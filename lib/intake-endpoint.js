const { parseOrThrow } = require('./intake-validation');
const { resolveActor } = require('./actor');
const { mirrorEvent } = require('./mirror');
const {
  ensureApiToken,
  ensureCors,
  ensureHoneypot,
  ensureRateLimit,
  setCors,
} = require('./security');

function sendError(res, error, fallbackMessage = 'Erro interno') {
  const statusCode = error.statusCode || 500;
  const code = error.code || 'INTERNAL_ERROR';

  if (statusCode >= 500) {
    console.error('[intake] erro interno', { code, message: error.message });
  }

  res.status(statusCode).json({
    success: false,
    error: code,
    message: statusCode >= 500 ? fallbackMessage : error.message,
  });
}

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

    if (!ensureApiToken(req, res)) return;
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

      return sendError(res, error);
    }
  };
}

module.exports = {
  createIntakeHandler,
};
