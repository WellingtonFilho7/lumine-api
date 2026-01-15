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
  'school',
  'schoolShift',
  'grade',
  'neighborhood',
  'referralSource',
  'schoolCommuteAlone',
  'healthCareNeeded',
  'healthNotes',
  'dietaryRestriction',
  'specialNeeds',
  'triageNotes',
  'priority',
  'priorityReason',
  'enrollmentStatus',
  'enrollmentDate',
  'triageDate',
  'startDate',
  'participationDays',
  'authorizedPickup',
  'canLeaveAlone',
  'leaveAloneConsent',
  'leaveAloneConfirmation',
  'responsibilityTerm',
  'consentTerm',
  'imageConsent',
  'documentsReceived',
  'initialObservations',
  'classGroup',
  'matriculationDate',
  'enrollmentHistory',
  'entryDate',
  'createdAt',
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

function toIso(value, dateOnly) {
  if (value === null || value === undefined || value === '') return '';
  const serial = parseSerial(value);
  if (serial !== null) {
    const date = new Date(SHEETS_EPOCH + serial * MS_PER_DAY);
    return dateOnly ? date.toISOString().slice(0, 10) : date.toISOString();
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return '';
    if (dateOnly) {
      if (ISO_DATETIME_RE.test(trimmed)) return trimmed.split('T')[0];
      if (ISO_DATE_RE.test(trimmed)) return trimmed;
    } else {
      if (ISO_DATE_RE.test(trimmed)) return `${trimmed}T00:00:00.000Z`;
      if (ISO_DATETIME_RE.test(trimmed)) return trimmed;
    }
  }

  return value;
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

  CHILD_DATE_FIELDS.forEach(field => {
    if (field in normalized) {
      normalized[field] = toSerial(normalized[field], true);
    }
  });

  CHILD_DATETIME_FIELDS.forEach(field => {
    if (field in normalized) {
      normalized[field] = toSerial(normalized[field], false);
    }
  });

  return normalized;
}

function normalizeRecordForSheet(record) {
  const normalized = { ...record };

  RECORD_DATE_FIELDS.forEach(field => {
    if (field in normalized) {
      normalized[field] = toSerial(normalized[field], true);
    }
  });

  return normalized;
}

function normalizeChildrenForApp(children) {
  return children.map(child => {
    const normalized = { ...child };

    CHILD_DATE_FIELDS.forEach(field => {
      if (field in normalized) {
        normalized[field] = toIso(normalized[field], true);
      }
    });

    CHILD_DATETIME_FIELDS.forEach(field => {
      if (field in normalized) {
        normalized[field] = toIso(normalized[field], false);
      }
    });

    normalized.documentsReceived = parseDocumentsReceived(normalized.documentsReceived);
    normalized.participationDays = parseParticipationDays(normalized.participationDays);
    normalized.enrollmentHistory = parseEnrollmentHistory(normalized.enrollmentHistory);

    return normalized;
  });
}

function normalizeRecordsForApp(records) {
  return records.map(record => {
    const normalized = { ...record };
    RECORD_DATE_FIELDS.forEach(field => {
      if (field in normalized) {
        normalized[field] = toIso(normalized[field], true);
      }
    });
    return normalized;
  });
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
          range: 'Criancas!A:AM',
          valueRenderOption: 'UNFORMATTED_VALUE',
          dateTimeRenderOption: 'SERIAL_NUMBER',
        }),
        sheets.spreadsheets.values.get({
          spreadsheetId: SPREADSHEET_ID,
          range: 'Registros!A:L',
          valueRenderOption: 'UNFORMATTED_VALUE',
          dateTimeRenderOption: 'SERIAL_NUMBER',
        }),
      ]);

      const children = normalizeChildrenForApp(
        rowsToObjects(childrenRes.data.values || [])
      );

      return res.status(200).json({
        success: true,
        data: {
          children,
          records: normalizeRecordsForApp(
            rowsToObjects(recordsRes.data.values || [])
          ),
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
            range: 'Criancas!A2:AM999',
          });

          const normalizedChildren = children.map(normalizeChildForSheet);
          const childrenRows = objectsToRows(normalizedChildren, CHILD_HEADERS);

          if (childrenRows.length > 0) {
            await sheets.spreadsheets.values.update({
              spreadsheetId: SPREADSHEET_ID,
              range: 'Criancas!A2:AM',
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

          const normalizedRecords = records.map(normalizeRecordForSheet);
          const recordsRows = objectsToRows(normalizedRecords, RECORD_HEADERS);

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
          range: 'Criancas!A:AM',
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
        const record = normalizeRecordForSheet(data || {});
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
