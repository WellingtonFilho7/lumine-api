const crypto = require('crypto');
const { getSupabaseAdmin } = require('./supabase');

function hashFingerprint(parts) {
  return crypto
    .createHash('sha256')
    .update(parts.join('|').toLowerCase())
    .digest('hex');
}

async function getConfigValue(supabase, key, defaultValue = null) {
  const { data, error } = await supabase
    .from('app_config')
    .select('value')
    .eq('key', key)
    .maybeSingle();

  if (error) throw error;
  if (!data) return defaultValue;
  return data.value;
}

async function setConfigValue(supabase, key, value) {
  const { error } = await supabase
    .from('app_config')
    .upsert({ key, value: String(value), updated_at: new Date().toISOString() }, { onConflict: 'key' });

  if (error) throw error;
}

async function bumpDataRev(supabase) {
  const current = Number(await getConfigValue(supabase, 'DATA_REV', '0')) || 0;
  const next = current + 1;
  await setConfigValue(supabase, 'DATA_REV', next);
  return next;
}

async function getNextChildPublicId(supabase) {
  const { data, error } = await supabase.rpc('next_child_public_id');
  if (!error && data) return data;

  const next = Number(await getConfigValue(supabase, 'NEXT_CHILD_ID', '1')) || 1;
  await setConfigValue(supabase, 'NEXT_CHILD_ID', String(next + 1));
  return `CRI-${String(next).padStart(4, '0')}`;
}

async function appendAuditLog(supabase, audit) {
  const { error } = await supabase.from('audit_logs').insert({
    actor_user_id: audit.userId,
    actor_role: audit.role,
    action: audit.action,
    resource_type: audit.resourceType,
    resource_id: audit.resourceId || null,
    success: audit.success,
    meta: audit.meta || {},
  });

  if (error) throw error;
}

async function ensureResponsavel(supabase, payload, actorUserId) {
  const { data: existing, error: findError } = await supabase
    .from('responsaveis')
    .select('id')
    .eq('telefone_principal', payload.telefonePrincipal)
    .limit(1)
    .maybeSingle();

  if (findError) throw findError;
  if (existing?.id) return existing.id;

  const { data, error } = await supabase
    .from('responsaveis')
    .insert({
      nome: payload.nomeResponsavel,
      telefone_principal: payload.telefonePrincipal,
      telefone_alternativo: payload.telefoneAlternativo || null,
      bairro: payload.bairro,
      updated_by: actorUserId,
    })
    .select('id')
    .single();

  if (error) throw error;
  return data.id;
}

async function createPreCadastro(payload, actor) {
  const supabase = getSupabaseAdmin();

  const fingerprint = hashFingerprint([
    payload.telefonePrincipal,
    payload.dataNascimento,
    payload.nomeCrianca,
  ]);

  const { data: existingPre, error: preFindError } = await supabase
    .from('pre_cadastros')
    .select('id, crianca_id')
    .eq('source_fingerprint', fingerprint)
    .maybeSingle();

  if (preFindError) throw preFindError;

  if (existingPre?.id) {
    const dataRev = await bumpDataRev(supabase);
    await appendAuditLog(supabase, {
      userId: actor.userId,
      role: actor.role,
      action: 'pre_cadastro_duplicate',
      resourceType: 'pre_cadastros',
      resourceId: existingPre.id,
      success: true,
      meta: { criancaId: existingPre.crianca_id, dataRev },
    });

    return {
      preCadastroId: existingPre.id,
      criancaId: existingPre.crianca_id,
      duplicated: true,
      dataRev,
    };
  }

  const responsavelId = await ensureResponsavel(supabase, payload, actor.userId);
  const childPublicId = await getNextChildPublicId(supabase);

  const { data: crianca, error: criancaError } = await supabase
    .from('criancas')
    .insert({
      child_public_id: childPublicId,
      responsavel_id: responsavelId,
      nome: payload.nomeCrianca,
      data_nascimento: payload.dataNascimento,
      escola: payload.escola,
      turno_escolar: payload.turnoEscolar,
      serie: payload.serie || null,
      neighborhood: payload.bairro,
      enrollment_status: 'em_triagem',
      updated_by: actor.userId,
    })
    .select('id, child_public_id')
    .single();

  if (criancaError) throw criancaError;

  const { data: preCadastro, error: preError } = await supabase
    .from('pre_cadastros')
    .insert({
      crianca_id: crianca.id,
      referral_source: payload.referralSource,
      school_commute_alone: payload.schoolCommuteAlone,
      consentimento_lgpd: payload.consentimentoLgpd,
      consentimento_data: payload.consentimentoLgpd ? new Date().toISOString() : null,
      consentimento_texto: payload.consentimentoTexto || null,
      source_fingerprint: fingerprint,
      updated_by: actor.userId,
    })
    .select('id')
    .single();

  if (preError) throw preError;

  const { error: statusError } = await supabase.from('status_historico').insert({
    crianca_id: crianca.id,
    status_anterior: null,
    status_novo: 'em_triagem',
    motivo: 'Cadastro inicial',
    changed_by: actor.userId,
  });
  if (statusError) throw statusError;

  const dataRev = await bumpDataRev(supabase);
  await appendAuditLog(supabase, {
    userId: actor.userId,
    role: actor.role,
    action: 'pre_cadastro_create',
    resourceType: 'pre_cadastros',
    resourceId: preCadastro.id,
    success: true,
    meta: { criancaId: crianca.id, childPublicId: crianca.child_public_id, dataRev },
  });

  return {
    preCadastroId: preCadastro.id,
    criancaId: crianca.id,
    childPublicId: crianca.child_public_id,
    duplicated: false,
    dataRev,
  };
}

async function evolveToTriagem(payload, actor) {
  const supabase = getSupabaseAdmin();

  const { data: preCadastro, error: preError } = await supabase
    .from('pre_cadastros')
    .select('id, crianca_id')
    .eq('id', payload.preCadastroId)
    .single();

  if (preError) throw preError;

  const { data: child, error: childError } = await supabase
    .from('criancas')
    .select('id, enrollment_status')
    .eq('id', preCadastro.crianca_id)
    .single();

  if (childError) throw childError;

  const { error: triagemError } = await supabase.from('triagens').upsert(
    {
      crianca_id: child.id,
      health_care_needed: payload.healthCareNeeded || null,
      health_notes: payload.healthNotes || null,
      dietary_restriction: payload.dietaryRestriction || null,
      special_needs: payload.specialNeeds || null,
      triage_notes: payload.triageNotes || null,
      priority: payload.priority || null,
      priority_reason: payload.priorityReason || null,
      resultado: payload.resultado,
      triage_date: new Date().toISOString(),
      updated_by: actor.userId,
    },
    { onConflict: 'crianca_id' }
  );

  if (triagemError) throw triagemError;

  const nextStatus = payload.resultado;
  const statusBefore = child.enrollment_status;

  const { error: updateChildError } = await supabase
    .from('criancas')
    .update({ enrollment_status: nextStatus, updated_by: actor.userId, updated_at: new Date().toISOString() })
    .eq('id', child.id);

  if (updateChildError) throw updateChildError;

  const { error: updatePreError } = await supabase
    .from('pre_cadastros')
    .update({ convertido_em_triagem: true, updated_by: actor.userId, updated_at: new Date().toISOString() })
    .eq('id', preCadastro.id);

  if (updatePreError) throw updatePreError;

  if (statusBefore !== nextStatus) {
    const { error: statusError } = await supabase.from('status_historico').insert({
      crianca_id: child.id,
      status_anterior: statusBefore,
      status_novo: nextStatus,
      motivo: 'Atualizacao de triagem',
      changed_by: actor.userId,
    });
    if (statusError) throw statusError;
  }

  const dataRev = await bumpDataRev(supabase);
  await appendAuditLog(supabase, {
    userId: actor.userId,
    role: actor.role,
    action: 'triagem_update',
    resourceType: 'triagens',
    resourceId: child.id,
    success: true,
    meta: { preCadastroId: preCadastro.id, statusBefore, statusAfter: nextStatus, dataRev },
  });

  return {
    preCadastroId: preCadastro.id,
    criancaId: child.id,
    statusBefore,
    statusAfter: nextStatus,
    dataRev,
  };
}

async function evolveToMatricula(payload, actor) {
  const supabase = getSupabaseAdmin();

  const { data: child, error: childError } = await supabase
    .from('criancas')
    .select('id, enrollment_status')
    .eq('id', payload.criancaId)
    .single();

  if (childError) throw childError;

  const { error: matriculaError } = await supabase.from('matriculas').upsert(
    {
      crianca_id: payload.criancaId,
      start_date: payload.startDate,
      participation_days: payload.participationDays,
      authorized_pickup: payload.authorizedPickup,
      can_leave_alone: payload.canLeaveAlone,
      leave_alone_consent: payload.canLeaveAlone === 'sim' ? Boolean(payload.leaveAloneConsent) : false,
      leave_alone_confirmation:
        payload.canLeaveAlone === 'sim' ? payload.leaveAloneConfirmation || null : null,
      terms_accepted: Boolean(payload.termsAccepted),
      class_group: payload.classGroup || null,
      image_consent: payload.imageConsent || '',
      documents_received: payload.documentsReceived || [],
      initial_observations: payload.initialObservations || null,
      matriculation_date: new Date().toISOString(),
      updated_by: actor.userId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'crianca_id' }
  );

  if (matriculaError) throw matriculaError;

  const statusBefore = child.enrollment_status;
  const { error: updateChildError } = await supabase
    .from('criancas')
    .update({ enrollment_status: 'matriculado', updated_by: actor.userId, updated_at: new Date().toISOString() })
    .eq('id', payload.criancaId);

  if (updateChildError) throw updateChildError;

  if (statusBefore !== 'matriculado') {
    const { error: statusError } = await supabase.from('status_historico').insert({
      crianca_id: payload.criancaId,
      status_anterior: statusBefore,
      status_novo: 'matriculado',
      motivo: 'Matricula efetivada',
      changed_by: actor.userId,
    });
    if (statusError) throw statusError;
  }

  const dataRev = await bumpDataRev(supabase);
  await appendAuditLog(supabase, {
    userId: actor.userId,
    role: actor.role,
    action: 'matricula_upsert',
    resourceType: 'matriculas',
    resourceId: payload.criancaId,
    success: true,
    meta: { statusBefore, statusAfter: 'matriculado', dataRev },
  });

  return {
    criancaId: payload.criancaId,
    statusBefore,
    statusAfter: 'matriculado',
    dataRev,
  };
}

module.exports = {
  createPreCadastro,
  evolveToMatricula,
  evolveToTriagem,
};
