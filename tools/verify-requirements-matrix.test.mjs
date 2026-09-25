import assert from 'node:assert/strict';
import test from 'node:test';
import {
  validateMatrixMarkdown,
  validateRequirementsCatalog,
} from './verify-requirements-matrix.mjs';

const frIds = Array.from({ length: 39 }, (_, index) => `FR-${String(index + 1).padStart(2, '0')}`);
const nfrIds = [
  'NFR-SECURITY',
  'NFR-PERFORMANCE',
  'NFR-COMPATIBILITY',
  'NFR-AVAILABILITY_HA',
  'NFR-MAINTAINABILITY',
];
const oqIds = Array.from({ length: 13 }, (_, index) => `OQ-${String(index + 1).padStart(2, '0')}`);

function validCatalog() {
  return {
    schemaVersion: 1,
    source: {
      version: '2.2',
      auditedAt: '2026-08-20',
      path: 'requirements.md',
      sha256: 'A'.repeat(64),
    },
    requirements: [...frIds, ...nfrIds].map((id) => ({
      id,
      status: id === 'FR-13' ? 'N/A' : 'PARTIAL',
      tasks: id === 'FR-13' ? ['N/A'] : ['FND-01'],
      evidence: ['tasks/plan.md'],
    })),
    openQuestions: oqIds.map((id) => ({
      id,
      status: 'OPEN',
      question: 'A concrete unresolved decision',
      owner: 'Project owner',
      dueDate: '2026-08-31',
      blocks: ['FND-01'],
    })),
  };
}

test('accepts exactly FR-01..FR-39, five NFR groups and OQ-01..OQ-13', () => {
  assert.doesNotThrow(() => validateRequirementsCatalog(validCatalog()));
});

test('rejects a missing or duplicated requirement ID', () => {
  const missing = validCatalog();
  missing.requirements = missing.requirements.filter(({ id }) => id !== 'FR-39');
  assert.throws(() => validateRequirementsCatalog(missing), /FR-39/);

  const duplicated = validCatalog();
  duplicated.requirements.push({ ...duplicated.requirements[0] });
  assert.throws(() => validateRequirementsCatalog(duplicated), /FR-01.*exactly once/i);
});

test('rejects non-canonical states and requirements without tasks or evidence', () => {
  const invalidStatus = validCatalog();
  invalidStatus.requirements[0].status = 'Parcial avanzado';
  assert.throws(() => validateRequirementsCatalog(invalidStatus), /COMPLIANT.*PARTIAL.*BLOCKED.*N\/A/);

  const missingTrace = validCatalog();
  missingTrace.requirements[0].evidence = [];
  assert.throws(() => validateRequirementsCatalog(missingTrace), /FR-01.*evidence/i);
});

test('rejects open questions without an owner, ISO due date or blocked task', () => {
  const catalog = validCatalog();
  catalog.openQuestions[0].owner = '';
  catalog.openQuestions[0].dueDate = 'before SEC-02';
  catalog.openQuestions[0].blocks = [];

  assert.throws(() => validateRequirementsCatalog(catalog), /OQ-01.*owner.*dueDate.*blocks/i);
});

test('rejects impossible calendar dates and open questions without their question text', () => {
  const catalog = validCatalog();
  catalog.openQuestions[0].dueDate = '2026-02-31';
  catalog.openQuestions[0].question = '';

  assert.throws(() => validateRequirementsCatalog(catalog), /OQ-01.*question.*dueDate/i);
});

test('requires the human-readable matrix to contain every catalog ID exactly once', () => {
  const catalog = validCatalog();
  const markdown = [
    ...catalog.requirements.map(({ id, status }) => `| ${id} | Requirement | \`${status}\` |`),
    ...catalog.openQuestions.map(({ id, status }) => `| ${id} | \`${status}\` |`),
  ].join('\n');
  assert.doesNotThrow(() => validateMatrixMarkdown(markdown, catalog));
  assert.throws(
    () => validateMatrixMarkdown(markdown.replace('FR-39', 'FR-38'), catalog),
    /FR-38.*exactly once.*FR-39.*exactly once/is,
  );

  assert.throws(
    () => validateMatrixMarkdown(markdown.replace('`PARTIAL`', '`COMPLIANT`'), catalog),
    /FR-01.*COMPLIANT.*PARTIAL/i,
  );
});
