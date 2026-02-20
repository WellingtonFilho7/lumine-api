# Supabase Deploy Checklist - Lumine API

## 1. Preparar Supabase

1. Criar projeto Supabase (producao).
2. Executar SQL das migrations, nesta ordem:
   - `db/migrations/0001_supabase_intake.sql`
   - `db/migrations/0002_supabase_sync_store.sql`
   - `db/migrations/0003_enrollment_hardening_expand.sql`
  - `db/migrations/0005_supabase_rate_limit.sql`
3. Rodar verificacao de colunas (arquivo: `db/migrations/0003_verify_columns.sql`).
4. Rodar backfill em dry-run:
   - `npm run backfill:hardening`
5. Se o dry-run estiver limpo, aplicar backfill:
   - `node scripts/backfill-enrollment-hardening.js --apply`
6. (Opcional por enquanto) Criar usuarios internos em `auth.users`.
7. (Opcional por enquanto) Criar perfis em `perfis_internos` com papel:
   - `admin`, `triagem`, `secretaria`.

## 2. Configurar Vercel (lumine-api)

Obrigatorias:
- `API_TOKEN`
- `ORIGINS_ALLOWLIST`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

Recomendadas:
- `SUPABASE_ENFORCE_RBAC=false` (iniciar)
- `DISABLE_SYNC_ENDPOINT=false`
- `RATE_LIMIT_WINDOW_MS=60000`
- `RATE_LIMIT_MAX=30`
- `RATE_LIMIT_USE_SUPABASE=true`
- `RATE_LIMIT_NAMESPACE=lumine:rate`
- `ENROLLMENT_STRICT_MODE=false`
- `ENROLLMENT_ACCEPT_LEGACY_FIELDS=true`

Somente se usar espelho em Sheets no intake:
- `SHEETS_MIRROR_ENABLED=true`
- `SPREADSHEET_ID`
- `GOOGLE_CREDENTIALS`
- `MIRROR_SHEET_TITLE=Mirror_Intake`

## 3. Deploy e teste rapido

1. Deploy da API.
2. Validar sync de leitura:

```bash
curl -i "$API_URL/api/sync" -H "Authorization: Bearer $API_TOKEN"
```

3. Validar sync de escrita (`addChild`, `addRecord` e `sync`).
4. Validar intake:
   - `POST /api/intake/pre-cadastro`
   - `POST /api/intake/triagem`
   - `POST /api/intake/matricula`

## 4. Janela de compatibilidade

1. Manter `ENROLLMENT_STRICT_MODE=false` e `ENROLLMENT_ACCEPT_LEGACY_FIELDS=true` ate todo frontend novo estar em producao.
2. Monitorar erros de validacao por no minimo 14 dias.
3. Somente apos estabilizacao, considerar cutover estrito.

## 5. Cutover definitivo (sem Sheets como banco)

1. Confirmar `SHEETS_MIRROR_ENABLED=false`.
2. Remover/ignorar variaveis de Sheets se nao forem mais usadas.
3. Manter operacao principal no Supabase (`/api/sync` e `/api/intake/*`).

## 6. Rollback rapido

Se houver incidente:

1. Reverter deploy no Vercel para o build anterior.
2. Definir `ENROLLMENT_STRICT_MODE=false` e `ENROLLMENT_ACCEPT_LEGACY_FIELDS=true`.
3. Manter `DISABLE_SYNC_ENDPOINT=false` na versao estavel.
4. Inspecionar `audit_logs` e logs do Vercel.
5. Corrigir e redeploy.
