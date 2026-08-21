import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const FR_IDS = Array.from({ length: 39 }, (_, index) => `FR-${String(index + 1).padStart(2, '0')}`);
const NFR_IDS = [
  'NFR-SECURITY',
  'NFR-PERFORMANCE',
  'NFR-COMPATIBILITY',
  'NFR-AVAILABILITY_HA',
  'NFR-MAINTAINABILITY',
];
const OQ_IDS = Array.from({ length: 13 }, (_, index) => `OQ-${String(index + 1).padStart(2, '0')}`);
const REQUIREMENT_STATES = ['COMPLIANT', 'PARTIAL', 'BLOCKED', 'N/A'];
const QUESTION_STATES = ['OPEN', 'PARTIAL'];

function countById(items) {
  const counts = new Map();
  for (const item of items) counts.set(item?.id, (counts.get(item?.id) ?? 0) + 1);
  return counts;
}

function exactlyOnceIssues(items, expectedIds, label) {
  const counts = countById(items);
  const expected = new Set(expectedIds);
  const issues = expectedIds
    .filter((id) => counts.get(id) !== 1)
    .map((id) => `${id} must appear exactly once in ${label}`);

  for (const id of counts.keys()) {
    if (!expected.has(id)) issues.push(`Unexpected ID ${String(id)} in ${label}`);
  }
  return issues;
}

function nonEmptyStrings(value) {
  return Array.isArray(value) && value.length > 0
    && value.every((entry) => typeof entry === 'string' && entry.trim().length > 0);
}

function isIsoDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function validateRequirementsCatalog(catalog) {
  const issues = [];
  if (!catalog || typeof catalog !== 'object') throw new Error('Requirements catalog must be an object');
  if (catalog.schemaVersion !== 1) issues.push('schemaVersion must be 1');

  const source = catalog.source ?? {};
  if (source.version !== '2.2') issues.push('source.version must be 2.2');
  if (!isIsoDate(source.auditedAt)) issues.push('source.auditedAt must be an ISO date');
  if (typeof source.path !== 'string' || !source.path.trim()) issues.push('source.path is required');
  if (typeof source.sha256 !== 'string' || !/^[A-Fa-f0-9]{64}$/.test(source.sha256)) {
    issues.push('source.sha256 must be a 64-character SHA-256');
  }

  const requirements = Array.isArray(catalog.requirements) ? catalog.requirements : [];
  issues.push(...exactlyOnceIssues(requirements, [...FR_IDS, ...NFR_IDS], 'requirements'));
  for (const requirement of requirements) {
    if (!REQUIREMENT_STATES.includes(requirement?.status)) {
      issues.push(`${String(requirement?.id)} status must be one of ${REQUIREMENT_STATES.join(', ')}`);
    }
    if (!nonEmptyStrings(requirement?.tasks)) issues.push(`${String(requirement?.id)} tasks must not be empty`);
    if (!nonEmptyStrings(requirement?.evidence)) issues.push(`${String(requirement?.id)} evidence must not be empty`);
  }

  const openQuestions = Array.isArray(catalog.openQuestions) ? catalog.openQuestions : [];
  issues.push(...exactlyOnceIssues(openQuestions, OQ_IDS, 'openQuestions'));
  for (const question of openQuestions) {
    const missing = [];
    if (!QUESTION_STATES.includes(question?.status)) missing.push('status');
    if (typeof question?.question !== 'string' || !question.question.trim()) missing.push('question');
    if (typeof question?.owner !== 'string' || !question.owner.trim()) missing.push('owner');
    if (!isIsoDate(question?.dueDate)) missing.push('dueDate');
    if (!nonEmptyStrings(question?.blocks)) missing.push('blocks');
    if (missing.length) issues.push(`${String(question?.id)} requires valid ${missing.join(', ')}`);
  }

  if (issues.length) throw new Error(issues.join('\n'));
}

function matrixEntries(markdown) {
  return markdown.split(/\r?\n/).flatMap((line) => {
    const cells = line.split('|').slice(1, -1).map((cell) => cell.trim());
    const [id] = cells;
    if (!/^(?:FR-\d{2}|NFR-[A-Z_]+|OQ-\d{2})$/.test(id ?? '')) return [];
    const statusCell = id.startsWith('OQ-') ? cells[1] : cells[2];
    return [{ id, status: statusCell?.replaceAll('`', '') }];
  });
}

export function validateMatrixMarkdown(markdown, catalog) {
  const entries = matrixEntries(markdown);
  const requirementIds = catalog.requirements.map(({ id }) => id);
  const questionIds = catalog.openQuestions.map(({ id }) => id);
  const issues = exactlyOnceIssues(entries, [...requirementIds, ...questionIds], 'requirements-matrix.md');
  const expectedStates = new Map([
    ...catalog.requirements.map(({ id, status }) => [id, status]),
    ...catalog.openQuestions.map(({ id, status }) => [id, status]),
  ]);
  for (const entry of entries) {
    const expected = expectedStates.get(entry.id);
    if (expected && entry.status !== expected) {
      issues.push(`${entry.id} matrix status ${String(entry.status)} does not match catalog ${expected}`);
    }
  }
  if (issues.length) throw new Error(issues.join('\n'));
}

export function verifyRepository(repoRoot) {
  const catalogPath = resolve(repoRoot, 'tasks/requirements-catalog.json');
  const matrixPath = resolve(repoRoot, 'tasks/requirements-matrix.md');
  const todoPath = resolve(repoRoot, 'tasks/todo.md');
  const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'));
  const matrix = readFileSync(matrixPath, 'utf8');
  const todo = readFileSync(todoPath, 'utf8');

  validateRequirementsCatalog(catalog);
  validateMatrixMarkdown(matrix, catalog);

  const issues = [];
  for (const requirement of catalog.requirements) {
    for (const task of requirement.tasks) {
      if (task !== 'N/A' && !todo.includes(`**${task}**`)) {
        issues.push(`${requirement.id} references unknown task ${task}`);
      }
    }
    for (const evidence of requirement.evidence) {
      const path = evidence.split('#')[0];
      if (!existsSync(resolve(repoRoot, path))) issues.push(`${requirement.id} evidence does not exist: ${evidence}`);
    }
  }
  for (const question of catalog.openQuestions) {
    for (const task of question.blocks) {
      if (!todo.includes(`**${task}**`)) issues.push(`${question.id} references unknown blocked task ${task}`);
    }
  }

  if (issues.length) throw new Error(issues.join('\n'));
  return { requirements: catalog.requirements.length, openQuestions: catalog.openQuestions.length };
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === pathToFileURL(currentFile).href) {
  const repoRoot = resolve(dirname(currentFile), '..');
  try {
    const result = verifyRepository(repoRoot);
    console.log(`Requirements traceability verified: ${result.requirements} requirements, ${result.openQuestions} open questions`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
