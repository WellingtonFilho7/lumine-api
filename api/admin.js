const { resolveActor } = require('../lib/actor');
const { sendHandledError } = require('../lib/http-errors');
const { createOperationalBackupDocument } = require('../lib/operational-backup-service');
const { ensureCors, ensureRateLimit, setCors } = require('../lib/security');
const {
  approveInternalUserSchema,
  parseAdminPayloadOrThrow,
} = require('../lib/internal-users-validation');
const {
  approveInternalUserByEmail,
  listPendingInternalUsers,
} = require('../lib/internal-users-service');

function safeParseJsonString(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  try {
    const parsed = JSON.parse(trimmed);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed;
  } catch (_error) {
    return null;
  }
}

function normalizeBodyPayload(rawBody) {
  const bodyCandidate = typeof rawBody === 'string' ? safeParseJsonString(rawBody) : rawBody;

  if (!bodyCandidate || typeof bodyCandidate !== 'object' || Array.isArray(bodyCandidate)) {
    return {};
  }

  const nestedData = bodyCandidate.data;
  if (nestedData && typeof nestedData === 'object' && !Array.isArray(nestedData)) {
    return nestedData;
  }

  return bodyCandidate;
}

function extractAction(req) {
  const queryAction = req.query?.action;
  if (typeof queryAction === 'string' && queryAction) return queryAction;
  if (Array.isArray(queryAction) && queryAction.length > 0) return queryAction[0];

  const [pathname] = String(req.url || '').split('?');
  const segments = pathname.split('/').filter(Boolean);
  return segments.slice(1).join('/') || '';
}

const ROUTES = {
  'internal-users/pending': {
    method: 'GET',
    rateLimitKey: 'admin_internal_users_pending',
    run: async () => listPendingInternalUsers(),
  },
  'internal-users/approve': {
    method: 'POST',
    rateLimitKey: 'admin_internal_users_approve',
    run: async req => {
      const payload = parseAdminPayloadOrThrow(approveInternalUserSchema, normalizeBodyPayload(req.body));
      return approveInternalUserByEmail(payload);
    },
  },
  'operational-backup/download': {
    method: 'GET',
    rateLimitKey: 'admin_operational_backup_download',
    rawResponse: true,
    run: async (_req, res) => {
      const document = await createOperationalBackupDocument();
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${document.fileName}"`);
      return res.status(200).send(document.json);
    },
  },
};

module.exports = async (req, res) => {
  const { origin, allowedOrigin } = setCors(req, res, { methods: 'GET, POST, OPTIONS' });
  if (!ensureCors(req, res, origin, allowedOrigin)) return;

  const action = extractAction(req);
  const route = ROUTES[action];
  if (!route) {
    return res.status(404).json({ success: false, error: 'NOT_FOUND' });
  }

  if (req.method !== route.method) {
    return res.status(405).json({ success: false, error: 'METHOD_NOT_ALLOWED' });
  }

  if (!(await ensureRateLimit(req, res, route.rateLimitKey))) return;

  try {
    await resolveActor(req, ['admin']);
    const result = await route.run(req, res);

    if (route.rawResponse) return result;

    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    return sendHandledError(res, `admin/${action}`, error);
  }
};

module.exports.__private = {
  extractAction,
  normalizeBodyPayload,
  safeParseJsonString,
};
