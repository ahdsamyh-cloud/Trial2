# Phase reports

Each phase was built, tested and committed separately on branch `ccr-9aa81935-1rrvtk`. Open questions from `PLAN.md` §11 used their stated defaults unless noted.

## How to run (all phases)
```bash
cd stelco-ldms && pnpm install && pnpm build:shared && pnpm --filter api prisma:generate
cp infra/.env.dev.example infra/.env   # fill with random values: openssl rand -hex 24
docker compose -f infra/compose.dev.yml up -d            # or local postgres/redis/clamd
cp .env.example apps/api/.env  # then fill in dev values (FIELD_KEYS, SIGNING_KEY, DB URLs, SEED_DEMO=true, DEMO_*)
cd apps/api && DATABASE_URL=$MIGRATION_DATABASE_URL npx prisma migrate deploy && DATABASE_URL=$MIGRATION_DATABASE_URL node scripts/apply-sql.js \
  && DATABASE_URL=$MIGRATION_DATABASE_URL pnpm seed && pnpm build && pnpm start:local      # API :4000
cd ../web && pnpm build && API_INTERNAL_URL=http://localhost:4000 pnpm start               # web :3000
```
Demo users all share `DEMO_PASSWORD` and the TOTP secret `DEMO_TOTP_SECRET` (dev only). See `CLAUDE.md`.

Tests: `pnpm test` (unit), `pnpm test:int` (API integration against real PostgreSQL/Redis/ClamAV; copy `apps/api/.env.test.example` to `apps/api/.env.test` first. Keys and demo credentials are generated per run), `pnpm --filter web test:e2e` (Playwright, needs the API and web running; export the `DEMO_PASSWORD`/`DEMO_TOTP_SECRET` used for seeding).

| Phase | Commit | Built | Tests at end of phase |
|---|---|---|---|
| 0 Plan | `648debb` | `PLAN.md`, `CLAUDE.md` | — |
| 1 Foundation + intake | `32b37c8` | Monorepo; local auth with Argon2id, mandatory TOTP, backup codes, lockout, sessions, re-auth; users/roles/SoD/leaver/access review; PolicyService + RLS ethical wall; hash-chained audit; documents with magic bytes, ClamAV, quarantine, versions, check-out, signed links, legal hold; notifications + SMTP outbox; business-day SLA engine; calendar + reminders + .ics; config; intake with .msg/.eml parsing, sanitised preview, triage, acknowledgement, portal; Docker/compose; CI with scanners | 22 shared, 9 API unit, 37 integration, 6 e2e |
| 2 Litigation + import | `15bbdca` | Cases, parties, hearings + structured summaries (2-day SLA), next-hearing automation, deadlines/limitation, counsel engagements, budget vs actual, invoice workflow, updates, outcomes (encrypted), enforcement, firm evaluation, exposure and other reports, Excel register import (mapping, dry run, duplicates, create-on-the-fly, batch tag, rollback, error report) | 48 integration, 10 e2e |
| 3 Drafting | `fafaf4d` | Full maker-checker state machine, HoD escalation and auto-routing, optional rules, staged versions, Word compare, templates/clauses, contract repository, PoA register, opinions archive, requester portal flow | 57 integration, 11 e2e |
| 4 Compliance | `8db6590` | Laws + versions, obligations, change log, dissemination + acknowledgement + reminders, recurring checklists, evidence, rating, findings + remediation + escalation, licences, heat map | 63 integration, 13 e2e |
| 5 Awareness | `410768e` | Plan, sessions, materials, attendance (manual/Excel/QR without account), feedback + quiz, staff import, training history, bulletins, FAQ, reports. Fixed token-segment bug. | 69 integration, 15 e2e |
| 6 Cross-cutting | `e93ca84` | Unified calendar UI, HoD/unit/management dashboards, global search with OCR, management report PDF/Excel, contracts/laws importers, bulk reminders | 76 integration, 17 e2e |
| 7 Hardening | this commit | Retention/disposal with HoD approval, key-rotation job, first-admin bootstrap, per-session rate limits, 413 handling, backup/restore scripts + drill, load test, dependency upgrades (audit clean), docs (SECURITY, ASVS checklist, IT_SETUP, RUNBOOK, user guides), i18n catalogue (845 strings), axe checks | 32 unit, 80 integration, 18 e2e |

## Open issues and decisions for you
1. **Real litigation register headers** are still needed (Q-C5). The importer guesses columns from common header names and lets staff map the rest; test it with the real file before go-live.
2. **Object storage product** (Q-A4) is still open. The code is S3-only, and dev uses MinIO.
3. **Not verifiable in this sandbox:** Docker image builds (no apt egress in containers), Semgrep (rule registry blocked), CodeQL/Trivy/ZAP (CI or staging only). These run in `.github/workflows/ldms-*.yml` and must be green before go-live.
4. **Deployment to STELCO servers** has to be done by STELCO IT using `IT_SETUP.md`. This environment has no access to STELCO infrastructure.
5. **External penetration test** against `ASVS-L2-CHECKLIST.md`.
6. Holidays in the seed are **indicative**; verify them against the official gazette.
7. Known functional limits: legacy `.doc/.xls/.ppt` files aren't text-indexed; Word compare shows text, not layout; the QR check-in uses staff numbers (no account needed), as proposed in Q-C6.
