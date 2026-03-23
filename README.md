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

### Administrativo
- `GET /api/admin/internal-users/pending`
- `POST /api/admin/internal-users/approve`
- `GET /api/admin/operational-backup/download`

## Variaveis de ambiente

### Obrigatorias (todas as trilhas)
- `ORIGINS_ALLOWLIST`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

### Opcionais (Supabase)
- `RATE_LIMIT_WINDOW_MS` default: `60000`
- `RATE_LIMIT_MAX` default: `30`
- `RATE_LIMIT_NAMESPACE` default: `lumine:rate`
- `RATE_LIMIT_USE_SUPABASE` (`true|false`) default: `true`
- `RATE_LIMIT_CLEANUP_PROBABILITY` default: `0.02`
- `DISABLE_SYNC_ENDPOINT` (`true|false`) default: `true`
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
- Leitura e escrita operacionais exigem JWT interno em `X-User-Jwt`.
- JWT sem perfil interno ativo ou sem papel permitido recebe `401/403`.
- Rotas intake possuem validacao server-side com Zod.
- Rotas financeiras exigem usuario interno (`x-user-jwt`) com papel `admin` ou `secretaria`.
- Nao existe mais fallback operacional por token compartilhado do cliente.
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

Suite principal:

```bash
npm test
```

Esse comando cobre tanto `lib/__tests__` quanto `scripts/lib/__tests__`.

Recorte util para o modulo financeiro:

```bash
node --test lib/__tests__/finance-validation.test.js lib/__tests__/finance-service.test.js lib/__tests__/finance-route-body.test.js
```


## Backup operacional

Requer `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` no ambiente.

Para gerar um snapshot JSON dos dados operacionais atuais (`children`, `records` e `dataRev`):

```bash
npm run backup:operational
```

Saida padrao: `backups/operational/operational-backup-YYYYMMDD_HHMMSS.json`

Para escrever em um caminho especifico:

```bash
npm run backup:operational -- --out /caminho/arquivo.json
```

Para imprimir o JSON no terminal:

```bash
npm run backup:operational -- --stdout
```

## Backup operacional sem friccao local

Para evitar exportar variaveis manualmente toda vez:

1. copie o arquivo de exemplo
2. preencha as credenciais locais
3. rode um unico comando

```bash
cp .env.ops.example .env.ops.local
```

Campos esperados em `.env.ops.local`:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `OPS_BACKUP_DEFAULT_OUT_DIR` ou `OPS_BACKUP_DEFAULT_OUT`

Depois:

```bash
npm run ops:backup
```

Esse comando:

- carrega `.env.ops.local`
- gera o snapshot operacional atual
- salva no destino padrao configurado

Voce ainda pode sobrescrever a saida:

```bash
npm run ops:backup -- --out /caminho/arquivo.json
```

Ou imprimir no terminal:

```bash
npm run ops:backup -- --stdout
```
