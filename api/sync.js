const { resolveActor } = require('../lib/actor');
const {
  addChild,
  addRecord,
  deleteChild,
  loadOperationalData,
  overwriteOperationalData,
} = require('../lib/sync-supabase-service');
const { ensureCors, ensureRateLimit, setCors } = require('../lib/security');
const { sendHandledError } = require('../lib/http-errors');

const MAX_SYNC_BYTES = 4 * 1024 * 1024;
const DISABLE_SYNC_OVERWRITE =
  (process.env.DISABLE_SYNC_ENDPOINT || 'true').toLowerCase() !== 'false';

module.exports = async (req, res) => {
  const { origin, allowedOrigin } = setCors(req, res, { methods: 'GET, POST, OPTIONS' });
  if (!ensureCors(req, res, origin, allowedOrigin)) return;

  const actionKey =
    req.method === 'GET' ? 'sync_get' : `sync_${(req.body && req.body.action) || 'post'}`;
  if (!(await ensureRateLimit(req, res, actionKey))) return;

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
      if (DISABLE_SYNC_OVERWRITE) {
        return res.status(503).json({
          success: false,
          error: 'SYNC_DISABLED',
          message: 'Sincronizacao por overwrite desativada para operacao diaria',
        });
      }

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

    if (action === 'deleteChild') {
      const childId = data?.childId || data?.id;
      const result = await deleteChild(childId, actor, deviceId, appVersion);
      return res.status(200).json({
        success: true,
        message: 'Cadastro removido',
        dataRev: result.dataRev,
        deletedRecords: result.deletedRecords,
        changed: result.changed,
      });
    }

    return res.status(400).json({
      success: false,
      error: 'UNKNOWN_ACTION',
      message: 'Acao nao reconhecida',
    });
  } catch (error) {
    if (error?.code === 'REVISION_MISMATCH') {
      return res.status(409).json({
        success: false,
        error: error.code,
        serverRev: error.meta?.serverRev,
        clientRev: error.meta?.clientRev,
        message: error.message,
      });
    }

    if (error?.code === 'DATA_LOSS_PREVENTED') {
      return res.status(409).json({
        success: false,
        error: error.code,
        serverCount: error.meta?.serverCount,
        clientCount: error.meta?.clientCount,
        message: error.message,
      });
    }

    return sendHandledError(res, 'sync', error);
  }
};
