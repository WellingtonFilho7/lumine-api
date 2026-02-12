# Full Supabase Cutover Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Move Lumine from hybrid Sheets+Supabase to full Supabase for intake, daily records, dashboard, and reporting, then disable Sheets writes safely.

**Architecture:** Keep `lumine-webapp` (CRA) and `lumine-api` (Vercel Node). Use `lumine-api` as the only write/read gateway for sensitive data. Supabase becomes source of truth; Sheets stays read-only/contingency during stabilization window only.

**Tech Stack:** React CRA, Node serverless (Vercel), Supabase Postgres/Auth, Zod validation, environment flags.

---

## Phase 0 - Guardrails and Feature Flags

### Task 1: Add global migration flags and enforce non-breaking defaults

**Files:**
- Modify: `lumine-api/README.md`
- Modify: `lumine-api/SUPABASE_DEPLOY_CHECKLIST.md`

**Steps:**
1. Document and standardize flags:
   - `SUPABASE_ENABLED=true`
   - `SUPABASE_ENFORCE_RBAC=false` (initially)
   - `SHEETS_MIRROR_ENABLED=true` (initially)
   - `SHEETS_READONLY_MODE=false` (initially)
   - `DISABLE_SYNC_ENDPOINT=false` (initially)
2. Define exact cutover switch sequence in docs.
3. Commit docs-only changes.

**Acceptance:** Team can toggle migration behavior without code edits.

---

## Phase 1 - Complete Supabase Data Model (missing daily records)

### Task 2: Create daily records table and consistency constraints

**Files:**
- Create: `lumine-api/db/migrations/0002_daily_records.sql`

**Steps:**
1. Create `registros_diarios` table with:
   - `id uuid pk default gen_random_uuid()`
   - `crianca_id uuid fk -> criancas(id)`
   - `record_date date not null`
   - `attendance` enum/check (`present`,`late`,`absent`)
   - `participation`,`mood`,`interaction`,`activity`,`performance`,`notes`,`family_contact`,`contact_reason`
   - audit fields (`created_at`,`updated_at`,`updated_by`)
2. Add unique key for daily identity:
   - `unique (crianca_id, record_date)`
3. Add indexes:
   - `(record_date)`
   - `(crianca_id, record_date desc)`
4. Add check constraints for allowed values.

**Acceptance:** Upsert by child+date is guaranteed at DB level.

### Task 3: Add read model for dashboard/query performance

**Files:**
- Create: `lumine-api/db/migrations/0003_views_dashboard.sql`

**Steps:**
1. Create view/materialized view for current-day summary (present/late/absent).
2. Create view joining child + latest status + current matricula info.
3. Add simple refresh strategy if materialized view is used.

**Acceptance:** Dashboard no longer depends on Sheets shape.

---

## Phase 2 - API endpoints for full app usage in Supabase

### Task 4: Create app bootstrap endpoint (replace /api/sync GET for app data)

**Files:**
- Create: `lumine-api/api/app/bootstrap.js`
- Create: `lumine-api/lib/app-read-service.js`
- Modify: `lumine-api/vercel.json`

**Steps:**
1. Implement `GET /api/app/bootstrap` returning:
   - children (normalized for frontend)
   - daily records
   - `dataRev`
   - server timestamp
2. Reuse auth/cors/rate-limit wrappers from `lib/security.js`.
3. Keep response contract close to current frontend consumption to reduce UI churn.

**Acceptance:** Frontend can load all operational data without `/api/sync`.

### Task 5: Create records upsert endpoint

**Files:**
- Create: `lumine-api/api/app/records/upsert.js`
- Create: `lumine-api/lib/app-records-service.js`
- Modify: `lumine-api/vercel.json`

**Steps:**
1. Implement `POST /api/app/records/upsert` with Zod validation.
2. Upsert by `(crianca_id, record_date)`.
3. Increment `DATA_REV` and write `audit_logs`.
4. Mirror to Sheets only if `SHEETS_MIRROR_ENABLED=true`.

**Acceptance:** Daily attendance is fully persisted in Supabase.

### Task 6: Create child status update endpoint for existing UI flows

**Files:**
- Create: `lumine-api/api/app/children/update-status.js`
- Create: `lumine-api/lib/app-children-service.js`
- Modify: `lumine-api/vercel.json`

**Steps:**
1. Implement status transitions with server-side rules:
   - `em_triagem -> aprovado|lista_espera|recusado`
   - `aprovado -> matriculado|lista_espera`
   - `matriculado -> inativo|desistente`
2. Require related data if moving to `matriculado`.
3. Persist status transition in `status_historico` and `audit_logs`.

**Acceptance:** Status workflow is no longer tied to Sheets sync payloads.

---

## Phase 3 - Webapp cutover from /api/sync to app/intake endpoints

### Task 7: Add API client layer in webapp (single source for HTTP)

**Files:**
- Create: `lumine-webapp/src/api/client.js`
- Create: `lumine-webapp/src/api/intake.js`
- Create: `lumine-webapp/src/api/app.js`
- Modify: `lumine-webapp/src/App.js`

**Steps:**
1. Centralize headers and token handling.
2. Implement typed wrappers:
   - `getBootstrap()` -> `/api/app/bootstrap`
   - `upsertRecord()` -> `/api/app/records/upsert`
   - `createPreCadastro()`, `evolveTriagem()`, `evolveMatricula()`
3. Preserve current UI behavior while switching transport layer.

**Acceptance:** No direct `fetch` scattered in `App.js` for core data paths.

### Task 8: Replace addChild flow with 3-step server process

**Files:**
- Modify: `lumine-webapp/src/App.js`
- Modify: `lumine-webapp/src/utils/enrollment.js`

**Steps:**
1. Map existing form state to:
   - pre-cadastro payload
   - triagem payload
   - matricula payload
2. Execute sequentially depending selected result/status.
3. Keep local optimistic update and error rollback behavior.

**Acceptance:** New children and matriculas stop using `/api/sync addChild`.

### Task 9: Replace daily record persistence with Supabase upsert endpoint

**Files:**
- Modify: `lumine-webapp/src/App.js`
- Modify: `lumine-webapp/src/utils/records.js`

**Steps:**
1. Keep local upsert logic for UX responsiveness.
2. Send each record change to `/api/app/records/upsert`.
3. Remove dependency on `/api/sync addRecord` for daily flow.

**Acceptance:** Presence/absence data path is fully Supabase-based.

### Task 10: Replace data download/bootstrap logic

**Files:**
- Modify: `lumine-webapp/src/App.js`

**Steps:**
1. Replace `/api/sync` read calls with `/api/app/bootstrap`.
2. Keep `lumine_data_rev` updates from new endpoint.
3. Keep review mode and pending change indicators intact.

**Acceptance:** Initial load and refresh use Supabase-only data.

---

## Phase 4 - Migration of existing Sheets records to Supabase

### Task 11: Build records migration script (idempotent)

**Files:**
- Create: `lumine-api/scripts/import-records-csv-to-supabase.js`
- Modify: `lumine-api/package.json`

**Steps:**
1. Parse `Registros.csv`.
2. Resolve child relation by internal id/public id mapping strategy.
3. Upsert into `registros_diarios` by `(crianca_id, record_date)`.
4. Emit report with imported/updated/skipped/conflicts.

**Acceptance:** Historical daily records are available in Supabase.

### Task 12: Reconciliation script for hybrid window

**Files:**
- Create: `lumine-api/scripts/reconcile-sheets-vs-supabase.js`

**Steps:**
1. Compare counts and hash sample between Sheets and Supabase.
2. Output diff report (by day and by child).
3. Use in daily check during mirror window.

**Acceptance:** Objective confidence before hard cutover.

---

## Phase 5 - Definitive cutover and decommission Sheets writes

### Task 13: Disable legacy writes safely

**Files:**
- Modify: `lumine-api/api/sync.js`
- Modify: `lumine-api/README.md`

**Steps:**
1. Set `SHEETS_READONLY_MODE=true` in Vercel.
2. In `sync.js`, block write actions (`sync`, `addChild`, `addRecord`) when readonly mode enabled.
3. Keep read-only fallback response for transition communication.

**Acceptance:** No new operational writes go to Sheets.

### Task 14: Disable legacy endpoint usage in webapp

**Files:**
- Modify: `lumine-webapp/src/App.js`
- Modify: `lumine-webapp/src/api/*`

**Steps:**
1. Remove remaining `/api/sync` write calls.
2. Keep optional diagnostic read path only (temporary).
3. Add visible flag/version marker in Config screen: `Data source: Supabase`.

**Acceptance:** Entire daily operation runs on Supabase.

### Task 15: Final lockdown

**Files:**
- Modify: `lumine-api/vercel.json`
- Modify: `lumine-api/SUPABASE_DEPLOY_CHECKLIST.md`

**Steps:**
1. Set `DISABLE_SYNC_ENDPOINT=true` (or remove route after freeze).
2. Set `SHEETS_MIRROR_ENABLED=false`.
3. Turn `SUPABASE_ENFORCE_RBAC=true` only after internal auth flow validated.

**Acceptance:** Sheets fully out of write path; Supabase is single source of truth.

---

## Test Strategy (minimum per phase)

- API unit/integration smoke:
  - pre-cadastro -> triagem -> matricula sequence
  - record upsert create/update same day
  - bootstrap returns consistent shapes
- Negative tests:
  - missing token -> 401
  - invalid payload -> 400
  - rate limit -> 429
  - forbidden role (when RBAC on) -> 403
- Reconciliation checks during mirror window:
  - children count
  - records count by date
  - random sample content parity

---

## Rollback Plan

1. Keep `/api/sync` readable through cutover.
2. If incident after cutover:
   - set `SHEETS_READONLY_MODE=false`
   - re-enable webapp fallback route to `/api/sync` read/write in hotfix branch
   - preserve Supabase writes for forensic analysis (do not purge)
3. Run reconciliation script to identify divergence.
4. Reattempt cutover only after parity restored.

---

## Deployment Sequence (strict)

1. Deploy new DB migrations.
2. Deploy `lumine-api` with new endpoints and flags (mirror on).
3. Deploy `lumine-webapp` reading/writing via new endpoints.
4. Run migration scripts + reconciliation for 1-2 weeks.
5. Flip read-only/disable sync flags.
6. Final cleanup.

---

## Commit Plan (small, frequent)

1. `feat(db): add daily records and dashboard views`
2. `feat(api): add app bootstrap and records upsert endpoints`
3. `feat(api): add child status update endpoint`
4. `refactor(webapp): centralize api client`
5. `feat(webapp): migrate intake flow to supabase endpoints`
6. `feat(webapp): migrate daily records to records upsert`
7. `chore(migration): add records import and reconciliation scripts`
8. `chore(cutover): enable supabase-only mode and deprecate sheets writes`

