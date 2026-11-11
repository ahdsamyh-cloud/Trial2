# Litigation Manager

A web app for a law firm to run its litigation practice: matters, clients,
hearings and deadlines, tasks, documents, case notes, time/billing, conflict
checks and reports, with sign-in and roles.

Zero npm dependencies. It uses Node's built-in HTTP server and built-in SQLite
(`node:sqlite`), plus a plain-JavaScript single-page front end. It needs no build step.

## Quick start

Requires **Node.js 22.5 or newer**.

```bash
cd litigation-manager
npm start            # http://localhost:3000
```

The first start creates `data/litigation.db` and loads demo data:

| Email              | Password   | Role      |
|--------------------|------------|-----------|
| admin@firm.local   | admin123   | Admin     |
| sara@firm.local    | password   | Partner   |
| omar@firm.local    | password   | Attorney  |
| lina@firm.local    | password   | Paralegal |

To start with an empty database, use `SEED=0 npm start`. It creates only
`admin@firm.local` / `admin123`. **Change that password after your first
sign-in** (Account → Change password).

Environment variables: `PORT` (default 3000), `HOST` (default 0.0.0.0),
`DATA_DIR` (default `./data`; holds the database and uploaded files),
`SEED` (`0` turns off demo data).

## Features

- **Dashboard**: open matters, upcoming hearings and deadlines, overdue tasks,
  past events not marked done, limitation (statute of limitations) watch list,
  hours this month and recent activity.
- **Cases / matters**: court number and internal reference (auto `LIT-0001`),
  client and client role, opposing party and counsel, court, judge,
  jurisdiction, practice area, status pipeline (intake → pleadings → discovery
  → mediation → trial → appeal → settled/judgment/closed), priority, lead
  attorney and case team, filed, closed and limitation dates, amount in
  dispute, fee arrangement, summary and outcome. You can search, filter and
  export to CSV.
- **Per-matter tabs**:
  - Hearings and deadlines
  - Tasks
  - Document upload and download (up to 25 MB per file, categorised)
  - Notes
  - Time and billing, with totals
  - Activity: a full audit trail of who changed what
- **Calendar**: a month grid plus agenda covering all matters, with a "my
  matters only" filter. Click a day to schedule something.
- **Tasks**: firm-wide or "assigned to me", with due-date warnings.
- **Clients**: contact details and each client's matters.
- **Time**: entries across matters, filtered by timekeeper and date range.
  The rate defaults to the timekeeper's hourly rate.
- **Conflict check**: searches a name against clients, adverse parties,
  opposing counsel and matter titles.
- **Reports**: matters by status, practice area and attorney, plus hours and
  billable value by timekeeper and by matter. Pages are printable.
- **Users** (admin only): add users, set roles and rates, deactivate
  accounts, reset passwords.

## Roles

All signed-in users can create and edit matters, clients, events, tasks,
notes, documents and time. Only **partners and admins** can delete matters
and clients. Only **admins** can manage users. Users can delete their own
notes; partners and admins can delete anyone's.

## Security notes

- Passwords are hashed with scrypt. Sessions use HttpOnly, SameSite=Strict
  cookies that expire after 12 hours.
- Every SQL query is parameterised. All output is HTML-escaped. The pages set
  a strict Content-Security-Policy.
- The server rejects cross-origin write requests.
- Uploaded files are stored under random names and served only as
  downloads, and only to signed-in users.
- CSV export guards against spreadsheet formula injection.
- For real use, run the app behind HTTPS (for example a reverse proxy such as
  nginx or Caddy) and back up `DATA_DIR`.

## Tests

```bash
npm test
```

The tests cover authentication, role permissions, cross-origin blocking,
and the full lifecycle of a matter (events, tasks, notes, time, document
upload and download, closing a matter, audit log, CSV export and deletion).

## Layout

```
server.js        HTTP server, JSON API, auth, static files
db.js            SQLite schema, password hashing, demo seed data
public/          index.html, app.js (SPA), styles.css
test/            API tests (node:test)
```
