# LDMS security

This document describes the security controls in the STELCO Legal Department Management System (LDMS), how they map to the threat model in [`PLAN.md` §8](PLAN.md#8-threat-model-stride), how they were verified, and how to report a problem. The requirement-by-requirement OWASP ASVS 4.0.3 Level 2 checklist is in [`ASVS-L2-CHECKLIST.md`](ASVS-L2-CHECKLIST.md).

## Reporting a security issue

Report suspected vulnerabilities or incidents **privately** to the STELCO IT Security team (internal ticket category *Security incident*, or the IT security mailbox). Do not open public issues and do not test on production. Include the steps to reproduce, the account used, the time and, if available, the `requestId` shown in the error message. The incident response procedure is in [`RUNBOOK.md` §6](RUNBOOK.md#6-incident-response).

## 1. Architecture and exposure

| Control | Implementation |
|---|---|
| Only the web front end is exposed | Nginx + ModSecurity (OWASP CRS, paranoia level 2) in the DMZ forwards to Next.js. Next.js proxies `/api/*` to NestJS over the internal network (`apps/web/app/api/[...path]/route.ts`). The API, PostgreSQL, Redis, object storage and ClamAV sit on `internal: true` Docker networks (`infra/compose.prod.yml`). |
| TLS everywhere | TLS 1.2/1.3 at the proxy (modern ciphers, HSTS, no session tickets). PostgreSQL `ssl=on`, `ssl_min_protocol_version=TLSv1.2`. Redis is TLS-only (`--port 0`). S3 over HTTPS. |
| Containers | Non-root users, `read_only` root filesystem, `cap_drop: ALL`, `no-new-privileges`, tmpfs for scratch, resource limits on the worker (OCR). |

## 2. Identity and sessions

| Control | Implementation | Evidence |
|---|---|---|
| Passwords | At least 12 characters, at most 128. No composition rules or expiry (NIST 800-63B). Checked against an offline common/breached list plus an optional large list (`BREACHED_PASSWORDS_FILE`). Argon2id (m=64 MiB, t=3, p=1). | `core/auth/passwords.ts`, `security.test.ts` |
| Mandatory TOTP | Enrolment at first sign-in. Secrets encrypted at rest. ±1 step window. **A time-step can never be reused.** 10 single-use backup codes, Argon2id-hashed. | `auth.service.ts`, `auth.int.test.ts` |
| Failed sign-ins | Same message and timing for unknown users and wrong passwords (dummy hash). After 5 failures the account locks for 15 minutes. Delays grow 1/2/4/8 s. Per-IP throttle of 20 per minute. Admins are alerted after 3 lockouts in 24 hours. | `auth.int.test.ts` |
| Sessions | Server-side. The 256-bit random token is stored only as a SHA-256 hash. Cookie is `__Host-ldms_sid; HttpOnly; Secure; SameSite=Strict`. Idle timeout 15 min (5 min on mobile), absolute timeout 8 h. Rotated after MFA. Users can sign out other sessions; admins can revoke any. Disabling a user or changing their roles revokes their sessions immediately. | `session.service.ts`, `auth.guard.ts` |
| Re-authentication | Password + TOTP within 5 minutes required for: user create/role change/disable/reset, audit log viewer, bulk matter export, disposal approval. | `@ReAuth()` |
| New device | Sign-in from a device without the device cookie notifies the user. | `completeLogin()` |
| One-time links | Setup links last 24 h and reset links 30 min. Single use, hashed, and earlier links are invalidated. Self-service reset never reveals whether an email exists. | `issueToken()` |
| Separation of duties | Super Admin can only be held by a separate admin account, which cannot hold any legal role. Granting HoD, Unit Head or Auditor alerts the HoD. Auditor accounts need an expiry date. | `validateRoleSet()`, `users-audit.int.test.ts` |

## 3. Authorisation

* **Deny by default.** One global `AuthGuard` runs on every route. A route without `@Can`, `@Authenticated` or `@Public` is refused, and `access.int.test.ts` fails the build if any route lacks metadata.
* **Record level.** `PolicyService` builds the `WHERE` clause for every read path (lists, details, search, calendar, exports, dashboards) from role, unit, department and the ethical wall. Records out of scope return **404**, so their existence isn't revealed.
* **Ethical wall in the database.** PostgreSQL row-level security with `FORCE` (`prisma/sql/03_rls.sql`) hides restricted matters and their documents, comments, SLA clocks, calendar entries and unit details from anyone not named on the matter, except the HoD. The request context is set per transaction. With no context, restricted rows are invisible (fail closed). This is tested directly against the database with the runtime role.
* **Least-privilege DB roles.** `ldms_owner` runs migrations only. The runtime role `ldms_app` has DML but no DDL, and no UPDATE/DELETE/TRUNCATE on `AuditLog`. `ldms_backup` is read-only with `BYPASSRLS`, for `pg_dump` only.
* **Maker-checker** (drafting): the drafter can't review, and neither drafter nor reviewer can approve. When the Unit Head is maker or checker, the request routes to the HoD automatically. Enforced server-side in `DraftingService.guard()` and tested.
* **IDOR tests.** Every unit's integration tests try access from other units, other departments, unnamed users on restricted matters, expired auditors and disabled users.

## 4. Input, output and files

* Zod schemas with `.strict()` on every body and query, so unknown keys (mass assignment) are rejected. JSON body limit 1 MB (413 when exceeded). Parameterised SQL only: Prisma, or `$queryRaw` tagged templates.
* **Strict CSP with per-request nonces** (no `unsafe-inline` or `unsafe-eval` in production), plus `frame-ancestors 'none'`, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy: no-referrer` and a restrictive `Permissions-Policy`. Pages and API responses are `Cache-Control: no-store`. An e2e test asserts there are no CSP violations across the main pages.
* **CSRF:** `SameSite=Strict`, an Origin/`Sec-Fetch-Site` check, and a double-submit token bound to the session (HMAC).
* **Email HTML** (untrusted): DOMPurify on the server (no scripts, forms, iframes, event handlers or `url()` styles; remote images replaced by placeholders), then rendered in an `<iframe sandbox>` with no permissions.
* **Uploads:** extension allow-list, **magic-byte check**, no macro-enabled formats (OOXML `vbaProject.bin`, embedded programs, OLE VBA streams rejected), zip-bomb limits. Files go to quarantine, are **scanned by ClamAV**, and are released only when clean; infected files are blocked and alerted. Storage keys are random and files are kept outside the web root. Integrity is checked by SHA-256 on download. Downloads use **60-second HMAC-signed links bound to the user and session**, sent as `Content-Disposition: attachment` with a sandbox CSP. PDFs can optionally be watermarked. Legal hold is enforced by the app *and* a database trigger.
* **Excel exports** neutralise formula injection (`= + - @` prefixes). Imports never evaluate formulas.
* Errors return a generic message plus a `requestId`, never stack traces.

## 5. Data protection

* **Field-level encryption:** AES-256-GCM with a key ring (`FIELD_KEYS`, `FIELD_KEY_ACTIVE`). It covers TOTP secrets, litigation exposure, settlement/judgment amounts, and the descriptions and comments of restricted matters. The `crypto.rotate` job re-encrypts values held under old keys.
* **At rest:** LUKS on the database, object-store and backup volumes (community PostgreSQL has no TDE). Backups are encrypted with AES-256 (PBKDF2, 200k iterations) and SHA-256 manifests.
* **Logs:** structured JSON (pino) with redaction of cookies, tokens, passwords, codes, email bodies and extracted text. Download tokens are masked in request logs.
* **Minimisation:** requesters see status-level views only. Internal notes are never shown in the portal. The management viewer gets aggregates only, with restricted matters counted in a "confidential" bucket.
* **Retention:** a weekly job proposes disposal of records past their retention period. Nothing is destroyed without HoD approval with re-authentication. Legal hold always wins. An audit entry keeps a snapshot.

## 6. Audit and monitoring

* An **append-only, hash-chained audit log**. Each entry stores `prevHash` and `SHA-256(prevHash ‖ canonical entry)`, inserts are serialised by an advisory lock, and UPDATE/DELETE/TRUNCATE are blocked by triggers for every role. A nightly `audit.verify` job walks the chain and writes the head hash to the application log for the SIEM, so tampering by a database superuser can be detected from outside.
* Recorded events: creates, updates, deletes, status transitions, views of restricted matters and audit pages, downloads, exports, searches, permission changes, sign-ins and failures, denied access, imports and rollbacks, disposal.
* **Alerts** (in-app and email to Super Admin/HoD): repeated access-denied events, repeated lockouts, role changes (sensitive roles to HoD), mass downloads (more than 50 in 10 minutes), large or repeated exports, malware detected. Break-glass alerts arrive with Phase 8.

## 7. Supply chain and pipeline

`.github/workflows/ldms-ci.yml` runs lint/typecheck, unit, integration and e2e tests, **CodeQL**, **Semgrep** (OWASP, TypeScript, nodejsscan), **gitleaks**, `pnpm audit --audit-level high`, image builds, **Trivy** (fails on fixable HIGH/CRITICAL) and an SBOM. `ldms-dast.yml` runs an **OWASP ZAP** baseline against staging from a STELCO self-hosted runner. Dependabot covers npm, Docker and Actions. All versions are pinned exactly and the lockfile is enforced.

## 8. Verification results (this build)

| Check | Result |
|---|---|
| Unit tests (shared + API) | 22 + 10 passing (incl. property-based calendar tests and the OCR fixture) |
| API integration tests (real PostgreSQL + RLS, Redis, ClamAV) | 80 passing |
| Playwright e2e (desktop + mobile, axe WCAG 2.1 AA, CSP violation check) | 18 passing |
| `pnpm audit --prod` | 0 critical, 0 high, 0 moderate, 1 low (transitive, no fix) |
| gitleaks (full history) | no leaks |
| Semgrep / CodeQL / Trivy / ZAP | configured in CI; **not run in the build sandbox** (no egress to semgrep.dev, no Docker apt mirror). Must pass in CI before go-live. |
| Backup + restore drill | passed; see [RUNBOOK §4.3](RUNBOOK.md#43-restore-drill-record) |
| Indicative load | 50 concurrent zero-think-time users through the BFF: p95 ≤ 340 ms on 4 vCPU with every service colocated |

Security bugs found and fixed during the build: signed tokens with extra `.` segments were accepted (fixed in `CryptoService.verify`, with a regression test); oversized JSON bodies returned 500 (now 413); a pure per-IP rate limit would have throttled whole offices behind NAT (now per session, with a per-IP ceiling); `pg_dump` cannot export FORCE-RLS tables (dedicated `BYPASSRLS` backup role added).

## 9. Known limitations and residual risks

* **Real-time phishing that relays a TOTP code** is not fully mitigated by TOTP (residual risk accepted for v1). Phase 8 adds Entra ID with phishing-resistant MFA through Conditional Access.
* Legacy `.doc` / `.xls` / `.ppt` files are accepted, scanned and stored, but their text isn't indexed for search.
* Word comparison shows text differences, not layout or formatting.
* An external penetration test is still required before go-live ([RUNBOOK §7](RUNBOOK.md#7-go-live-checklist)).
