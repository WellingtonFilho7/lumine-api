const { resolveActor } = require('../../lib/actor');
const { sendHandledError } = require('../../lib/http-errors');
const { ensureCors, ensureRateLimit, setCors } = require('../../lib/security');
const { parseFinanceCreatePayload } = require('../../lib/finance-validation');
const { createFinanceTransaction } = require('../../lib/finance-service');

module.exports = async (req, res) => {
  const { origin, allowedOrigin } = setCors(req, res, { methods: 'POST, OPTIONS' });
  if (!ensureCors(req, res, origin, allowedOrigin)) return;

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'METHOD_NOT_ALLOWED' });
  }

  if (!(await ensureRateLimit(req, res, 'finance_create'))) return;

  try {
    const actor = await resolveActor(req, ['admin', 'secretaria']);
    const payload = parseFinanceCreatePayload(req.body?.data || req.body || {});

    const result = await createFinanceTransaction(payload, actor);

    return res.status(200).json({
      success: true,
      data: {
        transaction: result.transaction,
        duplicated: result.duplicated,
      },
    });
  } catch (error) {
    return sendHandledError(res, 'finance/create', error);
  }
};
