-- 0004_enable_rls_lockdown.sql
-- Habilita RLS + FORCE RLS e remove acesso direto de anon/authenticated
-- em tabelas sensíveis expostas no schema public.

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'matriculas',
    'app_config',
    'perfis_internos',
    'responsaveis',
    'criancas',
    'pre_cadastros',
    'triagens',
    'status_historico',
    'audit_logs',
    'app_records_store',
    'app_children_store'
  ]
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY;', t);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon, authenticated;', t);
  END LOOP;
END $$;
