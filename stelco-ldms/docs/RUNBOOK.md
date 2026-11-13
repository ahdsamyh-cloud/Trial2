# LDMS runbook

Operational procedures for STELCO IT and the Legal Department system owner (HoD).

## 1. Components

| Service | Role | Notes |
|---|---|---|
| `proxy` | TLS, WAF, rate limits | Only published service |
| `web` | Next.js UI + BFF proxy | Stateless |
| `api` | NestJS REST API | Stateless; sessions live in PostgreSQL |
| `worker` | Background jobs (BullMQ) | AV scan, text extraction/OCR, email, reminders, SLA, compliance cycles, digests, retention, key rotation |
| `postgres` | Data, sessions, audit log | RLS + triggers |
| `redis` | Job queue, rate-limit counters | Losing Redis loses only queued jobs; the email outbox and SLA state are in PostgreSQL |
| `clamav` | Virus scanning | Uploads wait in quarantine if it is down |
| object store | Documents | `ldms-quarantine`, `ldms-documents` |

### Scheduled jobs (worker, Indian/Maldives time)

| Job | When | Purpose |
|---|---|---|
| `sla.scan` | every 10 min | 75% warning, breach → Unit Head, +1 business day → HoD |
| `reminders.send` | every 15 min | Calendar reminders (30/14/7/1/0 days) |
| `mail.flush` | every 5 min | Retry the email outbox |
| `digest.daily` / `digest.weekly` | 07:00 Sun–Thu / Sun | Notification digests |
| `audit.verify` | 02:30 daily | Hash-chain check; head hash → SIEM |
| `lit.no-update` | 06:00 daily | Flag cases with no update for 30+ days |
| `cmp.cycles` | 06:15 daily | Issue due compliance checklists |
| `cmp.ack-reminders` | 09:00 Sun–Thu | Circular acknowledgement reminders |
| `cmp.findings-overdue` | 06:30 daily | Escalate overdue findings |
| `drf.expiry-scan` | 06:45 daily | Expire contracts and PoAs; notice-period alerts |
| `retention.scan` | Sat 03:00 | Propose disposals for HoD review |
| `crypto.rotate` | Fri 04:00 | Re-encrypt values under old field keys |

## 2. Deploy / upgrade

1. CI must be green on the release commit: tests, CodeQL, Semgrep, gitleaks, audit, Trivy. Images are pushed as `ldms-{web,api,worker}:<tag>`.
2. Take a backup (`infra/backup/backup.sh`) and record the backup set name.
3. `export TAG=<new>`, then `docker compose -f infra/compose.prod.yml --profile migrate run --rm migrate` (migrations are additive; check the release notes for anything else).
4. `docker compose -f infra/compose.prod.yml up -d` (rolling restart of web, api and worker).
5. Smoke test: `/api/health` is `ok`; sign in as a test user; open a matter; upload and download a small PDF; check the worker log shows `doc.scan` and `doc.extract` completing.

**Rollback:** `export TAG=<previous>` and `up -d`. If a migration must be undone, restore the pre-upgrade backup (§4) — migrations are not reversed by hand.

## 3. User administration

* New staff: Users → New user (re-auth). Give the temporary password in person, or the user receives a 24 h setup link if SMTP is on.
* Leavers: Users → *Leaver checklist* shows open work. The HoD or Unit Head reassigns it (Users list → leaver → Reassign), then the admin disables the account. Disabling signs the person out everywhere immediately. **Emergency disable** (security incident) skips the open-work check.
* Lost phone: an admin resets two-factor (the user enrols again at next sign-in), or the user signs in with a backup code and generates new codes under My account.
* Quarterly access review: Users → *Access review (Excel)*. The HoD reviews it and IT keeps the signed copy.

## 4. Backup and restore

### 4.1 Backups
* **Continuous:** pgBackRest with WAL archiving (`archive_command` in `compose.prod.yml`): weekly full, daily differential, encrypted repository (`repo1-cipher-type=aes-256-cbc`). **RPO 15 minutes.**
* **Nightly logical snapshot** (portable, independently verifiable):
  ```bash
  DATABASE_URL=postgresql://ldms_backup:…@db:5432/ldms?sslmode=verify-full \
  S3_ALIAS=ldms S3_BUCKETS="ldms-documents" BACKUP_DIR=/backup/ldms PASSPHRASE_FILE=/etc/ldms/backup.pass \
  /opt/ldms/infra/backup/backup.sh
  ```
  This writes `db.dump.enc` and `storage.tar.enc` (AES-256, PBKDF2) plus `SHA256SUMS`, and keeps 35 sets. A failed run removes its partial set. The backup role needs `BYPASSRLS` (row-level security would otherwise block `pg_dump`).
* Keep the backup passphrase and `FIELD_KEYS` in Vault **and** in a sealed offline copy. Without `FIELD_KEYS`, encrypted fields can't be read after a restore.

### 4.2 Restore (RTO target: 4 hours)
```bash
SET=/backup/ldms/<timestamp> TARGET_DATABASE_URL=postgresql://ldms_owner:…@db:5432/ldms \
TARGET_STORAGE_DIR=/srv/ldms-restore/storage PASSPHRASE_FILE=/etc/ldms/backup.pass \
/opt/ldms/infra/backup/restore.sh
```
The script checks the SHA-256 sums, restores the database, re-applies RLS/triggers/grants, restores files, then runs `scripts/verify-restore.ts`: row counts, **full audit-chain verification**, and a SHA-256 check of up to 200 recent documents. It exits non-zero on any failure. For point-in-time recovery use `pgbackrest restore --type=time --target="<timestamp>"`.

### 4.3 Restore drill record

| Date | Set | Result | Duration | Notes |
|---|---|---|---|---|
| 2026-11-13 (build sandbox) | dev dataset | **Passed:** 19 users, 32 matters, 19 documents; audit chain 532 entries OK; 19/19 document hashes OK | 2 s (small dataset) | Drill found that `pg_dump` fails on FORCE-RLS tables without `BYPASSRLS`; fixed with the `ldms_backup` role. |
| _monthly_ | | | | Record each production drill here (restore into a staging database). |

## 5. Key and secret rotation

| Secret | How | Impact |
|---|---|---|
| `FIELD_KEYS` (field encryption) | Add a new key (`k2:<base64>`) to `FIELD_KEYS`, set `FIELD_KEY_ACTIVE=k2`, deploy. The Friday `crypto.rotate` job (or run it now) re-encrypts old values; when the job logs `rotated: 0`, remove the old key. | None |
| `SIGNING_KEY` | Replace and deploy. | Open download links and CSRF tokens become invalid; users reload the page. |
| DB / Redis / S3 passwords | Change in the service first, then in Vault/`api.env`, then restart. | Brief restart |
| TLS certificates | Replace files under `secrets/tls`, `docker compose restart proxy` (or the internal services). | None |
| Backup passphrase | New sets use the new passphrase. Keep old passphrases for as long as old sets are retained. | None |
| Users' sessions (suspected theft) | Users → user → sessions → revoke, or emergency-disable the account. | Immediate |

## 6. Incident response

1. **Contain:** emergency-disable affected accounts (revokes sessions at once). If needed, block the source IPs at the proxy or switch the proxy to maintenance.
2. **Preserve:** do not restart the database or delete anything. Export the audit log for the window (HoD/Auditor → Audit log, or SQL on a replica) and run `GET /api/audit/verify`. Collect proxy and container logs from the SIEM.
3. **Assess** with the audit log: `auth.login`, `access.denied`, `document.downloaded`, `export.list`, `matter.view.restricted`, `role.changed` for the actors and period.
4. **Specific cases:**
   * *Malware detected (`document.infected`):* the file is already blocked in quarantine. Check other uploads from the same user. Update ClamAV signatures and re-scan the quarantine if needed.
   * *Audit chain broken (`auditChain: BROKEN`):* treat as tampering. Compare with the SIEM head hashes to find when it happened. Restore a copy from backup to a separate server for comparison.
   * *Lost or stolen phone with an active session:* revoke the user's sessions and reset two-factor.
   * *Suspected Super Admin misuse:* Super Admin cannot read legal content. Review `role.changed` and `user.*` events, and check whether any legal role was granted to someone unexpected.
5. **Notify** the HoD and STELCO management according to the STELCO incident policy, and data subjects/regulators if personal data was exposed.
6. **Recover and learn:** rotate affected secrets (§5), patch, and record lessons learned.

## 7. Go-live checklist

- [ ] CI green, including CodeQL, Semgrep, gitleaks, Trivy, and a ZAP baseline against staging with no high findings
- [ ] External penetration test against `ASVS-L2-CHECKLIST.md`; findings fixed or accepted by the HoD
- [ ] Production `api.env` reviewed: `COOKIE_SECURE=true`, `AV_MODE=clamd`, `SMTP_*`, `ADMIN_IP_ALLOWLIST` (optional)
- [ ] TLS: public cert on the proxy; internal TLS for Postgres, Redis and S3; LUKS on data volumes
- [ ] WAF switched from DetectionOnly to On after the review week
- [ ] Holidays verified against the gazette; SLA targets, request types and templates confirmed by the HoD
- [ ] Departments, law firms, courts and regulators loaded; staff list imported (Awareness → Staff records)
- [ ] **Real litigation register imported** with the wizard (dry run reviewed, error report fixed, then committed)
- [ ] Contract register and laws imported (Data import)
- [ ] First admin created; HoD, Unit Heads, officers, paralegals and requesters created; access review signed
- [ ] Backups running; first restore drill recorded in §4.3
- [ ] SIEM receiving logs; alerts configured
- [ ] User guides distributed (`docs/user-guide/`); training session held
