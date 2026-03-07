#!/usr/bin/env node

const fs = require('fs');
const { google } = require('googleapis');
const { createClient } = require('@supabase/supabase-js');
const {
  normalizeHeader,
  normalizeText,
  findColumnIndexes,
  getCell,
  buildTargetValues,
  isEquivalentCellValue,
} = require('./lib/finance-gastos-shared');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const GOOGLE_CREDENTIALS_RAW = process.env.GOOGLE_CREDENTIALS || '';
const GOOGLE_CREDENTIALS_FILE = process.env.GOOGLE_CREDENTIALS_FILE || '';
const LEGACY_GASTOS_SHEET_TITLE = process.env.LEGACY_GASTOS_SHEET_TITLE || 'gastos';
const LEGACY_GASTOS_RANGE = process.env.LEGACY_GASTOS_RANGE || `${LEGACY_GASTOS_SHEET_TITLE}!A:ZZ`;
const FINANCE_GASTOS_SOURCE = process.env.FINANCE_GASTOS_SOURCE || 'app_finance';
const FINANCE_EXPORT_PAGE_SIZE = Number(process.env.FINANCE_EXPORT_PAGE_SIZE || 1000);

const APPLY = process.argv.includes('--apply');
const DRY_RUN = !APPLY;

function fail(message) {
  console.error(message);
  process.exit(1);
}

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  fail('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
}

if (!SPREADSHEET_ID || (!GOOGLE_CREDENTIALS_RAW && !GOOGLE_CREDENTIALS_FILE)) {
  fail('Missing SPREADSHEET_ID and GOOGLE credentials. Use GOOGLE_CREDENTIALS or GOOGLE_CREDENTIALS_FILE.');
}

let GOOGLE_CREDENTIALS = {};
try {
  if (GOOGLE_CREDENTIALS_FILE) {
    GOOGLE_CREDENTIALS = JSON.parse(fs.readFileSync(GOOGLE_CREDENTIALS_FILE, 'utf8'));
  } else {
    GOOGLE_CREDENTIALS = JSON.parse(GOOGLE_CREDENTIALS_RAW);
  }
} catch (_error) {
  fail('Google credentials invalid JSON. Check GOOGLE_CREDENTIALS_FILE or GOOGLE_CREDENTIALS.');
}

if (!GOOGLE_CREDENTIALS.client_email || !GOOGLE_CREDENTIALS.private_key) {
  fail('Google credentials must be Service Account JSON (missing client_email/private_key).');
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

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

function shouldWriteNewValue(field, currentValue, nextValue) {
  const next = normalizeText(nextValue || '', 1000);
  if (!next) return false;
  return !isEquivalentCellValue(field, currentValue, nextValue);
}

async function run() {
  const sheets = await getSheetsClient();

  const [sheetRes, financeRows] = await Promise.all([
    sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: LEGACY_GASTOS_RANGE,
      majorDimension: 'ROWS',
    }),
    fetchAllFinanceRows(),
  ]);

  const rows = Array.isArray(sheetRes.data.values) ? sheetRes.data.values : [];
  if (!rows.length) {
    fail(`A aba ${LEGACY_GASTOS_SHEET_TITLE} nao possui cabecalho. Abortei para nao criar estrutura incorreta.`);
  }

  const headers = rows[0].map((header, index) => normalizeHeader(header, index));
  const columns = findColumnIndexes(headers);

  if (columns.transactionId < 0) {
    fail(`A aba ${LEGACY_GASTOS_SHEET_TITLE} precisa de uma coluna de id (ex.: transaction_id) para backfill.`);
  }

  const financeById = new Map(financeRows.map(row => [normalizeText(row.id, 200), row]));
  const updates = [];
  let matchedRows = 0;
  let unchangedRows = 0;
  let rowsMissingInDatabase = 0;

  for (let i = 1; i < rows.length; i += 1) {
    const original = rows[i] || [];
    const transactionId = getCell(original, columns.transactionId);
    if (!transactionId) continue;

    const finance = financeById.get(transactionId);
    if (!finance) {
      rowsMissingInDatabase += 1;
      continue;
    }

    matchedRows += 1;
    const nextRow = [...original];
    const target = buildTargetValues(finance, FINANCE_GASTOS_SOURCE);

    for (const [field, value] of Object.entries(target)) {
      const columnIndex = columns[field];
      if (columnIndex < 0) continue;
      while (nextRow.length <= columnIndex) nextRow.push('');

      if (shouldWriteNewValue(field, nextRow[columnIndex], value)) {
        nextRow[columnIndex] = String(value ?? '');
      }
    }

    if (JSON.stringify(nextRow) === JSON.stringify(original)) {
      unchangedRows += 1;
      continue;
    }

    const rowNumber = i + 1;
    updates.push({
      range: `${LEGACY_GASTOS_SHEET_TITLE}!A${rowNumber}:ZZ${rowNumber}`,
      values: [nextRow],
    });
  }

  const summary = {
    mode: DRY_RUN ? 'dry-run' : 'apply',
    sheetTitle: LEGACY_GASTOS_SHEET_TITLE,
    scannedSheetRows: Math.max(0, rows.length - 1),
    scannedFinanceRows: financeRows.length,
    matchedRows,
    rowsMissingInDatabase,
    unchangedRows,
    rowsToUpdate: updates.length,
    previewRanges: updates.slice(0, 5).map(item => item.range),
  };

  if (DRY_RUN || !updates.length) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  for (let i = 0; i < updates.length; i += 100) {
    const chunk = updates.slice(i, i + 100);
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: {
        valueInputOption: 'RAW',
        data: chunk,
      },
    });
  }

  console.log(
    JSON.stringify(
      {
        ...summary,
        updated: updates.length,
      },
      null,
      2
    )
  );
}

run().catch(error => {
  console.error('Backfill failed:', error.message);
  process.exit(1);
});
