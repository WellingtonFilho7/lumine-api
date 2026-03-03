-- 0006_internal_profiles_autoprovision.sql
-- Auto provisiona perfis internos para novos usuarios do Supabase Auth.
-- Fluxo: usuario se cadastra -> perfil criado como triagem/inativo -> admin aprova.

create or replace function public.handle_new_internal_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  display_name text;
begin
  display_name := nullif(trim(coalesce(new.raw_user_meta_data ->> 'name', '')), '');

  if display_name is null then
    display_name := nullif(trim(split_part(coalesce(new.email, ''), '@', 1)), '');
  end if;

  if display_name is null then
    display_name := 'Usuario interno';
  end if;

  insert into public.perfis_internos (
    id,
    nome,
    papel,
    ativo,
    created_at,
    updated_at
  )
  values (
    new.id,
    left(display_name, 120),
    'triagem',
    false,
    now(),
    now()
  )
  on conflict (id) do update
    set nome = excluded.nome,
        updated_at = now();

  return new;
end;
$$;

drop trigger if exists trg_auth_user_created_internal_profile on auth.users;

create trigger trg_auth_user_created_internal_profile
after insert on auth.users
for each row
execute function public.handle_new_internal_user();

-- Backfill para usuarios ja existentes sem perfil.
insert into public.perfis_internos (id, nome, papel, ativo, created_at, updated_at)
select
  u.id,
  left(
    coalesce(
      nullif(trim(u.raw_user_meta_data ->> 'name'), ''),
      nullif(trim(split_part(coalesce(u.email, ''), '@', 1)), ''),
      'Usuario interno'
    ),
    120
  ) as nome,
  'triagem' as papel,
  false as ativo,
  now(),
  now()
from auth.users u
left join public.perfis_internos p on p.id = u.id
where p.id is null;
