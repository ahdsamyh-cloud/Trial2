# CLAUDE.md — STELCO Legal Department Management System (LDMS)

Read `docs/PLAN.md` for the approved architecture and `docs/PHASE-REPORTS.md` for status (Phases 0–7 done; Phase 8 only on request). This file holds conventions, commands and notes that keep the code consistent.

## Layout (pnpm workspace in `stelco-ldms/`)
- `packages/shared` — pure TS used by API and web: business-day calendar (`calendar.ts`), SLA maths (`sla.ts`), role→permission matrix (`permissions.ts`), workflow tables (`workflows.ts`), reference numbers, password policy. Build with `pnpm build:shared` before running API tests.
- `apps/api` — NestJS. `src/main.ts` (HTTP) and `src/main.worker.ts` (BullMQ worker, recurring jobs). `src/core/*` shared modules; `src/units/*` one module per Legal unit. Prisma schema + SQL (triggers, RLS, grants) in `prisma/`.
- `apps/web` — Next.js App Router. `app/api/[...path]/route.ts` is the BFF proxy: the browser never talks to the API directly. `middleware.ts` sets the nonce CSP and security headers.
- `infra/` — Dockerfiles, compose (dev/prod), nginx + ModSecurity CRS config. CI lives at repo root `.github/workflows/ldms-*.yml`.

## Commands
```bash
pnpm install
pnpm setup:env       # once: random local secrets -> infra/.env + apps/api/.env (cross-platform, never overwrites)
docker compose -f infra/compose.dev.yml up -d
pnpm setup:db        # build shared + prisma generate + migrate + apply SQL + seed (apps/api/scripts/dev-setup.js)
pnpm dev             # API :4000 + web :3000 (scripts/dev.mjs); or pnpm dev:api / dev:web / dev:worker separately
pnpm demo:code       # current TOTP code for demo users (dev only)
pnpm test            # unit (shared + api/src)
pnpm test:int        # API integration (real Postgres ldms_test, Redis db 5, clamd with EICAR sig); DB URLs from env or apps/api/.env.test
pnpm --filter web test:e2e   # Playwright; needs API + web running against a seeded DB
pnpm typecheck
```
Demo users (dev/test only): password `DEMO_PASSWORD`, all share TOTP secret `DEMO_TOTP_SECRET`. Usernames: `adm.it`, `hod`, `uh.lit|cmp|drf|awr`, `lo.lit1`, `lo.lit2`, `lo.drf1`, `lo.drf2`, `lo.cmp1`, `lo.awr1`, `pl.lit`, `pl.drf`, `req.fin|hr|proc`, `auditor`, `mgmt`.

## Non-negotiable conventions
- **Every route** has `@Can(...)`, `@Authenticated()` or `@Public()`. The global `AuthGuard` denies anything else, and `test/access.int.test.ts` fails the build if a route lacks metadata.
- **Record access** always goes through `PolicyService` (`matterScope`, `assertMatter`, `assertWrite`, `covers`). Return **404, not 403**, for records outside scope. Restricted matters: only named users + HoD. RLS (`prisma/sql/03_rls.sql`) repeats this in the database.
- DB access: `prisma.db` (RLS context from the request) or `prisma.tx(fn)` for multi-statement work. `prisma.base` (no RLS context) only for auth/session/audit/system tables. Background jobs run via `runAsSystem`.
- **Inserting a restricted matter**: insert unrestricted → add `MatterAccess` → set `restricted=true` (RLS requires RETURNING rows to be visible).
- **Every state change and sensitive read** → `AuditService.log(...)`. Workflow transitions → `MattersService.recordTransition` (writes `StatusTransition` + audit).
- **Validation**: zod schemas with `.strict()`; parse via `parse(schema, body)`. No generic "update everything" endpoints.
- **Raw SQL** only via Prisma tagged templates (`$queryRaw\`...${param}\``). Never `$queryRawUnsafe` with user input.
- **Encrypted fields** (`*Enc`) via `CryptoService.encrypt/decrypt`. Never log them.
- **Files**: always via `DocumentsService.upload` (signature check → quarantine → ClamAV → clean → extract). Downloads only through signed 60 s links bound to user+session.
- **Errors**: throw `DomainError`/`notFound`/`forbidden`/`badRequest`/`conflict`. The global filter hides internals.
- **Business days**: use `@ldms/shared` calendar + `SettingsService.calendar()` (Sun–Thu, holidays, 16:00 cut-off). Never hand-roll date maths.
- **Web**: all UI strings through `t()` (`lib/i18n.ts`); no inline `style=` in server-rendered markup (CSP); no confidential data in localStorage (only column/view preferences).
- Tests: every new resource gets integration tests including IDOR cases (other unit, other department, not-named on restricted).

## Notes / decisions
- Prisma 6 (stable) rather than 7; zod 4; Next 15; Node 22 LTS; Vitest 4.
- **Local edition** (`pnpm build:local` → `dist-local/stelco-ldms-local/`, plain npm, Node only).
  - **Launcher** (`local/start.mjs`):
    - runs PGlite (embedded Postgres 18 WASM) behind `@electric-sql/pglite-socket` on 127.0.0.1;
    - applies migrations (recorded in `_prisma_migrations`) and `prisma/sql/*`, and seeds once;
    - then `SET ROLE ldms_app` on the single PGlite session, so RLS applies (PGlite ignores the connecting user name);
    - starts the API with `DATABASE_URL=...connection_limit=1` plus local-only settings, then the Next standalone server.
  - **Local-only settings:**
    - `REDIS_URL=memory` (`kv()` stand-in);
    - `QUEUE_INLINE`;
    - `LOCAL_SCHEDULER` (recurring jobs in-process, `core/jobs/schedules.ts`);
    - `AV_MODE=eicar` (EICAR-only);
    - `DB_TX_MAX_WAIT_MS`.
  - **Production refuses** every local-only setting (`config.ts`).
  - **Build packaging** (`scripts/build-local.mjs`): flattens the web `node_modules` and resolves every symlink, because Windows unzip doesn't restore them.
- **Edits + history**: `PolicyService.canWrite` (HoD/UH/paralegal always; other unit officers when setting `access.officersEditAnyMatter`, default on). Audit updates with `changedFields(before, data)` (only changed fields, `*Enc`/amount/exposure masked) and `meta.matterId` for child records, so `GET /matters/:id/history` finds them. PATCH schemas from create schemas: `updatable(schema)` (zod applies defaults inside `.partial()`).
- **Transactions**: inside `prisma.tx()` code reuses the open transaction (`prisma.db` and nested `tx()` join it; `prisma.raw` = open tx or base). Audit SUCCESS entries are written after commit, DENIED/FAILURE after the tx ends; jobs are queued after commit. `pnpm test:int:single` runs the suite on a 1-connection pool to catch regressions.
- **Hearings**: statuses SCHEDULED/HELD/ADJOURNED/POSTPONED/CANCELLED; `postponeHearing` (new hearing, `nextHearingId`), `continuance` REQUEST→GRANTED(new date)/DENIED; chit summary field; hearing documents owner `hearing` with doc types HEARING_CHIT/CONTINUANCE_REQUEST/POSTPONEMENT_NOTICE.
- **Drafting**: HoD/UH may take drafter steps (`DRAFTER_STEPS`, transition comment "on behalf"); `assign` from any open status (after `FIRST_ASSIGN` statuses it is a reassignment: status unchanged, open review round moves to the new reviewer); UH/HoD may `start` an unassigned request (they become drafter); `skip_review` (comment required) → approval routing like `send_for_approval`; `complete` (UH/HoD, comment) closes at any stage; new version = new matter + `MatterLink(kind PREVIOUS_VERSION)` (restriction + named people carried); `DraftingExternal` for external lawyers; `Comment.versionId` for per-version comments.
- **Compliance**: law research (`researchStatus`, HoD/UH assign); department `CheckItem.answer` YES/NO (`answer()`), `cmp.answer-reminders` (every `compliance.reminderDays`), obligations default ANNUAL; `departmentReport()`. Officer rating/findings kept in the API but not in the main UI.
- **Reports**: `ReportsService.build(kind weekly|monthly|annual, period, unit)`; `ReportTemplatesService`: uploaded xlsx/docx formats (library docs, AV-scanned), `{{path}}` placeholders, Excel list rows repeat per item, Word `{{#list}}…{{/list}}` (docxtemplater), data scoped like reports (AGG scope → no lists).
- **Dhivehi**: inputs `dir="auto"`, CSS `unicode-bidi: plaintext`, Thaana font fallbacks, phonetic keyboard (`lib/thaana.ts`, shared state; toggle in header + every Modal). UI language: `lib/i18n.ts` (`messages/dv.json` draft + server overrides `GET/PUT /config/i18n/dv`, setting `i18n.dv`; HoD/IT admin edit at `/admin/translations`); preference per device (`ldms.lang`), applied in `AuthProvider` before the first signed-in render; `html dir=rtl`. Use logical Tailwind classes (`ms-/me-/ps-/pe-/text-start/text-end/border-e`), not left/right. `label()` goes through `t()`. PDF: `core/reports/pdf-text.ts` (Noto Sans Thaana in `apps/api/data/fonts`, OFL; fontkit RTL layout drawn glyph by glyph; Latin via Helvetica).
- **Hearing reminders**: `lit.hearing-reminders` (15:00 daily; on working days, hearings up to the end of the next working day; once per hearing via `Hearing.reminderSentAt`) and `lit.hearing-digest` (07:30, one message per person); setting `litigation.hearingReminders`; restricted → named people + HoD only.
- **Judgments**: `Outcome.appealDays/appealDayKind/appealFrom/appealDecision/complyBy` → `syncOutcomeDeadlines` keeps CaseDeadline APPEAL / comply-by (+ calendar) in step; court default `Court.appealDays` (none seeded: periods must come from the law).
- **Workload**: `GET /dashboard/workload` (HoD all, UH own units).
- **Library**: `Template`/`Clause` have version + `LibraryVersion` snapshots; only DRF UH/HoD approve; a non-approver's wording change → DRAFT; non-library users see APPROVED only; template files = document owner `template`; `POST /drafting/requests/:id/from-template` copies the file in (re-scanned).
- **Auto reports**: `ReportTemplate.autoSend/recipientIds`; job `reports.auto` (08:00: Sundays weekly, 1st monthly) sends a notification/email with a link `/reports?run=…`; the file is generated when opened, under the reader's access (no report content in email).
- Inside `prisma.tx()` never read through `prisma.base` (second connection → deadlock on 1-connection pools); use `prisma.raw`.
- **No credentials in the repo**, not even for tests: test keys and demo logins are generated per run (`test/setup-env.ts`, CI "Generate per-run test secrets"); dev compose reads `infra/.env`.
- Query strings: read with `qs()` / `qrec(query, ['k1','k2'])` (named keys only). Post-login redirects: `safeRedirectPath()` from `@ldms/shared`.
- pnpm supply-chain settings (`pnpm-workspace.yaml`): 7-day `minimumReleaseAge`, `trustPolicy: no-downgrade`, `blockExoticSubdeps`. The `minimumReleaseAgeExclude` entries are temporary (see comment).
- TOTP replay protection: a used time-step cannot be reused. Tests that are not about sign-in create sessions directly (`test/helpers.ts → as()`).
- Field encryption uses a keyring (`FIELD_KEYS=id:key,...`, `FIELD_KEY_ACTIVE`); the `crypto.rotate` job re-encrypts values under old keys.
- MinIO community edition is in maintenance mode; storage is S3-API-only (`STORAGE_DRIVER=s3`) so the backend is a deployment choice.
- ClamAV signatures cannot be downloaded in the build sandbox; tests use an EICAR-only signature DB.

## Unit modules
- **Litigation** (`src/units/litigation`): `LitigationService` (cases, hearings + structured summaries, deadlines, counsel engagements/invoices, updates, outcomes, firm evaluation, reports, `lit.no-update` job) and `LitigationImportService` (Excel register: upload → column mapping (saved) → dry-run preview → commit tagged with `ImportBatch` → rollback; error report). Status transitions in `@ldms/shared` `LITIGATION_TRANSITIONS`. Closing a case with an external firm requires a firm evaluation. Hearing "held" starts the `LIT_HEARING_SUMMARY` SLA clock (2 business days).
- Unit modules register intake converters (`IntakeService.registerConverter`) and document owner types (`DocumentsService.registerOwner`) in `onModuleInit`.
- Web: unit pages wrap the shared `MatterView` and add unit panels (`components/litigation-panels.tsx`).
- Dev tip: `pkill -f next-server` (not `next start`) to stop the web server before rebuilding.
- **Drafting** (`src/units/drafting`): `DraftingService.act(id, {action,...})` drives the shared `draftingMachine`; guards in `guard()` enforce maker-checker (drafter ≠ reviewer ≠ approver), Unit Head → HoD auto-routing when the Unit Head is maker/checker, optional `drafting.hodRules` setting (off by default), FINAL document version required to approve. `RegistersService`: templates/clauses (only UH/HoD approve), contract repository (expiry + notice calendar events), PoA register, opinions archive (FTS). The generic matter "Assign" button is hidden for DRF — assignment is a workflow step.
- **Compliance** (`src/units/compliance`): laws register (+versions → change log entry), obligation library (frequency, departments, risk), regulatory change log (forward-only statuses, impact required), dissemination with per-department acknowledgement + SLA + daily reminders (`cmp.ack-reminders`), periodic checks (`cmp.cycles` daily: one `CheckCycle` per department+period, items per obligation; `periodOf`/`nextPeriodStart`), department answers + evidence (`checkItem` documents) → submit → officer rating; PARTIAL/NON_COMPLIANT auto-creates a `Finding` (30/60/90 calendar days by severity) → action plan → evidence → officer closes; overdue findings escalate once (`cmp.findings-overdue`). Requesters see only their department's circulars, checklists and findings.
- **Awareness** (`src/units/awareness`): annual plan (quarters, UH/HoD approval), sessions (presenters/preparers notified; calendar entry + materials deadline 5 business days before; `MATERIALS_READY` needs uploaded materials), attendance (manual, Excel by staff no., QR), **public QR check-in** (`/checkin/<token>`: signed token bound to a per-session secret, valid until 2 h after the end, closable; staff number only; rate-limited; anonymous feedback + quiz scored server-side), HR staff-list import (dry run → commit), training history, bulletins (publish → notify audience) and FAQ (everyone can read), annual report (held vs planned, coverage by department, feedback, presenters).
- `CryptoService.verify` accepts exactly `body.signature` (tokens with extra segments are rejected).
- **Cross-cutting** (`src/core/{dashboard,search,reports,imports}`): HoD/unit dashboard (scoped; unit heads limited to their units), management dashboard (`runAsSystem`, aggregates only, restricted matters → "confidential" count), global search (FTS candidates fetched inside `prisma.tx` so RLS context applies, then re-filtered via `PolicyService` / `DocumentsService.assertDocRead`; snippets use «» markers, rendered without innerHTML), management report (monthly/annual → JSON/xlsx/PDF via pdf-lib), contracts/laws importers (dry run → commit), bulk reminders.
- OCR: `pdftoppm` → `tesseract` per page (no ocrmypdf/pikepdf). PDF reports via `pdf-lib`; Gotenberg was dropped (legacy .doc/.xls are stored and scanned but not text-indexed).
- `$queryRaw` on `prisma.db` does NOT get RLS context (the extension only wraps model operations) — run raw SQL inside `prisma.tx(...)`.
- **Retention / keys** (`src/core/retention`): weekly `retention.scan` proposes `DisposalRequest`s (legal hold excluded); HoD approves with re-auth → files destroyed, record deleted, audit snapshot kept. `crypto.rotate` re-encrypts `*Enc` fields under the active key.
- **Ops tools** (compiled to `dist-tools/` by `pnpm --filter api build`): `prisma/seed.js`, `scripts/create-admin.js` (first Super Admin), `scripts/verify-restore.js`. Backups: `infra/backup/{backup,restore}.sh` (needs the `ldms_backup` BYPASSRLS role).
- i18n: run `pnpm --filter web i18n:extract` after adding UI strings.
