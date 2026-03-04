const { google } = require('googleapis');

const SHEETS_MIRROR_ENABLED = process.env.SHEETS_MIRROR_ENABLED === 'true';
const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const GOOGLE_CREDENTIALS = JSON.parse(process.env.GOOGLE_CREDENTIALS || '{}');

const MIRROR_SHEET_TITLE = process.env.MIRROR_SHEET_TITLE || 'Mirror_Intake';
const FINANCE_SHEET_TITLE = process.env.FINANCE_SHEET_TITLE || 'Finance';

const MIRROR_HEADERS = ['timestamp', 'stage', 'entityId', 'status', 'dataRev', 'details'];
const FINANCE_HEADERS = [
  'timestamp',
  'transaction_id',
  'tipo',
  'categoria',
  'valor_centavos',
  'data_transacao',
  'forma_pagamento',
  'descricao',
  'comprovante_path',
  'registrado_por',
  'updated_by',
];

async function getSheets() {
  const auth = new google.auth.GoogleAuth({
    credentials: GOOGLE_CREDENTIALS,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  const client = await auth.getClient();
  return google.sheets({ version: 'v4', auth: client });
}

async function ensureSheetHeaders(sheets, title, headers) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  const existing = (meta.data.sheets || []).find(sheet => sheet.properties?.title === title);

  if (!existing) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: {
        requests: [{ addSheet: { properties: { title } } }],
      },
    });
  }

  const lastColumnLetter = String.fromCharCode('A'.charCodeAt(0) + headers.length - 1);
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${title}!A1:${lastColumnLetter}1`,
    valueInputOption: 'RAW',
    requestBody: { values: [headers] },
  });
}

async function mirrorEvent(event) {
  if (!SHEETS_MIRROR_ENABLED) return;
  if (!SPREADSHEET_ID) return;

  const sheets = await getSheets();
  await ensureSheetHeaders(sheets, MIRROR_SHEET_TITLE, MIRROR_HEADERS);

  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: `${MIRROR_SHEET_TITLE}!A:F`,
    valueInputOption: 'RAW',
    requestBody: {
      values: [[
        new Date().toISOString(),
        event.stage,
        event.entityId || '',
        event.status || '',
        event.dataRev ?? '',
        JSON.stringify(event.details || {}),
      ]],
    },
  });
}

async function mirrorFinanceTransaction(transaction) {
  if (!SHEETS_MIRROR_ENABLED) return;
  if (!SPREADSHEET_ID) return;

  const sheets = await getSheets();
  await ensureSheetHeaders(sheets, FINANCE_SHEET_TITLE, FINANCE_HEADERS);

  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: `${FINANCE_SHEET_TITLE}!A:K`,
    valueInputOption: 'RAW',
    requestBody: {
      values: [[
        new Date().toISOString(),
        transaction.transactionId || '',
        transaction.tipo || '',
        transaction.categoria || '',
        transaction.valorCentavos ?? '',
        transaction.dataTransacao || '',
        transaction.formaPagamento || '',
        transaction.descricao || '',
        transaction.comprovantePath || '',
        transaction.registradoPor || '',
        transaction.updatedBy || '',
      ]],
    },
  });
}

module.exports = {
  mirrorEvent,
  mirrorFinanceTransaction,
};
