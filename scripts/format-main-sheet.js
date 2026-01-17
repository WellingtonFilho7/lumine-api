const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');

const [spreadsheetId, credentialsPath] = process.argv.slice(2);

if (!spreadsheetId || !credentialsPath) {
  console.error('Usage: node scripts/format-main-sheet.js <spreadsheetId> <credentialsPath>');
  process.exit(1);
}

const absoluteCredentialsPath = path.resolve(credentialsPath);
const credentials = JSON.parse(fs.readFileSync(absoluteCredentialsPath, 'utf8'));

const COLORS = {
  header: { red: 0 / 255, green: 73 / 255, blue: 119 / 255 },
  headerText: { red: 1, green: 1, blue: 1 },
  bandOdd: { red: 1, green: 1, blue: 1 },
  bandEven: { red: 223 / 255, green: 223 / 255, blue: 223 / 255 },
  accent: { red: 255 / 255, green: 145 / 255, blue: 2 / 255 },
};

async function getSheetsAPI() {
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return google.sheets({ version: 'v4', auth: await auth.getClient() });
}

function isBackupTab(title) {
  return title.startsWith('Criancas_backup_') || title.startsWith('Registros_backup_');
}

async function main() {
  const sheets = await getSheetsAPI();

  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const existingSheets = meta.data.sheets || [];

  const deleteRequests = existingSheets
    .filter(sheet => isBackupTab(sheet.properties.title))
    .map(sheet => ({ deleteSheet: { sheetId: sheet.properties.sheetId } }));

  if (deleteRequests.length) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests: deleteRequests },
    });
  }

  const updatedMeta = await sheets.spreadsheets.get({ spreadsheetId });
  const updatedSheets = (updatedMeta.data.sheets || []).filter(
    sheet => !isBackupTab(sheet.properties.title)
  );

  const requests = [];

  for (const sheet of updatedSheets) {
    const { sheetId, title, gridProperties, basicFilter } = sheet.properties;
    const rowCount = gridProperties?.rowCount || 1000;
    const colCountFallback = gridProperties?.columnCount || 26;
    const bandedRanges = sheet.bandedRanges || [];

    const headerRes = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${title}!1:1`,
    });
    const headerRow = headerRes.data.values?.[0] || [];
    const colCount = Math.max(headerRow.length, colCountFallback);

    if (basicFilter) {
      requests.push({ clearBasicFilter: { sheetId } });
    }

    for (const band of bandedRanges) {
      requests.push({ deleteBanding: { bandedRangeId: band.bandedRangeId } });
    }

    requests.push({
      addBanding: {
        bandedRange: {
          range: {
            sheetId,
            startRowIndex: 0,
            endRowIndex: rowCount,
            startColumnIndex: 0,
            endColumnIndex: colCount,
          },
          rowProperties: {
            headerColor: COLORS.header,
            firstBandColor: COLORS.bandOdd,
            secondBandColor: COLORS.bandEven,
          },
        },
      },
    });

    requests.push({
      repeatCell: {
        range: {
          sheetId,
          startRowIndex: 0,
          endRowIndex: 1,
          startColumnIndex: 0,
          endColumnIndex: colCount,
        },
        cell: {
          userEnteredFormat: {
            backgroundColor: COLORS.header,
            textFormat: {
              foregroundColor: COLORS.headerText,
              bold: true,
            },
          },
        },
        fields: 'userEnteredFormat(backgroundColor,textFormat)',
      },
    });

    requests.push({
      updateBorders: {
        range: {
          sheetId,
          startRowIndex: 0,
          endRowIndex: 1,
          startColumnIndex: 0,
          endColumnIndex: colCount,
        },
        bottom: {
          style: 'SOLID',
          width: 1,
          color: COLORS.accent,
        },
      },
    });

    requests.push({
      setBasicFilter: {
        filter: {
          range: {
            sheetId,
            startRowIndex: 0,
            endRowIndex: rowCount,
            startColumnIndex: 0,
            endColumnIndex: colCount,
          },
        },
      },
    });
  }

  if (requests.length) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests },
    });
  }

  console.log('Formatacao aplicada e abas de backup removidas.');
}

main().catch(error => {
  console.error('Erro ao formatar planilha:', error.message || error);
  process.exit(1);
});
