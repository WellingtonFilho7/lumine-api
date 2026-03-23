const { resolveActor } = require('../../../lib/actor');
const { sendHandledError } = require('../../../lib/http-errors');
const { createOperationalBackupDocument } = require('../../../lib/operational-backup-service');
const { ensureCors, ensureRateLimit, setCors } = require('../../../lib/security');

module.exports = async (req, res) => {
  const { origin, allowedOrigin } = setCors(req, res, { methods: 'GET, OPTIONS' });
  if (!ensureCors(req, res, origin, allowedOrigin)) return;

  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'METHOD_NOT_ALLOWED' });
  }

  if (!(await ensureRateLimit(req, res, 'admin_operational_backup_download'))) return;

  try {
    await resolveActor(req, ['admin']);
    const document = await createOperationalBackupDocument();

    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${document.fileName}"`);
    return res.status(200).send(document.json);
  } catch (error) {
    return sendHandledError(res, 'admin/operational-backup/download', error);
  }
};
