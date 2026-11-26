# OWASP ASVS 4.0.3 — Level 2 checklist (LDMS)

This is the penetration-test checklist for Phase 7. Status values: **Met** (implemented and tested), **Met (ops)** (depends on the deployment configuration in `IT_SETUP.md`), **Partial** (with a note), **N/A**. Evidence points to code or tests. Testers should confirm each "Met (ops)" item on the production configuration.

| ASVS | Requirement (summary) | Status | Evidence / notes |
|---|---|---|---|
| **V1 Architecture** | | | |
| 1.1.2 / 1.1.3 | Threat model, security requirements | Met | `PLAN.md` §8 STRIDE, `SECURITY.md` |
| 1.2.1 | Least privilege for components | Met | DB roles owner/app/backup; containers non-root and read-only |
| 1.4.1 | Access control enforced at a trusted service layer | Met | Global `AuthGuard`, `PolicyService`, RLS |
| 1.5.1 | Input/output requirements defined | Met | Zod `.strict()` schemas per endpoint |
| 1.6.1–1.6.4 | Key management policy, keys not in code | Met (ops) | `FIELD_KEYS` / `SIGNING_KEY` injected; rotation job; `RUNBOOK` §5 |
| 1.8.1–1.8.2 | Sensitive data identified and protected | Met | Field-level encryption list in `SECURITY.md` §5 |
| 1.9.1 | Communication between components encrypted | Met (ops) | TLS for Postgres, Redis and S3 in `compose.prod.yml` |
| 1.14.x | Segregated components, CI/CD | Met | Internal networks, pinned builds, CI scans |
| **V2 Authentication** | | | |
| 2.1.1–2.1.2 | Password length ≥ 12, ≤ 128 allowed | Met | `password.ts` |
| 2.1.7 | Breached-password check | Met | Offline list + optional large list |
| 2.1.9 | No composition rules | Met | |
| 2.1.10 | No periodic rotation | Met | Change forced only after a reset |
| 2.2.1 | Anti-automation (lockout, throttling) | Met | Lockout after 5, delays, per-IP throttle, `auth.int.test.ts` |
| 2.2.3 | Notify on security-relevant changes | Met | New device, password changed, roles changed, reset |
| 2.3.1 | Initial passwords random, must change | Met | Temp password / 24 h setup link, `mustChangePassword` |
| 2.4.1 | Approved password hashing | Met | Argon2id |
| 2.5.1–2.5.6 | Secure recovery, no hints, notifications | Met | One-time 30 min links, admin resets audited |
| 2.7.x / 2.8.x | OTP: time-limited, single use, rate-limited | Met | TOTP ±1 step, replay prevented (`lastStep`), 10 attempts per 5 min |
| 2.8.4 | OTP not reusable | Met | Tested |
| 2.9.x | Cryptographic authenticators | N/A | Phase 8 (Entra ID) |
| **V3 Session management** | | | |
| 3.1.1 | No tokens in URLs | Met | Cookies only; download links are short-lived and bound to user + session |
| 3.2.1–3.2.3 | New token on authentication; ≥ 64 bits entropy; secure storage | Met | 256-bit token, hash stored, rotated after MFA |
| 3.3.1–3.3.4 | Logout, idle and absolute timeouts, sign out other sessions | Met | 15 min / 5 min mobile / 8 h; tested |
| 3.4.1–3.4.5 | Secure, HttpOnly, SameSite, `__Host-` prefix, path | Met (ops) | `COOKIE_SECURE=true` required in production (enforced at start-up) |
| 3.5.x | Token-based sessions | N/A | Server-side sessions |
| 3.7.1 | Re-auth before sensitive actions | Met | `@ReAuth()` |
| **V4 Access control** | | | |
| 4.1.1–4.1.5 | Enforced server-side, deny by default, least privilege | Met | Guard metadata test, `PERMISSIONS` matrix |
| 4.2.1 | Protection against IDOR | Met | Cuid IDs, scopes, 404s, IDOR tests in every unit suite |
| 4.2.2 | CSRF protection | Met | SameSite + Origin + HMAC double submit, tested |
| 4.3.1 | Admin interfaces protected (MFA, IP allow-list option) | Met | Admin routes need MFA + re-auth; `ADMIN_IP_ALLOWLIST` |
| 4.3.2 | Directory browsing disabled | Met | No static listing; storage outside the web root |
| **V5 Validation, sanitisation, encoding** | | | |
| 5.1.1–5.1.5 | Allow-list validation, HTTP parameter pollution | Met | Zod strict; enums |
| 5.2.1 | Sanitise untrusted HTML | Met | DOMPurify + sandboxed iframe |
| 5.2.x | Template injection, SSRF | Met | Plain-text `{{}}` templates; no server-side fetch of user URLs |
| 5.3.1–5.3.4 | Output encoding, SQL injection | Met | React escaping; Prisma / tagged `$queryRaw` |
| 5.3.x | Formula injection in exports | Met | `safeCell()` |
| 5.5.x | Deserialisation | Met | JSON only; no `eval` |
| **V6 Stored cryptography** | | | |
| 6.2.1–6.2.5 | Approved algorithms, authenticated encryption, random IV | Met | AES-256-GCM, 96-bit random IV, versioned envelope |
| 6.2.x | Key rotation | Met | Keyring + `crypto.rotate` job (tested) |
| 6.3.1 | CSPRNG | Met | `crypto.randomBytes` |
| 6.4.1–6.4.2 | Secrets management | Met (ops) | Vault / deploy-time injection |
| **V7 Error handling and logging** | | | |
| 7.1.1–7.1.4 | No credentials or session tokens in logs; sufficient context | Met | pino redaction; `requestId` |
| 7.2.1–7.2.2 | Log auth decisions and access-control failures | Met | `auth.*`, `access.denied` |
| 7.3.1–7.3.4 | Log integrity, time source | Met / Met (ops) | Hash chain + SIEM head hash; NTP on hosts |
| 7.4.1 | Generic error messages | Met | `AllExceptionsFilter` |
| **V8 Data protection** | | | |
| 8.1.1–8.1.6 | No caching of sensitive data, backups protected | Met | `no-store`; PWA caches static assets only; encrypted backups |
| 8.2.1–8.2.3 | Browser storage free of sensitive data | Met | Only column and view preferences in localStorage |
| 8.3.x | Sensitive data in HTTP body, privacy | Met | Data minimisation, portal DTOs |
| **V9 Communication** | | | |
| 9.1.1–9.1.3 | TLS for all connections, strong ciphers | Met (ops) | `nginx/ldms.conf` TLS 1.2/1.3 |
| 9.2.x | Internal TLS | Met (ops) | `compose.prod.yml` |
| **V10 Malicious code** | | | |
| 10.3.x | Integrity of updates, no back doors | Met | Pinned deps, lockfile, SBOM, Dependabot |
| **V11 Business logic** | | | |
| 11.1.1–11.1.5 | Sequential steps enforced, limits, anti-automation | Met | State machines with server guards; rate limits |
| **V12 Files and resources** | | | |
| 12.1.1–12.1.3 | Size limits, compression bombs | Met | 50 MB default; zip entry/ratio limits |
| 12.2.1 | File type validated by content | Met | Magic bytes |
| 12.3.x | No path traversal; filenames sanitised | Met | Random keys; `cleanFilename()` |
| 12.4.1–12.4.2 | Files outside web root, AV scanning | Met | Quarantine → ClamAV → clean |
| 12.5.x | Download served safely | Met | Attachment, nosniff, sandbox CSP |
| **V13 API** | | | |
| 13.1.x | Same encodings and parsers; admin APIs authenticated | Met | |
| 13.2.x | RESTful method checks, content-type validation | Met | Nest routing; JSON parser only |
| **V14 Configuration** | | | |
| 14.1.x | Secure build, compiler flags, CI scanning | Met | TS strict; CI scanners |
| 14.2.x | Dependencies up to date, SBOM | Met | Audit clean (1 low); SBOM job |
| 14.3.x | No debug or unintended info | Met | `x-powered-by` off; errors generic |
| 14.4.x | Security headers | Met | CSP nonce, HSTS, XFO, nosniff, Referrer-Policy, Permissions-Policy |
| 14.5.x | Origin/CORS validation | Met | Single origin; no CORS |

**Tester focus areas:** the ethical wall (restricted matters through every read path), maker-checker bypass attempts, signed download links (replay, cross-session), QR check-in tokens, email upload parsing (crafted `.msg`/`.eml`), import files (formula, XXE, zip bomb), session fixation across the MFA step, and admin → legal privilege escalation.
