const { resolveActor } = require('../../../lib/actor');
const { sendHandledError } = require('../../../lib/http-errors');
const { ensureCors, ensureRateLimit, setCors } = require('../../../lib/security');
const { listPendingInternalUsers } = require('../../../lib/internal-users-service');

module.exports = async (req, res) => {
  const { origin, allowedOrigin } = setCors(req, res, { methods: 'GET, OPTIONS' });
  if (!ensureCors(req, res, origin, allowedOrigin)) return;

  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'METHOD_NOT_ALLOWED' });
  }

  if (!(await ensureRateLimit(req, res, 'admin_internal_users_pending'))) return;

  try {
    await resolveActor(req, ['admin']);
    const data = await listPendingInternalUsers();

    return res.status(200).json({
      success: true,
      data,
    });
  } catch (error) {
    return sendHandledError(res, 'admin/internal-users/pending', error);
  }
};
