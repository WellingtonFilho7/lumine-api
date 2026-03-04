const { resolveActor } = require('../../lib/actor');
const { sendHandledError } = require('../../lib/http-errors');
const { ensureCors, ensureRateLimit, setCors } = require('../../lib/security');
const { parseFinanceListQuery } = require('../../lib/finance-validation');
const { listFinanceTransactions } = require('../../lib/finance-service');

module.exports = async (req, res) => {
  const { origin, allowedOrigin } = setCors(req, res, { methods: 'GET, OPTIONS' });
  if (!ensureCors(req, res, origin, allowedOrigin)) return;

  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'METHOD_NOT_ALLOWED' });
  }

  if (!(await ensureRateLimit(req, res, 'finance_list'))) return;

  try {
    const actor = await resolveActor(req, ['admin', 'secretaria']);
    const filters = parseFinanceListQuery(req.query || {});

    const result = await listFinanceTransactions(filters, actor);

    return res.status(200).json({
      success: true,
      data: {
        items: result.items,
        nextCursor: result.nextCursor,
        hasMore: result.hasMore,
      },
    });
  } catch (error) {
    return sendHandledError(res, 'finance/list', error);
  }
};
