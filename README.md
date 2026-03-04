# Lumine API

API do Instituto Lumine com persistencia principal em Supabase Postgres.

Trilhas ativas:
1. `sync` para operacao atual do webapp (children/records) em Supabase.
2. `intake` para pre-cadastro, triagem e matricula em Supabase.
3. `finance` para gastos e doacoes com comprovante em Storage privado.

## Endpoints

### Operacional (Supabase)
- `GET /api/sync`
- `POST /api/sync` (`sync`, `addChild`, `addRecord`, `deleteChild`)

### Intake (Supabase)
- `POST /api/intake/pre-cadastro`
- `POST /api/intake/triagem`
- `POST /api/intake/matricula`

### Financeiro (Supabase + Storage)
- `POST /api/finance/upload-url`
- `POST /api/finance/create`
- `GET /api/finance/list`
- `POST /api/finance/file-url`

## Variaveis de ambiente

### Obrigatorias (todas as trilhas)
- `API_TOKEN`
- `ORIGINS_ALLOWLIST`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

### Opcionais (Supabase)
- `SUPABASE_ENFORCE_RBAC` (`true|false`) default: `false`
- `RATE_LIMIT_WINDOW_MS` default: `60000`
- `RATE_LIMIT_MAX` default: `30`
- `RATE_LIMIT_NAMESPACE` default: `lumine:rate`
- `RATE_LIMIT_USE_SUPABASE` (`true|false`) default: `true`
- `RATE_LIMIT_CLEANUP_PROBABILITY` default: `0.02`
- `DISABLE_SYNC_ENDPOINT` (`true|false`) default: `false`
- `ENROLLMENT_STRICT_MODE` (`true|false`) default: `false`
- `ENROLLMENT_ACCEPT_LEGACY_FIELDS` (`true|false`) default: `true`

### Opcionais (financeiro)
- `FINANCE_BUCKET` default: `finance-comprovantes`
- `FINANCE_STORAGE_PREFIX` default: `finance`
- `FINANCE_UPLOAD_MAX_BYTES` default: `10485760` (10 MB)
- `FINANCE_ALLOWED_MIME` default: `application/pdf,image/jpeg,image/png,image/webp`
- `FINANCE_SIGNED_UPLOAD_EXPIRES_SECONDS` default: `120`
- `FINANCE_SIGNED_READ_EXPIRES_SECONDS` default: `120`

### Opcionais (espelho em Sheets, transitorio)
- `SHEETS_MIRROR_ENABLED` (`true|false`) default: `false`
- `SPREADSHEET_ID`
- `GOOGLE_CREDENTIALS`
- `MIRROR_SHEET_TITLE` default: `Mirror_Intake`
- `FINANCE_SHEET_TITLE` default: `Finance`

## Seguranca

- Browser nunca grava diretamente no banco.
- API valida token Bearer (`API_TOKEN`).
- Rotas intake possuem validacao server-side com Zod.
- Rotas financeiras exigem usuario interno (`x-user-jwt`) com papel `admin` ou `secretaria`.
- Fluxo financeiro nao aceita fallback de token compartilhado sem JWT interno.
- `sync` possui validacao server-side e controle de concorrencia por `DATA_REV`.
- Honeypot (`website`) no pre-cadastro.
- Rate limit por IP: distribuido via Supabase (quando habilitado) com fallback em memoria.
- Em serverless, o fallback em memoria vale por instancia; para limite global usar Redis/Upstash.
- Logs de erro sem PII.

## SQL / Migracao

Migrations:
- `db/migrations/0001_supabase_intake.sql`
- `db/migrations/0002_supabase_sync_store.sql`
- `db/migrations/0003_enrollment_hardening_expand.sql`
- `db/migrations/0005_supabase_rate_limit.sql`
- `db/migrations/0008_finance.sql`

Verificacao manual (pos-migration):
- `db/migrations/0003_verify_columns.sql`

## Backfill de compatibilidade

Dry-run (padrao recomendado antes de aplicar):

```bash
npm run backfill:hardening
```

Aplicacao real:

```bash
node scripts/backfill-enrollment-hardening.js --apply
```

## Importacao de dados CSV (idempotente)

```bash
npm run import:csv -- ./caminho/criancas.csv
```

## Testes locais

```bash
node --test lib/__tests__/*.test.js
```

```bash
node --test lib/__tests__/finance-validation.test.js lib/__tests__/finance-service.test.js
```
