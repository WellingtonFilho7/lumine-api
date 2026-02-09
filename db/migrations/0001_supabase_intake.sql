-- Lumine intake migration v1
-- PII fields are marked with [PII] and sensitive fields with [SENSITIVE]

create extension if not exists pgcrypto;
create extension if not exists citext;

create table if not exists app_config (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

insert into app_config (key, value)
values ('NEXT_CHILD_ID', '1'), ('DATA_REV', '1')
on conflict (key) do nothing;

create table if not exists perfis_internos (
  id uuid primary key references auth.users(id) on delete cascade,
  nome text not null,                            -- [PII]
  papel text not null check (papel in ('admin', 'triagem', 'secretaria')),
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists responsaveis (
  id uuid primary key default gen_random_uuid(),
  nome text not null,                            -- [PII]
  telefone_principal text not null,              -- [PII]
  telefone_alternativo text,                     -- [PII]
  bairro text,                                   -- [PII]
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);

create index if not exists idx_responsaveis_tel on responsaveis (telefone_principal);

create table if not exists criancas (
  id uuid primary key default gen_random_uuid(),
  child_public_id text unique not null,
  responsavel_id uuid not null references responsaveis(id),
  nome text not null,                            -- [PII]
  data_nascimento date not null,                 -- [PII]
  escola text,
  turno_escolar text check (turno_escolar in ('manha', 'tarde', 'integral')),
  serie text,
  neighborhood text,
  enrollment_status text not null check (
    enrollment_status in (
      'em_triagem',
      'aprovado',
      'lista_espera',
      'matriculado',
      'recusado',
      'desistente',
      'inativo'
    )
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);

create index if not exists idx_criancas_status on criancas (enrollment_status);
create index if not exists idx_criancas_responsavel on criancas (responsavel_id);

create table if not exists pre_cadastros (
  id uuid primary key default gen_random_uuid(),
  crianca_id uuid not null references criancas(id) on delete cascade,
  referral_source text,
  school_commute_alone text check (school_commute_alone in ('sim', 'nao')),
  consentimento_lgpd boolean not null default false,
  consentimento_data timestamptz,
  consentimento_texto text,
  source_fingerprint text unique,
  convertido_em_triagem boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);

create index if not exists idx_pre_cadastros_crianca on pre_cadastros (crianca_id);

create table if not exists triagens (
  id uuid primary key default gen_random_uuid(),
  crianca_id uuid not null unique references criancas(id) on delete cascade,
  health_care_needed text check (health_care_needed in ('sim', 'nao')),
  health_notes text,                             -- [SENSITIVE]
  dietary_restriction text check (dietary_restriction in ('sim', 'nao')),
  special_needs text,                            -- [SENSITIVE]
  triage_notes text,
  priority text check (priority in ('alta', 'media', 'baixa')),
  priority_reason text,                          -- [SENSITIVE]
  resultado text check (resultado in ('em_triagem', 'aprovado', 'lista_espera', 'recusado')),
  triage_date timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);

create table if not exists matriculas (
  id uuid primary key default gen_random_uuid(),
  crianca_id uuid not null unique references criancas(id) on delete cascade,
  start_date date not null,
  participation_days text[] not null default '{}',
  authorized_pickup text not null,               -- [PII]
  can_leave_alone text not null check (can_leave_alone in ('sim', 'nao')),
  leave_alone_consent boolean not null default false,
  leave_alone_confirmation text,
  terms_accepted boolean not null default false,
  class_group text,
  image_consent text not null default '' check (image_consent in ('', 'interno', 'comunicacao')),
  documents_received text[] not null default '{}',
  initial_observations text,
  matriculation_date timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);

create table if not exists status_historico (
  id bigint generated always as identity primary key,
  crianca_id uuid not null references criancas(id) on delete cascade,
  status_anterior text,
  status_novo text not null,
  motivo text,
  changed_at timestamptz not null default now(),
  changed_by uuid references auth.users(id)
);

create index if not exists idx_status_historico_crianca on status_historico (crianca_id, changed_at desc);

create table if not exists audit_logs (
  id bigint generated always as identity primary key,
  actor_user_id uuid references auth.users(id),
  actor_role text,
  action text not null,
  resource_type text not null,
  resource_id text,
  success boolean not null,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_audit_logs_created_at on audit_logs (created_at desc);

create or replace function next_child_public_id()
returns text
language plpgsql
as $$
declare
  current_val integer;
  next_val integer;
begin
  select value::integer into current_val from app_config where key = 'NEXT_CHILD_ID';

  if current_val is null then
    current_val := 1;
    insert into app_config (key, value)
    values ('NEXT_CHILD_ID', '2')
    on conflict (key) do update set value = '2', updated_at = now();
    return 'CRI-' || lpad(current_val::text, 4, '0');
  end if;

  next_val := current_val + 1;
  update app_config
  set value = next_val::text,
      updated_at = now()
  where key = 'NEXT_CHILD_ID';

  return 'CRI-' || lpad(current_val::text, 4, '0');
end;
$$;
