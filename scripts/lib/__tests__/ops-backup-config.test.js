const test = require('node:test');
const assert = require('node:assert/strict');

const {
  parseEnvAssignments,
  resolveOpsBackupOptions,
} = require('../ops-backup-config');

test('parseEnvAssignments ignora comentarios e preserva aspas simples ou duplas', () => {
  const result = parseEnvAssignments(`
# comentario
SUPABASE_URL="https://lumine.supabase.co"
SUPABASE_SERVICE_ROLE_KEY='secret-key'
OPS_BACKUP_DEFAULT_OUT_DIR=/tmp/lumine-backups
`);

  assert.deepEqual(result, {
    SUPABASE_URL: 'https://lumine.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'secret-key',
    OPS_BACKUP_DEFAULT_OUT_DIR: '/tmp/lumine-backups',
  });
});

test('resolveOpsBackupOptions usa saida padrao configurada no arquivo local', () => {
  const result = resolveOpsBackupOptions({
    cliArgs: { stdout: false, out: '' },
    env: {
      SUPABASE_URL: 'https://lumine.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'secret-key',
      OPS_BACKUP_DEFAULT_OUT: '/tmp/lumine-backups/fixo.json',
    },
  });

  assert.equal(result.out, '/tmp/lumine-backups/fixo.json');
  assert.equal(result.stdout, false);
});
