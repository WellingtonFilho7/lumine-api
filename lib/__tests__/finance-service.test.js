const test = require('node:test');
const assert = require('node:assert/strict');

const { __private } = require('../finance-service');

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
