const fs = require('node:fs');
const path = require('node:path');

function formatTimestampForFilename(isoTimestamp) {
  return String(isoTimestamp)
    .replace(/[-:]/g, '')
    .replace('T', '_')
    .replace(/\.\d{3}Z$/, '')
    .replace(/Z$/, '');
}

function buildDefaultBackupFilePath({ generatedAt, outDir }) {
  return path.join(outDir, `operational-backup-${formatTimestampForFilename(generatedAt)}.json`);
}

function stripWrappingQuotes(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function parseEnvAssignments(source) {
  return String(source || '')
    .split(/\r?\n/)
    .reduce((acc, line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return acc;

      const separatorIndex = trimmed.indexOf('=');
      if (separatorIndex <= 0) return acc;

      const key = trimmed.slice(0, separatorIndex).trim();
      const rawValue = trimmed.slice(separatorIndex + 1).trim();
      acc[key] = stripWrappingQuotes(rawValue);
      return acc;
    }, {});
}

function loadOpsEnvFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return {};
  return parseEnvAssignments(fs.readFileSync(filePath, 'utf8'));
}

function resolveOpsBackupOptions({ cliArgs, env }) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      'Configure SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no ambiente ou em .env.ops.local'
    );
  }

  const generatedAt = cliArgs.generatedAt || new Date().toISOString();
  const out =
    cliArgs.out ||
    env.OPS_BACKUP_DEFAULT_OUT ||
    (env.OPS_BACKUP_DEFAULT_OUT_DIR
      ? buildDefaultBackupFilePath({
          generatedAt,
          outDir: env.OPS_BACKUP_DEFAULT_OUT_DIR,
        })
      : '');

  return {
    stdout: Boolean(cliArgs.stdout),
    out,
    generatedAt,
  };
}

function getDefaultOpsEnvPath(cwd = process.cwd()) {
  return path.join(cwd, '.env.ops.local');
}

module.exports = {
  buildDefaultBackupFilePath,
  formatTimestampForFilename,
  getDefaultOpsEnvPath,
  loadOpsEnvFile,
  parseEnvAssignments,
  resolveOpsBackupOptions,
};
