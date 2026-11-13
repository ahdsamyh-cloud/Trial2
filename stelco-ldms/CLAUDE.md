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
