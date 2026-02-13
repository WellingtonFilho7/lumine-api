# Lumine API

API do Instituto Lumine com persistencia principal em Supabase Postgres.

Trilhas ativas:
1. `sync` para operacao atual do webapp (children/records) em Supabase.
2. `intake` para pre-cadastro, triagem e matricula em Supabase.

## Endpoints

### Operacional (Supabase)
- `GET /api/sync`
- `POST /api/sync` (`sync`, `addChild`, `addRecord`)

### Intake (Supabase)
- `POST /api/intake/pre-cadastro`
- `POST /api/intake/triagem`
- `POST /api/intake/matricula`

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
- `DISABLE_SYNC_ENDPOINT` (`true|false`) default: `false`
- `ENROLLMENT_STRICT_MODE` (`true|false`) default: `false`
- `ENROLLMENT_ACCEPT_LEGACY_FIELDS` (`true|false`) default: `true`

### Opcionais (espelho em Sheets, transitorio)
- `SHEETS_MIRROR_ENABLED` (`true|false`) default: `false`
- `SPREADSHEET_ID`
- `GOOGLE_CREDENTIALS`
- `MIRROR_SHEET_TITLE` default: `Mirror_Intake`

## Seguranca

- Browser nunca grava diretamente no banco.
- API valida token Bearer (`API_TOKEN`).
- Rotas intake possuem validacao server-side com Zod.
- `sync` possui validacao server-side e controle de concorrencia por `DATA_REV`.
- Honeypot (`website`) no pre-cadastro.
- Rate limit por IP em memoria (janela curta).
- Logs de erro sem PII.

## SQL / Migracao

Migrations:
- `db/migrations/0001_supabase_intake.sql`
- `db/migrations/0002_supabase_sync_store.sql`
- `db/migrations/0003_enrollment_hardening_expand.sql`

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
