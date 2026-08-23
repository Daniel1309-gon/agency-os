import { readdirSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { RequirePermissions, RequireRoles } from './decorators.js';

const HTTP_DECORATORS = new Set(['All', 'Delete', 'Get', 'Head', 'Options', 'Patch', 'Post', 'Put', 'Sse']);
const POLICY_DECORATORS = new Set(['Authenticated', 'Public', 'RequirePermissions', 'RequireRoles']);
const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const authDecoratorsPath = resolve(sourceRoot, 'common/auth/decorators.ts');
const canaryPath = resolve(sourceRoot, 'modules/canary/canary.controller.ts');

type ImportSource = 'auth' | 'nest';

interface ImportedDecorator {
  importedName: string;
  source: ImportSource;
}

interface ImportBindings {
  named: Map<string, ImportedDecorator>;
  namespaces: Map<string, ImportSource>;
}

interface DecoratorUse {
  argumentCount: number;
  hasBlankStringArgument: boolean;
  invoked: boolean;
  name: string;
}

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return entry.name === 'test' ? [] : sourceFiles(path);
    const isTest = entry.name.endsWith('.spec.ts') || entry.name.endsWith('.test.ts');
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts') && !isTest ? [path] : [];
  });
}

function importSource(source: ts.SourceFile, moduleName: string): ImportSource | undefined {
  if (moduleName === '@nestjs/common') return 'nest';
  if (!moduleName.startsWith('.')) return undefined;
  const importedPath = resolve(dirname(source.fileName), moduleName.replace(/\.js$/, '.ts'));
  return importedPath === authDecoratorsPath ? 'auth' : undefined;
}

function importsOf(source: ts.SourceFile): ImportBindings {
  const bindings: ImportBindings = { named: new Map(), namespaces: new Map() };

  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const origin = importSource(source, statement.moduleSpecifier.text);
    const clause = statement.importClause;
    if (!origin || !clause?.namedBindings) continue;

    if (ts.isNamespaceImport(clause.namedBindings)) {
      bindings.namespaces.set(clause.namedBindings.name.text, origin);
      continue;
    }

    for (const element of clause.namedBindings.elements) {
      bindings.named.set(element.name.text, {
        importedName: element.propertyName?.text ?? element.name.text,
        source: origin,
      });
    }
  }

  return bindings;
}

function importedDecorator(
  expression: ts.LeftHandSideExpression,
  imports: ImportBindings,
): ImportedDecorator | undefined {
  if (ts.isIdentifier(expression)) return imports.named.get(expression.text);
  if (!ts.isPropertyAccessExpression(expression) || !ts.isIdentifier(expression.expression)) return undefined;
  const source = imports.namespaces.get(expression.expression.text);
  return source ? { importedName: expression.name.text, source } : undefined;
}

function decoratorUses(node: ts.Node, imports: ImportBindings): DecoratorUse[] {
  if (!ts.canHaveDecorators(node)) return [];
  return (ts.getDecorators(node) ?? []).flatMap((decorator) => {
    const invoked = ts.isCallExpression(decorator.expression);
    const expression = invoked ? decorator.expression.expression : decorator.expression;
    const imported = importedDecorator(expression, imports);
    if (!imported) return [];

    const isKnownNest = imported.source === 'nest'
      && (imported.importedName === 'Controller' || HTTP_DECORATORS.has(imported.importedName));
    const isKnownPolicy = imported.source === 'auth' && POLICY_DECORATORS.has(imported.importedName);
    if (!isKnownNest && !isKnownPolicy) return [];

    const args = invoked ? decorator.expression.arguments : [];
    return [{
      argumentCount: args.length,
      hasBlankStringArgument: args.some((argument) => ts.isStringLiteral(argument) && !argument.text.trim()),
      invoked,
      name: imported.importedName,
    }];
  });
}

function policyViolation(policies: DecoratorUse[], location: string): string | undefined {
  if (policies.length > 1) return `${location}: multiple access policies`;
  const [policy] = policies;
  if (!policy) return undefined;
  if (!policy.invoked) return `${location}: @${policy.name} must be invoked`;
  if (
    (policy.name === 'RequirePermissions' || policy.name === 'RequireRoles')
    && (!policy.argumentCount || policy.hasBlankStringArgument)
  ) {
    return `${location}: @${policy.name} requires at least one non-empty value`;
  }
  return undefined;
}

function routePolicyViolations(source: ts.SourceFile, displayPath: string): string[] {
  const violations: string[] = [];
  const imports = importsOf(source);

  source.forEachChild((node) => {
    if (!ts.isClassDeclaration(node)) return;
    const classDecorators = decoratorUses(node, imports);
    if (!classDecorators.some((decorator) => decorator.name === 'Controller' && decorator.invoked)) return;

    const classPolicies = classDecorators.filter((decorator) => POLICY_DECORATORS.has(decorator.name));
    const className = node.name?.text ?? '<anonymous controller>';
    const classLocation = `${displayPath} ${className}`;
    const invalidClassPolicy = policyViolation(classPolicies, classLocation);
    if (invalidClassPolicy) {
      violations.push(invalidClassPolicy);
      return;
    }

    for (const member of node.members) {
      if (!ts.isMethodDeclaration(member)) continue;
      const decorators = decoratorUses(member, imports);
      const httpDecorator = decorators.find((decorator) => HTTP_DECORATORS.has(decorator.name));
      if (!httpDecorator) continue;

      const methodName = ts.isIdentifier(member.name) || ts.isStringLiteral(member.name)
        ? member.name.text
        : member.name.getText(source);
      const { line } = source.getLineAndCharacterOfPosition(member.getStart(source));
      const location = `${displayPath}:${line + 1} ${className}.${methodName}`;
      const methodPolicies = decorators.filter((decorator) => POLICY_DECORATORS.has(decorator.name));
      const invalidMethodPolicy = policyViolation(methodPolicies, location);

      if (!httpDecorator.invoked) {
        violations.push(`${location}: @${httpDecorator.name} must be invoked`);
      } else if (invalidMethodPolicy) {
        violations.push(invalidMethodPolicy);
      } else if (!classPolicies.length && !methodPolicies.length) {
        violations.push(`${location} (@${httpDecorator.name}) has no explicit access policy`);
      } else if (
        classPolicies[0]?.name === 'Public'
        && methodPolicies.length
        && methodPolicies[0]?.name !== 'Public'
      ) {
        violations.push(`${location}: a class-level @Public policy cannot be restricted at method level`);
      }
    }
  });

  return violations;
}

function canarySource(sourceText: string): ts.SourceFile {
  return ts.createSourceFile(
    canaryPath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
}

describe('HTTP route policies', () => {
  it.each([
    ['RequirePermissions', RequirePermissions],
    ['RequireRoles', RequireRoles],
  ])('rejects an empty %s decorator at runtime', (_name, decorator) => {
    expect(() => decorator()).toThrow(/at least one/i);
    expect(() => decorator('')).toThrow(/at least one/i);
  });

  it('detects an unclassified route canary', () => {
    const source = canarySource(`
      import { Controller, Get } from '@nestjs/common';
      @Controller('canary')
      class CanaryController {
        @Get() open() {}
      }
    `);

    expect(routePolicyViolations(source, 'canary.controller.ts')).toHaveLength(1);
  });

  it.each([
    {
      name: 'an aliased HTTP decorator',
      source: `
        import { Controller, Get as Read } from '@nestjs/common';
        @Controller('canary')
        class CanaryController {
          @Read() open() {}
        }
      `,
    },
    {
      name: 'an unrelated same-name decorator',
      source: `
        import { Controller, Get } from '@nestjs/common';
        const Authenticated = () => () => undefined;
        @Controller('canary')
        class CanaryController {
          @Get() @Authenticated() open() {}
        }
      `,
    },
    {
      name: 'an empty role policy',
      source: `
        import { Controller, Get } from '@nestjs/common';
        import { RequireRoles } from '../../common/auth/decorators.js';
        @Controller('canary')
        class CanaryController {
          @Get() @RequireRoles() open() {}
        }
      `,
    },
    {
      name: 'a blank permission policy',
      source: `
        import { Controller, Get } from '@nestjs/common';
        import { RequirePermissions } from '../../common/auth/decorators.js';
        @Controller('canary')
        class CanaryController {
          @Get() @RequirePermissions('') open() {}
        }
      `,
    },
    {
      name: 'an uninvoked policy factory',
      source: `
        import { Controller, Get } from '@nestjs/common';
        import { Authenticated } from '../../common/auth/decorators.js';
        @Controller('canary')
        class CanaryController {
          @Get() @Authenticated open() {}
        }
      `,
    },
    {
      name: 'contradictory method policies',
      source: `
        import { Controller, Get } from '@nestjs/common';
        import { Public, RequireRoles } from '../../common/auth/decorators.js';
        @Controller('canary')
        class CanaryController {
          @Get() @Public() @RequireRoles('ADMIN') open() {}
        }
      `,
    },
    {
      name: 'RequireShift without an access policy',
      source: `
        import { Controller, Get } from '@nestjs/common';
        import { RequireShift } from '../../common/auth/decorators.js';
        @Controller('canary')
        class CanaryController {
          @Get() @RequireShift() open() {}
        }
      `,
    },
    {
      name: 'a restriction below a class-level Public policy',
      source: `
        import { Controller, Get } from '@nestjs/common';
        import { Authenticated, Public } from '../../common/auth/decorators.js';
        @Controller('canary')
        @Public()
        class CanaryController {
          @Get() @Authenticated() open() {}
        }
      `,
    },
  ])('rejects $name', ({ source: sourceText }) => {
    expect(routePolicyViolations(canarySource(sourceText), 'canary.controller.ts')).toHaveLength(1);
  });

  it('accepts a valid class-level Public policy', () => {
    const source = canarySource(`
      import { Controller, Get } from '@nestjs/common';
      import { Public } from '../../common/auth/decorators.js';
      @Controller('canary')
      @Public()
      class CanaryController {
        @Get() open() {}
      }
    `);

    expect(routePolicyViolations(source, 'canary.controller.ts')).toEqual([]);
  });

  it('requires every controller route to declare one valid explicit access policy', () => {
    const violations = sourceFiles(sourceRoot).flatMap((file) => {
      const source = ts.createSourceFile(
        file,
        readFileSync(file, 'utf8'),
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TS,
      );
      return routePolicyViolations(source, relative(sourceRoot, file));
    });

    expect(violations, `Invalid or missing route policies:\n${violations.join('\n')}`).toEqual([]);
  });

  it('allows the IP allowlist exception only on the health controller', () => {
    const uses = sourceFiles(sourceRoot)
      .filter((file) => /\bSkipIpAllowlist\s*\(/.test(readFileSync(file, 'utf8')))
      .map((file) => relative(sourceRoot, file).replaceAll('\\', '/'));

    expect(uses).toEqual(['modules/health/health.controller.ts']);
  });
});
