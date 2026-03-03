const { resolveActor } = require('../lib/actor');
const { loadOperationalData } = require('../lib/sync-supabase-service');
const { sendHandledError } = require('../lib/http-errors');
const { ensureCors, ensureRateLimit, setCors } = require('../lib/security');

function shouldRetryBootstrapLoad(error) {
  const text = String(error?.message || '').toLowerCase();
  return (
    text.includes('fetch failed') ||
    text.includes('network') ||
    text.includes('socket') ||
    text.includes('timeout') ||
    text.includes('temporar')
  );
}

async function loadOperationalDataWithRetry(maxRetries = 1) {
  let attempt = 0;
  let lastError = null;

  while (attempt <= maxRetries) {
    try {
      return await loadOperationalData();
    } catch (error) {
      lastError = error;
      if (!shouldRetryBootstrapLoad(error) || attempt === maxRetries) {
        throw error;
      }
      await new Promise(resolve => setTimeout(resolve, 120));
      attempt += 1;
    }
  }

  throw lastError;
}

module.exports = async (req, res) => {
  const { origin, allowedOrigin } = setCors(req, res, { methods: 'GET, OPTIONS' });
  if (!ensureCors(req, res, origin, allowedOrigin)) return;

  if (req.method !== 'GET') {
    return res.status(405).json({
      success: false,
      error: 'METHOD_NOT_ALLOWED',
      message: 'Metodo nao permitido',
    });
  }

  if (!(await ensureRateLimit(req, res, 'bootstrap_get'))) return;

  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('Pragma', 'no-cache');

  try {
    await resolveActor(req, []);
    const payload = await loadOperationalDataWithRetry(1);

    return res.status(200).json({
      success: true,
      data: {
        children: payload.children,
        records: payload.records,
      },
      dataRev: payload.dataRev,
      serverTs: new Date().toISOString(),
    });
  } catch (error) {
    return sendHandledError(res, 'bootstrap', error);
  }
};
