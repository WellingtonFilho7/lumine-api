const { resolveActor } = require('../../lib/actor');
const { updateChild } = require('../../lib/sync-supabase-service');
const { sendHandledError } = require('../../lib/http-errors');
const { ensureCors, ensureRateLimit, setCors } = require('../../lib/security');

module.exports = async (req, res) => {
  const { origin, allowedOrigin } = setCors(req, res, { methods: 'POST, OPTIONS' });
  if (!ensureCors(req, res, origin, allowedOrigin)) return;

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'METHOD_NOT_ALLOWED' });
  }

  if (!(await ensureRateLimit(req, res, 'children_update'))) return;

  try {
    const actor = await resolveActor(req, ['admin', 'triagem', 'secretaria']);
    const body = req.body || {};
    const childId = body.childId || body.id || body.data?.id;
    const patch = body.data || body.patch || body;
    const ifUnmodifiedSince = body.ifUnmodifiedSince || body.updatedAt || null;

    if (!childId) {
      return res.status(400).json({
        success: false,
        error: 'VALIDATION_ERROR',
        message: 'childId é obrigatório',
      });
    }

    const payload = {
      ...(patch || {}),
      id: String(childId),
    };

    const deviceId = req.headers['x-device-id'] || '';
    const appVersion = req.headers['x-app-version'] || '';
    const result = await updateChild(payload, actor, deviceId, appVersion, { ifUnmodifiedSince });

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
    return sendHandledError(res, 'children/update', error);
  }
};
