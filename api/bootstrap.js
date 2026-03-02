const { resolveActor } = require('../lib/actor');
const { loadOperationalData } = require('../lib/sync-supabase-service');
const { sendHandledError } = require('../lib/http-errors');
const { ensureCors, ensureRateLimit, setCors } = require('../lib/security');

module.exports = async (req, res) => {
  const { origin, allowedOrigin } = setCors(req, res, { methods: 'GET, OPTIONS' });
  if (!ensureCors(req, res, origin, allowedOrigin)) return;

  if (req.method !== 'GET') {
    return res.status(405).json({
      success: false,
      error: 'METHOD_NOT_ALLOWED',
      message: 'Metodo nao permitido',
    });
  }

  if (!(await ensureRateLimit(req, res, 'bootstrap_get'))) return;

  try {
    await resolveActor(req, []);
    const payload = await loadOperationalData();

    return res.status(200).json({
      success: true,
      data: {
        children: payload.children,
        records: payload.records,
      },
      dataRev: payload.dataRev,
      serverTs: new Date().toISOString(),
    });
  } catch (error) {
    return sendHandledError(res, 'bootstrap', error);
  }
};
