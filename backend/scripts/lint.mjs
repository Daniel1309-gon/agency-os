import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { analyzeSourceTree, compareArchitectureBaseline } from './architecture-rules.mjs';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const baselinePath = new URL('../architecture-baseline.json', import.meta.url);
const baseline = JSON.parse(await readFile(baselinePath, 'utf8'));
const violations = await analyzeSourceTree(projectRoot);
const { unexpected, stale } = compareArchitectureBaseline(violations, baseline.exceptions);

const errors = [
  ...unexpected.map((item) => `${item.file}:${item.line}:${item.column} [${item.rule}] ${item.message}\n  baseline key: ${item.key}`),
  ...stale.map((key) => `architecture-baseline.json [stale-exception] remove resolved exception:\n  ${key}`),
];

if (errors.length) {
  console.error(errors.join('\n'));
  process.exitCode = 1;
} else {
  console.log(`backend AST lint checks passed (${baseline.exceptions.length} explicit architecture exceptions)`);
}
