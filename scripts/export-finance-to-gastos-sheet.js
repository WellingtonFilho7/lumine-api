#!/usr/bin/env node

const { google } = require('googleapis');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const GOOGLE_CREDENTIALS_RAW = process.env.GOOGLE_CREDENTIALS || '';
const LEGACY_GASTOS_SHEET_TITLE = process.env.LEGACY_GASTOS_SHEET_TITLE || 'gastos';
const LEGACY_GASTOS_RANGE = process.env.LEGACY_GASTOS_RANGE || `${LEGACY_GASTOS_SHEET_TITLE}!A:ZZ`;
const FINANCE_EXPORT_PAGE_SIZE = Number(process.env.FINANCE_EXPORT_PAGE_SIZE || 1000);
const FINANCE_EXPORT_BATCH_SIZE = Number(process.env.FINANCE_EXPORT_BATCH_SIZE || 200);
const FINANCE_GASTOS_SOURCE = process.env.FINANCE_GASTOS_SOURCE || 'app_finance';

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

let GOOGLE_CREDENTIALS = {};
try {
  GOOGLE_CREDENTIALS = JSON.parse(GOOGLE_CREDENTIALS_RAW);
} catch (_error) {
  fail('GOOGLE_CREDENTIALS invalid JSON');
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const HEADER_ALIASES = {
  transactionId: ['transaction_id', 'id_transacao', 'transacao_id', 'id', 'id_lancamento'],
  data: ['data', 'data_transacao', 'data_lancamento', 'dia'],
  tipo: ['tipo', 'tipo_transacao', 'movimento'],
  categoria: ['categoria', 'categoria_gasto', 'classificacao', 'grupo'],
  descricao: ['descricao', 'historico', 'detalhamento', 'detalhe', 'observacoes', 'observacao', 'item'],
  valor: ['valor', 'valor_r', 'valor_rs', 'total', 'quantia'],
  valorCentavos: ['valor_centavos'],
  formaPagamento: ['forma_pagamento', 'pagamento', 'metodo_pagamento', 'meio_pagamento', 'forma'],
  comprovantePath: ['comprovante_path', 'comprovante', 'anexo', 'arquivo', 'comprovante_url'],
  registradoPor: ['registrado_por', 'user_id', 'responsavel', 'registrado_por_id'],
  createdAt: ['created_at', 'criado_em', 'timestamp', 'data_criacao'],
  origem: ['origem', 'fonte', 'source'],
  ano: ['ano'],
  trimestre: ['trimestre'],
  mes: ['mes', 'mes_referencia'],
  categoriaArquivo: ['categoria_arquivo', 'categoria_pasta'],
};

const MONTH_LABELS = [
  'Janeiro',
  'Fevereiro',
  'Marco',
  'Abril',
  'Maio',
  'Junho',
  'Julho',
  'Agosto',
  'Setembro',
  'Outubro',
  'Novembro',
  'Dezembro',
];

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

function parseDateInfo(rawDate) {
  const text = normalizeText(rawDate, 20);
  if (!text) return null;
  const date = new Date(`${text}T12:00:00`);
  if (Number.isNaN(date.getTime())) return null;

  const year = date.getUTCFullYear();
  const monthIndex = date.getUTCMonth();
  const monthLabel = MONTH_LABELS[monthIndex] || '';
  const quarter = Math.floor(monthIndex / 3) + 1;
  const quarterLabel =
    quarter === 1
      ? 'T1_Jan-Mar'
      : quarter === 2
      ? 'T2_Abr-Jun'
      : quarter === 3
      ? 'T3_Jul-Set'
      : 'T4_Out-Dez';

  return {
    isoDate: text,
    year: String(year),
    monthLabel,
    quarterLabel,
  };
}

function formatCentsToBrl(cents) {
  const parsed = Number(cents);
  if (!Number.isFinite(parsed) || parsed <= 0) return '';
  return (parsed / 100).toFixed(2).replace('.', ',');
}

function mapCategoryToFolder(categoryRaw) {
  const token = normalizeText(categoryRaw, 120)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

  if (token === 'aluguel_utilidades') return '01_ALUGUEL_UTILIDADES';
  if (token === 'manutencao_reparos') return '02_MANUTENCAO_REPAROS';
  if (token === 'impostos_taxas') return '03_IMPOSTOS_TAXAS';
  if (token === 'tecnologia_e_equipamentos') return '04_TECNOLOGIA_E_EQUIPAMENTOS';
  if (token === 'reembolso_voluntario') return '05-Reembolsos';
  if (token === 'servicos_tecnicos') return '05_SERVICOS_TECNICOS';
  return '99_OUTROS';
}

function findColumnIndexes(headers) {
  const map = {};
  Object.entries(HEADER_ALIASES).forEach(([field, aliases]) => {
    map[field] = headers.findIndex(header => aliases.includes(header));
  });
  return map;
}

function getCell(row, index) {
  if (index < 0) return '';
  return normalizeText(row[index] || '', 500);
}

async function getSheetsClient() {
  const auth = new google.auth.GoogleAuth({
    credentials: GOOGLE_CREDENTIALS,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  const client = await auth.getClient();
  return google.sheets({ version: 'v4', auth: client });
}

async function fetchAllFinanceRows() {
  const rows = [];
  let offset = 0;

  while (true) {
    const to = offset + FINANCE_EXPORT_PAGE_SIZE - 1;
    const { data, error } = await supabase
      .from('transacoes_financeiras')
      .select('*')
      .order('created_at', { ascending: true })
      .range(offset, to);

    if (error) throw error;

    const batch = Array.isArray(data) ? data : [];
    rows.push(...batch);
    if (batch.length < FINANCE_EXPORT_PAGE_SIZE) break;
    offset += FINANCE_EXPORT_PAGE_SIZE;
  }

  return rows;
}

function buildTargetRow(record, columns, headerSize) {
  const row = Array.from({ length: headerSize }, () => '');
  const dateInfo = parseDateInfo(record.data_transacao);

  const setValue = (field, value) => {
    const idx = columns[field];
    if (idx >= 0) row[idx] = value ?? '';
  };

  setValue('transactionId', record.id);
  setValue('data', record.data_transacao || '');
  setValue('tipo', record.tipo || '');
  setValue('categoria', record.categoria || '');
  setValue('descricao', record.descricao || '');
  setValue('valor', formatCentsToBrl(record.valor_centavos));
  setValue('valorCentavos', record.valor_centavos || '');
  setValue('formaPagamento', record.forma_pagamento || '');
  setValue('comprovantePath', record.comprovante_path || '');
  setValue('registradoPor', record.registrado_por || '');
  setValue('createdAt', record.created_at || '');
  setValue('origem', FINANCE_GASTOS_SOURCE);
  setValue('ano', dateInfo?.year || '');
  setValue('trimestre', dateInfo?.quarterLabel || '');
  setValue('mes', dateInfo?.monthLabel || '');
  setValue('categoriaArquivo', mapCategoryToFolder(record.categoria));

  return row;
}

async function run() {
  const sheets = await getSheetsClient();

  const sheetRes = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: LEGACY_GASTOS_RANGE,
    majorDimension: 'ROWS',
  });

  const rows = Array.isArray(sheetRes.data.values) ? sheetRes.data.values : [];
  if (!rows.length) {
    fail(`A aba ${LEGACY_GASTOS_SHEET_TITLE} nao possui cabecalho. Abortei para nao criar estrutura incorreta.`);
  }

  const headers = rows[0].map((header, index) => normalizeHeader(header, index));
  const columns = findColumnIndexes(headers);

  if (columns.transactionId < 0) {
    fail(
      `A aba ${LEGACY_GASTOS_SHEET_TITLE} precisa de uma coluna de id (ex.: transaction_id) para evitar duplicidade.`
    );
  }

  const existingIds = new Set();
  rows.slice(1).forEach(row => {
    const id = getCell(row, columns.transactionId);
    if (id) existingIds.add(id);
  });

  const financeRows = await fetchAllFinanceRows();
  const toAppend = [];
  let skippedExisting = 0;

  for (const record of financeRows) {
    const id = normalizeText(record.id, 200);
    if (!id) continue;

    if (existingIds.has(id)) {
      skippedExisting += 1;
      continue;
    }

    toAppend.push(buildTargetRow(record, columns, headers.length));
  }

  const summary = {
    mode: DRY_RUN ? 'dry-run' : 'apply',
    sheetTitle: LEGACY_GASTOS_SHEET_TITLE,
    scannedFinanceRows: financeRows.length,
    alreadyInSheet: existingIds.size,
    skippedExisting,
    rowsToAppend: toAppend.length,
    previewFirstRows: toAppend.slice(0, 3),
  };

  if (DRY_RUN || toAppend.length === 0) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  for (let i = 0; i < toAppend.length; i += FINANCE_EXPORT_BATCH_SIZE) {
    const chunk = toAppend.slice(i, i + FINANCE_EXPORT_BATCH_SIZE);
    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: `${LEGACY_GASTOS_SHEET_TITLE}!A:ZZ`,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: chunk },
    });
  }

  console.log(
    JSON.stringify(
      {
        ...summary,
        appended: toAppend.length,
      },
      null,
      2
    )
  );
}

run().catch(error => {
  console.error('Export failed:', error.message);
  process.exit(1);
});
