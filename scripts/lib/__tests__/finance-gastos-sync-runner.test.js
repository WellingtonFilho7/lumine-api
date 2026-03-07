const test = require('node:test');
const assert = require('node:assert/strict');

const { buildSteps } = require('../finance-gastos-sync-runner');

test('buildSteps em dry-run executa export e backfill sem --apply', () => {
  const steps = buildSteps({ apply: false });
  assert.equal(steps.length, 2);
  assert.equal(steps[0].name, 'export');
  assert.equal(steps[1].name, 'backfill');
  assert.deepEqual(steps[0].args, ['scripts/export-finance-to-gastos-sheet.js']);
  assert.deepEqual(steps[1].args, ['scripts/backfill-finance-gastos-sheet.js']);
});

test('buildSteps em apply executa export e backfill com --apply', () => {
  const steps = buildSteps({ apply: true });
  assert.equal(steps.length, 2);
  assert.deepEqual(steps[0].args, ['scripts/export-finance-to-gastos-sheet.js', '--apply']);
  assert.deepEqual(steps[1].args, ['scripts/backfill-finance-gastos-sheet.js', '--apply']);
});

test('buildSteps com prune inclui etapa de limpeza ao final', () => {
  const steps = buildSteps({ apply: true, prune: true });
  assert.equal(steps.length, 3);
  assert.deepEqual(steps[0].args, ['scripts/export-finance-to-gastos-sheet.js', '--apply']);
  assert.deepEqual(steps[1].args, ['scripts/backfill-finance-gastos-sheet.js', '--apply']);
  assert.deepEqual(steps[2].args, ['scripts/prune-finance-gastos-sheet.js', '--apply']);
});
