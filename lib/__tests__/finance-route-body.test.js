const test = require('node:test');
const assert = require('node:assert/strict');
const financeHandler = require('../../api/finance/[action].js');

test('normalizeBodyPayload preserva payload quando data e string de data da transacao', () => {
  const payload = {
    tipo: 'gasto',
    data: '2026-03-05',
    categoria: 'infra',
  };

  const normalized = financeHandler.__private.normalizeBodyPayload(payload);
  assert.deepEqual(normalized, payload);
});

test('normalizeBodyPayload prioriza envelope data quando data e objeto', () => {
  const normalized = financeHandler.__private.normalizeBodyPayload({
    data: { tipo: 'doacao', categoria: 'oferta' },
    ignored: true,
  });

  assert.deepEqual(normalized, { tipo: 'doacao', categoria: 'oferta' });
});

test('normalizeBodyPayload aceita body json string', () => {
  const normalized = financeHandler.__private.normalizeBodyPayload(
    '{"tipo":"gasto","data":"2026-03-05"}'
  );

  assert.deepEqual(normalized, { tipo: 'gasto', data: '2026-03-05' });
});
