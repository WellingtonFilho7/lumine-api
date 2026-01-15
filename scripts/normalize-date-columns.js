/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');

const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const CREDS_FILE = process.env.GOOGLE_CREDENTIALS_FILE;
const CREDS_JSON = process.env.GOOGLE_CREDENTIALS;

if (!SPREADSHEET_ID) {
  console.error('Missing SPREADSHEET_ID env var.');
  process.exit(1);
}

if (!CREDS_FILE && !CREDS_JSON) {
  console.error('Missing GOOGLE_CREDENTIALS_FILE or GOOGLE_CREDENTIALS env var.');
  process.exit(1);
}

function loadCredentials() {
  if (CREDS_JSON) {
    return JSON.parse(CREDS_JSON);
  }
  const absPath = path.resolve(CREDS_FILE);
  return JSON.parse(fs.readFileSync(absPath, 'utf8'));
}

const CHILD_DATE_FIELDS = ['birthDate', 'startDate', 'entryDate'];
const CHILD_DATETIME_FIELDS = [
  'enrollmentDate',
  'triageDate',
  'matriculationDate',
  'createdAt',
];
const RECORD_DATE_FIELDS = ['date'];

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const SHEETS_EPOCH = Date.UTC(1899, 11, 30);
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_DATETIME_RE = /^\d{4}-\d{2}-\d{2}T/;
const SERIAL_RE = /^-?\d+(\.\d+)?$/;

function parseSerial(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed && SERIAL_RE.test(trimmed)) {
      const num = Number(trimmed);
      if (Number.isFinite(num)) return num;
    }
  }
  return null;
}

function toSerial(value, dateOnly) {
  if (value === null || value === undefined || value === '') return '';
  const existing = parseSerial(value);
  if (existing !== null) return existing;

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return '';

    if (dateOnly && ISO_DATETIME_RE.test(trimmed)) {
      return toSerial(trimmed.split('T')[0], true);
    }

    if (ISO_DATE_RE.test(trimmed)) {
      const parsed = Date.parse(`${trimmed}T00:00:00Z`);
      if (!Number.isNaN(parsed)) {
        return (parsed - SHEETS_EPOCH) / MS_PER_DAY;
      }
    }

    const parsed = Date.parse(trimmed);
    if (!Number.isNaN(parsed)) {
      return (parsed - SHEETS_EPOCH) / MS_PER_DAY;
    }
  }

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return (value.getTime() - SHEETS_EPOCH) / MS_PER_DAY;
  }

  return value;
}

function columnToLetter(column) {
  let letter = '';
  let temp = column;
  while (temp > 0) {
    const mod = (temp - 1) % 26;
    letter = String.fromCharCode(65 + mod) + letter;
    temp = Math.floor((temp - 1) / 26);
  }
  return letter;
}

async function getSheetId(sheets, title) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  const sheet = meta.data.sheets.find(entry => entry.properties.title === title);
  return sheet ? sheet.properties.sheetId : null;
}

function buildNumberFormatRequest(sheetId, columnIndex, format) {
  return {
    repeatCell: {
      range: {
        sheetId,
        startRowIndex: 1,
        startColumnIndex: columnIndex,
        endColumnIndex: columnIndex + 1,
      },
      cell: {
        userEnteredFormat: {
          numberFormat: format,
        },
      },
      fields: 'userEnteredFormat.numberFormat',
    },
  };
}

async function normalizeSheetDates({
  sheets,
  sheetName,
  range,
  dateFields,
  datetimeFields,
}) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range,
    valueRenderOption: 'UNFORMATTED_VALUE',
    dateTimeRenderOption: 'SERIAL_NUMBER',
  });

  const values = res.data.values || [];
  if (values.length <= 1) {
    console.log(`${sheetName}: sem dados para normalizar.`);
    return;
  }

  const headers = values[0];
  const headerMap = {};
  headers.forEach((header, index) => {
    headerMap[header] = index;
  });

  const updatedRows = values.slice(1).map(row => {
    const normalizedRow = Array.from({ length: headers.length }, (_, idx) => row[idx] ?? '');

    dateFields.forEach(field => {
      const idx = headerMap[field];
      if (idx !== undefined) {
        normalizedRow[idx] = toSerial(normalizedRow[idx], true);
      }
    });

    datetimeFields.forEach(field => {
      const idx = headerMap[field];
      if (idx !== undefined) {
        normalizedRow[idx] = toSerial(normalizedRow[idx], false);
      }
    });

    return normalizedRow;
  });

  const endColumn = columnToLetter(headers.length);
  const endRow = updatedRows.length + 1;

  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${sheetName}!A2:${endColumn}${endRow}`,
    valueInputOption: 'RAW',
    requestBody: { values: updatedRows },
  });

  const sheetId = await getSheetId(sheets, sheetName);
  if (sheetId === null || sheetId === undefined) {
    console.log(`${sheetName}: sheetId nao encontrado.`);
    return;
  }

  const requests = [];
  dateFields.forEach(field => {
    const idx = headerMap[field];
    if (idx !== undefined) {
      requests.push(
        buildNumberFormatRequest(sheetId, idx, {
          type: 'DATE',
          pattern: 'dd/MM/yyyy',
        })
      );
    }
  });

  datetimeFields.forEach(field => {
    const idx = headerMap[field];
    if (idx !== undefined) {
      requests.push(
        buildNumberFormatRequest(sheetId, idx, {
          type: 'DATE_TIME',
          pattern: 'dd/MM/yyyy HH:mm',
        })
      );
    }
  });

  if (requests.length > 0) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: { requests },
    });
  }

  console.log(`${sheetName}: datas normalizadas e formatadas.`);
}

async function main() {
  const auth = new google.auth.GoogleAuth({
    credentials: loadCredentials(),
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  const sheets = google.sheets({ version: 'v4', auth });

  await normalizeSheetDates({
    sheets,
    sheetName: 'Criancas',
    range: 'Criancas!A1:AM',
    dateFields: CHILD_DATE_FIELDS,
    datetimeFields: CHILD_DATETIME_FIELDS,
  });

  await normalizeSheetDates({
    sheets,
    sheetName: 'Registros',
    range: 'Registros!A1:L',
    dateFields: RECORD_DATE_FIELDS,
    datetimeFields: [],
  });
}

main().catch(error => {
  console.error('Erro ao normalizar datas:', error.message || error);
  process.exit(1);
});
