const { google } = require('googleapis');

const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const GOOGLE_CREDENTIALS = JSON.parse(process.env.GOOGLE_CREDENTIALS || '{}');

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
  'schoolCommuteAlone',
  'healthCareNeeded',
  'dietaryRestriction',
  'participationDays',
  'canLeaveAlone',
  'leaveAloneConsent',
  'leaveAloneConfirmation',
];

const RECORD_HEADERS = [
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
];

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
        obj[header] = row[index] ?? '';
      });
      return obj;
    })
    .filter(obj => obj.id);
}

function objectsToRows(objects, headers) {
  return objects.map(obj => headers.map(h => (obj[h] ?? '')));
}

function parseEnrollmentHistory(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    return [];
  }
}

function parseDocumentsReceived(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  return String(value)
    .split('|')
    .map(item => item.trim())
    .filter(Boolean);
}

function parseParticipationDays(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  return String(value)
    .split('|')
    .map(item => item.trim())
    .filter(Boolean);
}

function normalizeChildForSheet(child) {
  const normalized = { ...child };

  if (Array.isArray(normalized.documentsReceived)) {
    normalized.documentsReceived = normalized.documentsReceived.filter(Boolean).join('|');
  }

  if (Array.isArray(normalized.participationDays)) {
    normalized.participationDays = normalized.participationDays.filter(Boolean).join('|');
  }

  if (Array.isArray(normalized.enrollmentHistory)) {
    normalized.enrollmentHistory = JSON.stringify(normalized.enrollmentHistory);
  }

  return normalized;
}

function normalizeChildrenForApp(children) {
  return children.map(child => ({
    ...child,
    documentsReceived: parseDocumentsReceived(child.documentsReceived),
    participationDays: parseParticipationDays(child.participationDays),
    enrollmentHistory: parseEnrollmentHistory(child.enrollmentHistory),
  }));
}

async function getNextChildId(sheets) {
  const configRes = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Config!A2:B2',
  });

  const currentValue = parseInt(configRes.data?.values?.[0]?.[1], 10);
  const nextValue = Number.isFinite(currentValue) && currentValue > 0 ? currentValue : 1;

  const childId = `CRI-${String(nextValue).padStart(4, '0')}`;
  const updatedValue = nextValue + 1;

  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Config!A2:B2',
    valueInputOption: 'RAW',
    requestBody: {
      values: [['NEXT_CHILD_ID', String(updatedValue)]],
    },
  });

  return childId;
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
          range: 'Criancas!A:AQ',
        }),
        sheets.spreadsheets.values.get({
          spreadsheetId: SPREADSHEET_ID,
          range: 'Registros!A:L',
        }),
      ]);

      const children = normalizeChildrenForApp(
        rowsToObjects(childrenRes.data.values || [])
      );

      return res.status(200).json({
        success: true,
        data: {
          children,
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
            range: 'Criancas!A2:AQ999',
          });

          const normalizedChildren = children.map(normalizeChildForSheet);
          const childrenRows = objectsToRows(normalizedChildren, CHILD_HEADERS);

          if (childrenRows.length > 0) {
            await sheets.spreadsheets.values.update({
              spreadsheetId: SPREADSHEET_ID,
              range: 'Criancas!A2:AQ',
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

          const recordsRows = objectsToRows(records, RECORD_HEADERS);

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
        let child = data || {};

        if (!child.childId) {
          const generatedChildId = await getNextChildId(sheets);
          child = { ...child, childId: generatedChildId };
        }

        const normalizedChild = normalizeChildForSheet(child);
        const row = [CHILD_HEADERS.map(header => normalizedChild[header] ?? '')];

        await sheets.spreadsheets.values.append({
          spreadsheetId: SPREADSHEET_ID,
          range: 'Criancas!A:AQ',
          valueInputOption: 'RAW',
          resource: { values: row },
        });

        return res.status(200).json({
          success: true,
          message: 'Criança adicionada',
          childId: normalizedChild.childId,
        });
      }

      if (action === 'addRecord') {
        const record = data || {};
        const row = [RECORD_HEADERS.map(header => record[header] ?? '')];

        await sheets.spreadsheets.values.append({
          spreadsheetId: SPREADSHEET_ID,
          range: 'Registros!A:L',
          valueInputOption: 'RAW',
          resource: { values: row },
        });

        return res.status(200).json({
          success: true,
          message: 'Registro adicionado',
        });
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
