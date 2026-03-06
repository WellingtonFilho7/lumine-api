const { z } = require('zod');
const { sanitizeOptional, sanitizeText } = require('./security');

const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const IDP_KEY_REGEX = /^[A-Za-z0-9_.:-]{4,120}$/;
const DEFAULT_ALLOWED_UPLOAD_MIME = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];

function normalizeAscii(value) {
  return String(value || '')
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function normalizeTipo(value) {
  const token = normalizeAscii(value);
  if (token === 'doacao' || token === 'doação') return 'doacao';
  if (token === 'gasto' || token === 'despesa') return 'gasto';
  return token;
}

const CATEGORY_ALIASES = new Map([
  ['01_aluguel_utilidades', 'aluguel_utilidades'],
  ['aluguel_utilidades', 'aluguel_utilidades'],
  ['aluguel_e_utilidades', 'aluguel_utilidades'],
  ['02_manutencao_reparos', 'manutencao_reparos'],
  ['manutencao_reparos', 'manutencao_reparos'],
  ['manutencao', 'manutencao_reparos'],
  ['limpeza', 'manutencao_reparos'],
  ['03_impostos_taxas', 'impostos_taxas'],
  ['impostos_taxas', 'impostos_taxas'],
  ['04_tecnologia_e_equipamentos', 'tecnologia_e_equipamentos'],
  ['tecnologia_e_equipamentos', 'tecnologia_e_equipamentos'],
  ['material_pedagogico', 'tecnologia_e_equipamentos'],
  ['05_reembolsos', 'reembolso_voluntario'],
  ['05-reembolsos', 'reembolso_voluntario'],
  ['reembolso', 'reembolso_voluntario'],
  ['reembolsos', 'reembolso_voluntario'],
  ['reembolso_voluntario', 'reembolso_voluntario'],
  ['05_servicos_tecnicos', 'servicos_tecnicos'],
  ['servico_tecnico', 'servicos_tecnicos'],
  ['servicos_tecnicos', 'servicos_tecnicos'],
  ['alimentacao', 'outros'],
  ['transporte', 'outros'],
  ['eventos', 'outros'],
  ['99_outros', 'outros'],
  ['outros', 'outros'],
]);

function normalizeCategoria(value) {
  const token = normalizeAscii(value).replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  if (!token) return '';
  return CATEGORY_ALIASES.get(token) || token;
}

function getAllowedUploadMime() {
  const raw = String(process.env.FINANCE_ALLOWED_MIME || '').trim();
  if (!raw) return DEFAULT_ALLOWED_UPLOAD_MIME;
  return raw
    .split(',')
    .map(item => item.trim().toLowerCase())
    .filter(Boolean);
}

function normalizeStoragePath(value) {
  return String(value || '')
    .trim()
    .replace(/\\+/g, '/')
    .replace(/\/+/g, '/');
}

function isValidStoragePath(value) {
  const path = normalizeStoragePath(value);
  if (!path || path.length > 500) return false;
  if (path.startsWith('/')) return false;
  if (path.includes('..')) return false;
  if (!/^[A-Za-z0-9._\-/]+$/.test(path)) return false;
  return true;
}

function toCentavosFromMoney(value) {
  if (value === null || value === undefined || value === '') return null;

  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.round(value * 100);
  }

  const raw = String(value).trim();
  if (!raw) return null;

  let normalized = raw.replace(/\s+/g, '');
  if (normalized.includes(',') && normalized.includes('.')) {
    normalized = normalized.replace(/\./g, '').replace(',', '.');
  } else {
    normalized = normalized.replace(',', '.');
  }

  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) return null;
  return Math.round(parsed * 100);
}

function toInteger(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed)) return null;
  return parsed;
}

function normalizeCreatePayload(raw) {
  const payload = raw && typeof raw === 'object' ? { ...raw } : {};

  payload.tipo = normalizeTipo(payload.tipo);
  payload.descricao = sanitizeText(payload.descricao, 500);
  payload.categoria = normalizeCategoria(payload.categoria);
  payload.formaPagamento = sanitizeText(payload.formaPagamento || payload.forma_pagamento, 80);
  payload.data = sanitizeText(payload.data || payload.dataTransacao || payload.data_transacao, 20);

  const cents = toInteger(payload.valorCentavos ?? payload.valor_centavos);
  payload.valorCentavos = cents ?? toCentavosFromMoney(payload.valor ?? payload.value);

  payload.comprovantePath = normalizeStoragePath(
    payload.comprovantePath || payload.comprovante_path
  );
  payload.comprovanteMime = sanitizeOptional(
    payload.comprovanteMime || payload.comprovante_mime || payload.contentType,
    120
  );
  payload.comprovanteNome = sanitizeOptional(
    payload.comprovanteNome || payload.comprovante_nome || payload.fileName,
    200
  );
  payload.idempotencyKey = sanitizeOptional(
    payload.idempotencyKey || payload.idempotency_key,
    120
  );

  return payload;
}

function normalizeUploadPayload(raw) {
  const payload = raw && typeof raw === 'object' ? { ...raw } : {};

  payload.fileName = sanitizeText(payload.fileName || payload.filename || payload.file_name, 200);
  payload.contentType = sanitizeText(payload.contentType || payload.content_type || payload.mime, 120).toLowerCase();
  payload.fileSizeBytes = toInteger(payload.fileSizeBytes ?? payload.fileSize ?? payload.size ?? payload.bytes);

  return payload;
}

function normalizeListQuery(raw) {
  const query = raw && typeof raw === 'object' ? { ...raw } : {};

  query.limit = toInteger(query.limit) || 20;
  query.cursor = sanitizeOptional(query.cursor, 200);
  query.tipo = sanitizeOptional(normalizeTipo(query.tipo), 20);
  query.categoria = sanitizeOptional(normalizeCategoria(query.categoria), 120);
  query.startDate = sanitizeOptional(
    query.startDate || query.start || query.dataInicio || query.from,
    20
  );
  query.endDate = sanitizeOptional(
    query.endDate || query.end || query.dataFim || query.to,
    20
  );

  return query;
}

function normalizeFileUrlPayload(raw) {
  const payload = raw && typeof raw === 'object' ? { ...raw } : {};
  payload.comprovantePath = normalizeStoragePath(
    payload.comprovantePath || payload.comprovante_path || payload.path
  );
  payload.expiresIn = toInteger(payload.expiresIn ?? payload.expires ?? payload.ttl) || 120;
  return payload;
}

const financeCreateSchema = z.preprocess(
  normalizeCreatePayload,
  z.object({
    tipo: z.enum(['gasto', 'doacao']),
    descricao: z.string().min(1, 'descricao e obrigatoria').max(500),
    categoria: z.string().min(1, 'categoria e obrigatoria').max(120),
    valorCentavos: z.number().int().positive('valor e obrigatorio'),
    data: z.string().regex(ISO_DATE_REGEX, 'data invalida'),
    formaPagamento: z.string().min(1, 'formaPagamento e obrigatorio').max(80),
    comprovantePath: z
      .string()
      .refine(isValidStoragePath, 'comprovantePath invalido'),
    comprovanteMime: z.string().nullable().optional(),
    comprovanteNome: z.string().nullable().optional(),
    idempotencyKey: z
      .string()
      .nullable()
      .optional()
      .refine(value => value == null || IDP_KEY_REGEX.test(value), 'idempotencyKey invalida'),
  })
);

const financeUploadUrlSchema = z.preprocess(
  normalizeUploadPayload,
  z.object({
    fileName: z
      .string({ required_error: 'fileName e obrigatorio' })
      .min(3, 'fileName invalido')
      .max(200)
      .refine(value => !value.includes('/') && !value.includes('\\'), 'fileName invalido'),
    contentType: z
      .string({ required_error: 'contentType e obrigatorio' })
      .refine(value => getAllowedUploadMime().includes(value), 'contentType invalido'),
    fileSizeBytes: z.number().int().positive('fileSizeBytes invalido'),
  })
);

const financeListSchema = z.preprocess(
  normalizeListQuery,
  z
    .object({
      limit: z.number().int().min(1).max(100),
      cursor: z.string().nullable().optional(),
      tipo: z.enum(['gasto', 'doacao']).nullable().optional(),
      categoria: z.string().nullable().optional(),
      startDate: z
        .string()
        .regex(ISO_DATE_REGEX, 'startDate invalida')
        .nullable()
        .optional(),
      endDate: z
        .string()
        .regex(ISO_DATE_REGEX, 'endDate invalida')
        .nullable()
        .optional(),
    })
    .superRefine((value, ctx) => {
      if (value.startDate && value.endDate && value.startDate > value.endDate) {
        ctx.addIssue({
          code: 'custom',
          message: 'intervalo de data invalido',
          path: ['startDate'],
        });
      }
    })
);

const financeFileUrlSchema = z.preprocess(
  normalizeFileUrlPayload,
  z.object({
    comprovantePath: z
      .string({ required_error: 'comprovantePath e obrigatorio' })
      .refine(isValidStoragePath, 'comprovantePath invalido'),
    expiresIn: z.number().int().min(30).max(3600),
  })
);

function parseOrThrow(schema, payload) {
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0];
    const message = firstIssue?.message || 'Payload invalido';
    const error = new Error(message);
    error.statusCode = 400;
    error.code = 'INVALID_PAYLOAD';
    throw error;
  }
  return parsed.data;
}

function parseFinanceCreatePayload(payload) {
  return parseOrThrow(financeCreateSchema, payload);
}

function parseFinanceUploadUrlPayload(payload) {
  return parseOrThrow(financeUploadUrlSchema, payload);
}

function parseFinanceListQuery(query) {
  return parseOrThrow(financeListSchema, query);
}

function parseFinanceFileUrlPayload(payload) {
  return parseOrThrow(financeFileUrlSchema, payload);
}

module.exports = {
  getAllowedUploadMime,
  parseFinanceCreatePayload,
  parseFinanceFileUrlPayload,
  parseFinanceListQuery,
  parseFinanceUploadUrlPayload,
  __private: {
    isValidStoragePath,
    normalizeStoragePath,
    toCentavosFromMoney,
    toInteger,
  },
};
