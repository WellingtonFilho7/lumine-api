# Supabase Deploy Checklist - Lumine API

## 1. Preparar Supabase

1. Criar projeto Supabase (ambiente de producao).
2. Executar SQL da migration:
   - `db/migrations/0001_supabase_intake.sql`
3. Criar usuarios internos em `auth.users`.
4. Criar perfis em `perfis_internos` com papel:
   - `admin`, `triagem`, `secretaria`.

## 2. Configurar Vercel (lumine-api)

Variaveis obrigatorias:
- `API_TOKEN`
- `ORIGINS_ALLOWLIST`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

Manter durante fase de espelho:
- `SPREADSHEET_ID`
- `GOOGLE_CREDENTIALS`

Variaveis recomendadas:
- `SUPABASE_ENFORCE_RBAC=false` (iniciar)
- `SHEETS_MIRROR_ENABLED=true` (2 semanas)
- `RATE_LIMIT_WINDOW_MS=60000`
- `RATE_LIMIT_MAX=30`

## 3. Deploy incremental

1. Deploy da API com novas rotas intake.
2. Testar respostas basicas:
   - `POST /api/intake/pre-cadastro`
   - `POST /api/intake/triagem`
   - `POST /api/intake/matricula`
3. Confirmar escrita no Supabase.
4. Confirmar espelho no Sheets (`Mirror_Intake`) se habilitado.

## 4. Migracao de dados

1. Exportar CSV da planilha `Criancas`.
2. Rodar import idempotente:

```bash
npm run import:csv -- ./export/criancas.csv
```

3. Validar relatorio final (`imported`, `updated`, `skipped`, `conflicts`).

## 5. Cutover (apos 2 semanas)

1. Definir `SHEETS_MIRROR_ENABLED=false`.
2. Manter `sync` legado apenas como contingencia temporaria.
3. Planejar retirada gradual da escrita em Sheets.

## 6. Rollback

Se houver incidente:

1. Reverter deploy para versao anterior no Vercel.
2. Manter operacao via `/api/sync` (Sheets).
3. Exportar logs de erro e `audit_logs` para analise.
4. Corrigir e reaplicar em staging antes de novo deploy.
