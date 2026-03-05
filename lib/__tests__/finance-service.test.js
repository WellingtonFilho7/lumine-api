const test = require('node:test');
const assert = require('node:assert/strict');

const { createFinanceService, __private } = require('../finance-service');

function createMockSupabase() {
  return {
    storage: {
      from: () => ({}),
    },
    from(table) {
      if (table === 'transacoes_financeiras') {
        return {
          select() {
            return this;
          },
          eq() {
            return this;
          },
          maybeSingle: async () => ({ data: null, error: null }),
          insert: row => ({
            select: () => ({
              single: async () => ({
                data: {
                  id: 'tx-1',
                  seq: 1,
                  created_at: '2026-03-05T12:00:00.000Z',
                  updated_at: '2026-03-05T12:00:00.000Z',
                  ...row,
                },
                error: null,
              }),
            }),
          }),
        };
      }

      if (table === 'audit_logs') {
        return {
          insert: async () => ({ error: null }),
        };
      }

      throw new Error(`Tabela inesperada no mock: ${table}`);
    },
  };
}

function sampleCreatePayload() {
  return {
    tipo: 'gasto',
    descricao: 'Compra material',
    categoria: 'operacional',
    valorCentavos: 12000,
    data: '2026-03-05',
    formaPagamento: 'pix',
    comprovantePath: 'finance/2026/03/user-1/comprovante.pdf',
    comprovanteMime: 'application/pdf',
  };
}

function sampleActor() {
  return {
    userId: '11111111-1111-4111-8111-111111111111',
    role: 'admin',
    source: 'jwt',
  };
}

test('fingerprint financeiro e deterministico para mesmo payload', () => {
  const payload = {
    tipo: 'gasto',
    categoria: 'operacional',
    descricao: 'Compra de materiais',
    valorCentavos: 1000,
    data: '2026-03-04',
    formaPagamento: 'pix',
    comprovantePath: 'finance/2026/03/u/arquivo.pdf',
  };

  const a = __private.buildFinanceFingerprint(payload, 'user-1');
  const b = __private.buildFinanceFingerprint(payload, 'user-1');
  const c = __private.buildFinanceFingerprint(payload, 'user-2');

  assert.equal(a, b);
  assert.notEqual(a, c);
});

test('cursor encode/decode preserva seq', () => {
  const encoded = __private.encodeCursor(9876);
  const decoded = __private.decodeCursor(encoded);

  assert.equal(decoded, 9876);
});

test('detector de unique violation reconhece constraint de idempotencia', () => {
  const isDup = __private.isUniqueViolationForConstraint(
    { code: '23505', message: 'duplicate key value violates unique constraint "uq_transacoes_financeiras_actor_idempotency"' },
    'uq_transacoes_financeiras_actor_idempotency'
  );

  assert.equal(isDup, true);
});

test('createTransaction rejeita quando comprovante nao existe no storage', async () => {
  const service = createFinanceService({
    getSupabaseAdmin: () => createMockSupabase(),
    getConfig: () => ({
      bucket: 'finance-comprovantes',
      prefix: 'finance',
      maxUploadBytes: 10 * 1024 * 1024,
      uploadUrlExpiresIn: 120,
      readUrlExpiresIn: 120,
      allowedMime: ['application/pdf'],
    }),
    getStorageObjectMetadata: async () => null,
  });

  await assert.rejects(
    () => service.createTransaction(sampleCreatePayload(), sampleActor()),
    error => error?.code === 'PROOF_FILE_NOT_FOUND'
  );
});

test('createTransaction rejeita quando arquivo excede limite real do storage', async () => {
  const service = createFinanceService({
    getSupabaseAdmin: () => createMockSupabase(),
    getConfig: () => ({
      bucket: 'finance-comprovantes',
      prefix: 'finance',
      maxUploadBytes: 100,
      uploadUrlExpiresIn: 120,
      readUrlExpiresIn: 120,
      allowedMime: ['application/pdf'],
    }),
    getStorageObjectMetadata: async () => ({
      size: 9999,
      mimeType: 'application/pdf',
    }),
  });

  await assert.rejects(
    () => service.createTransaction(sampleCreatePayload(), sampleActor()),
    error => error?.code === 'FILE_TOO_LARGE'
  );
});
