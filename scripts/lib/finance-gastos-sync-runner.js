function buildSteps({ apply, prune }) {
  const maybeApply = apply ? ['--apply'] : [];
  const steps = [
    {
      name: 'export',
      args: ['scripts/export-finance-to-gastos-sheet.js', ...maybeApply],
    },
    {
      name: 'backfill',
      args: ['scripts/backfill-finance-gastos-sheet.js', ...maybeApply],
    },
  ];

  if (prune) {
    steps.push({
      name: 'prune',
      args: ['scripts/prune-finance-gastos-sheet.js', ...maybeApply],
    });
  }

  return steps;
}

module.exports = {
  buildSteps,
};
