const { google } = require('googleapis');

const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const GOOGLE_CREDENTIALS = JSON.parse(process.env.GOOGLE_CREDENTIALS || '{}');
const API_TOKEN = process.env.API_TOKEN;
const ORIGINS_ALLOWLIST = (process.env.ORIGINS_ALLOWLIST || 'https://lumine-webapp.vercel.app')
  .split(',')
  .map(origin => origin.trim())
  .filter(Boolean);
const BACKUP_ENABLED = process.env.BACKUP_ENABLED !== 'false';
const BACKUP_SPREADSHEET_ID = process.env.BACKUP_SPREADSHEET_ID;
const MAX_SYNC_BYTES = 4 * 1024 * 1024;

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

function getAllowedOrigin(origin) {
  if (!origin) return '';
  return ORIGINS_ALLOWLIST.includes(origin) ? origin : '';
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
  const internalId = normalized.childInternalId || normalized.childId || '';
  normalized.childId = internalId;

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
    const internalId = normalized.childInternalId || normalized.childId || '';
    normalized.childInternalId = internalId;
    normalized.childId = internalId;

    RECORD_DATE_FIELDS.forEach(field => {
      if (field in normalized) {
        normalized[field] = toIso(normalized[field], true);
      }
    });

    return normalized;
  });
}

async function getConfigValues(sheets) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Config!A:B',
  });
  return res.data.values || [];
}

async function setConfigValue(sheets, key, value) {
  const values = await getConfigValues(sheets);
  const normalizedValue = value == null ? '' : String(value);

  if (!values.length) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: 'Config!A1:B2',
      valueInputOption: 'RAW',
      requestBody: {
        values: [
          ['Campo', 'Valor'],
          [key, normalizedValue],
        ],
      },
    });
    return;
  }

  let rowIndex = -1;
  for (let i = 1; i < values.length; i += 1) {
    if (String(values[i][0] || '').trim() === key) {
      rowIndex = i;
      break;
    }
  }

  if (rowIndex === -1) {
    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: 'Config!A:B',
      valueInputOption: 'RAW',
      requestBody: {
        values: [[key, normalizedValue]],
      },
    });
    return;
  }

  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `Config!A${rowIndex + 1}:B${rowIndex + 1}`,
    valueInputOption: 'RAW',
    requestBody: {
      values: [[key, normalizedValue]],
    },
  });
}

async function getConfigValue(sheets, key, defaultValue) {
  const values = await getConfigValues(sheets);
  if (!values.length) {
    if (defaultValue !== undefined) {
      await setConfigValue(sheets, key, defaultValue);
      return defaultValue;
    }
    return null;
  }

  for (let i = 1; i < values.length; i += 1) {
    if (String(values[i][0] || '').trim() === key) {
      return values[i][1];
    }
  }

  if (defaultValue !== undefined) {
    await setConfigValue(sheets, key, defaultValue);
    return defaultValue;
  }

  return null;
}

async function getDataRev(sheets) {
  const raw = await getConfigValue(sheets, 'DATA_REV', 1);
  let value = parseInt(raw, 10);
  if (!Number.isFinite(value) || value < 1) {
    value = 1;
    await setConfigValue(sheets, 'DATA_REV', value);
  }
  return value;
}

async function setDataRev(sheets, value) {
  await setConfigValue(sheets, 'DATA_REV', value);
}

async function bumpDataRev(sheets) {
  const current = await getDataRev(sheets);
  const next = current + 1;
  await setDataRev(sheets, next);
  return next;
}

async function getNextChildId(sheets) {
  const currentValue = parseInt(await getConfigValue(sheets, 'NEXT_CHILD_ID', 1), 10);
  const nextValue = Number.isFinite(currentValue) && currentValue > 0 ? currentValue : 1;

  const childId = `CRI-${String(nextValue).padStart(4, '0')}`;
  const updatedValue = nextValue + 1;

  await setConfigValue(sheets, 'NEXT_CHILD_ID', updatedValue);

  return childId;
}

function countFilled(values) {
  return values.filter(row => String(row?.[0] || '').trim() !== '').length;
}

async function getServerCounts(sheets) {
  const [childrenRes, recordsRes] = await Promise.all([
    sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: 'Criancas!A:AM',
    }),
    sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: 'Registros!A:L',
    }),
  ]);

  return {
    children: countFilled((childrenRes.data.values || []).slice(1)),
    records: countFilled((recordsRes.data.values || []).slice(1)),
  };
}


async function listSheets(sheets, spreadsheetId) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  return meta.data.sheets || [];
}

async function ensureSheet(sheets, spreadsheetId, title) {
  const allSheets = await listSheets(sheets, spreadsheetId);
  const existing = allSheets.find(sheet => sheet.properties.title === title);
  if (existing) return existing.properties.sheetId;

  const addRes = await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [{ addSheet: { properties: { title } } }],
    },
  });

  return addRes.data.replies[0].addSheet.properties.sheetId;
}

async function clearAndWriteSheet(sheets, spreadsheetId, title, values, clearRange, headers) {
  await ensureSheet(sheets, spreadsheetId, title);
  await sheets.spreadsheets.values.clear({
    spreadsheetId,
    range: `${title}!${clearRange}`,
  });

  const payload = values && values.length ? values : [headers];

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${title}!A1`,
    valueInputOption: 'RAW',
    requestBody: { values: payload },
  });
}

const AUDIT_HEADERS = [
  'timestamp',
  'action',
  'dataRev',
  'childrenCount',
  'recordsCount',
  'result',
  'message',
];

async function ensureAuditSheet(sheets) {
  await ensureSheet(sheets, SPREADSHEET_ID, 'Audit');
  const headerRes = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Audit!A1:G1',
  });
  const headerRow = headerRes.data.values?.[0] || [];
  const headerMatches = AUDIT_HEADERS.every((header, idx) => headerRow[idx] === header);
  if (!headerMatches) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: 'Audit!A1:G1',
      valueInputOption: 'RAW',
      requestBody: { values: [AUDIT_HEADERS] },
    });
  }
}

async function appendAudit(sheets, entry) {
  await ensureAuditSheet(sheets);
  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Audit!A:G',
    valueInputOption: 'RAW',
    requestBody: { values: [[
      entry.timestamp,
      entry.action,
      entry.dataRev,
      entry.childrenCount,
      entry.recordsCount,
      entry.result,
      entry.message,
    ]] },
  });
}

async function backupToSecondarySheet(sheets, childrenValues, recordsValues) {
  if (!BACKUP_SPREADSHEET_ID) {
    console.log('BACKUP_SPREADSHEET_ID não configurado; backup ignorado.');
    return;
  }

  await clearAndWriteSheet(
    sheets,
    BACKUP_SPREADSHEET_ID,
    'Criancas',
    childrenValues,
    'A:AM',
    CHILD_HEADERS
  );

  await clearAndWriteSheet(
    sheets,
    BACKUP_SPREADSHEET_ID,
    'Registros',
    recordsValues,
    'A:L',
    RECORD_HEADERS
  );

  console.log('Backup atualizado no Sheets de backup.');
}

function isEmptyEnrollmentHistory(value) {
  if (value == null || value === '') return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'string') return value.trim() === '';
  return false;
}

function normalizeRecordsPayload(records = []) {
  return records.map(record => {
    const internalId = record.childInternalId || record.childId || '';
    return {
      ...record,
      childInternalId: internalId,
      childId: internalId,
    };
  });
}

function validateChildrenPayload(children = []) {
  if (!Array.isArray(children)) return 'children must be an array';
  for (const child of children) {
    if (!child || !child.id) return 'child id is required';
  }
  return null;
}

function validateRecordsPayload(records = []) {
  if (!Array.isArray(records)) return 'records must be an array';
  for (const record of records) {
    if (!record) return 'record is required';
    const internalId = record.childInternalId || record.childId;
    if (!internalId) return 'record childInternalId is required';
    if (!record.date) return 'record date is required';
  }
  return null;
}

module.exports = async (req, res) => {
  const origin = req.headers.origin;
  const allowedOrigin = getAllowedOrigin(origin);

  if (allowedOrigin) {
    res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (!BACKUP_ENABLED) {
    console.log('BACKUP_ENABLED=false (backup desativado por configuração)');
  }

  if (origin && !allowedOrigin) {
    return res.status(403).json({
      success: false,
      error: 'FORBIDDEN_ORIGIN',
      message: 'Origem não permitida',
    });
  }

  const authHeader = req.headers.authorization || '';
  if (!API_TOKEN || authHeader !== `Bearer ${API_TOKEN}`) {
    return res.status(401).json({
      success: false,
      error: 'UNAUTHORIZED',
      message: 'Não autorizado',
    });
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
      const records = normalizeRecordsForApp(
        rowsToObjects(recordsRes.data.values || [])
      );
      const dataRev = await getDataRev(sheets);

      return res.status(200).json({
        success: true,
        data: {
          children,
          records,
        },
        dataRev,
        lastSync: new Date().toISOString(),
      });
    }

    if (req.method === 'POST') {
      const { action, data, ifMatchRev } = req.body || {};

      if (action === 'sync') {
        if (typeof ifMatchRev !== 'number') {
          return res.status(400).json({
            success: false,
            error: 'MISSING_IF_MATCH_REV',
            message: 'ifMatchRev é obrigatório',
          });
        }

        const bodySize = Buffer.byteLength(JSON.stringify(req.body || {}));
        if (bodySize > MAX_SYNC_BYTES) {
          return res.status(413).json({
            success: false,
            error: 'PAYLOAD_TOO_LARGE',
            message: 'Payload excede limite',
          });
        }

        const children = data?.children;
        const records = data?.records;
        if (!Array.isArray(children) || !Array.isArray(records)) {
          return res.status(400).json({
            success: false,
            error: 'INVALID_PAYLOAD',
            message: 'Payload inválido',
          });
        }
        const childrenError = validateChildrenPayload(children);
        const recordsError = validateRecordsPayload(records);
        if (childrenError || recordsError) {
          return res.status(400).json({
            success: false,
            error: 'INVALID_PAYLOAD',
            message: 'Payload inválido',
          });
        }

        const serverRev = await getDataRev(sheets);
        if (ifMatchRev !== serverRev) {
          return res.status(409).json({
            success: false,
            error: 'REVISION_MISMATCH',
            serverRev,
            clientRev: ifMatchRev,
            message:
              'Dados foram alterados por outro dispositivo. Baixe a versão atual primeiro.',
          });
        }

        const [serverChildrenRes, serverRecordsRes] = await Promise.all([
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

        const serverChildrenValues = serverChildrenRes.data.values || [];
        const serverRecordsValues = serverRecordsRes.data.values || [];
        const countChildrenServer = countFilled(serverChildrenValues.slice(1));
        const countRecordsServer = countFilled(serverRecordsValues.slice(1));

        if (children.length < countChildrenServer || records.length < countRecordsServer) {
          return res.status(409).json({
            success: false,
            error: 'DATA_LOSS_PREVENTED',
            serverCount: {
              children: countChildrenServer,
              records: countRecordsServer,
            },
            clientCount: {
              children: children.length,
              records: records.length,
            },
            message: 'Servidor tem mais dados. Baixe primeiro.',
          });
        }

        if (BACKUP_ENABLED) {
          await backupToSecondarySheet(sheets, serverChildrenValues, serverRecordsValues);
        } else {
          console.log('BACKUP_ENABLED=false (backup desativado por configuração)');
        }

        const serverChildren = rowsToObjects(serverChildrenRes.data.values || []);
        const serverHistoryById = new Map();
        serverChildren.forEach(child => {
          if (!child.id) return;
          if (!isEmptyEnrollmentHistory(child.enrollmentHistory)) {
            serverHistoryById.set(child.id, child.enrollmentHistory);
          }
        });

        const payloadChildren = children.map(child => {
          if (!child.id) return child;
          const hasHistory = !isEmptyEnrollmentHistory(child.enrollmentHistory);
          if (!hasHistory && serverHistoryById.has(child.id)) {
            return { ...child, enrollmentHistory: serverHistoryById.get(child.id) };
          }
          return child;
        });

        await sheets.spreadsheets.values.clear({
          spreadsheetId: SPREADSHEET_ID,
          range: 'Criancas!A2:AM999',
        });

        const normalizedChildren = payloadChildren.map(normalizeChildForSheet);
        const childrenRows = objectsToRows(normalizedChildren, CHILD_HEADERS);

        if (childrenRows.length > 0) {
          await sheets.spreadsheets.values.update({
            spreadsheetId: SPREADSHEET_ID,
            range: 'Criancas!A2:AM',
            valueInputOption: 'RAW',
            resource: { values: childrenRows },
          });
        }

        await sheets.spreadsheets.values.clear({
          spreadsheetId: SPREADSHEET_ID,
          range: 'Registros!A2:L999',
        });

        const normalizedRecordsPayload = normalizeRecordsPayload(records);
        const normalizedRecords = normalizedRecordsPayload.map(normalizeRecordForSheet);
        const recordsRows = objectsToRows(normalizedRecords, RECORD_HEADERS);

        if (recordsRows.length > 0) {
          await sheets.spreadsheets.values.update({
            spreadsheetId: SPREADSHEET_ID,
            range: 'Registros!A2:L',
            valueInputOption: 'RAW',
            resource: { values: recordsRows },
          });
        }

        const dataRev = await bumpDataRev(sheets);
        try {
          await appendAudit(sheets, {
            timestamp: new Date().toISOString(),
            action: 'sync',
            dataRev,
            childrenCount: children.length,
            recordsCount: records.length,
            result: 'success',
            message: 'overwrite',
          });
        } catch (error) {
          console.error('Erro ao registrar auditoria:', error);
        }

        return res.status(200).json({
          success: true,
          dataRev,
          lastSync: new Date().toISOString(),
        });
      }

      if (action === 'addChild') {
        if (!data || !data.id) {
          return res.status(400).json({
            success: false,
            error: 'INVALID_PAYLOAD',
            message: 'Payload inválido',
          });
        }

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

        const dataRev = await bumpDataRev(sheets);
        try {
          const counts = await getServerCounts(sheets);
          await appendAudit(sheets, {
            timestamp: new Date().toISOString(),
            action: 'addChild',
            dataRev,
            childrenCount: counts.children,
            recordsCount: counts.records,
            result: 'success',
            message: 'append',
          });
        } catch (error) {
          console.error('Erro ao registrar auditoria:', error);
        }

        return res.status(200).json({
          success: true,
          message: 'Criança adicionada',
          childId: normalizedChild.childId,
          dataRev,
        });
      }

      if (action === 'addRecord') {
        if (!data || !data.date || !(data.childInternalId || data.childId)) {
          return res.status(400).json({
            success: false,
            error: 'INVALID_PAYLOAD',
            message: 'Payload inválido',
          });
        }

        const recordPayload = normalizeRecordsPayload([data])[0];
        const record = normalizeRecordForSheet(recordPayload);
        const row = [RECORD_HEADERS.map(header => record[header] ?? '')];

        await sheets.spreadsheets.values.append({
          spreadsheetId: SPREADSHEET_ID,
          range: 'Registros!A:L',
          valueInputOption: 'RAW',
          resource: { values: row },
        });

        const dataRev = await bumpDataRev(sheets);
        try {
          const counts = await getServerCounts(sheets);
          await appendAudit(sheets, {
            timestamp: new Date().toISOString(),
            action: 'addRecord',
            dataRev,
            childrenCount: counts.children,
            recordsCount: counts.records,
            result: 'success',
            message: 'append',
          });
        } catch (error) {
          console.error('Erro ao registrar auditoria:', error);
        }

        return res.status(200).json({
          success: true,
          message: 'Registro adicionado',
          dataRev,
          record: {
            ...recordPayload,
            childId: recordPayload.childInternalId,
          },
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
