const { google } = require('googleapis');

const SHEETS_MIRROR_ENABLED = process.env.SHEETS_MIRROR_ENABLED === 'true';
const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const GOOGLE_CREDENTIALS = JSON.parse(process.env.GOOGLE_CREDENTIALS || '{}');

const MIRROR_SHEET_TITLE = process.env.MIRROR_SHEET_TITLE || 'Mirror_Intake';
const MIRROR_HEADERS = ['timestamp', 'stage', 'entityId', 'status', 'dataRev', 'details'];

async function getSheets() {
  const auth = new google.auth.GoogleAuth({
    credentials: GOOGLE_CREDENTIALS,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  const client = await auth.getClient();
  return google.sheets({ version: 'v4', auth: client });
}

async function ensureMirrorSheet(sheets) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  const existing = (meta.data.sheets || []).find(
    sheet => sheet.properties?.title === MIRROR_SHEET_TITLE
  );

  if (!existing) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: {
        requests: [{ addSheet: { properties: { title: MIRROR_SHEET_TITLE } } }],
      },
    });
  }

  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${MIRROR_SHEET_TITLE}!A1:F1`,
    valueInputOption: 'RAW',
    requestBody: { values: [MIRROR_HEADERS] },
  });
}

async function mirrorEvent(event) {
  if (!SHEETS_MIRROR_ENABLED) return;
  if (!SPREADSHEET_ID) return;

  const sheets = await getSheets();
  await ensureMirrorSheet(sheets);

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

module.exports = {
  mirrorEvent,
};
