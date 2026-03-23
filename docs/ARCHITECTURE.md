# Arquitetura da API Lumine

## Visao geral

`lumine-api` e uma API serverless em Vercel que centraliza quatro trilhas operacionais:

1. `bootstrap`: hidrata o webapp com o snapshot atual de criancas e registros.
2. `sync`: operacoes incrementais de children/records e um endpoint legado de overwrite, hoje desabilitado por padrao.
3. `intake`: pre-cadastro, triagem e matricula.
4. `finance`: upload seguro de comprovantes, criacao e listagem de transacoes.

Persistencia primaria:

- Supabase Postgres para dados operacionais
- Supabase Auth para autenticacao interna
- Supabase Storage para comprovantes financeiros

Integracoes opcionais:

- Google Sheets para espelho operacional e financeiro

## Stack tecnica

- Runtime: Vercel Node Serverless
- Banco: Supabase Postgres
- Auth: Supabase Auth + `X-User-Jwt`
- Validacao: Zod
- Storage: Supabase Storage
- Mirror: Google Sheets via `googleapis`
- Testes: `node:test`

## Estrutura principal

### `api/`

- `bootstrap.js`: carrega children, records e `dataRev`
- `sync.js`: `GET` do snapshot e `POST` para `addChild`, `addRecord`, `deleteChild` e overwrite legado
- `intake/*.js`: handlers de pre-cadastro, triagem e matricula
- `children/*.js`: create, update e delete por endpoint dedicado
- `records/upsert.js`: gravacao idempotente de registros diarios
- `finance/[action].js`: roteador serverless do modulo financeiro
- `admin/internal-users/*.js`: aprovacao de usuarios internos
- `admin/operational-backup/download.js`: download admin-only do snapshot operacional

### `lib/`

- `actor.js`: resolve o ator autenticado e valida papel interno
- `security.js`: CORS, allowlist de origem, rate limit e sanitizacao
- `supabase.js`: cliente admin do Supabase e lookup de usuario/perfil
- `http-errors.js`: serializacao padrao de erros HTTP
- `intake-validation.js` e `finance-validation.js`: schemas Zod
- `intake-service.js`, `sync-supabase-service.js` e `finance-service.js`: logica de negocio
- `mirror.js`: espelho opcional para Google Sheets
- `operational-backup-service.js`: montagem do snapshot JSON de backup operacional

### `db/migrations/`

Sequencia viva hoje:

- `0001_supabase_intake.sql`
- `0002_supabase_sync_store.sql`
- `0003_enrollment_hardening_expand.sql`
- `0004_enable_rls_lockdown.sql`
- `0005_supabase_rate_limit.sql`
- `0006_internal_profiles_autoprovision.sql`
- `0007_internal_access_helpers.sql`
- `0008_finance.sql`

Arquivos auxiliares como `0003_verify_columns.sql` servem para verificacao, nao para criar estado novo.

## Padroes de endpoint

Fluxo padrao:

1. `setCors`
2. `ensureCors`
3. validacao de metodo HTTP
4. `ensureRateLimit`
5. `resolveActor`
6. parse/validacao de payload
7. service
8. `sendHandledError` ou resposta JSON de sucesso

Observacao:

- `intake` ainda usa `createIntakeHandler`, que encapsula esse fluxo e mantem um helper local de erro.
- `finance`, `sync`, `bootstrap`, `children` e `records` usam handlers diretos.

## Modelo de autenticacao e autorizacao

### Webapp -> API

O webapp envia o JWT de sessao interna em `X-User-Jwt`.

### API

- `actor.js` valida o JWT via Supabase Auth
- consulta `perfis_internos`
- exige `perfil.ativo = true`
- valida o papel conforme a rota

Sem JWT valido:

- leitura operacional falha
- escrita falha
- nao existe mais fallback operacional por bearer token compartilhado

Papais usados hoje:

- `admin`
- `secretaria`
- `triagem`

## Fluxos principais

### Bootstrap

`GET /api/bootstrap`

- autentica usuario interno
- carrega snapshot operacional
- retorna `{ children, records, dataRev, serverTs }`
- faz uma tentativa curta de retry para falhas transitorias de rede no backend

### Sync operacional

`GET /api/sync`

- leitura autenticada do snapshot atual

`POST /api/sync`

- `addChild`
- `addRecord`
- `deleteChild`
- `sync` por overwrite completo

O overwrite completo fica atras de `DISABLE_SYNC_ENDPOINT=true` por padrao. O fluxo diario esperado e incremental.

### Intake

`POST /api/intake/pre-cadastro`
- cria pre-cadastro e crianca inicial

`POST /api/intake/triagem`
- registra resultado de triagem

`POST /api/intake/matricula`
- conclui matricula com campos operacionais e legais

### Finance

`POST /api/finance/upload-url`
- gera signed upload URL no Storage

`POST /api/finance/create`
- valida payload
- valida prefixo e existencia do comprovante
- insere transacao
- grava `audit_logs`
- tenta espelho em planilha sem quebrar o request

`GET /api/finance/list`
- pagina por cursor
- filtra por tipo, categoria e intervalo de datas

`POST /api/finance/file-url`
- gera signed read URL para comprovante

### Backup operacional

`GET /api/admin/operational-backup/download`

- exige `admin`
- monta um snapshot atualizado de `children`, `records` e `dataRev`
- responde com `application/json` e `Content-Disposition` para download

Uso local complementar:

- `npm run backup:operational` para export simples
- `npm run ops:backup` para fluxo local com `.env.ops.local`

## Dados e consistencia

### Operacional

- `app_children_store`
- `app_records_store`
- `app_config` com `DATA_REV`
- `status_historico`
- `audit_logs`

### Intake

- `criancas`
- `pre_cadastros`
- `triagens`
- `matriculas`
- `responsaveis`

### Finance

- `transacoes_financeiras`

Garantias importantes:

- `DATA_REV` protege o fluxo legado de overwrite
- `records/upsert` e `finance/create` usam idempotencia/regras de unicidade para evitar duplicidade
- RLS e `FORCE ROW LEVEL SECURITY` estao habilitados nas tabelas publicas criticas

## Variaveis de ambiente principais

Obrigatorias:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `ORIGINS_ALLOWLIST`

Operacionais:

- `DISABLE_SYNC_ENDPOINT`
- `RATE_LIMIT_WINDOW_MS`
- `RATE_LIMIT_MAX`
- `RATE_LIMIT_USE_SUPABASE`

Financeiro:

- `FINANCE_BUCKET`
- `FINANCE_STORAGE_PREFIX`
- `FINANCE_UPLOAD_MAX_BYTES`
- `FINANCE_ALLOWED_MIME`
- `FINANCE_SIGNED_UPLOAD_EXPIRES_SECONDS`
- `FINANCE_SIGNED_READ_EXPIRES_SECONDS`

Mirror opcional:

- `SHEETS_MIRROR_ENABLED`
- `SPREADSHEET_ID`
- `GOOGLE_CREDENTIALS` ou `GOOGLE_CREDENTIALS_FILE` para scripts locais

## Testes e validacao

Rodar suite principal:

```bash
npm test
```

Rodar recorte financeiro:

```bash
node --test lib/__tests__/finance-validation.test.js lib/__tests__/finance-service.test.js lib/__tests__/finance-route-body.test.js
```

## Decisoes arquiteturais importantes

1. Supabase e a fonte primaria de verdade; planilhas sao espelho e operacao auxiliar.
2. Autenticacao do webapp e sempre por sessao interna; nao ha token compartilhado no bundle.
3. O fluxo diario evita overwrite global e privilegia operacoes incrementais.
4. O modulo financeiro depende de comprovante em Storage privado antes da criacao da transacao.
