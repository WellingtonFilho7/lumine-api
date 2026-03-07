const { normalizeText } = require('./finance-gastos-shared');

function parseStartRowFromRange(range) {
  const text = String(range || '').trim();
  const match = text.match(/![A-Z]+(\d+):/i);
  if (!match) return 1;
  const parsed = Number.parseInt(match[1], 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

function computePrunePlan({ rows, transactionIdColumnIndex, financeIds, startRowNumber }) {
  const rowsToDelete = [];
  const orphanTransactionIds = [];

  if (!Array.isArray(rows) || rows.length <= 1) {
    return { rowsToDelete, orphanTransactionIds };
  }

  for (let i = 1; i < rows.length; i += 1) {
    const row = rows[i] || [];
    const transactionId = normalizeText(row[transactionIdColumnIndex] || '', 200);
    if (!transactionId) continue;
    if (financeIds.has(transactionId)) continue;

    rowsToDelete.push(startRowNumber + i);
    orphanTransactionIds.push(transactionId);
  }

  return { rowsToDelete, orphanTransactionIds };
}

module.exports = {
  parseStartRowFromRange,
  computePrunePlan,
};
