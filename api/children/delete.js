const { resolveActor } = require('../../lib/actor');
const { deleteChild } = require('../../lib/sync-supabase-service');
const { sendHandledError } = require('../../lib/http-errors');
const { ensureCors, ensureRateLimit, setCors } = require('../../lib/security');

module.exports = async (req, res) => {
  const { origin, allowedOrigin } = setCors(req, res, { methods: 'POST, OPTIONS' });
  if (!ensureCors(req, res, origin, allowedOrigin)) return;

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'METHOD_NOT_ALLOWED' });
  }

  if (!(await ensureRateLimit(req, res, 'children_delete'))) return;

  try {
    const actor = await resolveActor(req, ['admin']);
    const childId = req.body?.childId || req.body?.id || req.body?.data?.childId;
    if (!childId) {
      return res.status(400).json({
        success: false,
        error: 'VALIDATION_ERROR',
        message: 'childId é obrigatório',
      });
    }

    const deviceId = req.headers['x-device-id'] || '';
    const appVersion = req.headers['x-app-version'] || '';
    const result = await deleteChild(String(childId), actor, deviceId, appVersion);

    return res.status(200).json({
      success: true,
      data: {
        dataRev: result.dataRev,
        changed: result.changed,
        deletedRecords: result.deletedRecords,
      },
    });
  } catch (error) {
    return sendHandledError(res, 'children/delete', error);
  }
};
