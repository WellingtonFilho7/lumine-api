const { getSupabaseAdmin } = require('./supabase');

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

function parseEnrollmentHistory(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_error) {
    return [];
  }
}

function normalizeChildrenForApp(children) {
  return children.map(child => {
    const normalized = { ...child };
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
    return normalized;
  });
}

function isEmptyEnrollmentHistory(value) {
  if (value == null || value === '') return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return true;
    try {
      const parsed = JSON.parse(trimmed);
      return !Array.isArray(parsed) || parsed.length === 0;
    } catch (_error) {
      return false;
    }
  }
  return false;
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

function normalizeStatusToken(value) {
  return String(value || '').trim().toLowerCase();
}

function canTransitionEnrollmentStatus(statusBefore, statusAfter) {
  if (!statusBefore || !statusAfter || statusBefore === statusAfter) return true;

  const from = normalizeStatusToken(statusBefore);
  const to = normalizeStatusToken(statusAfter);

  if (from === 'matriculado' && ['em_triagem', 'aprovado', 'lista_espera'].includes(to)) {
    return false;
  }

  return true;
}

function assertEnrollmentStatusTransition(statusBefore, statusAfter, childIdentifier = '') {
  if (canTransitionEnrollmentStatus(statusBefore, statusAfter)) return;

  const error = new Error('Transicao de status nao permitida para este registro.');
  error.statusCode = 409;
  error.code = 'STATUS_TRANSITION_NOT_ALLOWED';
  error.meta = {
    childId: childIdentifier || null,
    statusBefore,
    statusAfter,
  };
  throw error;
}

async function getConfigValue(supabase, key, defaultValue = null) {
  const { data, error } = await supabase
    .from('app_config')
    .select('value')
    .eq('key', key)
    .maybeSingle();

  if (error) throw error;

  if (!data) {
    if (defaultValue !== null && defaultValue !== undefined) {
      await setConfigValue(supabase, key, defaultValue);
      return String(defaultValue);
    }
    return null;
  }

  return data.value;
}

async function setConfigValue(supabase, key, value) {
  const { error } = await supabase
    .from('app_config')
    .upsert({
      key,
      value: String(value),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'key' });

  if (error) throw error;
}

async function getDataRev(supabase) {
  const raw = await getConfigValue(supabase, 'DATA_REV', '1');
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    await setConfigValue(supabase, 'DATA_REV', '1');
    return 1;
  }
  return parsed;
}

async function bumpDataRev(supabase) {
  const current = await getDataRev(supabase);
  const next = current + 1;
  await setConfigValue(supabase, 'DATA_REV', String(next));
  return next;
}

async function getNextChildPublicId(supabase) {
  const { data, error } = await supabase.rpc('next_child_public_id');
  if (!error && data) return data;

  const next = Number.parseInt(await getConfigValue(supabase, 'NEXT_CHILD_ID', '1'), 10) || 1;
  await setConfigValue(supabase, 'NEXT_CHILD_ID', String(next + 1));
  return `CRI-${String(next).padStart(4, '0')}`;
}

async function getServerCounts(supabase) {
  const [childrenRes, recordsRes] = await Promise.all([
    supabase.from('app_children_store').select('id', { count: 'exact', head: true }),
    supabase.from('app_records_store').select('id', { count: 'exact', head: true }),
  ]);

  if (childrenRes.error) throw childrenRes.error;
  if (recordsRes.error) throw recordsRes.error;

  return {
    children: childrenRes.count || 0,
    records: recordsRes.count || 0,
  };
}

async function appendAuditLog(supabase, entry) {
  const { error } = await supabase.from('audit_logs').insert({
    actor_user_id: entry.userId || null,
    actor_role: entry.role || 'system',
    action: entry.action,
    resource_type: entry.resourceType || 'sync',
    resource_id: entry.resourceId || null,
    success: entry.success !== false,
    meta: entry.meta || {},
  });

  if (error) throw error;
}

async function loadOperationalData() {
  const supabase = getSupabaseAdmin();

  const [childrenRes, recordsRes, dataRev] = await Promise.all([
    supabase.from('app_children_store').select('payload'),
    supabase.from('app_records_store').select('payload'),
    getDataRev(supabase),
  ]);

  if (childrenRes.error) throw childrenRes.error;
  if (recordsRes.error) throw recordsRes.error;

  const rawChildren = (childrenRes.data || []).map(row => row.payload || {}).filter(row => row.id);
  const rawRecords = (recordsRes.data || []).map(row => row.payload || {}).filter(row => row.id);

  return {
    children: normalizeChildrenForApp(rawChildren),
    records: normalizeRecordsForApp(rawRecords),
    dataRev,
  };
}

function buildChildrenRows(children = []) {
  const now = new Date().toISOString();
  return children.map(child => {
    const payload = {
      ...child,
      documentsReceived: Array.isArray(child.documentsReceived)
        ? child.documentsReceived
        : parseDocumentsReceived(child.documentsReceived),
      participationDays: Array.isArray(child.participationDays)
        ? child.participationDays
        : parseParticipationDays(child.participationDays),
      enrollmentHistory: Array.isArray(child.enrollmentHistory)
        ? child.enrollmentHistory
        : parseEnrollmentHistory(child.enrollmentHistory),
    };

    return {
      id: String(payload.id),
      child_public_id: payload.childId || null,
      enrollment_status: payload.enrollmentStatus || null,
      payload,
      updated_at: now,
    };
  });
}

function buildRecordRows(records = []) {
  const now = new Date().toISOString();
  return records.map(record => {
    const internalId = record.childInternalId || record.childId || '';
    const id = record.id ? String(record.id) : `${internalId}-${record.date}`;
    const payload = {
      ...record,
      id,
      childInternalId: internalId,
      childId: internalId,
    };

    return {
      id,
      child_internal_id: internalId,
      record_date: record.date || null,
      payload,
      updated_at: now,
    };
  });
}

async function clearStoreTable(supabase, table) {
  const { error } = await supabase
    .from(table)
    .delete()
    .neq('id', '__none__');

  if (error) throw error;
}

async function insertInBatches(supabase, table, rows, batchSize = 300) {
  for (let i = 0; i < rows.length; i += batchSize) {
    const chunk = rows.slice(i, i + batchSize);
    const { error } = await supabase.from(table).insert(chunk);
    if (error) throw error;
  }
}

async function overwriteOperationalData({ children, records, ifMatchRev, actor, deviceId, appVersion }) {
  const supabase = getSupabaseAdmin();

  const childrenError = validateChildrenPayload(children);
  const recordsError = validateRecordsPayload(records);
  if (childrenError || recordsError) {
    const error = new Error('Payload invalido');
    error.statusCode = 400;
    error.code = 'INVALID_PAYLOAD';
    throw error;
  }

  if (typeof ifMatchRev !== 'number') {
    const error = new Error('ifMatchRev e obrigatorio');
    error.statusCode = 400;
    error.code = 'MISSING_IF_MATCH_REV';
    throw error;
  }

  const serverRev = await getDataRev(supabase);
  if (ifMatchRev !== serverRev) {
    const error = new Error('Dados foram alterados por outro dispositivo. Baixe a versao atual primeiro.');
    error.statusCode = 409;
    error.code = 'REVISION_MISMATCH';
    error.meta = { serverRev, clientRev: ifMatchRev };
    throw error;
  }

  const serverCounts = await getServerCounts(supabase);
  if (children.length < serverCounts.children || records.length < serverCounts.records) {
    const error = new Error('Servidor tem mais dados. Baixe primeiro.');
    error.statusCode = 409;
    error.code = 'DATA_LOSS_PREVENTED';
    error.meta = {
      serverCount: serverCounts,
      clientCount: { children: children.length, records: records.length },
    };
    throw error;
  }

  const { data: existingChildrenRows, error: existingError } = await supabase
    .from('app_children_store')
    .select('id, payload, enrollment_status');

  if (existingError) throw existingError;

  const historyById = new Map();
  const statusById = new Map();

  (existingChildrenRows || []).forEach(row => {
    const existingPayload = row.payload || {};
    const rowId = row.id ? String(row.id) : '';
    const existingStatus =
      existingPayload.enrollmentStatus || existingPayload.enrollment_status || row.enrollment_status || null;

    if (rowId && !isEmptyEnrollmentHistory(existingPayload.enrollmentHistory)) {
      historyById.set(rowId, existingPayload.enrollmentHistory);
    }

    if (rowId && existingStatus) {
      statusById.set(rowId, existingStatus);
    }
  });

  const mergedChildren = children.map(child => {
    if (!child?.id) return child;

    const childId = String(child.id);
    const existingStatus = statusById.get(childId) || null;
    const nextStatus = child.enrollmentStatus || existingStatus || null;

    assertEnrollmentStatusTransition(existingStatus, nextStatus, childId);

    const nextChild = { ...child };

    if (!nextChild.enrollmentStatus && existingStatus) {
      nextChild.enrollmentStatus = existingStatus;
    }

    if (isEmptyEnrollmentHistory(nextChild.enrollmentHistory) && historyById.has(childId)) {
      nextChild.enrollmentHistory = historyById.get(childId);
    }

    return nextChild;
  });

  const childRows = buildChildrenRows(mergedChildren);
  const recordRows = buildRecordRows(records);

  await clearStoreTable(supabase, 'app_records_store');
  await clearStoreTable(supabase, 'app_children_store');

  if (childRows.length > 0) {
    await insertInBatches(supabase, 'app_children_store', childRows);
  }
  if (recordRows.length > 0) {
    await insertInBatches(supabase, 'app_records_store', recordRows);
  }

  const dataRev = await bumpDataRev(supabase);

  await appendAuditLog(supabase, {
    userId: actor?.userId || null,
    role: actor?.role || 'system',
    action: 'sync_overwrite_supabase',
    resourceType: 'sync',
    resourceId: null,
    success: true,
    meta: {
      dataRev,
      childrenCount: mergedChildren.length,
      recordsCount: records.length,
      deviceId: deviceId || '',
      appVersion: appVersion || '',
    },
  });

  return {
    dataRev,
    childrenCount: mergedChildren.length,
    recordsCount: records.length,
  };
}

async function addChild(data, actor, deviceId, appVersion) {
  if (!data || !data.id) {
    const error = new Error('Payload invalido');
    error.statusCode = 400;
    error.code = 'INVALID_PAYLOAD';
    throw error;
  }

  const supabase = getSupabaseAdmin();
  const child = { ...data };

  const { data: existingRow, error: existingRowError } = await supabase
    .from('app_children_store')
    .select('id, payload, enrollment_status')
    .eq('id', String(child.id))
    .maybeSingle();

  if (existingRowError) throw existingRowError;

  const statusBefore =
    existingRow?.payload?.enrollmentStatus ||
    existingRow?.payload?.enrollment_status ||
    existingRow?.enrollment_status ||
    null;
  const statusAfter = child.enrollmentStatus || statusBefore || null;

  assertEnrollmentStatusTransition(statusBefore, statusAfter, String(child.id));

  if (!child.enrollmentStatus && statusBefore) {
    child.enrollmentStatus = statusBefore;
  }

  if (!child.childId) {
    child.childId = await getNextChildPublicId(supabase);
  }

  const rows = buildChildrenRows([child]);
  const { error: upsertError } = await supabase
    .from('app_children_store')
    .upsert(rows[0], { onConflict: 'id' });

  if (upsertError) throw upsertError;

  const dataRev = await bumpDataRev(supabase);

  await appendAuditLog(supabase, {
    userId: actor?.userId || null,
    role: actor?.role || 'system',
    action: 'add_child_supabase',
    resourceType: 'children',
    resourceId: child.id,
    success: true,
    meta: {
      dataRev,
      childId: child.childId,
      deviceId: deviceId || '',
      appVersion: appVersion || '',
    },
  });

  return {
    childId: child.childId,
    dataRev,
  };
}

async function addRecord(data, actor, deviceId, appVersion) {
  if (!data || !data.date || !(data.childInternalId || data.childId)) {
    const error = new Error('Payload invalido');
    error.statusCode = 400;
    error.code = 'INVALID_PAYLOAD';
    throw error;
  }

  const supabase = getSupabaseAdmin();
  const rows = buildRecordRows([data]);

  const { error: upsertError } = await supabase
    .from('app_records_store')
    .upsert(rows[0], { onConflict: 'id' });

  if (upsertError) throw upsertError;

  const dataRev = await bumpDataRev(supabase);
  const internalId = rows[0].child_internal_id;

  await appendAuditLog(supabase, {
    userId: actor?.userId || null,
    role: actor?.role || 'system',
    action: 'add_record_supabase',
    resourceType: 'records',
    resourceId: rows[0].id,
    success: true,
    meta: {
      dataRev,
      childInternalId: internalId,
      recordDate: rows[0].record_date,
      deviceId: deviceId || '',
      appVersion: appVersion || '',
    },
  });

  return {
    dataRev,
    record: {
      ...(rows[0].payload || {}),
      childInternalId: internalId,
      childId: internalId,
    },
  };
}

module.exports = {
  addChild,
  addRecord,
  loadOperationalData,
  overwriteOperationalData,
  __private: {
    canTransitionEnrollmentStatus,
  },
};
