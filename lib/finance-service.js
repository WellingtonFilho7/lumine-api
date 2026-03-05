const crypto = require('crypto');
const path = require('path');
const { getSupabaseAdmin } = require('./supabase');
const { mirrorFinanceTransaction } = require('./mirror');
const { getAllowedUploadMime } = require('./finance-validation');

const MIME_EXT_MAP = {
  'application/pdf': ['pdf'],
  'image/jpeg': ['jpg', 'jpeg'],
  'image/png': ['png'],
  'image/webp': ['webp'],
};

function createHandledError(message, statusCode, code, meta = null) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  if (meta) error.meta = meta;
  return error;
}

function readIntEnv(name, fallback) {
  const parsed = Number.parseInt(process.env[name] || '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function getConfig() {
  return {
    bucket: process.env.FINANCE_BUCKET || 'finance-comprovantes',
    prefix: process.env.FINANCE_STORAGE_PREFIX || 'finance',
    maxUploadBytes: readIntEnv('FINANCE_UPLOAD_MAX_BYTES', 10 * 1024 * 1024),
    uploadUrlExpiresIn: readIntEnv('FINANCE_SIGNED_UPLOAD_EXPIRES_SECONDS', 120),
    readUrlExpiresIn: readIntEnv('FINANCE_SIGNED_READ_EXPIRES_SECONDS', 120),
    allowedMime: getAllowedUploadMime(),
  };
}

function assertFinanceActor(actor) {
  if (!actor || actor.source !== 'jwt' || !actor.userId) {
    throw createHandledError('Token do usuario interno ausente', 401, 'INTERNAL_AUTH_REQUIRED');
  }

  if (!['admin', 'secretaria'].includes(actor.role)) {
    throw createHandledError('Permissao insuficiente', 403, 'FORBIDDEN_ROLE');
  }
}

function sanitizeFileName(fileName) {
  const baseName = path.basename(String(fileName || 'comprovante').trim());
  const normalized = baseName
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9._-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^\.+/, '')
    .slice(0, 120);

  return normalized || 'comprovante';
}

function getFileExtension(fileName) {
  const ext = path.extname(String(fileName || '')).toLowerCase().replace('.', '');
  return ext;
}

function buildStoragePath(fileName, userId, now = new Date(), prefix = 'finance') {
  const year = String(now.getUTCFullYear());
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  const safeFileName = sanitizeFileName(fileName);
  const nonce = crypto.randomBytes(6).toString('hex');
  return `${prefix}/${year}/${month}/${userId}/${Date.now()}-${nonce}-${safeFileName}`;
}

function hasFinancePrefix(storagePath, prefix = 'finance') {
  const expected = `${String(prefix || 'finance').replace(/\/$/, '')}/`;
  return String(storagePath || '').startsWith(expected);
}

function buildFinanceFingerprint(payload, userId) {
  const fingerprintPayload = [
    userId,
    payload.tipo,
    payload.categoria,
    payload.descricao,
    payload.valorCentavos,
    payload.data,
    payload.formaPagamento,
    payload.comprovantePath,
  ]
    .map(value => String(value || '').trim().toLowerCase())
    .join('|');

  return crypto.createHash('sha256').update(fingerprintPayload).digest('hex');
}

function mapFinanceRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    seq: row.seq,
    tipo: row.tipo,
    descricao: row.descricao,
    categoria: row.categoria,
    valorCentavos: row.valor_centavos,
    data: row.data_transacao,
    formaPagamento: row.forma_pagamento,
    comprovantePath: row.comprovante_path,
    comprovanteMime: row.comprovante_mime,
    comprovanteNome: row.comprovante_nome,
    registradoPor: row.registrado_por,
    updatedBy: row.updated_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function encodeCursor(seq) {
  return Buffer.from(String(seq)).toString('base64url');
}

function decodeCursor(cursor) {
  if (!cursor) return null;
  try {
    const raw = Buffer.from(String(cursor), 'base64url').toString('utf8');
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed) || parsed < 1) return null;
    return parsed;
  } catch (_error) {
    return null;
  }
}

function isUniqueViolationForConstraint(error, constraintName) {
  if (!error || error.code !== '23505') return false;
  const message = [error.message, error.details, error.hint].filter(Boolean).join(' ');
  return message.includes(constraintName);
}

function isStorageNotFoundError(error) {
  const status = Number(error?.statusCode || error?.status || 0);
  if (status === 404) return true;
  const message = String(error?.message || '').toLowerCase();
  return message.includes('not found') || message.includes('no such');
}

function extractStorageObjectSize(metadata) {
  if (!metadata || typeof metadata !== 'object') return null;
  const candidates = [
    metadata.size,
    metadata.fileSize,
    metadata.file_size,
    metadata?.metadata?.size,
    metadata?.metadata?.fileSize,
    metadata?.metadata?.file_size,
  ];

  for (const value of candidates) {
    const parsed = Number.parseInt(String(value ?? ''), 10);
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  }

  return null;
}

function extractStorageObjectMime(metadata) {
  if (!metadata || typeof metadata !== 'object') return null;
  const candidates = [
    metadata.mimetype,
    metadata.mimeType,
    metadata.contentType,
    metadata.content_type,
    metadata?.metadata?.mimetype,
    metadata?.metadata?.mimeType,
    metadata?.metadata?.contentType,
    metadata?.metadata?.content_type,
  ];

  for (const value of candidates) {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized) return normalized;
  }

  return null;
}

async function defaultGetStorageObjectMetadata(supabase, bucket, objectPath) {
  const bucketClient = supabase.storage.from(bucket);
  const normalizedPath = String(objectPath || '').replace(/^\/+/, '');
  if (!normalizedPath) return null;

  if (typeof bucketClient.info === 'function') {
    const { data, error } = await bucketClient.info(normalizedPath);
    if (error) {
      if (isStorageNotFoundError(error)) return null;
      throw error;
    }
    return data || null;
  }

  const lastSlashIndex = normalizedPath.lastIndexOf('/');
  const directory = lastSlashIndex >= 0 ? normalizedPath.slice(0, lastSlashIndex) : '';
  const fileName = lastSlashIndex >= 0 ? normalizedPath.slice(lastSlashIndex + 1) : normalizedPath;
  if (!fileName) return null;

  const { data, error } = await bucketClient.list(directory, { limit: 100, search: fileName });
  if (error) throw error;

  const entries = Array.isArray(data) ? data : [];
  return entries.find(item => item?.name === fileName) || null;
}

async function appendAuditLog(supabase, entry) {
  const { error } = await supabase.from('audit_logs').insert({
    actor_user_id: entry.userId || null,
    actor_role: entry.role || 'system',
    action: entry.action,
    resource_type: entry.resourceType || 'finance',
    resource_id: entry.resourceId || null,
    success: entry.success !== false,
    meta: entry.meta || {},
  });

  if (error) throw error;
}

async function mirrorFinanceSafely(row) {
  try {
    await mirrorFinanceTransaction({
      transactionId: row.id,
      tipo: row.tipo,
      categoria: row.categoria,
      descricao: row.descricao,
      valorCentavos: row.valor_centavos,
      dataTransacao: row.data_transacao,
      formaPagamento: row.forma_pagamento,
      comprovantePath: row.comprovante_path,
      registradoPor: row.registrado_por,
      updatedBy: row.updated_by,
      createdAt: row.created_at,
    });
  } catch (error) {
    console.error('[finance] mirror falhou', {
      code: error?.code || 'MIRROR_ERROR',
      message: error?.message || 'Falha ao espelhar transacao financeira',
      transactionId: row?.id || null,
    });
  }
}

function createFinanceService(deps = {}) {
  const getSupabase = deps.getSupabaseAdmin || getSupabaseAdmin;
  const configResolver = deps.getConfig || getConfig;
  const getStorageObjectMetadata = deps.getStorageObjectMetadata || defaultGetStorageObjectMetadata;

  async function generateUploadUrl(payload, actor) {
    assertFinanceActor(actor);

    const config = configResolver();
    const contentType = String(payload.contentType || '').toLowerCase();
    if (!config.allowedMime.includes(contentType)) {
      throw createHandledError('contentType invalido', 400, 'INVALID_PAYLOAD');
    }

    if (payload.fileSizeBytes > config.maxUploadBytes) {
      throw createHandledError('Arquivo excede limite permitido', 400, 'FILE_TOO_LARGE', {
        maxUploadBytes: config.maxUploadBytes,
      });
    }

    const extension = getFileExtension(payload.fileName);
    const allowedExt = MIME_EXT_MAP[contentType] || [];
    if (allowedExt.length > 0 && !allowedExt.includes(extension)) {
      throw createHandledError('Extensao de arquivo invalida para este tipo', 400, 'INVALID_FILE_EXTENSION');
    }

    const storagePath = buildStoragePath(payload.fileName, actor.userId, new Date(), config.prefix);

    const supabase = getSupabase();
    const { data, error } = await supabase
      .storage
      .from(config.bucket)
      .createSignedUploadUrl(storagePath, { upsert: false });

    if (error || !data?.signedUrl || !data?.token) {
      throw createHandledError('Falha ao gerar URL de upload', 503, 'UPLOAD_URL_GENERATION_FAILED');
    }

    return {
      bucket: config.bucket,
      path: data.path || storagePath,
      signedUploadUrl: data.signedUrl,
      token: data.token,
      expiresIn: config.uploadUrlExpiresIn,
    };
  }

  async function createTransaction(payload, actor) {
    assertFinanceActor(actor);

    const config = configResolver();
    if (!hasFinancePrefix(payload.comprovantePath, config.prefix)) {
      throw createHandledError('comprovantePath invalido para prefixo financeiro', 400, 'INVALID_PROOF_PATH');
    }

    const supabase = getSupabase();
    const idempotencyKey = payload.idempotencyKey || null;

    if (idempotencyKey) {
      const { data: existingByIdp, error: idpError } = await supabase
        .from('transacoes_financeiras')
        .select('*')
        .eq('registrado_por', actor.userId)
        .eq('idempotency_key', idempotencyKey)
        .maybeSingle();

      if (idpError) throw idpError;

      if (existingByIdp) {
        await appendAuditLog(supabase, {
          userId: actor.userId,
          role: actor.role,
          action: 'finance_create_duplicate',
          resourceType: 'finance',
          resourceId: existingByIdp.id,
          success: true,
          meta: { reason: 'idempotency_key_replay' },
        });

        return { duplicated: true, transaction: mapFinanceRow(existingByIdp) };
      }
    }

    const storageMetadata = await getStorageObjectMetadata(
      supabase,
      config.bucket,
      payload.comprovantePath
    );
    if (!storageMetadata) {
      throw createHandledError('Comprovante nao encontrado no storage', 400, 'PROOF_FILE_NOT_FOUND');
    }

    const storageFileSize = extractStorageObjectSize(storageMetadata);
    if (Number.isFinite(storageFileSize) && storageFileSize > config.maxUploadBytes) {
      throw createHandledError('Arquivo excede limite permitido', 400, 'FILE_TOO_LARGE', {
        maxUploadBytes: config.maxUploadBytes,
        actualSizeBytes: storageFileSize,
      });
    }

    const storageMime = extractStorageObjectMime(storageMetadata);
    if (storageMime && !config.allowedMime.includes(storageMime)) {
      throw createHandledError('Tipo real do comprovante nao permitido', 400, 'INVALID_FILE_MIME');
    }

    const fingerprint = buildFinanceFingerprint(payload, actor.userId);
    const nowIso = new Date().toISOString();

    const row = {
      tipo: payload.tipo,
      descricao: payload.descricao,
      categoria: payload.categoria,
      valor_centavos: payload.valorCentavos,
      data_transacao: payload.data,
      forma_pagamento: payload.formaPagamento,
      comprovante_path: payload.comprovantePath,
      comprovante_mime: payload.comprovanteMime || storageMime || null,
      comprovante_nome: payload.comprovanteNome || null,
      idempotency_key: idempotencyKey,
      fingerprint,
      registrado_por: actor.userId,
      updated_by: actor.userId,
      updated_at: nowIso,
    };

    const { data: inserted, error: insertError } = await supabase
      .from('transacoes_financeiras')
      .insert(row)
      .select('*')
      .single();

    if (insertError) {
      const byIdp = isUniqueViolationForConstraint(
        insertError,
        'uq_transacoes_financeiras_actor_idempotency'
      );
      const byFingerprint = isUniqueViolationForConstraint(
        insertError,
        'uq_transacoes_financeiras_fingerprint'
      );

      if (byIdp || byFingerprint) {
        const lookupQuery = supabase.from('transacoes_financeiras').select('*');
        if (byIdp && idempotencyKey) {
          lookupQuery.eq('registrado_por', actor.userId).eq('idempotency_key', idempotencyKey);
        } else {
          lookupQuery.eq('fingerprint', fingerprint);
        }

        const { data: duplicatedRow, error: duplicatedError } = await lookupQuery.maybeSingle();
        if (duplicatedError) throw duplicatedError;

        if (duplicatedRow) {
          await appendAuditLog(supabase, {
            userId: actor.userId,
            role: actor.role,
            action: 'finance_create_duplicate',
            resourceType: 'finance',
            resourceId: duplicatedRow.id,
            success: true,
            meta: { reason: byIdp ? 'idempotency_unique' : 'fingerprint_unique' },
          });

          return { duplicated: true, transaction: mapFinanceRow(duplicatedRow) };
        }
      }

      throw insertError;
    }

    await appendAuditLog(supabase, {
      userId: actor.userId,
      role: actor.role,
      action: 'finance_create',
      resourceType: 'finance',
      resourceId: inserted.id,
      success: true,
      meta: {
        tipo: inserted.tipo,
        categoria: inserted.categoria,
        valorCentavos: inserted.valor_centavos,
      },
    });

    await mirrorFinanceSafely(inserted);

    return { duplicated: false, transaction: mapFinanceRow(inserted) };
  }

  async function listTransactions(filters, actor) {
    assertFinanceActor(actor);

    const limit = Number(filters.limit) || 20;
    const cursorSeq = decodeCursor(filters.cursor);

    const supabase = getSupabase();
    let query = supabase
      .from('transacoes_financeiras')
      .select('*')
      .order('seq', { ascending: false })
      .limit(limit + 1);

    if (cursorSeq) query = query.lt('seq', cursorSeq);
    if (filters.tipo) query = query.eq('tipo', filters.tipo);
    if (filters.categoria) query = query.eq('categoria', filters.categoria);
    if (filters.startDate) query = query.gte('data_transacao', filters.startDate);
    if (filters.endDate) query = query.lte('data_transacao', filters.endDate);

    const { data, error } = await query;
    if (error) throw error;

    const rows = Array.isArray(data) ? data : [];
    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore && pageRows.length > 0
      ? encodeCursor(pageRows[pageRows.length - 1].seq)
      : null;

    return {
      items: pageRows.map(mapFinanceRow),
      hasMore,
      nextCursor,
    };
  }

  async function createFileReadUrl(payload, actor) {
    assertFinanceActor(actor);

    const config = configResolver();
    if (!hasFinancePrefix(payload.comprovantePath, config.prefix)) {
      throw createHandledError('comprovantePath invalido para prefixo financeiro', 400, 'INVALID_PROOF_PATH');
    }

    const expiresIn = payload.expiresIn || config.readUrlExpiresIn;
    const supabase = getSupabase();

    const { data, error } = await supabase
      .storage
      .from(config.bucket)
      .createSignedUrl(payload.comprovantePath, expiresIn);

    if (error || !data?.signedUrl) {
      throw createHandledError('Falha ao gerar URL de leitura', 503, 'FILE_URL_GENERATION_FAILED');
    }

    return {
      signedUrl: data.signedUrl,
      expiresIn,
      bucket: config.bucket,
      path: payload.comprovantePath,
    };
  }

  return {
    createFileReadUrl,
    createTransaction,
    generateUploadUrl,
    listTransactions,
  };
}

const financeService = createFinanceService();

module.exports = {
  createFinanceService,
  createFinanceFileUrl: financeService.createFileReadUrl,
  createFinanceTransaction: financeService.createTransaction,
  generateFinanceUploadUrl: financeService.generateUploadUrl,
  listFinanceTransactions: financeService.listTransactions,
  __private: {
    buildFinanceFingerprint,
    buildStoragePath,
    decodeCursor,
    encodeCursor,
    extractStorageObjectMime,
    extractStorageObjectSize,
    hasFinancePrefix,
    isStorageNotFoundError,
    isUniqueViolationForConstraint,
    sanitizeFileName,
  },
};
