-- 0005_supabase_rate_limit.sql
-- Rate limit distribuido via Supabase (sem dependencia de servico externo)

create table if not exists public.api_rate_limits (
  key text primary key,
  window_start timestamptz not null,
  hit_count integer not null default 0 check (hit_count >= 0),
  updated_at timestamptz not null default now()
);

create index if not exists idx_api_rate_limits_window_start
  on public.api_rate_limits (window_start);

create or replace function public.consume_rate_limit(
  p_key text,
  p_window_start timestamptz,
  p_max integer
)
returns table (allowed boolean, hit_count integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  insert into public.api_rate_limits (key, window_start, hit_count, updated_at)
  values (p_key, p_window_start, 1, now())
  on conflict (key)
  do update set
    hit_count = public.api_rate_limits.hit_count + 1,
    updated_at = now()
  returning public.api_rate_limits.hit_count into v_count;

  allowed := v_count <= p_max;
  hit_count := v_count;
  return next;
end;
$$;

revoke all on function public.consume_rate_limit(text, timestamptz, integer) from public;
grant execute on function public.consume_rate_limit(text, timestamptz, integer) to service_role;

alter table public.api_rate_limits enable row level security;
alter table public.api_rate_limits force row level security;

revoke all on table public.api_rate_limits from anon, authenticated;

drop policy if exists service_role_full_access_on_api_rate_limits on public.api_rate_limits;
create policy service_role_full_access_on_api_rate_limits
  on public.api_rate_limits
  for all
  to service_role
  using (true)
  with check (true);
