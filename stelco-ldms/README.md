# STELCO Legal Department Management System (LDMS)

A secure, on-premises web app for STELCO's Legal Department, covering Litigation, Compliance, Drafting and Awareness. It turns requests into trackable matters with business-day SLAs (Sun–Thu), keeps an append-only audit trail, and works on desktop and phones (PWA).

| Read | For |
|---|---|
| [`docs/PLAN.md`](docs/PLAN.md) | Architecture, data model, permissions, workflows, threat model |
| [`docs/PHASE-REPORTS.md`](docs/PHASE-REPORTS.md) | What each phase delivered, how to run, test results, open issues |
| [`docs/SECURITY.md`](docs/SECURITY.md) · [`docs/ASVS-L2-CHECKLIST.md`](docs/ASVS-L2-CHECKLIST.md) · [`docs/SECURITY-AUDIT.md`](docs/SECURITY-AUDIT.md) | Security controls, the pen-test checklist, and the pre-go-live audit |
| [`docs/IT_SETUP.md`](docs/IT_SETUP.md) · [`docs/RUNBOOK.md`](docs/RUNBOOK.md) | Installing, operating, backups, incidents, go-live |
| [`docs/user-guide/`](docs/user-guide/README.md) | User guides per role |
| [`CLAUDE.md`](CLAUDE.md) | Conventions and commands for developers |

**Stack:** Next.js (App Router, BFF proxy, nonce CSP) · NestJS + BullMQ worker · PostgreSQL 17 + Prisma + row-level security · Redis · S3-compatible storage · ClamAV · Tesseract OCR · Docker Compose behind Nginx + ModSecurity CRS.

## Quick start (local development: Windows, macOS or Linux)

This project uses **pnpm** (not npm) and needs PostgreSQL, Redis and ClamAV, which run in Docker.

**Install once:**
- [Node.js 22 LTS](https://nodejs.org/)
- [Docker Desktop](https://www.docker.com/products/docker-desktop/), started before you continue.
- pnpm: `npm install -g pnpm@10.28.0`

**Then, in this folder (`stelco-ldms`), in Command Prompt, PowerShell or a terminal:**

```bat
pnpm install
pnpm setup:env
docker compose -f infra/compose.dev.yml up -d
pnpm setup:db
pnpm dev
```

| Command | What it does |
|---|---|
| `pnpm install` | Installs all dependencies. |
| `pnpm setup:env` | Creates `infra/.env` and `apps/api/.env` with random local passwords and keys. It prints the demo password and the TOTP secret. |
| `docker compose -f infra/compose.dev.yml up -d` | Starts Postgres, Redis, ClamAV, MinIO and Mailpit. |
| `pnpm setup:db` | Migrates the database and seeds reference data and demo users. |
| `pnpm dev` | Starts the API on :4000 and the web app on :3000. Ctrl+C stops both. `pnpm start` does the same. |

**Signing in:**
1. Open **http://localhost:3000**.
2. Sign in as **`hod`**, **`adm.it`** or another demo user (full list in `CLAUDE.md`). Use the demo password that `pnpm setup:env` printed.
3. For the 6-digit code, run `pnpm demo:code`, or add the TOTP secret to an authenticator app. Each code works only once. If it is refused, wait for the next 30-second window.

**Good to know:**
- Emails go to Mailpit at http://localhost:8025.
- ClamAV needs a few minutes on first start to download its signatures. Uploads are refused until it is ready.
- Run `pnpm setup:env` again any time to see the demo credentials. It never overwrites existing files.
- Stop the services with `docker compose -f infra/compose.dev.yml down`. Add `-v` to also delete the data.

**Testing:** see [`docs/TESTING.md`](docs/TESTING.md) for the automated tests (`pnpm test`, `pnpm test:int`, `pnpm test:e2e`) and a step-by-step manual checklist for each unit.

For production, see `docs/IT_SETUP.md`. Do not use the development setup on a server.
