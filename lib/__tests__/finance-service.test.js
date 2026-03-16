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

function createTransactionRow(row = {}) {
  return {
    id: 'tx-1',
    seq: 1,
    tipo: 'gasto',
    descricao: 'Compra material',
    categoria: 'operacional',
    valor_centavos: 12000,
    data_transacao: '2026-03-05',
    forma_pagamento: 'pix',
    comprovante_path: 'finance/2026/03/user-1/comprovante.pdf',
    comprovante_mime: 'application/pdf',
    comprovante_nome: null,
    registrado_por: '11111111-1111-4111-8111-111111111111',
    updated_by: '11111111-1111-4111-8111-111111111111',
    created_at: '2026-03-05T12:00:00.000Z',
    updated_at: '2026-03-05T12:00:00.000Z',
    ...row,
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

test('createTransaction registra audit log em criacao bem-sucedida', async () => {
  const auditEntries = [];
  const insertedRow = createTransactionRow();
  const service = createFinanceService({
    getSupabaseAdmin: () => ({
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
                  data: { ...insertedRow, ...row },
                  error: null,
                }),
              }),
            }),
          };
        }

        if (table === 'audit_logs') {
          return {
            insert: async payload => {
              auditEntries.push(payload);
              return { error: null };
            },
          };
        }

        throw new Error(`Tabela inesperada no mock: ${table}`);
      },
    }),
    getConfig: () => ({
      bucket: 'finance-comprovantes',
      prefix: 'finance',
      maxUploadBytes: 10 * 1024 * 1024,
      uploadUrlExpiresIn: 120,
      readUrlExpiresIn: 120,
      allowedMime: ['application/pdf'],
    }),
    getStorageObjectMetadata: async () => ({
      size: 1234,
      mimeType: 'application/pdf',
    }),
  });

  const result = await service.createTransaction(sampleCreatePayload(), sampleActor());

  assert.equal(result.duplicated, false);
  assert.equal(auditEntries.length, 1);
  assert.equal(auditEntries[0].action, 'finance_create');
  assert.equal(auditEntries[0].resource_type, 'finance');
  assert.equal(auditEntries[0].resource_id, insertedRow.id);
});

test('createTransaction retorna duplicado e registra audit log quando idempotencyKey reaparece', async () => {
  const auditEntries = [];
  const duplicatedRow = createTransactionRow({
    id: 'tx-duplicated',
    idempotency_key: 'idem-1',
  });

  const service = createFinanceService({
    getSupabaseAdmin: () => ({
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
            maybeSingle: async () => ({ data: duplicatedRow, error: null }),
          };
        }

        if (table === 'audit_logs') {
          return {
            insert: async payload => {
              auditEntries.push(payload);
              return { error: null };
            },
          };
        }

        throw new Error(`Tabela inesperada no mock: ${table}`);
      },
    }),
    getConfig: () => ({
      bucket: 'finance-comprovantes',
      prefix: 'finance',
      maxUploadBytes: 10 * 1024 * 1024,
      uploadUrlExpiresIn: 120,
      readUrlExpiresIn: 120,
      allowedMime: ['application/pdf'],
    }),
    getStorageObjectMetadata: async () => {
      throw new Error('nao deveria consultar storage em replay idempotente');
    },
  });

  const result = await service.createTransaction(
    { ...sampleCreatePayload(), idempotencyKey: 'idem-1' },
    sampleActor()
  );

  assert.equal(result.duplicated, true);
  assert.equal(result.transaction.id, 'tx-duplicated');
  assert.equal(auditEntries.length, 1);
  assert.equal(auditEntries[0].action, 'finance_create_duplicate');
  assert.equal(auditEntries[0].meta.reason, 'idempotency_key_replay');
});
