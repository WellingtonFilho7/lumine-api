-- Lumine enrollment hardening v1 (expand-only, backward compatible)
-- IMPORTANT: do not drop legacy columns in this migration.

alter table if exists responsaveis
  add column if not exists parentesco text,
  add column if not exists contato_emergencia_nome text,
  add column if not exists contato_emergencia_telefone text;

alter table if exists criancas
  add column if not exists sexo text;

alter table if exists pre_cadastros
  add column if not exists termo_lgpd_assinado boolean not null default false,
  add column if not exists termo_lgpd_data timestamptz;

alter table if exists triagens
  add column if not exists restricao_alimentar text,
  add column if not exists alergia_alimentar text,
  add column if not exists alergia_medicamento text,
  add column if not exists medicamentos_em_uso text,
  add column if not exists renovacao boolean not null default false;

alter table if exists matriculas
  add column if not exists leave_alone_confirmado boolean not null default false,
  add column if not exists consentimento_saude boolean not null default false,
  add column if not exists consentimento_saude_data timestamptz,
  add column if not exists forma_chegada text;

-- Safe CHECK constraints (added only if missing)
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'responsaveis_parentesco_check'
  ) then
    alter table responsaveis
      add constraint responsaveis_parentesco_check
      check (parentesco is null or parentesco in ('mae', 'pai', 'avo', 'tio', 'responsavel_legal', 'outro'));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'criancas_sexo_check'
  ) then
    alter table criancas
      add constraint criancas_sexo_check
      check (sexo is null or sexo in ('M', 'F', 'nao_declarado'));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'matriculas_forma_chegada_check'
  ) then
    alter table matriculas
      add constraint matriculas_forma_chegada_check
      check (forma_chegada is null or forma_chegada in ('a_pe', 'transporte_escolar', 'levada_responsavel', 'outro'));
  end if;
end $$;
