#!/usr/bin/env node

const fs = require('fs');
const { google } = require('googleapis');
const { createClient } = require('@supabase/supabase-js');
const { normalizeHeader, findColumnIndexes } = require('./lib/finance-gastos-shared');
const { parseStartRowFromRange, computePrunePlan } = require('./lib/finance-gastos-prune');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const GOOGLE_CREDENTIALS_RAW = process.env.GOOGLE_CREDENTIALS || '';
const GOOGLE_CREDENTIALS_FILE = process.env.GOOGLE_CREDENTIALS_FILE || '';
const LEGACY_GASTOS_SHEET_TITLE = process.env.LEGACY_GASTOS_SHEET_TITLE || 'gastos';
const LEGACY_GASTOS_RANGE = process.env.LEGACY_GASTOS_RANGE || `${LEGACY_GASTOS_SHEET_TITLE}!A:ZZ`;
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

async function fetchAllFinanceIds() {
  const ids = new Set();
  let offset = 0;

  while (true) {
    const to = offset + FINANCE_EXPORT_PAGE_SIZE - 1;
    const { data, error } = await supabase
      .from('transacoes_financeiras')
      .select('id')
      .order('created_at', { ascending: true })
      .range(offset, to);

    if (error) throw error;
    const batch = Array.isArray(data) ? data : [];
    batch.forEach(item => {
      if (item && item.id) ids.add(String(item.id));
    });
    if (batch.length < FINANCE_EXPORT_PAGE_SIZE) break;
    offset += FINANCE_EXPORT_PAGE_SIZE;
  }

  return ids;
}

async function run() {
  const sheets = await getSheetsClient();
  const [sheetRes, metaRes, financeIds] = await Promise.all([
    sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: LEGACY_GASTOS_RANGE,
      majorDimension: 'ROWS',
    }),
    sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID }),
    fetchAllFinanceIds(),
  ]);

  const rows = Array.isArray(sheetRes.data.values) ? sheetRes.data.values : [];
  if (!rows.length) {
    fail(`A aba ${LEGACY_GASTOS_SHEET_TITLE} nao possui cabecalho. Abortei para nao remover linhas indevidas.`);
  }

  const headers = rows[0].map((header, index) => normalizeHeader(header, index));
  const columns = findColumnIndexes(headers);
  if (columns.transactionId < 0) {
    fail(`A aba ${LEGACY_GASTOS_SHEET_TITLE} precisa de uma coluna de id (ex.: transaction_id) para prune.`);
  }

  const startRowNumber = parseStartRowFromRange(LEGACY_GASTOS_RANGE);
  const { rowsToDelete, orphanTransactionIds } = computePrunePlan({
    rows,
    transactionIdColumnIndex: columns.transactionId,
    financeIds,
    startRowNumber,
  });

  const summary = {
    mode: DRY_RUN ? 'dry-run' : 'apply',
    sheetTitle: LEGACY_GASTOS_SHEET_TITLE,
    scannedSheetRows: Math.max(0, rows.length - 1),
    scannedFinanceRows: financeIds.size,
    rowsToDelete: rowsToDelete.length,
    previewRows: rowsToDelete.slice(0, 20),
    previewTransactionIds: orphanTransactionIds.slice(0, 20),
  };

  if (DRY_RUN || rowsToDelete.length === 0) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  const sheet = (metaRes.data.sheets || []).find(item => item.properties?.title === LEGACY_GASTOS_SHEET_TITLE);
  if (!sheet?.properties?.sheetId && sheet?.properties?.sheetId !== 0) {
    fail(`Aba ${LEGACY_GASTOS_SHEET_TITLE} nao encontrada no spreadsheet.`);
  }
  const sheetId = sheet.properties.sheetId;

  const descRows = [...rowsToDelete].sort((a, b) => b - a);
  for (let i = 0; i < descRows.length; i += 200) {
    const chunk = descRows.slice(i, i + 200);
    const requests = chunk.map(rowNumber => ({
      deleteDimension: {
        range: {
          sheetId,
          dimension: 'ROWS',
          startIndex: rowNumber - 1,
          endIndex: rowNumber,
        },
      },
    }));

    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: { requests },
    });
  }

  console.log(
    JSON.stringify(
      {
        ...summary,
        deleted: rowsToDelete.length,
      },
      null,
      2
    )
  );
}

run().catch(error => {
  console.error('Prune failed:', error.message);
  process.exit(1);
});
