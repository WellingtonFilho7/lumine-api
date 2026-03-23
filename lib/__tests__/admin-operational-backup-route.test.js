const test = require('node:test');
const assert = require('node:assert/strict');

function loadHandler({
  resolveActor = async () => ({ userId: 'admin-1', role: 'admin', source: 'jwt' }),
  ensureCors = () => true,
  ensureRateLimit = async () => true,
  setCors = () => ({ origin: '', allowedOrigin: '' }),
  createOperationalBackupDocument = async () => ({
    fileName: 'operational-backup-20260323_220000.json',
    json: '{"schemaVersion":1}',
  }),
} = {}) {
  const handlerPath = require.resolve('../../api/admin.js');
  const actorPath = require.resolve('../actor');
  const securityPath = require.resolve('../security');
  const servicePath = require.resolve('../operational-backup-service');

  delete require.cache[handlerPath];
  delete require.cache[actorPath];
  delete require.cache[securityPath];
  delete require.cache[servicePath];

  require.cache[actorPath] = {
    id: actorPath,
    filename: actorPath,
    loaded: true,
    exports: { resolveActor },
  };

  require.cache[securityPath] = {
    id: securityPath,
    filename: securityPath,
    loaded: true,
    exports: { ensureCors, ensureRateLimit, setCors },
  };

  require.cache[servicePath] = {
    id: servicePath,
    filename: servicePath,
    loaded: true,
    exports: { createOperationalBackupDocument },
  };

  const handler = require('../../api/admin.js');

  function restore() {
    delete require.cache[handlerPath];
    delete require.cache[actorPath];
    delete require.cache[securityPath];
    delete require.cache[servicePath];
  }

  return { handler, restore };
}

function createResponse() {
  return {
    statusCode: 200,
    headers: {},
    body: '',
    setHeader(name, value) {
      this.headers[name] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = JSON.stringify(payload);
      return this;
    },
    send(payload) {
      this.body = payload;
      return this;
    },
  };
}

test('admin operational backup download responde com attachment json', async () => {
  const { handler, restore } = loadHandler();

  try {
    const res = createResponse();
    await handler(
      {
        method: 'GET',
        url: '/api/admin/operational-backup/download',
        query: { action: 'operational-backup/download' },
        headers: { 'x-user-jwt': 'jwt' },
      },
      res
    );

    assert.equal(res.statusCode, 200);
    assert.equal(res.headers['Content-Type'], 'application/json; charset=utf-8');
    assert.equal(
      res.headers['Content-Disposition'],
      'attachment; filename="operational-backup-20260323_220000.json"'
    );
    assert.equal(res.body, '{"schemaVersion":1}');
  } finally {
    restore();
  }
});
