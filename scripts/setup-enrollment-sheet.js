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

const CHILD_HEADERS = [
  'id',
  'childId',
  'name',
  'birthDate',
  'guardianName',
  'guardianPhone',
  'guardianPhoneAlt',
  'guardianRelation',
  'address',
  'school',
  'schoolShift',
  'grade',
  'neighborhood',
  'referralSource',
  'emergencyContact',
  'emergencyPhone',
  'authorizedPickup',
  'healthNotes',
  'specialNeeds',
  'priority',
  'priorityReason',
  'enrollmentStatus',
  'enrollmentDate',
  'triageDate',
  'triageNotes',
  'startDate',
  'classGroup',
  'responsibilityTerm',
  'consentTerm',
  'imageConsent',
  'documentsReceived',
  'initialObservations',
  'matriculationDate',
  'enrollmentHistory',
  'entryDate',
  'createdAt',
];

function hasAnyData(values) {
  if (!values || values.length <= 1) return false;
  return values.slice(1).some(row => row.some(cell => String(cell || '').trim() !== ''));
}

function timestamp() {
  const now = new Date();
  const pad = value => String(value).padStart(2, '0');
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}`;
}

async function ensureSheet(sheets, title) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  const existing = meta.data.sheets.find(sheet => sheet.properties.title === title);
  if (existing) return existing.properties.sheetId;

  const addRes = await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: {
      requests: [{ addSheet: { properties: { title } } }],
    },
  });

  return addRes.data.replies[0].addSheet.properties.sheetId;
}

async function main() {
  const auth = new google.auth.GoogleAuth({
    credentials: loadCredentials(),
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  const sheets = google.sheets({ version: 'v4', auth });

  await ensureSheet(sheets, 'Criancas');
  await ensureSheet(sheets, 'Config');

  const existing = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Criancas!A:AJ',
  });
  const existingValues = existing.data.values || [];

  if (hasAnyData(existingValues)) {
    const backupName = `Criancas_backup_${timestamp()}`;
    await ensureSheet(sheets, backupName);
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${backupName}!A1`,
      valueInputOption: 'RAW',
      requestBody: { values: existingValues },
    });
    console.log(`Backup criado: ${backupName}`);
  }

  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Criancas!A1:AJ1',
    valueInputOption: 'RAW',
    requestBody: { values: [CHILD_HEADERS] },
  });

  const configCurrent = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Config!A1:B2',
  });
  const currentValue = parseInt(configCurrent.data?.values?.[1]?.[1], 10);
  const nextId = Number.isFinite(currentValue) && currentValue > 0 ? currentValue : 1;

  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Config!A1:B2',
    valueInputOption: 'RAW',
    requestBody: {
      values: [
        ['Campo', 'Valor'],
        ['NEXT_CHILD_ID', String(nextId)],
      ],
    },
  });

  console.log('Planilha preparada.');
  console.log('- Aba Criancas com cabeçalhos atualizados');
  console.log(`- Aba Config com NEXT_CHILD_ID=${nextId}`);
}

main().catch(error => {
  console.error('Erro ao preparar planilha:', error.message || error);
  process.exit(1);
});
