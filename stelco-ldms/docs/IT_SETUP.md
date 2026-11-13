# LDMS — IT setup guide

For STELCO IT: how to host the Legal Department Management System on STELCO's own servers, publish it safely for office, home and mobile use, and bootstrap the first administrator. Commands assume Linux (RHEL-family or Ubuntu LTS) with Docker Engine and the Compose plugin.

## 1. Server sizing (70 users, growing to 200)

| Host | vCPU | RAM | Disk | Notes |
|---|---|---|---|---|
| DMZ reverse proxy | 2 | 4 GB | 20 GB | Nginx + ModSecurity CRS. The only host reachable from the internet. |
| App host | 8 | 16 GB | 100 GB | `web`, `api`, `worker` (OCR), `clamav`, `redis` |
| DB host | 4 | 16 GB | 250 GB SSD | PostgreSQL 17 + pgBackRest. LUKS-encrypted volume. |
| Object storage | 2 | 8 GB | 1 TB to start | S3-compatible (see §4). LUKS-encrypted. |
| Backup target | — | — | 3× data size | Different building or site if possible. Encrypted. |

A single 8 vCPU / 32 GB host can run everything except the DMZ proxy for a pilot. Keep the proxy separate.

## 2. Network layout and firewall

```
Internet / office LAN / VPN ──443──▶ [DMZ: proxy] ──3000──▶ [app: web] ──4000──▶ [app: api]
                                                                        ├──5432──▶ [data: postgres]
                                                                        ├──6380──▶ [data: redis (TLS)]
                                                                        ├──443/9000▶ [data: object store]
                                                                        └──3310──▶ [data: clamav]
worker ──25/587──▶ STELCO SMTP relay (only)
clamav ──443──▶ internal signature mirror (only)
```

* Inbound from the internet: **443 (and 80 → 443 redirect) to the proxy only.** Nothing else.
* Proxy → app host: TCP 3000 only. App → data: only the ports above. Deny everything else (host firewall, or VLAN ACLs).
* Outbound: the worker → SMTP relay; ClamAV → signature mirror; hosts → NTP and OS update mirrors. No general internet egress.
* **Alternative to opening 443:** put the proxy behind STELCO's VPN or a self-hosted zero-trust gateway. Users then connect to the VPN first. Password + TOTP is still required either way.

## 3. TLS certificates

* **Public certificate** on the proxy for the public name (for example `legal.stelco.com.mv`) from STELCO's usual CA or ACME. Files: `infra/secrets/tls/fullchain.pem`, `privkey.pem`. Check that the result is TLS 1.2/1.3 only (`nmap --script ssl-enum-ciphers -p 443 legal.stelco.com.mv`).
* **Internal CA** certificates for PostgreSQL (`tls/postgres/server.{crt,key}`), Redis (`tls/redis/redis.{crt,key}`, `ca.crt`) and the object store. Clients verify against the internal CA: `DATABASE_URL=...?sslmode=verify-full&sslrootcert=/run/secrets/ca.crt`, `REDIS_URL=rediss://:password@redis:6380`.

## 4. Object storage

The app uses only the S3 API (`STORAGE_DRIVER=s3`). MinIO's open-source edition went into maintenance mode in late 2025, so choose one of:

* **Licensed MinIO AIStor** (closest to the original plan), **SeaweedFS**, **Garage**, or **Ceph RGW**, or
* an existing STELCO S3-compatible appliance.

Create two buckets: `ldms-quarantine` (unscanned uploads) and `ldms-documents` (clean files). Neither is public. Create one service account limited to those buckets. Turn on server-side encryption if the product supports it (`S3_SSE=true`) **and** LUKS on the volume. Set `S3_FORCE_PATH_STYLE=true` for most self-hosted products.

## 5. PostgreSQL roles

```sql
CREATE ROLE ldms_owner LOGIN PASSWORD '<from vault>';            -- migrations only
CREATE ROLE ldms_app   LOGIN PASSWORD '<from vault>';            -- runtime (DML only)
CREATE ROLE ldms_backup LOGIN BYPASSRLS PASSWORD '<from vault>'; -- pg_dump only (read-only)
CREATE DATABASE ldms OWNER ldms_owner;
```

`scripts/apply-sql.js` (run by the `migrate` service) installs the audit triggers, RLS policies and grants. `ldms_app` gets no UPDATE/DELETE on `AuditLog`, and `ldms_backup` gets SELECT only. Set `ssl=on` and `password_encryption=scram-sha-256`, and use `pg_hba.conf` `hostssl` lines limited to the app and backup hosts.

## 6. Secrets

Generate on a trusted machine and store in HashiCorp Vault (or STELCO's secrets store). At deploy time, render them into `infra/secrets/api.env` (mode 0600, owned by root, never committed).

```bash
openssl rand -base64 32   # FIELD_KEYS=k1:<this>   (field-level encryption key; keep old keys when rotating)
openssl rand -base64 48   # SIGNING_KEY            (download links, CSRF)
openssl rand -base64 32   # REDIS_PASSWORD, DB passwords, backup passphrase
```

`api.env` must contain at least: `NODE_ENV=production`, `APP_ORIGIN=https://legal.stelco.com.mv`, `COOKIE_SECURE=true`, `DATABASE_URL` (ldms_app, TLS), `MIGRATION_DATABASE_URL` (ldms_owner), `REDIS_URL` (rediss), `FIELD_KEYS`, `FIELD_KEY_ACTIVE`, `SIGNING_KEY`, `STORAGE_DRIVER=s3` + `S3_*`, `AV_MODE=clamd`, `CLAMD_HOST=clamav`, `SMTP_*`, `OCR_ENABLED=true`, `TRUST_PROXY=2` (proxy + web). The API refuses to start in production if `AV_MODE=off`, `COOKIE_SECURE=false` or `QUEUE_INLINE=true`.

## 7. SMTP relay

Set `SMTP_ENABLED=true`, `SMTP_HOST`, `SMTP_PORT` (25 or 587), `SMTP_REQUIRE_TLS=true`, and `SMTP_FROM="LDMS <no-reply-legal@stelco.com.mv>"`. Allow the worker host's IP on the relay. Add the sender to SPF if the relay requires it. With SMTP off, everything still works through in-app notifications: new accounts get a temporary password instead of a setup link, and acknowledgements are copied into Outlook by hand.

## 8. ClamAV signatures

The `clamav` container runs `freshclam`. Point it at an internal mirror (`DatabaseMirror` / `PrivateMirror` in `freshclam.conf`) or allow `database.clamav.net` through the proxy. **Uploads stay quarantined if ClamAV is unavailable**: they're retried and never released unscanned.

## 9. First deployment

```bash
# 1. images (built by CI and pushed to the internal registry)
export REGISTRY=registry.stelco.internal TAG=<release>
# 2. database schema, RLS, triggers, grants
docker compose -f infra/compose.prod.yml --profile migrate run --rm migrate
# 3. reference data (departments, SLA targets, request types, templates, holidays — no demo users)
docker compose -f infra/compose.prod.yml run --rm -e DATABASE_URL="$MIGRATION_DATABASE_URL" api node dist-tools/prisma/seed.js
# 4. start
docker compose -f infra/compose.prod.yml up -d
# 5. first administrator (admin account: user management only, no legal content)
docker compose -f infra/compose.prod.yml run --rm -e DATABASE_URL="$MIGRATION_DATABASE_URL" api \
  node dist-tools/scripts/create-admin.js adm.<name> <name>@stelco.com.mv "IT Administrator"
```

The script prints a one-time temporary password. Give it to the administrator in person. At first sign-in they must change it and enrol an authenticator app. The administrator then creates the **HoD** account, and the HoD's legal-role grant is alerted to the HoD. **Review the indicative public holidays** in Configuration → Public holidays against the official gazette.

## 10. Reverse proxy and WAF

`infra/nginx/ldms.conf` (templated by the `owasp/modsecurity-crs` image) provides TLS 1.2/1.3, HSTS, request limits (55 MB uploads), per-IP rate limits (stricter on `/api/auth/login`), and the OWASP Core Rule Set at paranoia level 2 with a short, reviewed exclusion list (`crs-exclusions.conf`). Optional: restrict `/admin` paths to office ranges at the proxy, and also set `ADMIN_IP_ALLOWLIST=10.0.0.0/8,...` in the API.

Run the WAF in detection-only mode for the first week (`MODSEC_RULE_ENGINE=DetectionOnly`), review false positives, then switch to `On`.

## 11. Logs and monitoring

* Containers log JSON to stdout. Ship them with the STELCO log agent (Filebeat, Fluent Bit or syslog) to the SIEM.
* Alert on: `"auditChain":"BROKEN"`, `securityAlert` entries, `level >= 50`, repeated `access.denied`, and container restarts.
* Health: `GET /api/health` (database + Redis) through the proxy. Monitor the BullMQ queue depth in Redis (`bull:ldms:wait`).
* Time: all hosts on NTP. The app works in `Indian/Maldives` time.

## 12. Backups

See [RUNBOOK §4](RUNBOOK.md#4-backup-and-restore). In summary: pgBackRest (weekly full, daily differential, continuous WAL → RPO 15 min) plus nightly `infra/backup/backup.sh` encrypted logical snapshots of the database and object store, and a **monthly restore drill** with `restore.sh`.

---

## 13. Phase 8 — Microsoft 365 (only when requested)

Not active in v1. These are the steps IT will need when Phase 8 starts.

### 13.1 Entra ID single sign-on (OIDC + PKCE)
1. **App registration** "STELCO LDMS", single tenant. Redirect URI `https://legal.stelco.com.mv/api/auth/oidc/callback` (Web). Front-channel logout URL `/login`.
2. **Token configuration:** add the `groups` claim (security groups, sent as group IDs).
3. **API permissions (delegated):** `openid`, `profile`, `email`, `User.Read`. Grant admin consent.
4. **Security groups → roles:** create `LDMS-HoD`, `LDMS-UnitHead-LIT|CMP|DRF|AWR`, `LDMS-Officer-…`, `LDMS-Paralegal-…`, `LDMS-Requester`, `LDMS-Auditor`, `LDMS-Management`. LDMS maps group object IDs to roles. Super Admin stays a local admin account.
5. **Conditional Access:** require MFA (phishing-resistant: Authenticator number matching or FIDO2) for the LDMS app. Block legacy auth. Optionally require compliant devices for mobile.
6. Existing users are linked by verified email on first SSO sign-in (`Identity` provider `ENTRA`, subject = object ID). Then local passwords are switched off **except one break-glass admin account** (long password + TOTP, kept in a sealed envelope; every use alerts).

### 13.2 Microsoft Graph mailbox access (least privilege)
1. Separate app registration "STELCO LDMS Mail".
2. **Application permissions:** `Mail.Read` (ingestion), `Mail.Send` (acknowledgements from the shared mailbox), and `Calendars.ReadWrite` only if Outlook calendar sync is enabled. Nothing else.
3. **Restrict the app to the legal mailbox only** with RBAC for Applications (preferred) or an Application Access Policy:
   ```powershell
   Connect-ExchangeOnline
   New-DistributionGroup -Name "LDMS-Mailbox-Scope" -Type Security -Members legal@stelco.com.mv
   New-ApplicationAccessPolicy -AppId <app-id> -PolicyScopeGroupId "LDMS-Mailbox-Scope" -AccessRight RestrictAccess -Description "LDMS: legal@ only"
   Test-ApplicationAccessPolicy -Identity legal@stelco.com.mv -AppId <app-id>     # AccessCheckResult: Granted
   Test-ApplicationAccessPolicy -Identity someone.else@stelco.com.mv -AppId <app-id>  # Denied
   ```
4. Use a **certificate** credential (not a client secret), stored in Vault. Rotate it yearly.
5. Change notifications need an HTTPS endpoint reachable from Microsoft. Publish only `/api/graph/notifications` through the proxy, validated by `clientState`. Delta polling every 5 minutes is the fallback if inbound webhooks aren't allowed.
