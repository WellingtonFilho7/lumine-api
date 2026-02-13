-- Manual verification for migration 0003_enrollment_hardening_expand.sql

select table_name, column_name
from information_schema.columns
where table_schema = 'public'
  and (
    (table_name = 'responsaveis' and column_name in ('parentesco','contato_emergencia_nome','contato_emergencia_telefone'))
    or (table_name = 'criancas' and column_name in ('sexo'))
    or (table_name = 'pre_cadastros' and column_name in ('termo_lgpd_assinado','termo_lgpd_data'))
    or (table_name = 'triagens' and column_name in ('restricao_alimentar','alergia_alimentar','alergia_medicamento','medicamentos_em_uso','renovacao'))
    or (table_name = 'matriculas' and column_name in ('leave_alone_confirmado','consentimento_saude','consentimento_saude_data','forma_chegada'))
  )
order by table_name, column_name;
