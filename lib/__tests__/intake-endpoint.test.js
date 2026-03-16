const test = require('node:test');
const assert = require('node:assert/strict');
const { z } = require('zod');

function loadIntakeEndpointModule({
  resolveActor = async () => ({ userId: 'user-1', role: 'admin', source: 'jwt' }),
  mirrorEvent = async () => {},
  ensureCors = () => true,
  ensureHoneypot = () => true,
  ensureRateLimit = async () => true,
  setCors = () => ({ origin: '', allowedOrigin: '' }),
} = {}) {
  const modulePath = require.resolve('../intake-endpoint');
  const actorPath = require.resolve('../actor');
  const mirrorPath = require.resolve('../mirror');
  const securityPath = require.resolve('../security');

  delete require.cache[modulePath];
  delete require.cache[actorPath];
  delete require.cache[mirrorPath];
  delete require.cache[securityPath];

  require.cache[actorPath] = {
    id: actorPath,
    filename: actorPath,
    loaded: true,
    exports: { resolveActor },
  };

  require.cache[mirrorPath] = {
    id: mirrorPath,
    filename: mirrorPath,
    loaded: true,
    exports: { mirrorEvent },
  };

  require.cache[securityPath] = {
    id: securityPath,
    filename: securityPath,
    loaded: true,
    exports: {
      ensureCors,
      ensureHoneypot,
      ensureRateLimit,
      setCors,
    },
  };

  const intakeEndpoint = require('../intake-endpoint');

  function restore() {
    delete require.cache[modulePath];
    delete require.cache[actorPath];
    delete require.cache[mirrorPath];
    delete require.cache[securityPath];
  }

  return { intakeEndpoint, restore };
}

function createResponse() {
  return {
    statusCode: 200,
    payload: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    },
  };
}

test('createIntakeHandler inclui details em erros 4xx com meta', async () => {
  const { intakeEndpoint, restore } = loadIntakeEndpointModule();

  try {
    const handler = intakeEndpoint.createIntakeHandler({
      action: 'triagem',
      schema: z.object({}),
      allowedRoles: ['admin'],
      handler: async () => {
        const error = new Error('Falha de validacao');
        error.statusCode = 400;
        error.code = 'INVALID_PAYLOAD';
        error.meta = { field: 'resultado' };
        throw error;
      },
    });

    const res = createResponse();
    await handler({ method: 'POST', body: {}, headers: {} }, res);

    assert.equal(res.statusCode, 400);
    assert.deepEqual(res.payload, {
      success: false,
      error: 'INVALID_PAYLOAD',
      message: 'Falha de validacao',
      details: { field: 'resultado' },
    });
  } finally {
    restore();
  }
});

test('createIntakeHandler usa mensagem publica padrao em erro 503', async () => {
  const { intakeEndpoint, restore } = loadIntakeEndpointModule();

  try {
    const handler = intakeEndpoint.createIntakeHandler({
      action: 'triagem',
      schema: z.object({}),
      allowedRoles: ['admin'],
      handler: async () => {
        const error = new Error('Falha interna do provedor');
        error.statusCode = 503;
        error.code = 'PROVIDER_DOWN';
        throw error;
      },
    });

    const res = createResponse();
    await handler({ method: 'POST', body: {}, headers: {} }, res);

    assert.equal(res.statusCode, 503);
    assert.deepEqual(res.payload, {
      success: false,
      error: 'PROVIDER_DOWN',
      message: 'Servico temporariamente indisponivel',
    });
  } finally {
    restore();
  }
});
