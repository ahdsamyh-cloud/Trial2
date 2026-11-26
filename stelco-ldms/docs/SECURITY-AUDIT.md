# Security audit and hardening (pre-go-live)

**Scope:** the whole LDMS codebase (`apps/api`, `apps/web`, `packages/shared`, `infra/`, CI), reviewed against five areas: input validation, secrets, authentication/sessions, error handling, and headers/dependencies.
**Method:** manual code review, plus automated checks in CI: CodeQL, Semgrep (OWASP Top 10, TypeScript, nodejsscan rule packs), gitleaks, `pnpm audit`, Trivy.
**Result:** 9 issues fixed (listed below), plus extra defence in depth. Tests after the changes: shared 24 · API unit 13 · API integration 81 · Playwright end-to-end 18. All pass. `pnpm audit` reports no known vulnerabilities.

Each change is commented in the code with a `SECURITY:` note explaining why.

## 1. What was fixed

| # | Severity | Area | Problem | Fix (file) |
|---|---|---|---|---|
| 1 | **High** | Input / redirects | Open redirect after login. `?next=/\evil.com` passed the `startsWith('/') && !startsWith('//')` check; browsers treat `\` as `/`, so users could be sent to another site after signing in (a phishing risk). | `safeRedirectPath()` allows same-origin paths only and rejects backslashes and control characters (`packages/shared/src/redirect.ts`, used in `apps/web/app/(public)/login/page.tsx`). Unit tests cover the bypass variants. |
| 2 | **High** | Error handling / records integrity | When a disposal was approved, file-deletion errors were swallowed (`.catch(() => undefined)`). The record was marked **DISPOSED** even if its files still existed in storage. | Failures are now logged, audited (`retention.dispose.failed`) and returned as a friendly 503. The record is kept until every file is gone, and approving again completes it (`core/retention/retention.service.ts`). An integration test simulates a storage outage. |
| 3 | Medium | Input / prototype pollution | The query-string helper copied request-chosen keys onto an object (CodeQL: remote property injection). | `qrec(query, ['key', …])` reads only keys named by the code (`common/zod.ts`, 8 call sites). |
| 4 | Medium | Input / type confusion | Repeated query keys (`?q=a&q=b`) arrived as arrays where strings were expected. | Global middleware returns 400 for array-valued query parameters, and `qs()` type-checks and caps every value (`bootstrap.ts`, `common/zod.ts`). Regression test included. |
| 5 | Medium | Error leakage | Bulk assign returned raw `Error.message` to the browser, which could expose database or driver errors. | Only user-facing `DomainError` messages are returned. Other errors are logged and replaced with a generic message (`core/matters/matters.controller.ts`). |
| 6 | Medium | Cryptography | The AES-GCM authentication tag length was not pinned, so a truncated tag would be accepted (makes forging encrypted values easier). | Tag length pinned to 16 bytes in encrypt and decrypt; short tags are rejected (`common/crypto.service.ts`). Unit test included. |
| 7 | Medium | Proxy / Host header | nginx built redirects and the upstream `Host` from the client-supplied `Host` header. Separately, the production compose file never passed `SERVER_NAME`, and the config included a file that does not exist. | Both now use the configured `SERVER_NAME`, which compose requires; the header block is inlined (`infra/nginx/ldms.conf`, `infra/compose.prod.yml`). |
| 8 | Medium | Proxy / IP spoofing (defence in depth) | The web proxy forwarded the **leftmost** `X-Forwarded-For` entry, which the client controls. nginx currently overwrites the header, so this was not exploitable today; behind a different proxy it would allow dodging per-IP rate limits and the admin network allow-list. | The proxy forwards the **rightmost** entry, which our own nginx sets (`apps/web/app/api/[...path]/route.ts`). |
| 9 | Low–Critical (dev tooling) | Dependencies | `diff` 7 (low, denial of service). `vitest` 3 / `tinypool` / `@vitest/mocker` (2 critical, 3 moderate; test tooling only, not shipped). | `diff` 8.0.4, `vitest` 4.1.12, `@swc-node/register` 1.12.1. `pnpm audit`: **0 known vulnerabilities**. |

### Also hardened
- **Secrets removed from the repository (including test-only ones):**
  - The demo password, TOTP secret, field-encryption keys, signing key and DB passwords used to be hard-coded in the test setup, CI, `.env.ci`, the dev compose file and the e2e helpers.
  - Tests now generate fresh random values on every run (`apps/api/test/setup-env.ts`).
  - CI generates them per job and masks them in logs. Postgres is started in a CI step so its passwords can be random.
  - Dev compose refuses to start until `infra/.env` provides the passwords (`infra/.env.dev.example`).
  - The test setup refuses to run against any database whose name does not end in `_test`, because the integration run wipes the schema.
- **Web proxy:**
  - 120-second upstream timeout.
  - Friendly 502/504 message when the API is down; the technical cause is logged on the server only.
  - Passes through the API's security headers.
  - Always sends `nosniff` and `no-store`.
- **API:** `X-Frame-Options: DENY`, to match the web pages.
- **Client-side validation** (for usability only; the server is the security boundary):
  - Default `maxLength` on every text input and text area.
  - `accept=` on every file picker.
  - Files are checked for type, emptiness and size before upload, using one allow-list in `@ldms/shared`. A unit test keeps that list identical to the server's.
  - Network failures show a clear message instead of a raw error.
- **Supply chain (pnpm):**
  - Packages must be at least 7 days old before they can be installed.
  - `trustPolicy: no-downgrade` refuses a package version that has weaker publishing evidence than earlier versions.
  - `blockExoticSubdeps` stops dependencies of dependencies being installed from git or tarball URLs.
  - npm uses `min-release-age`.
- **Regex denial of service:** regular expressions that check user input were replaced with plain string checks (TOTP code, IPv4, password rules).

## 2. Controls verified as already correct

**Input validation and injection**
- Every request body goes through a strict zod schema (`.strict()` rejects unknown fields, so no mass assignment). The API checks every field's length and type.
- SQL goes through Prisma's parameterised queries and tagged-template raw SQL only. `$queryRawUnsafe` appears only in tests. Postgres row-level security repeats the access rules inside the database.
- No command injection: OCR and PDF tools run via `execFile` (no shell), with fixed arguments and server-generated temp paths.
- XSS:
  - React escapes all output; no `dangerouslySetInnerHTML` or `innerHTML` anywhere.
  - Search highlights are built as elements, not HTML.
  - Imported email HTML is sanitised with DOMPurify.
  - A strict per-request nonce Content Security Policy (no `unsafe-inline`) blocks injected scripts.
- File uploads:
  - Extension allow-list and magic-byte check (the bytes must match the claimed type).
  - Zip-bomb and macro checks.
  - Quarantine, then a ClamAV scan, before anyone can open the file.
  - Downloads only through signed 60-second links tied to the user's session.
  - Excel exports neutralise formulas (prevents spreadsheet formula injection).

**Authentication and sessions**
- Passwords and backup codes are hashed with **Argon2id** (64 MiB memory, t=3).
- TOTP two-factor sign-in is mandatory, and a used code cannot be replayed.
- Lockout with progressive delay; per-session and per-IP rate limits.
- Session cookie: `HttpOnly; Secure; SameSite=Strict`, with the `__Host-` prefix. The server stores only the sha256 of the 256-bit token.
- Idle timeouts of 15 min (desktop) and 5 min (mobile); absolute timeout of 8 h.
- CSRF protection: SameSite, Origin check and an HMAC double-submit token.
- Re-authentication is required for sensitive actions.
- HTTPS is enforced:
  - nginx redirects port 80 to 443, allows only TLS 1.2/1.3, and sends HSTS.
  - The API refuses to start in production if `COOKIE_SECURE=false` or `AV_MODE=off`.

**Error handling and logging**
- One global exception filter. Users get a generic message plus a reference ID; validation errors list only the field paths. Stack traces and database errors go to the server log only.
- Logs are structured JSON (pino), with cookies, tokens, passwords, codes and document text redacted.
- The audit log is hash-chained and append-only: database triggers block UPDATE, DELETE and TRUNCATE.

**Headers**
- Web pages: nonce CSP, `frame-ancestors 'none'`, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy: no-referrer`, `Permissions-Policy`, HSTS (behind HTTPS), and `Cache-Control: no-store`.
- API: helmet with `default-src 'none'`, HSTS, `nosniff`, `X-Frame-Options: DENY`, CORP same-origin, `X-Powered-By` removed.

## 3. Open items for the owner
1. **Three CodeQL alerts were assessed as false positives**, with an explanation on PR #1 for each:
   - The session token written to a cookie.
   - sha256 used on random tokens; these are not passwords.
   - The quarantine write of uploaded files.

   Dismiss them in *Security → Code scanning*, or ask for changes.
2. **`minimumReleaseAgeExclude`** in `pnpm-workspace.yaml` lists `rollup@4.68.2` and `@rollup/*`. These were already locked before the 7-day rule existed. Remove the entries after 2026-11-20.
3. Before go-live:
   - Run the external penetration test (`docs/ASVS-L2-CHECKLIST.md`).
   - Load real ClamAV signatures (tests use an EICAR-only database).
   - Inject production secrets from Vault or the deployment's secret store (`docs/IT_SETUP.md`).
