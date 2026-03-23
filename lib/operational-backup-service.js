const fs = require('node:fs');
const path = require('node:path');
const { loadOperationalData } = require('./sync-supabase-service');

function formatTimestampForFilename(isoTimestamp) {
  return String(isoTimestamp)
    .replace(/[-:]/g, '')
    .replace('T', '_')
    .replace(/\.\d{3}Z$/, '')
    .replace(/Z$/, '');
}

function buildOperationalBackupPayload({ generatedAt, payload, source = 'supabase' }) {
  const children = Array.isArray(payload?.children) ? payload.children : [];
  const records = Array.isArray(payload?.records) ? payload.records : [];

  return {
    schemaVersion: 1,
    generatedAt,
    source,
    dataRev: Number(payload?.dataRev || 0),
    counts: {
      children: children.length,
      records: records.length,
    },
    children,
    records,
  };
}

function buildOperationalBackupFilePath({
  generatedAt,
  outDir = path.join('backups', 'operational'),
  prefix = 'operational-backup',
}) {
  return path.join(outDir, `${prefix}-${formatTimestampForFilename(generatedAt)}.json`);
}

async function createOperationalBackupDocument({
  generatedAt = new Date().toISOString(),
  source = 'supabase',
} = {}) {
  const operationalData = await loadOperationalData();
  const payload = buildOperationalBackupPayload({
    generatedAt,
    payload: operationalData,
    source,
  });
  const filePath = buildOperationalBackupFilePath({ generatedAt, outDir: '' });
  const fileName = path.basename(filePath);
  const json = `${JSON.stringify(payload, null, 2)}\n`;

  return {
    generatedAt,
    fileName,
    payload,
    json,
  };
}

function writeOperationalBackupDocument({ document, outputPath }) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, document.json, 'utf8');
  return outputPath;
}

module.exports = {
  buildOperationalBackupFilePath,
  buildOperationalBackupPayload,
  createOperationalBackupDocument,
  formatTimestampForFilename,
  writeOperationalBackupDocument,
};
