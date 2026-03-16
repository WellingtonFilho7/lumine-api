const { parseOrThrow } = require('./intake-validation');
const { resolveActor } = require('./actor');
const { sendHandledError } = require('./http-errors');
const { mirrorEvent } = require('./mirror');
const {
  ensureCors,
  ensureHoneypot,
  ensureRateLimit,
  setCors,
} = require('./security');

async function mirrorSafely(payload) {
  try {
    await mirrorEvent(payload);
  } catch (error) {
    console.error('[intake] mirror falhou', {
      stage: payload.stage,
      status: payload.status,
      code: error?.code || 'MIRROR_ERROR',
      message: error?.message || 'Falha ao espelhar evento',
    });
  }
}

function createIntakeHandler({
  action,
  schema,
  allowedRoles = [],
  handler,
  honeypot = true,
}) {
  return async (req, res) => {
    const { origin, allowedOrigin } = setCors(req, res);

    if (!ensureCors(req, res, origin, allowedOrigin)) return;
    if (req.method !== 'POST') {
      return res.status(405).json({ success: false, error: 'METHOD_NOT_ALLOWED' });
    }

    if (!(await ensureRateLimit(req, res, action))) return;
    if (honeypot && !ensureHoneypot(req, res)) return;

    try {
      const actor = await resolveActor(req, allowedRoles);
      const payload = parseOrThrow(schema, req.body || {});
      const result = await handler(payload, actor, req);

      await mirrorSafely({
        stage: action,
        entityId: result.criancaId || result.preCadastroId || '',
        status: 'success',
        dataRev: result.dataRev,
        details: {
          duplicated: result.duplicated || false,
          statusAfter: result.statusAfter || null,
        },
      });

      return res.status(200).json({ success: true, data: result });
    } catch (error) {
      await mirrorSafely({
        stage: action,
        entityId: '',
        status: 'error',
        dataRev: null,
        details: {
          code: error.code || 'INTERNAL_ERROR',
        },
      });

      return sendHandledError(res, 'intake', error);
    }
  };
}

module.exports = {
  createIntakeHandler,
};
