#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const csvPath = process.argv[2];
if (!csvPath) {
  console.error('Usage: node scripts/import-csv-to-supabase.js <children.csv>');
  process.exit(1);
}

const absolutePath = path.resolve(process.cwd(), csvPath);
if (!fs.existsSync(absolutePath)) {
  console.error(`CSV not found: ${absolutePath}`);
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function normalize(value) {
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim();
  return trimmed || null;
}

function toArray(value) {
  if (!value) return [];
  return String(value)
    .split('|')
    .map(item => item.trim())
    .filter(Boolean);
}

async function findOrCreateResponsavel(row) {
  const tel = normalize(row.guardianPhone);
  if (!tel) throw new Error(`guardianPhone missing for row id ${row.id}`);

  const { data: existing, error: findError } = await supabase
    .from('responsaveis')
    .select('id')
    .eq('telefone_principal', tel)
    .limit(1)
    .maybeSingle();

  if (findError) throw findError;
  if (existing?.id) return existing.id;

  const { data, error } = await supabase
    .from('responsaveis')
    .insert({
      nome: normalize(row.guardianName) || 'Responsavel sem nome',
      telefone_principal: tel,
      telefone_alternativo: normalize(row.guardianPhoneAlt),
      bairro: normalize(row.neighborhood),
    })
    .select('id')
    .single();

  if (error) throw error;
  return data.id;
}

async function run() {
  const csvContent = fs.readFileSync(absolutePath, 'utf8');
  const records = parse(csvContent, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  });

  let imported = 0;
  let updated = 0;
  let skipped = 0;
  const conflicts = [];

  for (const row of records) {
    try {
      const childPublicId = normalize(row.childId);
      const nome = normalize(row.name);
      const nascimento = normalize(row.birthDate);

      if (!childPublicId || !nome || !nascimento) {
        skipped += 1;
        continue;
      }

      const responsavelId = await findOrCreateResponsavel(row);

      const childPayload = {
        child_public_id: childPublicId,
        responsavel_id: responsavelId,
        nome,
        data_nascimento: nascimento,
        escola: normalize(row.school),
        turno_escolar: normalize(row.schoolShift),
        serie: normalize(row.grade),
        neighborhood: normalize(row.neighborhood),
        enrollment_status: normalize(row.enrollmentStatus) || 'em_triagem',
      };

      const { data: existingChild, error: findChildError } = await supabase
        .from('criancas')
        .select('id')
        .eq('child_public_id', childPublicId)
        .maybeSingle();

      if (findChildError) throw findChildError;

      let criancaId = existingChild?.id;

      if (criancaId) {
        const { error } = await supabase.from('criancas').update(childPayload).eq('id', criancaId);
        if (error) throw error;
        updated += 1;
      } else {
        const { data, error } = await supabase
          .from('criancas')
          .insert(childPayload)
          .select('id')
          .single();
        if (error) throw error;
        criancaId = data.id;
        imported += 1;
      }

      const triagemPayload = {
        crianca_id: criancaId,
        health_care_needed: normalize(row.healthCareNeeded),
        health_notes: normalize(row.healthNotes),
        dietary_restriction: normalize(row.dietaryRestriction),
        special_needs: normalize(row.specialNeeds),
        triage_notes: normalize(row.triageNotes),
        priority: normalize(row.priority),
        priority_reason: normalize(row.priorityReason),
        resultado: normalize(row.enrollmentStatus) || 'em_triagem',
        triage_date: normalize(row.triageDate),
      };

      const { error: triagemError } = await supabase
        .from('triagens')
        .upsert(triagemPayload, { onConflict: 'crianca_id' });
      if (triagemError) throw triagemError;

      if ((normalize(row.enrollmentStatus) || '') === 'matriculado') {
        const matriculaPayload = {
          crianca_id: criancaId,
          start_date: normalize(row.startDate) || normalize(row.entryDate),
          participation_days: toArray(row.participationDays),
          authorized_pickup: normalize(row.authorizedPickup) || 'Nao informado',
          can_leave_alone: normalize(row.canLeaveAlone) || 'nao',
          leave_alone_consent: String(row.leaveAloneConsent || '').toLowerCase() === 'true',
          leave_alone_confirmation: normalize(row.leaveAloneConfirmation),
          terms_accepted:
            String(row.responsibilityTerm || '').toLowerCase() === 'true' ||
            String(row.consentTerm || '').toLowerCase() === 'true',
          class_group: normalize(row.classGroup),
          image_consent: normalize(row.imageConsent) || '',
          documents_received: toArray(row.documentsReceived),
          initial_observations: normalize(row.initialObservations),
          matriculation_date: normalize(row.matriculationDate),
        };

        const { error: matriculaError } = await supabase
          .from('matriculas')
          .upsert(matriculaPayload, { onConflict: 'crianca_id' });

        if (matriculaError) throw matriculaError;
      }
    } catch (error) {
      conflicts.push({ childId: row.childId || null, error: error.message });
    }
  }

  console.log(
    JSON.stringify(
      {
        imported,
        updated,
        skipped,
        conflicts: conflicts.length,
        conflictDetails: conflicts.slice(0, 20),
      },
      null,
      2
    )
  );
}

run().catch(error => {
  console.error('Import failed:', error.message);
  process.exit(1);
});
