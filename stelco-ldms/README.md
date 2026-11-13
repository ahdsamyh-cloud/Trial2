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

**Quick start (dev):** see `docs/PHASE-REPORTS.md` → *How to run*.
