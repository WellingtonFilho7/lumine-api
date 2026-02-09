# Lumine API

API do Instituto Lumine com duas trilhas:

1. `sync` (legado) para operacao atual com Google Sheets.
2. `intake` (novo) para pre-cadastro, triagem e matricula em Supabase Postgres.

## Endpoints

### Legado (Sheets)
- `GET /api/sync`
- `POST /api/sync` (`sync`, `addChild`, `addRecord`)

### Novo intake (Supabase)
- `POST /api/intake/pre-cadastro`
- `POST /api/intake/triagem`
- `POST /api/intake/matricula`

## Variaveis de ambiente

### Obrigatorias (trilha atual)
- `API_TOKEN`
- `ORIGINS_ALLOWLIST`
- `SPREADSHEET_ID`
- `GOOGLE_CREDENTIALS`

### Obrigatorias (nova trilha Supabase)
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

### Opcionais (nova trilha)
- `SUPABASE_ENFORCE_RBAC` (`true|false`) default: `false`
- `RATE_LIMIT_WINDOW_MS` default: `60000`
- `RATE_LIMIT_MAX` default: `30`
- `SHEETS_MIRROR_ENABLED` (`true|false`) default: `false`
- `MIRROR_SHEET_TITLE` default: `Mirror_Intake`

## Seguranca

- Browser nunca grava diretamente no banco.
- API valida token Bearer (`API_TOKEN`).
- Rotas intake possuem validação server-side com Zod.
- Honeypot (`website`) no pre-cadastro.
- Rate limit por IP em memoria (janela curta).
- Logs de erro sem PII.

## SQL / Migração

Migration inicial:
- `db/migrations/0001_supabase_intake.sql`

Importacao de dados CSV (idempotente):

```bash
npm run import:csv -- ./caminho/criancas.csv
```
