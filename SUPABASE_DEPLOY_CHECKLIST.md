# Supabase Deploy Checklist - Lumine API

## 1. Preparar Supabase

1. Criar projeto Supabase (producao).
2. Executar SQL das migrations, nesta ordem:
   - `db/migrations/0001_supabase_intake.sql`
   - `db/migrations/0002_supabase_sync_store.sql`
   - `db/migrations/0003_enrollment_hardening_expand.sql`
   - `db/migrations/0005_supabase_rate_limit.sql`
   - `db/migrations/0008_finance.sql`
3. Rodar verificacao de colunas (arquivo: `db/migrations/0003_verify_columns.sql`).
4. Rodar backfill em dry-run:
   - `npm run backfill:hardening`
5. Se o dry-run estiver limpo, aplicar backfill:
   - `node scripts/backfill-enrollment-hardening.js --apply`
6. (Opcional por enquanto) Criar usuarios internos em `auth.users`.
7. (Opcional por enquanto) Criar perfis em `perfis_internos` com papel:
   - `admin`, `triagem`, `secretaria`.
8. Criar bucket privado para comprovantes financeiros:
   - nome sugerido: `finance-comprovantes`
   - visibilidade: **private**
   - MIME permitidos: pdf, jpg/jpeg, png, webp

## 2. Configurar Vercel (lumine-api)

Obrigatorias:
- `ORIGINS_ALLOWLIST`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

Recomendadas:
- `DISABLE_SYNC_ENDPOINT=true`
- `RATE_LIMIT_WINDOW_MS=60000`
- `RATE_LIMIT_MAX=30`
- `RATE_LIMIT_USE_SUPABASE=true`
- `RATE_LIMIT_NAMESPACE=lumine:rate`
- `ENROLLMENT_STRICT_MODE=false`
- `ENROLLMENT_ACCEPT_LEGACY_FIELDS=true`
- `FINANCE_BUCKET=finance-comprovantes`
- `FINANCE_STORAGE_PREFIX=finance`
- `FINANCE_UPLOAD_MAX_BYTES=10485760`
- `FINANCE_ALLOWED_MIME=application/pdf,image/jpeg,image/png,image/webp`
- `FINANCE_SIGNED_UPLOAD_EXPIRES_SECONDS=120`
- `FINANCE_SIGNED_READ_EXPIRES_SECONDS=120`

Somente se usar espelho em Sheets (intake e/ou financeiro):
- `SHEETS_MIRROR_ENABLED=true`
- `SPREADSHEET_ID`
- `GOOGLE_CREDENTIALS`
- `MIRROR_SHEET_TITLE=Mirror_Intake`
- `FINANCE_SHEET_TITLE=Finance`

## 3. Deploy e teste rapido

1. Deploy da API.
2. Validar sync de leitura:

```bash
curl -i "$API_URL/api/sync" -H "X-User-Jwt: $INTERNAL_USER_JWT"
```

3. Validar sync de escrita (`addChild`, `addRecord` e `sync`).
4. Validar intake:
   - `POST /api/intake/pre-cadastro`
   - `POST /api/intake/triagem`
   - `POST /api/intake/matricula`
5. Validar financeiro:
   - `POST /api/finance/upload-url`
   - `POST /api/finance/create`
   - `GET /api/finance/list`
   - `POST /api/finance/file-url`

### Comandos prontos (financeiro)

```bash
node --test lib/__tests__/finance-validation.test.js lib/__tests__/finance-service.test.js
```

```bash
curl -i "$API_URL/api/finance/upload-url" \
  -H "X-User-Jwt: $INTERNAL_USER_JWT" \
  -H "Content-Type: application/json" \
  -d '{"fileName":"recibo.pdf","contentType":"application/pdf","fileSizeBytes":120000}'
```

```bash
curl -i "$API_URL/api/finance/create" \
  -H "X-User-Jwt: $INTERNAL_USER_JWT" \
  -H "Content-Type: application/json" \
  -d '{"tipo":"gasto","descricao":"Compra de material","categoria":"operacional","valor":"149.90","data":"2026-03-04","formaPagamento":"pix","comprovantePath":"finance/2026/03/<user-id>/arquivo.pdf","idempotencyKey":"finance-001"}'
```

```bash
curl -i "$API_URL/api/finance/list?limit=20" \
  -H "X-User-Jwt: $INTERNAL_USER_JWT"
```

```bash
curl -i "$API_URL/api/finance/file-url" \
  -H "X-User-Jwt: $INTERNAL_USER_JWT" \
  -H "Content-Type: application/json" \
  -d '{"comprovantePath":"finance/2026/03/<user-id>/arquivo.pdf","expiresIn":120}'
```

### SQL de validacao (Supabase)

```sql
select to_regclass('public.transacoes_financeiras');
select indexname from pg_indexes where schemaname='public' and tablename='transacoes_financeiras';
select relrowsecurity, relforcerowsecurity
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname = 'transacoes_financeiras';
```

## 4. Janela de compatibilidade

1. Manter `ENROLLMENT_STRICT_MODE=false` e `ENROLLMENT_ACCEPT_LEGACY_FIELDS=true` ate todo frontend novo estar em producao.
2. Monitorar erros de validacao por no minimo 14 dias.
3. Somente apos estabilizacao, considerar cutover estrito.

## 5. Cutover definitivo (sem Sheets como banco)

1. Confirmar `SHEETS_MIRROR_ENABLED=false`.
2. Remover/ignorar variaveis de Sheets se nao forem mais usadas.
3. Manter operacao principal no Supabase (`/api/sync` e `/api/intake/*`).

## 6. Rollout financeiro (MVP)

1. Aplicar `0008_finance.sql` em staging.
2. Criar/validar bucket privado (`FINANCE_BUCKET`).
3. Configurar env vars financeiras no Vercel.
4. Deploy e smoke test dos 4 endpoints financeiros.
5. Validar escrita na aba `Finance` do Google Sheets (se espelho ativo).
6. Promover para producao.

## 7. Rollback rapido

Se houver incidente:

1. Reverter deploy no Vercel para o build anterior.
2. Definir `ENROLLMENT_STRICT_MODE=false` e `ENROLLMENT_ACCEPT_LEGACY_FIELDS=true`.
3. Manter `DISABLE_SYNC_ENDPOINT=false` na versao estavel.
4. Se necessario, esconder as telas financeiras no frontend ate estabilizar.
5. Inspecionar `audit_logs` e logs do Vercel.
6. Corrigir e redeploy.
