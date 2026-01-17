const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');

const [spreadsheetId, credentialsPath, backupSpreadsheetId] = process.argv.slice(2);

if (!spreadsheetId || !credentialsPath) {
  console.error(
    'Usage: node scripts/format-main-sheet.js <spreadsheetId> <credentialsPath> [backupSpreadsheetId]'
  );
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

const MIN_COL_WIDTH = 90;
const MAX_COL_WIDTH = 220;
const CHAR_PX = 8;
const PADDING_PX = 24;

const REGISTROS_HEADER = 'childName';
const REGISTROS_FORMULA =
  '=ARRAYFORMULA(SE(B2:B="";"";SEERRO(PROCV(B2:B;Criancas!A:C;3;FALSO);"")))';

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

function clampWidth(value) {
  return Math.max(MIN_COL_WIDTH, Math.min(MAX_COL_WIDTH, value));
}

function widthForHeader(header) {
  const length = header ? String(header).trim().length : 0;
  if (!length) return MIN_COL_WIDTH;
  return clampWidth(length * CHAR_PX + PADDING_PX);
}

async function ensureRegistrosIdentifier(sheets, targetSpreadsheetId) {
  await sheets.spreadsheets.values.update({
    spreadsheetId: targetSpreadsheetId,
    range: 'Registros!M1:M2',
    valueInputOption: 'USER_ENTERED',
    requestBody: {
      values: [
        [REGISTROS_HEADER],
        [REGISTROS_FORMULA],
      ],
    },
  });
}

async function formatSpreadsheet(sheets, targetSpreadsheetId, removeBackupTabs) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId: targetSpreadsheetId });
  const existingSheets = meta.data.sheets || [];

  if (removeBackupTabs) {
    const deleteRequests = existingSheets
      .filter(sheet => isBackupTab(sheet.properties.title))
      .map(sheet => ({ deleteSheet: { sheetId: sheet.properties.sheetId } }));

    if (deleteRequests.length) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: targetSpreadsheetId,
        requestBody: { requests: deleteRequests },
      });
    }
  }

  const updatedMeta = await sheets.spreadsheets.get({ spreadsheetId: targetSpreadsheetId });
  const updatedSheets = (updatedMeta.data.sheets || []).filter(
    sheet => !(removeBackupTabs && isBackupTab(sheet.properties.title))
  );

  const requests = [];

  for (const sheet of updatedSheets) {
    const { sheetId, title, gridProperties, basicFilter } = sheet.properties;
    const rowCount = gridProperties?.rowCount || 1000;
    const colCountFallback = gridProperties?.columnCount || 26;
    const bandedRanges = sheet.bandedRanges || [];

    if (title === 'Registros') {
      await ensureRegistrosIdentifier(sheets, targetSpreadsheetId);
    }

    const headerRes = await sheets.spreadsheets.values.get({
      spreadsheetId: targetSpreadsheetId,
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
      updateSheetProperties: {
        properties: {
          sheetId,
          gridProperties: {
            frozenRowCount: 1,
          },
        },
        fields: 'gridProperties.frozenRowCount',
      },
    });

    for (let i = 0; i < colCount; i += 1) {
      const width = widthForHeader(headerRow[i]);
      requests.push({
        updateDimensionProperties: {
          range: {
            sheetId,
            dimension: 'COLUMNS',
            startIndex: i,
            endIndex: i + 1,
          },
          properties: {
            pixelSize: width,
          },
          fields: 'pixelSize',
        },
      });
    }

    requests.push({
      repeatCell: {
        range: {
          sheetId,
          startRowIndex: 1,
          endRowIndex: rowCount,
          startColumnIndex: 0,
          endColumnIndex: colCount,
        },
        cell: {
          userEnteredFormat: {
            wrapStrategy: 'OVERFLOW_CELL',
          },
        },
        fields: 'userEnteredFormat.wrapStrategy',
      },
    });

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
      spreadsheetId: targetSpreadsheetId,
      requestBody: { requests },
    });
  }

  console.log(`Formatacao aplicada: ${targetSpreadsheetId}`);
}

async function main() {
  const sheets = await getSheetsAPI();

  await formatSpreadsheet(sheets, spreadsheetId, true);

  if (backupSpreadsheetId) {
    await formatSpreadsheet(sheets, backupSpreadsheetId, false);
  }

  console.log('Formatacao aplicada e abas de backup removidas.');
}

main().catch(error => {
  console.error('Erro ao formatar planilha:', error.message || error);
  process.exit(1);
});
