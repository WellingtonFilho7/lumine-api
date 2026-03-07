function buildSteps({ apply }) {
  const maybeApply = apply ? ['--apply'] : [];
  return [
    {
      name: 'export',
      args: ['scripts/export-finance-to-gastos-sheet.js', ...maybeApply],
    },
    {
      name: 'backfill',
      args: ['scripts/backfill-finance-gastos-sheet.js', ...maybeApply],
    },
  ];
}

module.exports = {
  buildSteps,
};
