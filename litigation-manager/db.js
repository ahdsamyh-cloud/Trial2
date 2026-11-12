'use strict';
// Database layer: schema, password hashing, and demo seed data.
// Uses Node's built-in SQLite (node:sqlite) so the app has zero npm dependencies.

let DatabaseSync;
try {
  ({ DatabaseSync } = require('node:sqlite'));
} catch {
  console.error(`\nThis app needs a newer version of Node.js (you have ${process.version}).`);
  console.error('Please install the current "LTS" version from https://nodejs.org and try again.\n');
  process.exit(1);
}
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const SCHEMA = `
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'attorney' CHECK (role IN ('admin','partner','attorney','paralegal','staff')),
  hourly_rate REAL NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS clients (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'individual',
  contact_person TEXT,
  email TEXT,
  phone TEXT,
  address TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS cases (
  id INTEGER PRIMARY KEY,
  case_number TEXT,
  internal_ref TEXT,
  title TEXT NOT NULL,
  client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL,
  client_role TEXT,
  opposing_party TEXT,
  opposing_counsel TEXT,
  court TEXT,
  jurisdiction TEXT,
  judge TEXT,
  case_type TEXT,
  status TEXT NOT NULL DEFAULT 'intake',
  priority TEXT NOT NULL DEFAULT 'normal',
  lead_attorney_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  filed_date TEXT,
  closed_date TEXT,
  statute_of_limitations TEXT,
  claim_amount REAL,
  fee_arrangement TEXT,
  outcome TEXT,
  description TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS case_team (
  case_id INTEGER NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (case_id, user_id)
);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY,
  case_id INTEGER NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'hearing',
  title TEXT NOT NULL,
  starts_at TEXT NOT NULL,
  location TEXT,
  notes TEXT,
  completed INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY,
  case_id INTEGER REFERENCES cases(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  assignee_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  due_date TEXT,
  status TEXT NOT NULL DEFAULT 'todo',
  priority TEXT NOT NULL DEFAULT 'normal',
  notes TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS notes (
  id INTEGER PRIMARY KEY,
  case_id INTEGER NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS documents (
  id INTEGER PRIMARY KEY,
  case_id INTEGER NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  category TEXT,
  stored_name TEXT NOT NULL,
  mime TEXT,
  size INTEGER,
  uploaded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS time_entries (
  id INTEGER PRIMARY KEY,
  case_id INTEGER NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  work_date TEXT NOT NULL,
  hours REAL NOT NULL,
  rate REAL NOT NULL DEFAULT 0,
  billable INTEGER NOT NULL DEFAULT 1,
  description TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS activity (
  id INTEGER PRIMARY KEY,
  case_id INTEGER REFERENCES cases(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_events_start ON events(starts_at);
CREATE INDEX IF NOT EXISTS idx_events_case ON events(case_id);
CREATE INDEX IF NOT EXISTS idx_tasks_case ON tasks(case_id);
CREATE INDEX IF NOT EXISTS idx_tasks_assignee ON tasks(assignee_id);
CREATE INDEX IF NOT EXISTS idx_time_case ON time_entries(case_id);
CREATE INDEX IF NOT EXISTS idx_activity_case ON activity(case_id);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS contacts (
  id INTEGER PRIMARY KEY,
  case_id INTEGER NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'other',
  organization TEXT,
  email TEXT,
  phone TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS invoices (
  id INTEGER PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  case_id INTEGER NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  issue_date TEXT NOT NULL,
  due_date TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  time_total REAL NOT NULL DEFAULT 0,
  expense_total REAL NOT NULL DEFAULT 0,
  discount REAL NOT NULL DEFAULT 0,
  tax_rate REAL NOT NULL DEFAULT 0,
  tax REAL NOT NULL DEFAULT 0,
  total REAL NOT NULL DEFAULT 0,
  notes TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS expenses (
  id INTEGER PRIMARY KEY,
  case_id INTEGER NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  expense_date TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'other',
  description TEXT,
  amount REAL NOT NULL,
  billable INTEGER NOT NULL DEFAULT 1,
  invoice_id INTEGER REFERENCES invoices(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  payment_date TEXT NOT NULL,
  amount REAL NOT NULL,
  method TEXT,
  reference TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS templates (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  case_type TEXT,
  items TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_contacts_case ON contacts(case_id);
CREATE INDEX IF NOT EXISTS idx_expenses_case ON expenses(case_id);
CREATE INDEX IF NOT EXISTS idx_invoices_case ON invoices(case_id);
`;

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

function verifyPassword(password, stored) {
  const [scheme, salt, hash] = String(stored).split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'hex');
  const actual = crypto.scryptSync(String(password), salt, expected.length);
  return crypto.timingSafeEqual(expected, actual);
}

const DEFAULT_SETTINGS = {
  firm_name: 'Your Law Firm',
  firm_address: '',
  firm_email: '',
  firm_phone: '',
  currency: 'USD',
  tax_rate: '0',
  invoice_prefix: 'INV-',
  payment_terms: '30',
  holidays: '',
};

// Adds columns introduced after the first release so older databases keep working.
function migrate(db) {
  const has = (table, col) => db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === col);
  if (!has('events', 'outcome')) db.exec('ALTER TABLE events ADD COLUMN outcome TEXT');
  if (!has('time_entries', 'invoice_id')) db.exec('ALTER TABLE time_entries ADD COLUMN invoice_id INTEGER REFERENCES invoices(id) ON DELETE SET NULL');
  if (!has('users', 'ical_token')) db.exec('ALTER TABLE users ADD COLUMN ical_token TEXT');
  const ins = db.prepare('INSERT OR IGNORE INTO settings (key,value) VALUES (?,?)');
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) ins.run(k, v);
}

function open(dataDir, { seed = true } = {}) {
  fs.mkdirSync(path.join(dataDir, 'uploads'), { recursive: true });
  const db = new DatabaseSync(path.join(dataDir, 'litigation.db'));
  db.exec(SCHEMA);
  migrate(db);
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM users').get();
  if (n === 0) {
    if (seed) seedDemo(db);
    else {
      db.prepare('INSERT INTO users (name,email,password_hash,role) VALUES (?,?,?,?)')
        .run('Administrator', 'admin@firm.local', hashPassword('admin123'), 'admin');
    }
  }
  return db;
}

// Date helpers for seed data, relative to today so the demo always looks current.
function dayOffset(days, time) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  const s = d.toISOString().slice(0, 10);
  return time ? `${s}T${time}` : s;
}

function seedDemo(db) {
  const ins = (sql, ...p) => Number(db.prepare(sql).run(...p).lastInsertRowid);
  const user = (name, email, pw, role, rate) =>
    ins('INSERT INTO users (name,email,password_hash,role,hourly_rate) VALUES (?,?,?,?,?)',
      name, email, hashPassword(pw), role, rate);

  const admin = user('Administrator', 'admin@firm.local', 'admin123', 'admin', 0);
  const sara = user('Sara Haddad', 'sara@firm.local', 'password', 'partner', 450);
  const omar = user('Omar Nasser', 'omar@firm.local', 'password', 'attorney', 300);
  const lina = user('Lina Farah', 'lina@firm.local', 'password', 'paralegal', 120);

  const client = (name, type, contact, email, phone, address) =>
    ins('INSERT INTO clients (name,type,contact_person,email,phone,address) VALUES (?,?,?,?,?,?)',
      name, type, contact, email, phone, address);
  const acme = client('Acme Logistics Ltd.', 'organization', 'Rami Khoury', 'legal@acme.example', '+1 555 0100', '12 Harbour Rd, Port City');
  const jdoe = client('Jane Doe', 'individual', null, 'jane.doe@example.com', '+1 555 0142', '88 Elm St, Springfield');
  const north = client('Northwind Builders', 'organization', 'Maya Saleh', 'maya@northwind.example', '+1 555 0177', '400 Industrial Ave');

  const kase = (o) => ins(`INSERT INTO cases (case_number,internal_ref,title,client_id,client_role,opposing_party,opposing_counsel,
      court,jurisdiction,judge,case_type,status,priority,lead_attorney_id,filed_date,statute_of_limitations,claim_amount,fee_arrangement,description)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    o.no, o.ref, o.title, o.client, o.role, o.opp, o.oppc, o.court, o.jur, o.judge, o.type, o.status, o.prio,
    o.lead, o.filed, o.sol ?? null, o.claim ?? null, o.fee, o.desc);

  const c1 = kase({ no: 'CV-2026-01482', ref: 'LIT-0001', title: 'Acme Logistics v. Blue Ocean Shipping', client: acme, role: 'plaintiff',
    opp: 'Blue Ocean Shipping Co.', oppc: 'Mercer & Holt LLP', court: 'Commercial Court, Port City', jur: 'State', judge: 'Hon. R. Alvarez',
    type: 'Commercial / Contract', status: 'discovery', prio: 'high', lead: sara, filed: dayOffset(-120), claim: 1250000, fee: 'Hourly',
    desc: 'Breach of a multi-year freight services agreement; claim for unpaid invoices and consequential losses.' });
  const c2 = kase({ no: 'PI-2026-00317', ref: 'LIT-0002', title: 'Doe v. Metro Transit Authority', client: jdoe, role: 'plaintiff',
    opp: 'Metro Transit Authority', oppc: 'City Attorney\'s Office', court: 'District Court, Springfield', jur: 'State', judge: 'Hon. K. Chen',
    type: 'Personal Injury', status: 'active', prio: 'normal', lead: omar, filed: dayOffset(-45), sol: dayOffset(300), claim: 400000, fee: 'Contingency (33%)',
    desc: 'Bus collision injury claim. Medical records requested; awaiting independent medical examination.' });
  const c3 = kase({ no: '', ref: 'LIT-0003', title: 'Northwind Builders – Subcontractor Lien Dispute', client: north, role: 'defendant',
    opp: 'Steelframe Partners', oppc: 'Ortiz Legal Group', court: '', jur: 'State', judge: '',
    type: 'Construction', status: 'intake', prio: 'urgent', lead: sara, filed: null, claim: 210000, fee: 'Fixed fee',
    desc: 'Threatened mechanic\'s lien on the Riverside project. Response to demand letter due shortly.' });
  const c4 = kase({ no: 'CV-2025-09921', ref: 'LIT-0004', title: 'Acme Logistics adv. Former Employee (Wrongful Dismissal)', client: acme, role: 'defendant',
    opp: 'Daniel Price', oppc: 'Price Legal', court: 'Labour Court, Port City', jur: 'State', judge: 'Hon. M. Ibrahim',
    type: 'Employment', status: 'settled', prio: 'low', lead: omar, filed: dayOffset(-400), claim: 85000, fee: 'Hourly',
    desc: 'Settled at mediation.' });
  db.prepare("UPDATE cases SET closed_date=?, outcome='Settled at mediation for $22,500, no admission of liability.' WHERE id=?").run(dayOffset(-30), c4);

  const team = db.prepare('INSERT INTO case_team (case_id,user_id) VALUES (?,?)');
  [[c1, omar], [c1, lina], [c2, lina], [c3, omar], [c4, lina]].forEach(([c, u]) => team.run(c, u));

  const ev = (c, kind, title, at, loc, done = 0) =>
    ins('INSERT INTO events (case_id,kind,title,starts_at,location,completed,created_by) VALUES (?,?,?,?,?,?,?)', c, kind, title, at, loc, done, admin);
  ev(c1, 'deposition', 'Deposition of Blue Ocean CFO', dayOffset(3, '10:00'), 'Mercer & Holt offices, Room 4');
  ev(c1, 'deadline', 'Expert disclosures due', dayOffset(9, '17:00'), '');
  ev(c1, 'hearing', 'Case management conference', dayOffset(21, '09:30'), 'Courtroom 6B');
  ev(c2, 'hearing', 'Motion to compel hearing', dayOffset(6, '11:00'), 'Courtroom 2');
  ev(c2, 'filing', 'File amended complaint', dayOffset(1, '17:00'), 'E-filing');
  ev(c3, 'deadline', 'Respond to lien demand letter', dayOffset(2, '12:00'), '');
  ev(c1, 'hearing', 'Initial scheduling hearing', dayOffset(-60, '09:00'), 'Courtroom 6B', 1);
  ev(c4, 'meeting', 'Mediation session', dayOffset(-35, '10:00'), 'ADR Center', 1);

  const task = (c, title, who, due, status, prio) =>
    ins('INSERT INTO tasks (case_id,title,assignee_id,due_date,status,priority,created_by) VALUES (?,?,?,?,?,?,?)', c, title, who, due, status, prio, admin);
  task(c1, 'Prepare deposition outline for CFO', sara, dayOffset(2), 'in_progress', 'high');
  task(c1, 'Review document production batch #3', lina, dayOffset(-1), 'todo', 'normal');
  task(c1, 'Engage damages expert', omar, dayOffset(5), 'todo', 'high');
  task(c2, 'Collect medical records from St. Mary\'s', lina, dayOffset(4), 'todo', 'normal');
  task(c2, 'Draft amended complaint', omar, dayOffset(0), 'in_progress', 'urgent');
  task(c3, 'Run conflict check on Steelframe Partners', lina, dayOffset(-2), 'done', 'normal');
  task(c3, 'Draft response to demand letter', sara, dayOffset(1), 'todo', 'urgent');

  const note = (c, u, body) => ins('INSERT INTO notes (case_id,user_id,body) VALUES (?,?,?)', c, u, body);
  note(c1, sara, 'Client confirmed they hold signed copies of all amendments to the freight agreement. Lina to scan and upload.');
  note(c2, omar, 'Spoke with client — still in physiotherapy. Do not schedule IME before next month.');
  note(c3, sara, 'Client wants to explore early settlement if lien amount can be reduced below $150k.');

  const time = (c, u, d, h, rate, desc) =>
    ins('INSERT INTO time_entries (case_id,user_id,work_date,hours,rate,description) VALUES (?,?,?,?,?,?)', c, u, d, h, rate, desc);
  time(c1, sara, dayOffset(-5), 2.5, 450, 'Strategy meeting with client');
  time(c1, omar, dayOffset(-4), 4, 300, 'Drafted interrogatories');
  time(c1, lina, dayOffset(-3), 6, 120, 'Document review and coding');
  time(c2, omar, dayOffset(-2), 1.5, 300, 'Client call; reviewed police report');
  time(c3, sara, dayOffset(-1), 1, 450, 'Initial review of lien demand');
  time(c4, omar, dayOffset(-35), 7, 300, 'Attended mediation');

  const act = db.prepare('INSERT INTO activity (case_id,user_id,action) VALUES (?,?,?)');
  [c1, c2, c3, c4].forEach((c) => act.run(c, admin, 'Matter opened'));

  db.prepare("UPDATE settings SET value=? WHERE key='firm_name'").run('Haddad & Partners');
  db.prepare("UPDATE settings SET value=? WHERE key='firm_address'").run('Suite 900, 1 Justice Plaza, Port City');
  db.prepare("UPDATE settings SET value=? WHERE key='firm_email'").run('billing@firm.local');

  const contact = (c, name, role, org, email, phone) =>
    ins('INSERT INTO contacts (case_id,name,role,organization,email,phone) VALUES (?,?,?,?,?,?)', c, name, role, org, email, phone);
  contact(c1, 'Dr. Helen Brooks', 'expert', 'Brooks Forensic Accounting', 'hbrooks@example.com', '+1 555 0199');
  contact(c1, 'Peter Mercer', 'opposing_counsel', 'Mercer & Holt LLP', 'pmercer@mercerholt.example', '+1 555 0123');
  contact(c1, 'Anna Lee', 'witness', 'Acme Logistics Ltd.', 'anna.lee@acme.example', '');
  contact(c2, 'Officer T. Grant', 'witness', 'Springfield Police Dept.', '', '+1 555 0150');
  contact(c2, 'Claims Desk', 'insurer', 'Metro Mutual Insurance', 'claims@metromutual.example', '+1 555 0160');

  const expense = (c, u, d, cat, desc, amt) =>
    ins('INSERT INTO expenses (case_id,user_id,expense_date,category,description,amount) VALUES (?,?,?,?,?,?)', c, u, d, cat, desc, amt);
  expense(c1, lina, dayOffset(-20), 'filing_fees', 'Court filing fee — statement of claim', 350);
  expense(c1, omar, dayOffset(-6), 'courier', 'Courier of document production to opposing counsel', 45);
  expense(c2, omar, dayOffset(-10), 'expert_fees', 'Medical records retrieval fee', 120);
  const e4 = expense(c4, omar, dayOffset(-36), 'court_fees', 'Mediation centre fee (50% share)', 600);

  // A paid invoice for the settled matter.
  const t4 = db.prepare('SELECT id, hours*rate AS v FROM time_entries WHERE case_id=?').all(c4);
  const timeTotal = t4.reduce((a, r) => a + r.v, 0);
  const inv = ins(`INSERT INTO invoices (number,case_id,issue_date,due_date,status,time_total,expense_total,tax,total,created_by)
    VALUES (?,?,?,?,?,?,?,?,?,?)`, 'INV-0001', c4, dayOffset(-30), dayOffset(0), 'paid', timeTotal, 600, 0, timeTotal + 600, sara);
  for (const r of t4) db.prepare('UPDATE time_entries SET invoice_id=? WHERE id=?').run(inv, r.id);
  db.prepare('UPDATE expenses SET invoice_id=? WHERE id=?').run(inv, e4);
  ins('INSERT INTO payments (invoice_id,payment_date,amount,method,reference,created_by) VALUES (?,?,?,?,?,?)',
    inv, dayOffset(-12), timeTotal + 600, 'bank_transfer', 'ACME-TT-88412', sara);

  const tpl = (name, type, items) => ins('INSERT INTO templates (name,case_type,items) VALUES (?,?,?)', name, type, JSON.stringify(items));
  tpl('New litigation matter (intake)', null, [
    { title: 'Run conflict check', days: 0, priority: 'high' },
    { title: 'Send engagement letter and fee agreement', days: 2, priority: 'normal' },
    { title: 'Calendar limitation deadline', days: 2, priority: 'high' },
    { title: 'Collect key documents from client', days: 7, priority: 'normal' },
    { title: 'Prepare case assessment memo', days: 14, priority: 'normal' },
  ]);
  tpl('Discovery phase', null, [
    { title: 'Serve initial disclosures', days: 14, priority: 'high' },
    { title: 'Draft interrogatories and document requests', days: 21, priority: 'normal' },
    { title: 'Prepare client document production', days: 30, priority: 'normal' },
    { title: 'Schedule depositions', days: 45, priority: 'normal' },
  ]);
  tpl('Trial preparation', null, [
    { title: 'Finalise witness list', days: 0, priority: 'high' },
    { title: 'Prepare exhibit binders', days: 7, priority: 'high' },
    { title: 'Draft motions in limine', days: 10, priority: 'normal' },
    { title: 'Prepare opening statement', days: 14, priority: 'normal' },
    { title: 'Witness preparation sessions', days: 18, priority: 'high' },
  ]);
}

module.exports = { open, hashPassword, verifyPassword, DEFAULT_SETTINGS };
