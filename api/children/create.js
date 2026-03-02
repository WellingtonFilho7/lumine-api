const { resolveActor } = require('../../lib/actor');
const { createChild } = require('../../lib/sync-supabase-service');
const { sendHandledError } = require('../../lib/http-errors');
const { ensureCors, ensureRateLimit, setCors } = require('../../lib/security');

module.exports = async (req, res) => {
  const { origin, allowedOrigin } = setCors(req, res, { methods: 'POST, OPTIONS' });
  if (!ensureCors(req, res, origin, allowedOrigin)) return;

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'METHOD_NOT_ALLOWED' });
  }

  if (!(await ensureRateLimit(req, res, 'children_create'))) return;

  try {
    const actor = await resolveActor(req, ['admin', 'triagem', 'secretaria']);
    const payload = req.body?.data || req.body || {};
    const deviceId = req.headers['x-device-id'] || '';
    const appVersion = req.headers['x-app-version'] || '';

    const result = await createChild(payload, actor, deviceId, appVersion);

    return res.status(200).json({
      success: true,
      data: {
        childId: result.childId,
        dataRev: result.dataRev,
        child: result.child,
        updatedAt: result.updatedAt,
      },
    });
  } catch (error) {
    return sendHandledError(res, 'children/create', error);
  }
};
