const { resolveActor } = require('../lib/actor');
const {
  addChild,
  addRecord,
  loadOperationalData,
  overwriteOperationalData,
} = require('../lib/sync-supabase-service');

const API_TOKEN = process.env.API_TOKEN;
const ORIGINS_ALLOWLIST = (process.env.ORIGINS_ALLOWLIST || 'https://lumine-webapp.vercel.app')
  .split(',')
  .map(origin => origin.trim())
  .filter(Boolean);
const MAX_SYNC_BYTES = 4 * 1024 * 1024;
const DISABLE_SYNC_ENDPOINT = process.env.DISABLE_SYNC_ENDPOINT === 'true';

function getAllowedOrigin(origin) {
  if (!origin) return '';
  return ORIGINS_ALLOWLIST.includes(origin) ? origin : '';
}

function setCors(req, res) {
  const origin = req.headers.origin;
  const allowedOrigin = getAllowedOrigin(origin);

  if (allowedOrigin) {
    res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
    res.setHeader('Vary', 'Origin');
  }

  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Authorization, Content-Type, X-Device-Id, X-App-Version, X-User-Jwt'
  );

  return { origin, allowedOrigin };
}

function ensureCors(req, res, origin, allowedOrigin) {
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return false;
  }

  if (origin && !allowedOrigin) {
    res.status(403).json({
      success: false,
      error: 'FORBIDDEN_ORIGIN',
      message: 'Origem nao permitida',
    });
    return false;
  }

  return true;
}

function ensureApiToken(req, res) {
  const authHeader = req.headers.authorization || '';
  if (!API_TOKEN || authHeader !== `Bearer ${API_TOKEN}`) {
    res.status(401).json({
      success: false,
      error: 'UNAUTHORIZED',
      message: 'Nao autorizado',
    });
    return false;
  }
  return true;
}

function sendHandledError(res, error) {
  if (error?.statusCode && error?.code) {
    if (error.code === 'REVISION_MISMATCH') {
      return res.status(409).json({
        success: false,
        error: error.code,
        serverRev: error.meta?.serverRev,
        clientRev: error.meta?.clientRev,
        message: error.message,
      });
    }

    if (error.code === 'DATA_LOSS_PREVENTED') {
      return res.status(409).json({
        success: false,
        error: error.code,
        serverCount: error.meta?.serverCount,
        clientCount: error.meta?.clientCount,
        message: error.message,
      });
    }

    return res.status(error.statusCode).json({
      success: false,
      error: error.code,
      message: error.message,
    });
  }

  console.error('[sync] erro interno', {
    message: error?.message,
    code: error?.code,
  });

  return res.status(500).json({
    success: false,
    error: 'INTERNAL_ERROR',
    message: 'Erro interno',
  });
}

module.exports = async (req, res) => {
  const { origin, allowedOrigin } = setCors(req, res);
  if (!ensureCors(req, res, origin, allowedOrigin)) return;

  if (DISABLE_SYNC_ENDPOINT) {
    return res.status(503).json({
      success: false,
      error: 'SYNC_DISABLED',
      message: 'Endpoint de sincronizacao desativado',
    });
  }

  if (!ensureApiToken(req, res)) return;

  const deviceId = req.headers['x-device-id'] || '';
  const appVersion = req.headers['x-app-version'] || '';

  try {
    const actor = await resolveActor(req, []);

    if (req.method === 'GET') {
      const payload = await loadOperationalData();
      return res.status(200).json({
        success: true,
        data: {
          children: payload.children,
          records: payload.records,
        },
        dataRev: payload.dataRev,
        lastSync: new Date().toISOString(),
      });
    }

    if (req.method !== 'POST') {
      return res.status(405).json({
        success: false,
        error: 'METHOD_NOT_ALLOWED',
        message: 'Metodo nao permitido',
      });
    }

    const { action, data, ifMatchRev } = req.body || {};

    if (action === 'sync') {
      const bodySize = Buffer.byteLength(JSON.stringify(req.body || {}));
      if (bodySize > MAX_SYNC_BYTES) {
        return res.status(413).json({
          success: false,
          error: 'PAYLOAD_TOO_LARGE',
          message: 'Payload excede limite',
        });
      }

      const result = await overwriteOperationalData({
        children: data?.children,
        records: data?.records,
        ifMatchRev,
        actor,
        deviceId,
        appVersion,
      });

      return res.status(200).json({
        success: true,
        dataRev: result.dataRev,
        lastSync: new Date().toISOString(),
      });
    }

    if (action === 'addChild') {
      const result = await addChild(data, actor, deviceId, appVersion);
      return res.status(200).json({
        success: true,
        message: 'Crianca adicionada',
        childId: result.childId,
        dataRev: result.dataRev,
      });
    }

    if (action === 'addRecord') {
      const result = await addRecord(data, actor, deviceId, appVersion);
      return res.status(200).json({
        success: true,
        message: 'Registro adicionado',
        dataRev: result.dataRev,
        record: result.record,
      });
    }

    return res.status(400).json({
      success: false,
      error: 'UNKNOWN_ACTION',
      message: 'Acao nao reconhecida',
    });
  } catch (error) {
    return sendHandledError(res, error);
  }
};
