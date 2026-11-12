# CLAUDE.md — STELCO Legal Department Management System (LDMS)

## Status
- **Phase 0 (plan), waiting for approval.** See `docs/PLAN.md`. No application code yet.
- Do not start a phase until the user approves it. After each phase, report: what was built, how to run it, test results, open issues.
- Phase 8 (Microsoft 365 / Entra / Graph) is **only built when the user asks**.

## Context
- On-premises only (STELCO Linux servers). No public cloud services.
- Local accounts + mandatory TOTP in v1. The auth layer must accept Entra ID OIDC later through the `Identity` table without reworking users or roles.
- Time zone `Indian/Maldives`. Work week **Sun–Thu**. Business-day maths always go through `packages/shared/calendar.ts` (never hand-roll date maths).
- English UI, but **all strings go in translation files** (next-intl).

## Planned layout (pnpm workspaces)
- `apps/web`: Next.js App Router + BFF. The browser only talks to this origin.
- `apps/api`: NestJS (`main.ts` = HTTP, `main.worker.ts` = BullMQ worker). `src/core/*` + `src/units/{litigation,drafting,compliance,awareness}`.
- `packages/shared`: zod schemas, enums, permission matrix, workflow tables, calendar.
- `packages/db`: Prisma schema, migrations, RLS SQL, seeds.
- `infra/`: Dockerfiles, compose files, nginx/ModSecurity, extractor image.

## Non-negotiable conventions
- Every API route declares `@Can(permission)` or `@Public()`. A test fails the build otherwise.
- Record-level access always goes through `PolicyService` scopes. Restricted matters are invisible (404) to anyone not named on them, except the HoD.
- Every state change goes through `WorkflowService` and writes `StatusTransition` + `AuditLog`.
- Zod-validate every input and reject unknown keys. No string-built SQL (only `$queryRaw` tagged templates).
- Every new resource gets IDOR tests in the integration suite.
- Never log tokens, passwords, email bodies or document text. Never commit secrets (`.env.example` only).
- Small commits with clear messages.

## Commands
_To be filled in during Phase 1 (pnpm install, dev compose, test, lint, migrate, seed)._
