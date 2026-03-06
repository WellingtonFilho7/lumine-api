#!/usr/bin/env node

const crypto = require('crypto');
const { google } = require('googleapis');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const GOOGLE_CREDENTIALS_RAW = process.env.GOOGLE_CREDENTIALS || '';
const LEGACY_IMPORT_ACTOR_USER_ID = process.env.LEGACY_IMPORT_ACTOR_USER_ID || '';
const LEGACY_GASTOS_SHEET_TITLE = process.env.LEGACY_GASTOS_SHEET_TITLE || 'gastos';
const LEGACY_GASTOS_RANGE = process.env.LEGACY_GASTOS_RANGE || `${LEGACY_GASTOS_SHEET_TITLE}!A:ZZ`;

const APPLY = process.argv.includes('--apply');
const DRY_RUN = !APPLY;

function fail(message) {
  console.error(message);
  process.exit(1);
}

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  fail('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
}

if (!SPREADSHEET_ID || !GOOGLE_CREDENTIALS_RAW) {
  fail('Missing SPREADSHEET_ID or GOOGLE_CREDENTIALS');
}

if (!LEGACY_IMPORT_ACTOR_USER_ID) {
  fail('Missing LEGACY_IMPORT_ACTOR_USER_ID (UUID de auth.users/perfis_internos que sera dono da importacao)');
}

let GOOGLE_CREDENTIALS = {};
try {
  GOOGLE_CREDENTIALS = JSON.parse(GOOGLE_CREDENTIALS_RAW);
} catch (_error) {
  fail('GOOGLE_CREDENTIALS invalid JSON');
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function normalizeHeader(value, index) {
  const normalized = String(value || '')
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

  if (!normalized) return `col_${index + 1}`;
  return normalized;
}

function normalizeText(value, max = 500) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function isBlankRow(values) {
  return values.every(item => !normalizeText(item));
}

function mapRow(headers, row) {
  const mapped = {};
  headers.forEach((header, index) => {
    mapped[header] = normalizeText(row[index] || '', 2000);
  });
  return mapped;
}

function pick(obj, keys) {
  for (const key of keys) {
    const value = normalizeText(obj[key] || '', 2000);
    if (value) return value;
  }
  return '';
}

function parseDateFlexible(raw) {
  const value = normalizeText(raw, 100);
  if (!value) return null;

  if (/^\d+(\.\d+)?$/.test(value)) {
    const serial = Number(value);
    if (Number.isFinite(serial) && serial > 1000) {
      const ms = Math.round((serial - 25569) * 86400 * 1000);
      const date = new Date(ms);
      if (!Number.isNaN(date.getTime())) {
        return date.toISOString().slice(0, 10);
      }
    }
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;

  const br = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (br) {
    const dd = br[1].padStart(2, '0');
    const mm = br[2].padStart(2, '0');
    const yyyy = br[3];
    return `${yyyy}-${mm}-${dd}`;
  }

  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10);
  }

  return null;
}

function parseCentavos(raw) {
  const value = normalizeText(raw, 200);
  if (!value) return null;

  const cleaned = value
    .replace(/R\$/gi, '')
    .replace(/\s+/g, '')
    .replace(/[^\d,.-]/g, '');

  if (!cleaned) return null;

  let normalized = cleaned;
  if (normalized.includes(',') && normalized.includes('.')) {
    normalized = normalized.replace(/\./g, '').replace(',', '.');
  } else {
    normalized = normalized.replace(',', '.');
  }

  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.round(parsed * 100);
}

function normalizeTipo(raw) {
  const token = normalizeText(raw, 80)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

  if (!token) return 'gasto';
  if (token.includes('doa') || token.includes('entrada') || token.includes('receita')) {
    return 'doacao';
  }
  return 'gasto';
}

function normalizeToken(raw, fallback, max = 120) {
  const token = normalizeText(raw, max)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

  return token || fallback;
}

function normalizeComprovantePath(raw) {
  const value = normalizeText(raw, 500)
    .replace(/\\+/g, '/')
    .replace(/\/+/g, '/');

  if (!value) return '';
  if (value.startsWith('finance/')) return value;
  return '';
}

function buildIdempotencyKey(rowNumber) {
  const sourceHash = crypto
    .createHash('sha1')
    .update(`${SPREADSHEET_ID}:${LEGACY_GASTOS_SHEET_TITLE}`)
    .digest('hex')
    .slice(0, 16);

  return `legacy-gastos:${sourceHash}:${rowNumber}`;
}

function buildFingerprint(data, rowNumber) {
  const base = [
    'legacy-gastos',
    SPREADSHEET_ID,
    LEGACY_GASTOS_SHEET_TITLE,
    rowNumber,
    data.tipo,
    data.categoria,
    data.descricao,
    data.valor_centavos,
    data.data_transacao,
    data.forma_pagamento,
    data.comprovante_path,
  ].join('|');

  return crypto.createHash('sha256').update(base).digest('hex');
}

function isDuplicateError(error) {
  if (!error || error.code !== '23505') return false;
  const text = [error.message, error.details, error.hint].filter(Boolean).join(' ');
  return (
    text.includes('uq_transacoes_financeiras_actor_idempotency') ||
    text.includes('uq_transacoes_financeiras_fingerprint')
  );
}

async function getSheetsClient() {
  const auth = new google.auth.GoogleAuth({
    credentials: GOOGLE_CREDENTIALS,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });

  const client = await auth.getClient();
  return google.sheets({ version: 'v4', auth: client });
}

async function ensureActorExists(actorUserId) {
  const { data, error } = await supabase
    .from('perfis_internos')
    .select('id, nome, papel, ativo')
    .eq('id', actorUserId)
    .maybeSingle();

  if (error) throw error;
  if (!data?.id) {
    throw new Error(
      `LEGACY_IMPORT_ACTOR_USER_ID nao encontrado em perfis_internos: ${actorUserId}`
    );
  }

  return data;
}

function buildCandidateFromRow(rowMap, rowNumber) {
  const rawTipo = pick(rowMap, ['tipo', 'tipo_transacao', 'tipo_lancamento', 'movimento']);
  const rawCategoria = pick(rowMap, ['categoria', 'categoria_gasto', 'grupo', 'classificacao']);
  const rawDescricao = pick(rowMap, [
    'descricao',
    'historico',
    'detalhamento',
    'detalhe',
    'item',
    'observacao',
    'observacoes',
    'titulo',
  ]);
  const rawValor = pick(rowMap, ['valor', 'valor_r', 'valor_rs', 'total', 'quantia']);
  const rawData = pick(rowMap, ['data', 'data_transacao', 'data_lancamento', 'dia']);
  const rawForma = pick(rowMap, [
    'forma_pagamento',
    'pagamento',
    'metodo_pagamento',
    'meio_pagamento',
    'forma',
  ]);
  const rawComprovante = pick(rowMap, [
    'comprovante_path',
    'comprovante',
    'comprovante_url',
    'anexo',
    'arquivo',
  ]);

  const data_transacao = parseDateFlexible(rawData);
  const valor_centavos = parseCentavos(rawValor);

  if (!data_transacao) {
    return { ok: false, reason: 'data_invalida', rowNumber, rawData };
  }

  if (!valor_centavos) {
    return { ok: false, reason: 'valor_invalido', rowNumber, rawValor };
  }

  const tipo = normalizeTipo(rawTipo);
  const categoria = normalizeToken(rawCategoria, 'outros', 120);
  const forma_pagamento = normalizeToken(rawForma, 'nao_informado', 80);
  const descricao = normalizeText(rawDescricao || `Importado da aba gastos - linha ${rowNumber}`, 500);
  const comprovante_path = normalizeComprovantePath(rawComprovante);
  const idempotency_key = buildIdempotencyKey(rowNumber);

  const candidate = {
    tipo,
    descricao,
    categoria,
    valor_centavos,
    data_transacao,
    forma_pagamento,
    comprovante_path,
    comprovante_mime: null,
    comprovante_nome: null,
    idempotency_key,
  };

  candidate.fingerprint = buildFingerprint(candidate, rowNumber);

  return { ok: true, rowNumber, candidate };
}

async function run() {
  const actor = await ensureActorExists(LEGACY_IMPORT_ACTOR_USER_ID);
  const sheets = await getSheetsClient();

  const sheetRes = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: LEGACY_GASTOS_RANGE,
    majorDimension: 'ROWS',
  });

  const rows = Array.isArray(sheetRes.data.values) ? sheetRes.data.values : [];
  if (!rows.length) {
    console.log(JSON.stringify({ mode: DRY_RUN ? 'dry-run' : 'apply', message: 'aba vazia' }, null, 2));
    return;
  }

  const headers = rows[0].map((header, index) => normalizeHeader(header, index));
  const dataRows = rows.slice(1);

  let scanned = 0;
  let candidates = 0;
  let inserted = 0;
  let duplicated = 0;
  let invalid = 0;
  const invalidSamples = [];

  for (let idx = 0; idx < dataRows.length; idx += 1) {
    const row = dataRows[idx] || [];
    const rowNumber = idx + 2;

    if (isBlankRow(row)) continue;

    scanned += 1;
    const rowMap = mapRow(headers, row);
    const parsed = buildCandidateFromRow(rowMap, rowNumber);

    if (!parsed.ok) {
      invalid += 1;
      if (invalidSamples.length < 20) invalidSamples.push(parsed);
      continue;
    }

    candidates += 1;

    const payload = {
      ...parsed.candidate,
      registrado_por: LEGACY_IMPORT_ACTOR_USER_ID,
      updated_by: LEGACY_IMPORT_ACTOR_USER_ID,
      updated_at: new Date().toISOString(),
    };

    if (DRY_RUN) continue;

    const { error } = await supabase.from('transacoes_financeiras').insert(payload);

    if (error) {
      if (isDuplicateError(error)) {
        duplicated += 1;
        continue;
      }

      throw new Error(
        `Falha ao inserir linha ${rowNumber}: ${error.message || 'erro desconhecido'}`
      );
    }

    inserted += 1;
  }

  console.log(
    JSON.stringify(
      {
        mode: DRY_RUN ? 'dry-run' : 'apply',
        sheetTitle: LEGACY_GASTOS_SHEET_TITLE,
        actor: {
          id: actor.id,
          nome: actor.nome,
          papel: actor.papel,
          ativo: actor.ativo,
        },
        scanned,
        candidates,
        inserted,
        duplicated,
        invalid,
        invalidSamples,
      },
      null,
      2
    )
  );
}

run().catch(error => {
  console.error('Import failed:', error.message);
  process.exit(1);
});
