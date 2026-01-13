const { google } = require('googleapis');

const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const GOOGLE_CREDENTIALS = JSON.parse(process.env.GOOGLE_CREDENTIALS || '{}');

async function getAuthClient() {
  const auth = new google.auth.GoogleAuth({
    credentials: GOOGLE_CREDENTIALS,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return auth.getClient();
}

async function getSheetsAPI() {
  const authClient = await getAuthClient();
  return google.sheets({ version: 'v4', auth: authClient });
}

function rowsToObjects(rows) {
  if (!rows || rows.length < 2) return [];
  const headers = rows[0];
  return rows
    .slice(1)
    .map(row => {
      const obj = {};
      headers.forEach((header, index) => {
        obj[header] = row[index] || '';
      });
      return obj;
    })
    .filter(obj => obj.id);
}

function objectsToRows(objects, headers) {
  return objects.map(obj => headers.map(h => obj[h] || ''));
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const sheets = await getSheetsAPI();

    if (req.method === 'GET') {
      const [childrenRes, recordsRes] = await Promise.all([
        sheets.spreadsheets.values.get({
          spreadsheetId: SPREADSHEET_ID,
          range: 'Criancas!A:L',
        }),
        sheets.spreadsheets.values.get({
          spreadsheetId: SPREADSHEET_ID,
          range: 'Registros!A:L',
        }),
      ]);

      return res.status(200).json({
        success: true,
        data: {
          children: rowsToObjects(childrenRes.data.values || []),
          records: rowsToObjects(recordsRes.data.values || []),
        },
        lastSync: new Date().toISOString(),
      });
    }

    if (req.method === 'POST') {
      const { action, data } = req.body || {};

      if (action === 'sync') {
        const { children, records } = data;

        if (children && children.length > 0) {
          await sheets.spreadsheets.values.clear({
            spreadsheetId: SPREADSHEET_ID,
            range: 'Criancas!A2:L999',
          });

          const childrenRows = objectsToRows(children, [
            'id',
            'name',
            'birthDate',
            'entryDate',
            'guardianName',
            'guardianPhone',
            'guardianPhoneAlt',
            'address',
            'school',
            'grade',
            'initialObservations',
            'status',
          ]);

          if (childrenRows.length > 0) {
            await sheets.spreadsheets.values.update({
              spreadsheetId: SPREADSHEET_ID,
              range: 'Criancas!A2:L',
              valueInputOption: 'RAW',
              resource: { values: childrenRows },
            });
          }
        }

        if (records && records.length > 0) {
          await sheets.spreadsheets.values.clear({
            spreadsheetId: SPREADSHEET_ID,
            range: 'Registros!A2:L999',
          });

          const recordsRows = objectsToRows(records, [
            'id',
            'childId',
            'date',
            'attendance',
            'participation',
            'mood',
            'interaction',
            'activity',
            'performance',
            'notes',
            'familyContact',
            'contactReason',
          ]);

          if (recordsRows.length > 0) {
            await sheets.spreadsheets.values.update({
              spreadsheetId: SPREADSHEET_ID,
              range: 'Registros!A2:L',
              valueInputOption: 'RAW',
              resource: { values: recordsRows },
            });
          }
        }

        return res.status(200).json({
          success: true,
          message: 'Sincronizado com sucesso',
          lastSync: new Date().toISOString(),
        });
      }

      if (action === 'addChild') {
        const child = data;
        const row = [
          [
            child.id,
            child.name,
            child.birthDate,
            child.entryDate,
            child.guardianName,
            child.guardianPhone,
            child.guardianPhoneAlt || '',
            child.address || '',
            child.school || '',
            child.grade || '',
            child.initialObservations || '',
            child.status || 'active',
          ],
        ];

        await sheets.spreadsheets.values.append({
          spreadsheetId: SPREADSHEET_ID,
          range: 'Criancas!A:L',
          valueInputOption: 'RAW',
          resource: { values: row },
        });

        return res
          .status(200)
          .json({ success: true, message: 'Criança adicionada' });
      }

      if (action === 'addRecord') {
        const record = data;
        const row = [
          [
            record.id,
            record.childId,
            record.date,
            record.attendance,
            record.participation || '',
            record.mood || '',
            record.interaction || '',
            record.activity || '',
            record.performance || '',
            record.notes || '',
            record.familyContact || 'no',
            record.contactReason || '',
          ],
        ];

        await sheets.spreadsheets.values.append({
          spreadsheetId: SPREADSHEET_ID,
          range: 'Registros!A:L',
          valueInputOption: 'RAW',
          resource: { values: row },
        });

        return res
          .status(200)
          .json({ success: true, message: 'Registro adicionado' });
      }
    }

    return res.status(400).json({ success: false, error: 'Ação não reconhecida' });
  } catch (error) {
    console.error('Erro:', error);
    return res.status(500).json({
      success: false,
      error: 'Erro interno',
      details: error.message,
    });
  }
};
