-- 0007_internal_access_helpers.sql
-- Helpers para gestão rápida de acessos internos (aprovar/revogar/listar pendentes).
-- Uso recomendado no SQL Editor por admin.

create or replace function public.list_internal_pending_users()
returns table (
  id uuid,
  email text,
  nome text,
  papel text,
  ativo boolean,
  criado_em timestamptz
)
language sql
security definer
set search_path = public
as $$
  select
    u.id,
    u.email,
    coalesce(nullif(trim(p.nome), ''), split_part(coalesce(u.email, ''), '@', 1), 'Usuario interno') as nome,
    coalesce(p.papel, 'triagem') as papel,
    coalesce(p.ativo, false) as ativo,
    u.created_at as criado_em
  from auth.users u
  left join public.perfis_internos p on p.id = u.id
  where coalesce(p.ativo, false) = false
  order by u.created_at desc;
$$;

create or replace function public.approve_internal_user_by_email(
  p_email text,
  p_papel text default 'triagem'
)
returns table (
  id uuid,
  email text,
  nome text,
  papel text,
  ativo boolean,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_papel text;
begin
  v_papel := lower(coalesce(p_papel, 'triagem'));

  if v_papel not in ('admin', 'triagem', 'secretaria') then
    raise exception 'papel invalido: %', p_papel using errcode = '22023';
  end if;

  select u.id
  into v_user_id
  from auth.users u
  where lower(u.email) = lower(trim(p_email))
  limit 1;

  if v_user_id is null then
    raise exception 'usuario nao encontrado para email: %', p_email using errcode = '22023';
  end if;

  update public.perfis_internos p
     set ativo = true,
         papel = v_papel,
         updated_at = now()
   where p.id = v_user_id;

  return query
  select
    u.id,
    u.email,
    p.nome,
    p.papel,
    p.ativo,
    p.updated_at
  from public.perfis_internos p
  join auth.users u on u.id = p.id
  where p.id = v_user_id;
end;
$$;

create or replace function public.disable_internal_user_by_email(p_email text)
returns table (
  id uuid,
  email text,
  nome text,
  papel text,
  ativo boolean,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
begin
  select u.id
  into v_user_id
  from auth.users u
  where lower(u.email) = lower(trim(p_email))
  limit 1;

  if v_user_id is null then
    raise exception 'usuario nao encontrado para email: %', p_email using errcode = '22023';
  end if;

  update public.perfis_internos p
     set ativo = false,
         updated_at = now()
   where p.id = v_user_id;

  return query
  select
    u.id,
    u.email,
    p.nome,
    p.papel,
    p.ativo,
    p.updated_at
  from public.perfis_internos p
  join auth.users u on u.id = p.id
  where p.id = v_user_id;
end;
$$;

revoke all on function public.list_internal_pending_users() from public, anon, authenticated;
revoke all on function public.approve_internal_user_by_email(text, text) from public, anon, authenticated;
revoke all on function public.disable_internal_user_by_email(text) from public, anon, authenticated;
