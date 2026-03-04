-- Lumine API - Operações rápidas de acesso interno
-- Pré-requisito: migration 0007_internal_access_helpers.sql aplicada no Supabase.

-- 1) Listar usuários pendentes de aprovação
select * from public.list_internal_pending_users();

-- 2) Aprovar usuário por e-mail (papel: triagem | secretaria | admin)
-- Exemplo secretaria:
select * from public.approve_internal_user_by_email('professora@exemplo.com', 'secretaria');

-- Exemplo triagem:
-- select * from public.approve_internal_user_by_email('professora@exemplo.com', 'triagem');

-- 3) Desativar usuário por e-mail
select * from public.disable_internal_user_by_email('professora@exemplo.com');

-- 4) Conferir situação final de um e-mail
select
  u.email,
  p.id,
  p.nome,
  p.papel,
  p.ativo,
  p.updated_at
from auth.users u
left join public.perfis_internos p on p.id = u.id
where lower(u.email) = lower('professora@exemplo.com');
