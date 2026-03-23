const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildOperationalBackupPayload,
  buildOperationalBackupFilePath,
} = require('../operational-backup');

test('buildOperationalBackupPayload inclui metadados e contagens padrao', () => {
  const result = buildOperationalBackupPayload({
    generatedAt: '2026-03-23T12:00:00.000Z',
    payload: {
      dataRev: 7,
      children: [{ id: 'c1' }, { id: 'c2' }],
      records: [{ id: 'r1' }],
    },
  });

  assert.equal(result.schemaVersion, 1);
  assert.equal(result.generatedAt, '2026-03-23T12:00:00.000Z');
  assert.equal(result.source, 'supabase');
  assert.equal(result.dataRev, 7);
  assert.deepEqual(result.counts, { children: 2, records: 1 });
  assert.equal(result.children.length, 2);
  assert.equal(result.records.length, 1);
});

test('buildOperationalBackupFilePath gera caminho timestampado em backups/operational', () => {
  const result = buildOperationalBackupFilePath({
    generatedAt: '2026-03-23T12:34:56.000Z',
  });

  assert.equal(result, 'backups/operational/operational-backup-20260323_123456.json');
});
