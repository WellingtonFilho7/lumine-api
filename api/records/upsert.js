const { resolveActor } = require('../../lib/actor');
const { addRecord } = require('../../lib/sync-supabase-service');
const { sendHandledError } = require('../../lib/http-errors');
const { ensureCors, ensureRateLimit, setCors } = require('../../lib/security');

module.exports = async (req, res) => {
  const { origin, allowedOrigin } = setCors(req, res, { methods: 'POST, OPTIONS' });
  if (!ensureCors(req, res, origin, allowedOrigin)) return;

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'METHOD_NOT_ALLOWED' });
  }

  if (!(await ensureRateLimit(req, res, 'records_upsert'))) return;

  try {
    const actor = await resolveActor(req, ['admin', 'triagem', 'secretaria']);
    const body = req.body || {};
    const payload = body.data || body;
    const ifUnmodifiedSince = body.ifUnmodifiedSince || body.updatedAt || null;
    const deviceId = req.headers['x-device-id'] || '';
    const appVersion = req.headers['x-app-version'] || '';

    const result = await addRecord(payload, actor, deviceId, appVersion, { ifUnmodifiedSince });

    return res.status(200).json({
      success: true,
      data: {
        dataRev: result.dataRev,
        record: result.record,
        updatedAt: result.updatedAt,
      },
    });
  } catch (error) {
    return sendHandledError(res, 'records/upsert', error);
  }
};
