#!/usr/bin/env node

const { createClient } = require('@supabase/supabase-js');
const {
  normalizeDocuments,
  normalizeFormaChegada,
  normalizeImageConsent,
  normalizePriority,
  normalizeReferralSource,
  normalizeSchoolShift,
  normalizeYesNo,
} = require('../lib/normalizers');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const args = new Set(process.argv.slice(2));
const applyMode = args.has('--apply');

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const stats = {
  mode: applyMode ? 'apply' : 'dry-run',
  scanned: 0,
  normalized: 0,
  skipped: 0,
  tables: {},
  unknown: [],
};

function ensureTableStats(name) {
  if (!stats.tables[name]) {
    stats.tables[name] = { scanned: 0, changed: 0, skipped: 0 };
  }
  return stats.tables[name];
}

function addUnknown(table, rowId, field, value) {
  stats.unknown.push({ table, rowId, field, value });
}

function equalJson(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

async function processTable({ table, idColumn, selectColumns, buildPatch }) {
  const tableStats = ensureTableStats(table);

  const { data, error } = await supabase
    .from(table)
    .select([idColumn, ...selectColumns].join(','));

  if (error) throw error;

  for (const row of data || []) {
    stats.scanned += 1;
    tableStats.scanned += 1;

    const { patch, hasUnknown } = buildPatch(row);
    if (hasUnknown) {
      tableStats.skipped += 1;
      stats.skipped += 1;
      continue;
    }

    if (!patch || Object.keys(patch).length === 0) {
      tableStats.skipped += 1;
      stats.skipped += 1;
      continue;
    }

    tableStats.changed += 1;
    stats.normalized += 1;

    if (!applyMode) continue;

    const { error: updateError } = await supabase
      .from(table)
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq(idColumn, row[idColumn]);

    if (updateError) throw updateError;
  }
}

(async () => {
  try {
    await processTable({
      table: 'criancas',
      idColumn: 'id',
      selectColumns: ['turno_escolar'],
      buildPatch: row => {
        const patch = {};
        const nextShift = normalizeSchoolShift(row.turno_escolar);

        if (row.turno_escolar && !['manha', 'tarde', 'integral'].includes(nextShift)) {
          addUnknown('criancas', row.id, 'turno_escolar', row.turno_escolar);
          return { patch: null, hasUnknown: true };
        }

        if ((row.turno_escolar || '') !== (nextShift || '')) {
          patch.turno_escolar = nextShift || null;
        }

        return { patch, hasUnknown: false };
      },
    });

    await processTable({
      table: 'pre_cadastros',
      idColumn: 'id',
      selectColumns: ['referral_source', 'school_commute_alone', 'consentimento_lgpd', 'termo_lgpd_assinado', 'termo_lgpd_data'],
      buildPatch: row => {
        const patch = {};

        const nextReferral = normalizeReferralSource(row.referral_source);
        if (row.referral_source && !['igreja', 'escola', 'CRAS', 'indicacao', 'redes_sociais', 'outro'].includes(nextReferral)) {
          addUnknown('pre_cadastros', row.id, 'referral_source', row.referral_source);
          return { patch: null, hasUnknown: true };
        }

        if ((row.referral_source || '') !== (nextReferral || '')) {
          patch.referral_source = nextReferral || null;
        }

        const nextCommute = normalizeYesNo(row.school_commute_alone);
        if (row.school_commute_alone && !['sim', 'nao', ''].includes(nextCommute)) {
          addUnknown('pre_cadastros', row.id, 'school_commute_alone', row.school_commute_alone);
          return { patch: null, hasUnknown: true };
        }

        if ((row.school_commute_alone || '') !== (nextCommute || '')) {
          patch.school_commute_alone = nextCommute || null;
        }

        if (row.termo_lgpd_assinado !== true && row.consentimento_lgpd === true) {
          patch.termo_lgpd_assinado = true;
          if (!row.termo_lgpd_data) patch.termo_lgpd_data = new Date().toISOString();
        }

        return { patch, hasUnknown: false };
      },
    });

    await processTable({
      table: 'triagens',
      idColumn: 'id',
      selectColumns: ['priority'],
      buildPatch: row => {
        const patch = {};
        const nextPriority = normalizePriority(row.priority);

        if (row.priority && !['alta', 'media', 'baixa'].includes(nextPriority)) {
          addUnknown('triagens', row.id, 'priority', row.priority);
          return { patch: null, hasUnknown: true };
        }

        if ((row.priority || '') !== (nextPriority || '')) {
          patch.priority = nextPriority || null;
        }

        return { patch, hasUnknown: false };
      },
    });

    await processTable({
      table: 'matriculas',
      idColumn: 'id',
      selectColumns: ['documents_received', 'image_consent', 'forma_chegada', 'can_leave_alone', 'leave_alone_consent', 'leave_alone_confirmado'],
      buildPatch: row => {
        const patch = {};

        const normalizedDocs = normalizeDocuments(row.documents_received || []);
        if (!equalJson(normalizedDocs, row.documents_received || [])) {
          patch.documents_received = normalizedDocs;
        }

        const nextImageConsent = normalizeImageConsent(row.image_consent);
        if (row.image_consent && !['', 'interno', 'comunicacao'].includes(nextImageConsent)) {
          addUnknown('matriculas', row.id, 'image_consent', row.image_consent);
          return { patch: null, hasUnknown: true };
        }

        if ((row.image_consent || '') !== (nextImageConsent || '')) {
          patch.image_consent = nextImageConsent;
        }

        const nextForma = normalizeFormaChegada(row.forma_chegada);
        if (row.forma_chegada && !['a_pe', 'transporte_escolar', 'levada_responsavel', 'outro', ''].includes(nextForma)) {
          addUnknown('matriculas', row.id, 'forma_chegada', row.forma_chegada);
          return { patch: null, hasUnknown: true };
        }

        if ((row.forma_chegada || '') !== (nextForma || '')) {
          patch.forma_chegada = nextForma || null;
        }

        if (
          row.can_leave_alone === 'sim' &&
          row.leave_alone_confirmado !== true &&
          row.leave_alone_consent === true
        ) {
          patch.leave_alone_confirmado = true;
        }

        return { patch, hasUnknown: false };
      },
    });

    console.log(JSON.stringify(stats, null, 2));
  } catch (error) {
    console.error('[backfill-enrollment-hardening] failed', error.message);
    process.exit(1);
  }
})();
