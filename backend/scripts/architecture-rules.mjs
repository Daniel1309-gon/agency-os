import { readdir, readFile } from 'node:fs/promises';
import { basename, dirname, join, posix, relative, resolve } from 'node:path';
import ts from 'typescript';

const APPLICATION_FILE = /\.(controller|gateway|service|worker)\.ts$/;
const PUBLIC_MODULE_FILE = /\.(contracts|module|port)\.js$/;
const SELECT_STAR = /\bSELECT\s+\*/i;

function normalizedPath(path) {
  return path.replaceAll('\\', '/');
}

function moduleName(path) {
  return normalizedPath(path).match(/(?:^|\/)src\/modules\/([^/]+)\//)?.[1];
}

function importNames(node) {
  const clause = node.importClause;
  if (!clause) return ['side-effect'];
  const names = [];
  if (clause.name) names.push(`default:${clause.name.text}`);
  if (clause.namedBindings) {
    if (ts.isNamespaceImport(clause.namedBindings)) names.push(`namespace:${clause.namedBindings.name.text}`);
    else names.push(...clause.namedBindings.elements.map((element) => element.propertyName?.text ?? element.name.text));
  }
  return names.sort();
}

function violation(sourceFile, node, rule, detail, message) {
  const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  const file = normalizedPath(sourceFile.fileName);
  return {
    rule,
    file,
    line: position.line + 1,
    column: position.character + 1,
    key: `${rule}:${file}:${detail}`,
    message,
  };
}

function importedModule(filePath, moduleSpecifier) {
  if (!moduleSpecifier.startsWith('.')) return undefined;
  const resolvedImport = posix.normalize(posix.join(posix.dirname(normalizedPath(filePath)), moduleSpecifier));
  return moduleName(resolvedImport);
}

export function analyzeTypeScriptSource(filePath, source) {
  const normalizedFile = normalizedPath(filePath);
  const sourceFile = ts.createSourceFile(normalizedFile, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const violations = [];

  function visit(node) {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const specifier = node.moduleSpecifier.text;
      if (moduleName(normalizedFile) && APPLICATION_FILE.test(basename(normalizedFile)) && /(?:^|\/)database\/schema(?:\/|$)/.test(specifier)) {
        const names = importNames(node).join(',');
        violations.push(violation(
          sourceFile,
          node,
          'module-no-direct-schema',
          `${specifier}:${names}`,
          'application code must use a domain repository port instead of importing database schema',
        ));
      }

      const sourceModule = moduleName(normalizedFile);
      const targetModule = importedModule(normalizedFile, specifier);
      if (sourceModule && targetModule && sourceModule !== targetModule && !PUBLIC_MODULE_FILE.test(basename(specifier))) {
        violations.push(violation(
          sourceFile,
          node,
          'module-no-private-cross-import',
          specifier,
          `module ${sourceModule} must not import private implementation from module ${targetModule}`,
        ));
      }
    }

    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const receiver = node.expression.expression;
      const method = node.expression.name.text;
      if (ts.isIdentifier(receiver) && receiver.text === 'console' && method === 'log') {
        violations.push(violation(sourceFile, node, 'no-console-log', 'console.log', 'use LoggerService instead of console.log'));
      }
      if (ts.isIdentifier(receiver) && receiver.text === 'sql' && method === 'raw') {
        violations.push(violation(sourceFile, node, 'no-sql-raw', 'sql.raw', 'sql.raw() is forbidden outside migrations'));
      }
    }

    if (ts.isStringLiteralLike(node) && SELECT_STAR.test(node.text)) {
      violations.push(violation(sourceFile, node, 'no-select-star', node.text, 'SELECT * is forbidden'));
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return violations;
}

async function sourceFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await sourceFiles(path));
    else if (entry.name.endsWith('.ts')) files.push(path);
  }
  return files;
}

export async function analyzeSourceTree(projectRoot, sourceRoot = join(projectRoot, 'src')) {
  const absoluteProjectRoot = resolve(projectRoot);
  const files = await sourceFiles(resolve(sourceRoot));
  const results = await Promise.all(files.map(async (file) => {
    const displayPath = normalizedPath(relative(absoluteProjectRoot, file));
    return analyzeTypeScriptSource(displayPath, await readFile(file, 'utf8'));
  }));
  return results.flat();
}

export function compareArchitectureBaseline(violations, baselineKeys) {
  const actual = new Set(violations.map((item) => item.key));
  const baseline = new Set(baselineKeys);
  return {
    unexpected: violations.filter((item) => !baseline.has(item.key)),
    stale: [...baseline].filter((key) => !actual.has(key)).sort(),
  };
}
