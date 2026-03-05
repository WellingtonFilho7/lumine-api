const { resolveActor } = require('../../lib/actor');
const { sendHandledError } = require('../../lib/http-errors');
const { ensureCors, ensureRateLimit, setCors } = require('../../lib/security');
const {
  parseFinanceCreatePayload,
  parseFinanceFileUrlPayload,
  parseFinanceListQuery,
  parseFinanceUploadUrlPayload,
} = require('../../lib/finance-validation');
const {
  createFinanceFileUrl,
  createFinanceTransaction,
  generateFinanceUploadUrl,
  listFinanceTransactions,
} = require('../../lib/finance-service');

const ROUTES = {
  create: {
    method: 'POST',
    rateLimitKey: 'finance_create',
    run: async (req, actor) => {
      const payload = parseFinanceCreatePayload(req.body?.data || req.body || {});
      const result = await createFinanceTransaction(payload, actor);
      return {
        transaction: result.transaction,
        duplicated: result.duplicated,
      };
    },
  },
  list: {
    method: 'GET',
    rateLimitKey: 'finance_list',
    run: async (req, actor) => {
      const filters = parseFinanceListQuery(req.query || {});
      const result = await listFinanceTransactions(filters, actor);
      return {
        items: result.items,
        nextCursor: result.nextCursor,
        hasMore: result.hasMore,
      };
    },
  },
  'upload-url': {
    method: 'POST',
    rateLimitKey: 'finance_upload_url',
    run: async (req, actor) => {
      const payload = parseFinanceUploadUrlPayload(req.body?.data || req.body || {});
      return generateFinanceUploadUrl(payload, actor);
    },
  },
  'file-url': {
    method: 'POST',
    rateLimitKey: 'finance_file_url',
    run: async (req, actor) => {
      const payload = parseFinanceFileUrlPayload(req.body?.data || req.body || {});
      return createFinanceFileUrl(payload, actor);
    },
  },
};

function extractAction(req) {
  const queryAction = req.query?.action;
  if (typeof queryAction === 'string' && queryAction) return queryAction;
  if (Array.isArray(queryAction) && queryAction.length > 0) return queryAction[0];

  const [pathname] = String(req.url || '').split('?');
  const segments = pathname.split('/').filter(Boolean);
  return segments[segments.length - 1] || '';
}

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
    const actor = await resolveActor(req, ['admin', 'secretaria']);
    const result = await route.run(req, actor);

    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    return sendHandledError(res, `finance/${action}`, error);
  }
};
