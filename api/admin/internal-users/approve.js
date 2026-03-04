const { resolveActor } = require('../../../lib/actor');
const { sendHandledError } = require('../../../lib/http-errors');
const { ensureCors, ensureRateLimit, setCors } = require('../../../lib/security');
const {
  approveInternalUserSchema,
  parseAdminPayloadOrThrow,
} = require('../../../lib/internal-users-validation');
const { approveInternalUserByEmail } = require('../../../lib/internal-users-service');

module.exports = async (req, res) => {
  const { origin, allowedOrigin } = setCors(req, res, { methods: 'POST, OPTIONS' });
  if (!ensureCors(req, res, origin, allowedOrigin)) return;

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'METHOD_NOT_ALLOWED' });
  }

  if (!(await ensureRateLimit(req, res, 'admin_internal_users_approve'))) return;

  try {
    await resolveActor(req, ['admin']);
    const payload = parseAdminPayloadOrThrow(approveInternalUserSchema, req.body || {});
    const data = await approveInternalUserByEmail(payload);

    return res.status(200).json({
      success: true,
      data,
    });
  } catch (error) {
    return sendHandledError(res, 'admin/internal-users/approve', error);
  }
};
