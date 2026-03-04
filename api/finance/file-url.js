const { resolveActor } = require('../../lib/actor');
const { sendHandledError } = require('../../lib/http-errors');
const { ensureCors, ensureRateLimit, setCors } = require('../../lib/security');
const { parseFinanceFileUrlPayload } = require('../../lib/finance-validation');
const { createFinanceFileUrl } = require('../../lib/finance-service');

module.exports = async (req, res) => {
  const { origin, allowedOrigin } = setCors(req, res, { methods: 'POST, OPTIONS' });
  if (!ensureCors(req, res, origin, allowedOrigin)) return;

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'METHOD_NOT_ALLOWED' });
  }

  if (!(await ensureRateLimit(req, res, 'finance_file_url'))) return;

  try {
    const actor = await resolveActor(req, ['admin', 'secretaria']);
    const payload = parseFinanceFileUrlPayload(req.body?.data || req.body || {});

    const result = await createFinanceFileUrl(payload, actor);

    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    return sendHandledError(res, 'finance/file-url', error);
  }
};
