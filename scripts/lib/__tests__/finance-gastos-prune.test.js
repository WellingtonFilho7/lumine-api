const test = require('node:test');
const assert = require('node:assert/strict');

const { parseStartRowFromRange, computePrunePlan } = require('../finance-gastos-prune');

test('parseStartRowFromRange lê inicio da linha quando range inclui numero', () => {
  assert.equal(parseStartRowFromRange('gastos!A:ZZ'), 1);
  assert.equal(parseStartRowFromRange('gastos!A2:ZZ'), 2);
  assert.equal(parseStartRowFromRange('gastos!C10:ZZ'), 10);
});

test('computePrunePlan seleciona apenas IDs órfãos', () => {
  const rows = [
    ['transaction_id', 'descricao'],
    ['id-1', 'A'],
    ['id-2', 'B'],
    ['', 'linha manual'],
    ['id-3', 'C'],
  ];

  const financeIds = new Set(['id-1', 'id-3']);
  const plan = computePrunePlan({
    rows,
    transactionIdColumnIndex: 0,
    financeIds,
    startRowNumber: 1,
  });

  assert.deepEqual(plan.rowsToDelete, [3]);
  assert.deepEqual(plan.orphanTransactionIds, ['id-2']);
});

test('computePrunePlan respeita startRowNumber diferente de 1', () => {
  const rows = [
    ['transaction_id'],
    ['id-10'],
  ];

  const plan = computePrunePlan({
    rows,
    transactionIdColumnIndex: 0,
    financeIds: new Set(),
    startRowNumber: 2,
  });

  assert.deepEqual(plan.rowsToDelete, [3]);
});
