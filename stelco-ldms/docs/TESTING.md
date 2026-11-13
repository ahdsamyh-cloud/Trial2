# Testing LDMS

There are two kinds of testing:

- **Automated tests:** about 140 checks that run with one command each.
- **Manual acceptance testing:** you click through the real app as each type of user.

Both run on Windows (Command Prompt or PowerShell), macOS or Linux.

**Before you start:** do the README *Quick start* once. That means:
1. `pnpm install`
2. `pnpm setup:env`
3. `docker compose -f infra/compose.dev.yml up -d`
4. `pnpm setup:db`

Docker Desktop must be running whenever you test.

---

## 1. Automated tests

Run these from the `stelco-ldms` folder.

| Command | What it checks | Needs | Time |
|---|---|---|---|
| `pnpm typecheck` | The code compiles with no type errors. | — | ~30 s |
| `pnpm test` | **Unit tests** (37): business-day calendar and SLA maths, permissions, password rules, file-type checks, encryption, redirect guard. | nothing running | ~10 s |
| `pnpm test:int` | **API integration tests** (81). Each test sends real requests to the API, backed by real Postgres, Redis and ClamAV. They cover every unit's workflow, access rules (other unit, other department, restricted matters → 404), audit log, uploads and virus blocking, retention, and key rotation. | Docker services running | ~1–2 min |
| `pnpm test:e2e` | **Browser tests** (18). Playwright drives Chrome as real users: sign-in with 6-digit code, intake, litigation, drafting, compliance, awareness QR check-in, dashboards, CSP and accessibility (WCAG 2.1 AA). Covers desktop and phone layouts. | `pnpm dev` running in **another window**, and browsers installed once with `pnpm e2e:install` | ~2–3 min |

**Notes:**
- `pnpm test:int` uses a separate database, `ldms_test`, and **wipes it on every run**. Your dev data in `ldms` is not touched. Its settings are in `apps/api/.env.test`, which `pnpm setup:env` creates.
- `pnpm test:e2e` signs in with the demo login from `apps/api/.env`. It works best on a freshly seeded database. If a test fails after you've changed a lot of demo data by hand, reset everything:
  1. `docker compose -f infra/compose.dev.yml down -v`
  2. `docker compose -f infra/compose.dev.yml up -d`
  3. `pnpm setup:db`
- ClamAV needs a few minutes after its first start to load virus signatures. Tests that upload files fail until it's ready. Check with `docker compose -f infra/compose.dev.yml logs clamav`.
- To see API logs while debugging an integration test: `set TEST_LOG_LEVEL=debug` (Command Prompt) or `$env:TEST_LOG_LEVEL="debug"` (PowerShell), then run the tests again.
- The same suites, plus security scanners (CodeQL, Semgrep, gitleaks, `pnpm audit`, Trivy image scan), run automatically on every push in GitHub Actions. See `.github/workflows/ldms-ci.yml`.

---

## 2. Manual acceptance testing

Start the app with `pnpm dev` and open **http://localhost:3000**.

**Signing in:**
- Every demo user has the same password: the `DEMO_PASSWORD=` line in `apps/api/.env`. Open it in Notepad, or run `findstr DEMO_PASSWORD apps\api\.env`.
- For the 6-digit code, run `pnpm demo:code` in a second window. Each code works only once, so wait for the next 30-second window to sign in as another user.
- Use a private/incognito window per user to stay signed in as two people at once.
- Emails the app sends appear in Mailpit: **http://localhost:8025**.

**Demo users:**

| Username | Role |
|---|---|
| `hod` | Head of Legal Department (sees everything, approves) |
| `uh.lit` · `uh.drf` · `uh.cmp` · `uh.awr` | Unit Heads: Litigation · Drafting · Compliance · Awareness |
| `lo.lit1` `lo.lit2` · `lo.drf1` `lo.drf2` · `lo.cmp1` · `lo.awr1` | Legal Officers per unit |
| `pl.lit` · `pl.drf` | Paralegals (intake, registers) |
| `req.fin` · `req.hr` · `req.proc` | Requesters from Finance, HR and Procurement (department portal) |
| `auditor` · `mgmt` | Auditor (audit log) · Management (aggregate dashboard only) |
| `adm.it` | IT admin (users and settings, **no** legal content) |

Tick each scenario when it behaves as described.

### A. Sign-in and security
- [ ] A wrong password shows a generic error that doesn't say whether the username exists.
- [ ] After the password, the app asks for the 6-digit code. Reusing a code that was just accepted is refused.
- [ ] Sign in as `adm.it`: you can manage users, but litigation, drafting and other legal pages are not available.
- [ ] Sign in as `lo.drf1` (drafting) and paste the address of a litigation case (copy it while signed in as `uh.lit`): you get "not found".
- [ ] Leave the app idle for more than 15 minutes, then click something: you're asked to sign in again.

### B. Intake: turning requests into matters (`pl.lit`)
- [ ] Record a new intake, for example a phone request. Then **Convert to matter**, and use **Copy reply** to get the acknowledgement text.
- [ ] Upload an Outlook `.msg` or `.eml` email as an intake: sender, subject and attachments are read automatically.
- [ ] As `req.fin`, submit a request from the department portal. It appears in intake for the Legal team.

### C. Litigation (`uh.lit`, `lo.lit1`, `pl.lit`)
- [ ] `uh.lit`: open a case and **Assign** it to `lo.lit1`. `lo.lit1` gets a notification and an email in Mailpit.
- [ ] `lo.lit1`: mark a hearing as held, then **Enter summary** → **Save summary** with a next hearing date. The next hearing appears on the **Calendar**.
- [ ] Try to close a case handled by an external law firm: the app asks for the firm's performance evaluation first.
- [ ] `pl.lit`: import the litigation register from Excel:
  1. **Upload and read columns**.
  2. Check the column mapping.
  3. **Run dry-run preview**.
  4. **Import**.
  5. Then roll back the import batch.

### D. Drafting (`uh.drf`, `lo.drf1`, `lo.drf2`)
- [ ] Register a drafting request and assign `lo.drf1` as drafter and `lo.drf2` as reviewer.
- [ ] `lo.drf1`: **Start drafting**, upload a draft, **Submit for review**. The drafter **cannot** review their own work.
- [ ] `lo.drf2` reviews, then `uh.drf` approves. Approval needs a FINAL document version.
- [ ] Check the contract repository (expiry and notice dates on the calendar), the power-of-attorney register and the opinions archive search.

### E. Compliance (`lo.cmp1`, `uh.cmp`, `req.fin`)
- [ ] `lo.cmp1`: add a law or regulation, then **Send circular** to Finance.
- [ ] `req.fin`: open the circular and click **I have read this**. The acknowledgement shows for `lo.cmp1`.
- [ ] Periodic checks:
  1. `req.fin` answers a checklist item, uploads evidence and submits.
  2. `lo.cmp1` rates the answer "partially compliant". A finding with a due date is created.
  3. `req.fin` adds an action plan.
  4. `lo.cmp1` closes the finding.

### F. Awareness (`lo.awr1`, `uh.awr`)
- [ ] Create a session. Presenters are notified, and a materials deadline appears 5 business days before the session.
- [ ] **Open QR check-in**, then open the check-in link in an incognito window (no account). Check in with a staff number, then **Send feedback**. Attendance updates.
- [ ] Publish a bulletin or FAQ entry. Everyone can read it.

### G. Dashboards, search, reports
- [ ] `hod`: the HoD dashboard shows open matters by unit, SLA status and overdue items. Global search finds matters and documents.
- [ ] `uh.lit`: the dashboard shows only Litigation.
- [ ] `mgmt`: sees **Management overview** totals only. Restricted matters count as "confidential", with no titles.
- [ ] `hod`: download the monthly management report as Excel and PDF.

### H. Files and records
- [ ] Upload a PDF to a matter: it's scanned, then becomes downloadable.
- [ ] Upload the harmless antivirus test file:
  1. Create a text file containing exactly `X5O!P%@AP[4\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!H+H*`
  2. Save it as `eicar.txt`.
  3. Upload it. It must be **blocked**.
- [ ] Try to upload a `.exe`, or a file renamed to `.pdf` that isn't really a PDF: it's rejected.
- [ ] `auditor`: the audit log shows the actions above, with who did what and when.

**Report problems** with: the username, what you clicked, what you expected, what happened, and a screenshot. If an error message shows a "reference", include it; it points to the server log entry.

---

## 3. Before go-live

Development testing doesn't replace these. See `docs/RUNBOOK.md` and `docs/ASVS-L2-CHECKLIST.md`.
- [ ] User acceptance by each unit, on a staging server with production-like settings.
- [ ] External penetration test against the OWASP ASVS Level 2 checklist.
- [ ] Load test: `infra/perf/k6-load.js`.
- [ ] Backup and restore drill: `infra/backup/` and `scripts/verify-restore.js`.
