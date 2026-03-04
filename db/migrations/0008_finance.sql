-- 0008_finance.sql
-- MVP financeiro: transacoes (gastos/doacoes) com comprovante em storage privado,
-- rastreabilidade por usuario interno e controles de idempotencia.

create table if not exists public.transacoes_financeiras (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity,
  tipo text not null check (tipo in ('gasto', 'doacao')),
  descricao text not null,
  categoria text not null,
  valor_centavos bigint not null check (valor_centavos > 0),
  data_transacao date not null,
  forma_pagamento text not null,
  comprovante_path text not null,
  comprovante_mime text,
  comprovante_nome text,
  idempotency_key text,
  fingerprint text not null,
  registrado_por uuid not null references auth.users(id),
  updated_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint transacoes_financeiras_seq_unique unique (seq)
);

create index if not exists idx_transacoes_financeiras_seq_desc
  on public.transacoes_financeiras (seq desc);

create index if not exists idx_transacoes_financeiras_data_desc
  on public.transacoes_financeiras (data_transacao desc, id desc);

create index if not exists idx_transacoes_financeiras_tipo_data
  on public.transacoes_financeiras (tipo, data_transacao desc, id desc);

create index if not exists idx_transacoes_financeiras_categoria_data
  on public.transacoes_financeiras (categoria, data_transacao desc, id desc);

create index if not exists idx_transacoes_financeiras_registrado_por_created
  on public.transacoes_financeiras (registrado_por, created_at desc, id desc);

create unique index if not exists uq_transacoes_financeiras_actor_idempotency
  on public.transacoes_financeiras (registrado_por, idempotency_key)
  where idempotency_key is not null;

create unique index if not exists uq_transacoes_financeiras_fingerprint
  on public.transacoes_financeiras (fingerprint);

alter table public.transacoes_financeiras enable row level security;
alter table public.transacoes_financeiras force row level security;
revoke all on table public.transacoes_financeiras from anon, authenticated;
