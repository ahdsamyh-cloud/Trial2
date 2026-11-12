'use strict';
// Litigation Manager — HTTP server and JSON API. No external dependencies.

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const os = require('node:os');
const { open, hashPassword, verifyPassword, DEFAULT_SETTINGS } = require('./db');

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
const PUBLIC_DIR = path.join(__dirname, 'public');
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const MAX_JSON = 1024 * 1024;
const MAX_UPLOAD = 25 * 1024 * 1024;

const ENUMS = {
  role: ['admin', 'partner', 'attorney', 'paralegal', 'staff'],
  client_type: ['individual', 'organization'],
  client_role: ['plaintiff', 'defendant', 'petitioner', 'respondent', 'appellant', 'appellee', 'claimant', 'third_party', 'other'],
  case_status: ['intake', 'active', 'pleadings', 'discovery', 'mediation', 'trial', 'appeal', 'settled', 'judgment', 'closed'],
  priority: ['low', 'normal', 'high', 'urgent'],
  event_kind: ['hearing', 'deadline', 'filing', 'deposition', 'trial', 'meeting', 'other'],
  task_status: ['todo', 'in_progress', 'done'],
  doc_category: ['pleading', 'motion', 'evidence', 'correspondence', 'contract', 'order', 'discovery', 'other'],
  contact_role: ['witness', 'expert', 'opposing_counsel', 'co_counsel', 'court_clerk', 'insurer', 'mediator', 'other'],
  expense_category: ['court_fees', 'filing_fees', 'expert_fees', 'travel', 'copying', 'courier', 'translation', 'other'],
  invoice_status: ['draft', 'sent', 'paid', 'void'],
  payment_method: ['bank_transfer', 'cash', 'check', 'card', 'other'],
};
const BILLING_ROLES = ['admin', 'partner', 'attorney'];
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const CLOSED_STATUSES = ['settled', 'judgment', 'closed'];

// ---------------------------------------------------------------- helpers

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const bad = (msg) => new HttpError(400, msg);

function send(res, status, body, headers = {}) {
  const isBuf = Buffer.isBuffer(body);
  const payload = isBuf || typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': isBuf || typeof body === 'string' ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    ...headers,
  });
  res.end(payload);
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new HttpError(413, 'Request body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readJson(req) {
  const buf = await readBody(req, MAX_JSON);
  if (!buf.length) return {};
  try { return JSON.parse(buf.toString('utf8')); } catch { throw bad('Invalid JSON'); }
}

function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

const label = (s) => String(s || '').replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
const today = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};
const addDays = (s, n) => {
  const d = new Date(`${s}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

// Field coercion/validation. spec: { field: type } where type is
// 'text' | 'int' | 'real' | 'bool' | 'date' | 'datetime' | ['enum', key]
function clean(input, spec, required = [], partial = false) {
  const out = {};
  for (const [key, type] of Object.entries(spec)) {
    if (!(key in input)) continue;
    let v = input[key];
    if (v === '' || v === undefined) v = null;
    if (v !== null) {
      if (Array.isArray(type)) {
        if (!ENUMS[type[1]].includes(v)) throw bad(`Invalid value for ${key}`);
      } else if (type === 'int') {
        v = Number(v); if (!Number.isInteger(v)) throw bad(`${key} must be an integer`);
      } else if (type === 'real') {
        v = Number(v); if (!Number.isFinite(v)) throw bad(`${key} must be a number`);
      } else if (type === 'bool') {
        v = v === true || v === 1 || v === '1' || v === 'true' ? 1 : 0;
      } else if (type === 'date') {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) throw bad(`${key} must be a date (YYYY-MM-DD)`);
      } else if (type === 'datetime') {
        if (!/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/.test(v)) throw bad(`${key} must be a date/time`);
      } else {
        v = String(v).trim().slice(0, 20000);
        if (v === '') v = null;
      }
    }
    out[key] = v;
  }
  if (!partial) {
    for (const r of required) if (out[r] === null || out[r] === undefined) throw bad(`${r.replace(/_id$/, '').replace(/_/g, ' ')} is required`);
  } else {
    for (const r of required) if (r in out && out[r] === null) throw bad(`${r.replace(/_id$/, '').replace(/_/g, ' ')} is required`);
  }
  return out;
}

// ---------------------------------------------------------------- app

function createApp({ dataDir = DATA_DIR, seed = true } = {}) {
  const db = open(dataDir, { seed });
  const uploadDir = path.join(dataDir, 'uploads');

  const all = (sql, ...p) => db.prepare(sql).all(...p);
  const get = (sql, ...p) => db.prepare(sql).get(...p);
  const run = (sql, ...p) => db.prepare(sql).run(...p);

  function insert(table, obj) {
    const keys = Object.keys(obj).filter((k) => obj[k] !== undefined);
    const r = run(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`, ...keys.map((k) => obj[k]));
    return Number(r.lastInsertRowid);
  }
  function update(table, id, obj) {
    const keys = Object.keys(obj);
    if (!keys.length) return;
    run(`UPDATE ${table} SET ${keys.map((k) => `${k}=?`).join(',')} WHERE id=?`, ...keys.map((k) => obj[k]), id);
  }
  function mustGet(table, id) {
    const row = get(`SELECT * FROM ${table} WHERE id=?`, id);
    if (!row) throw new HttpError(404, 'Not found');
    return row;
  }
  function log(caseId, userId, action) {
    if (caseId) run('INSERT INTO activity (case_id,user_id,action) VALUES (?,?,?)', caseId, userId, action);
  }
  const touchCase = (id) => id && run("UPDATE cases SET updated_at=datetime('now') WHERE id=?", id);

  // ---------------------------------------------------------- sessions
  function currentUser(req) {
    const token = parseCookies(req.headers.cookie).sid;
    if (!token) return null;
    const row = get(`SELECT u.id,u.name,u.email,u.role,u.hourly_rate,u.active,s.expires_at FROM sessions s
      JOIN users u ON u.id=s.user_id WHERE s.token=?`, token);
    if (!row || row.expires_at < Date.now() || !row.active) return null;
    delete row.expires_at;
    return row;
  }
  const requireRole = (user, ...roles) => {
    if (!roles.includes(user.role)) throw new HttpError(403, 'You do not have permission to do that');
  };
  const isManager = (u) => u.role === 'admin' || u.role === 'partner';

  // ---------------------------------------------------------- specs
  const SPEC = {
    client: { name: 'text', type: ['enum', 'client_type'], contact_person: 'text', email: 'text', phone: 'text', address: 'text', notes: 'text' },
    case: {
      case_number: 'text', internal_ref: 'text', title: 'text', client_id: 'int', client_role: ['enum', 'client_role'],
      opposing_party: 'text', opposing_counsel: 'text', court: 'text', jurisdiction: 'text', judge: 'text', case_type: 'text',
      status: ['enum', 'case_status'], priority: ['enum', 'priority'], lead_attorney_id: 'int', filed_date: 'date',
      closed_date: 'date', statute_of_limitations: 'date', claim_amount: 'real', fee_arrangement: 'text', outcome: 'text', description: 'text',
    },
    event: { case_id: 'int', kind: ['enum', 'event_kind'], title: 'text', starts_at: 'datetime', location: 'text', notes: 'text', completed: 'bool', outcome: 'text' },
    contact: { case_id: 'int', name: 'text', role: ['enum', 'contact_role'], organization: 'text', email: 'text', phone: 'text', notes: 'text' },
    expense: { case_id: 'int', user_id: 'int', expense_date: 'date', category: ['enum', 'expense_category'], description: 'text', amount: 'real', billable: 'bool' },
    task: { case_id: 'int', title: 'text', assignee_id: 'int', due_date: 'date', status: ['enum', 'task_status'], priority: ['enum', 'priority'], notes: 'text' },
    time: { case_id: 'int', user_id: 'int', work_date: 'date', hours: 'real', rate: 'real', billable: 'bool', description: 'text' },
    user: { name: 'text', email: 'text', role: ['enum', 'role'], hourly_rate: 'real', active: 'bool' },
  };

  const CASE_LIST_SQL = `SELECT c.*, cl.name AS client_name, u.name AS lead_attorney_name,
      (SELECT MIN(e.starts_at) FROM events e WHERE e.case_id=c.id AND e.completed=0 AND e.starts_at>=?) AS next_event,
      (SELECT COUNT(*) FROM tasks t WHERE t.case_id=c.id AND t.status!='done') AS open_tasks
    FROM cases c LEFT JOIN clients cl ON cl.id=c.client_id LEFT JOIN users u ON u.id=c.lead_attorney_id`;
  const EVENT_SQL = `SELECT e.*, c.title AS case_title, c.case_number, c.internal_ref FROM events e JOIN cases c ON c.id=e.case_id`;
  const TASK_SQL = `SELECT t.*, c.title AS case_title, c.internal_ref, u.name AS assignee_name FROM tasks t
    LEFT JOIN cases c ON c.id=t.case_id LEFT JOIN users u ON u.id=t.assignee_id`;
  const TIME_SQL = `SELECT te.*, u.name AS user_name, c.title AS case_title, c.internal_ref FROM time_entries te
    LEFT JOIN users u ON u.id=te.user_id JOIN cases c ON c.id=te.case_id`;

  function listCases(q) {
    const where = []; const p = [today()];
    if (q.q) {
      where.push(`(c.title LIKE ? OR c.case_number LIKE ? OR c.internal_ref LIKE ? OR c.opposing_party LIKE ? OR cl.name LIKE ? OR c.court LIKE ? OR c.judge LIKE ?)`);
      const like = `%${q.q}%`; p.push(like, like, like, like, like, like, like);
    }
    if (q.status === 'open') where.push(`c.status NOT IN (${CLOSED_STATUSES.map(() => '?').join(',')})`), p.push(...CLOSED_STATUSES);
    else if (q.status === 'closed') where.push(`c.status IN (${CLOSED_STATUSES.map(() => '?').join(',')})`), p.push(...CLOSED_STATUSES);
    else if (q.status) where.push('c.status=?'), p.push(q.status);
    if (q.attorney) where.push('(c.lead_attorney_id=? OR c.id IN (SELECT case_id FROM case_team WHERE user_id=?))'), p.push(+q.attorney, +q.attorney);
    if (q.client_id) where.push('c.client_id=?'), p.push(+q.client_id);
    if (q.priority) where.push('c.priority=?'), p.push(q.priority);
    if (q.case_type) where.push('c.case_type=?'), p.push(q.case_type);
    const sql = `${CASE_LIST_SQL}${where.length ? ` WHERE ${where.join(' AND ')}` : ''}
      ORDER BY CASE c.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END, c.updated_at DESC`;
    return all(sql, ...p);
  }

  function caseDetail(id) {
    const c = get(`${CASE_LIST_SQL} WHERE c.id=?`, today(), id);
    if (!c) throw new HttpError(404, 'Case not found');
    c.client = c.client_id ? get('SELECT * FROM clients WHERE id=?', c.client_id) : null;
    c.team = all('SELECT u.id,u.name,u.role FROM case_team ct JOIN users u ON u.id=ct.user_id WHERE ct.case_id=? ORDER BY u.name', id);
    c.totals = get(`SELECT COALESCE(SUM(hours),0) AS hours, COALESCE(SUM(CASE WHEN billable=1 THEN hours*rate END),0) AS billable_value
      FROM time_entries WHERE case_id=?`, id);
    c.totals.expenses = get('SELECT COALESCE(SUM(amount),0) n FROM expenses WHERE case_id=?', id).n;
    c.totals.unbilled = unbilled(id).total;
    Object.assign(c.totals, get(`SELECT COALESCE(SUM(total),0) AS invoiced,
      COALESCE(SUM((SELECT COALESCE(SUM(amount),0) FROM payments p WHERE p.invoice_id=i.id)),0) AS paid
      FROM invoices i WHERE case_id=? AND status!='void'`, id));
    c.counts = {
      events: get('SELECT COUNT(*) n FROM events WHERE case_id=?', id).n,
      tasks: get("SELECT COUNT(*) n FROM tasks WHERE case_id=? AND status!='done'", id).n,
      documents: get('SELECT COUNT(*) n FROM documents WHERE case_id=?', id).n,
      notes: get('SELECT COUNT(*) n FROM notes WHERE case_id=?', id).n,
      contacts: get('SELECT COUNT(*) n FROM contacts WHERE case_id=?', id).n,
    };
    return c;
  }

  function unbilled(caseId, upTo = '9999-12-31') {
    const time = all(`SELECT id, round(hours*rate,2) AS v FROM time_entries WHERE case_id=? AND billable=1 AND invoice_id IS NULL AND work_date<=?`, caseId, upTo);
    const exp = all(`SELECT id, amount AS v FROM expenses WHERE case_id=? AND billable=1 AND invoice_id IS NULL AND expense_date<=?`, caseId, upTo);
    const timeTotal = round2(time.reduce((a, r) => a + r.v, 0));
    const expTotal = round2(exp.reduce((a, r) => a + r.v, 0));
    return { time, exp, time_total: timeTotal, expense_total: expTotal, total: round2(timeTotal + expTotal) };
  }

  const settings = () => Object.fromEntries(all('SELECT key,value FROM settings').map((r) => [r.key, r.value]));

  // Which matters a user works on (lead or team member).
  const MY_CASES = '(c.lead_attorney_id=? OR c.id IN (SELECT case_id FROM case_team WHERE user_id=?))';

  function setTeam(caseId, ids) {
    if (!Array.isArray(ids)) return;
    run('DELETE FROM case_team WHERE case_id=?', caseId);
    const stmt = db.prepare('INSERT OR IGNORE INTO case_team (case_id,user_id) VALUES (?,?)');
    for (const uid of ids) if (Number.isInteger(+uid) && get('SELECT 1 FROM users WHERE id=?', +uid)) stmt.run(caseId, +uid);
  }

  function checkRefs(obj) {
    if (obj.case_id != null && !get('SELECT 1 FROM cases WHERE id=?', obj.case_id)) throw bad('Case does not exist');
    if (obj.client_id != null && !get('SELECT 1 FROM clients WHERE id=?', obj.client_id)) throw bad('Client does not exist');
    for (const k of ['lead_attorney_id', 'assignee_id', 'user_id'])
      if (obj[k] != null && !get('SELECT 1 FROM users WHERE id=?', obj[k])) throw bad('User does not exist');
  }

  // ---------------------------------------------------------- routes
  const routes = [];
  const route = (method, pattern, handler, opts = {}) => {
    const keys = [];
    const re = new RegExp(`^${pattern.replace(/\./g, '\\.').replace(/:(\w+)/g, (_, k) => { keys.push(k); return k === 'token' ? '([a-f0-9]{32,64})' : '(\\d+)'; })}$`);
    routes.push({ method, re, keys, handler, auth: opts.auth !== false });
  };

  // Auth
  route('POST', '/api/login', async ({ req, res }) => {
    const { email, password } = await readJson(req);
    const u = get('SELECT * FROM users WHERE email=?', String(email || '').trim());
    if (!u || !u.active || !verifyPassword(password || '', u.password_hash)) throw new HttpError(401, 'Invalid email or password');
    const token = crypto.randomBytes(32).toString('hex');
    run('DELETE FROM sessions WHERE expires_at<?', Date.now());
    run('INSERT INTO sessions (token,user_id,expires_at) VALUES (?,?,?)', token, u.id, Date.now() + SESSION_TTL_MS);
    const secure = req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
    res.setHeader('Set-Cookie', `sid=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL_MS / 1000}${secure}`);
    return { id: u.id, name: u.name, email: u.email, role: u.role, hourly_rate: u.hourly_rate };
  }, { auth: false });

  route('POST', '/api/logout', ({ req, res }) => {
    const token = parseCookies(req.headers.cookie).sid;
    if (token) run('DELETE FROM sessions WHERE token=?', token);
    res.setHeader('Set-Cookie', 'sid=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
    return { ok: true };
  }, { auth: false });

  route('GET', '/api/me', ({ user }) => ({ ...user, enums: ENUMS, closed_statuses: CLOSED_STATUSES }));

  route('PUT', '/api/me/password', async ({ req, user }) => {
    const { current, next } = await readJson(req);
    const row = get('SELECT password_hash FROM users WHERE id=?', user.id);
    if (!verifyPassword(current || '', row.password_hash)) throw bad('Current password is incorrect');
    if (!next || String(next).length < 8) throw bad('New password must be at least 8 characters');
    run('UPDATE users SET password_hash=? WHERE id=?', hashPassword(String(next)), user.id);
    return { ok: true };
  });

  // Users
  route('GET', '/api/users', () => all('SELECT id,name,email,role,hourly_rate,active,created_at FROM users ORDER BY active DESC, name'));
  route('POST', '/api/users', async ({ req, user }) => {
    requireRole(user, 'admin');
    const body = await readJson(req);
    const obj = clean(body, SPEC.user, ['name', 'email', 'role']);
    if (!body.password || String(body.password).length < 8) throw bad('Password must be at least 8 characters');
    if (get('SELECT 1 FROM users WHERE email=?', obj.email)) throw bad('A user with that email already exists');
    obj.password_hash = hashPassword(String(body.password));
    return { id: insert('users', obj) };
  });
  route('PUT', '/api/users/:id', async ({ req, user, params }) => {
    requireRole(user, 'admin');
    mustGet('users', params.id);
    const body = await readJson(req);
    const obj = clean(body, SPEC.user, ['name', 'email', 'role'], true);
    if (obj.email && get('SELECT 1 FROM users WHERE email=? AND id!=?', obj.email, params.id)) throw bad('A user with that email already exists');
    if (params.id === user.id && (obj.active === 0 || (obj.role && obj.role !== 'admin'))) throw bad('You cannot deactivate or demote yourself');
    if (body.password) {
      if (String(body.password).length < 8) throw bad('Password must be at least 8 characters');
      obj.password_hash = hashPassword(String(body.password));
      run('DELETE FROM sessions WHERE user_id=?', params.id);
    }
    if (obj.active === 0) run('DELETE FROM sessions WHERE user_id=?', params.id);
    update('users', params.id, obj);
    return { ok: true };
  });

  // Clients
  route('GET', '/api/clients', ({ query }) => {
    const p = []; let where = '';
    if (query.q) { where = 'WHERE cl.name LIKE ? OR cl.contact_person LIKE ? OR cl.email LIKE ?'; p.push(`%${query.q}%`, `%${query.q}%`, `%${query.q}%`); }
    return all(`SELECT cl.*, (SELECT COUNT(*) FROM cases c WHERE c.client_id=cl.id) AS case_count,
      (SELECT COUNT(*) FROM cases c WHERE c.client_id=cl.id AND c.status NOT IN ('settled','judgment','closed')) AS open_cases
      FROM clients cl ${where} ORDER BY cl.name`, ...p);
  });
  route('GET', '/api/clients/:id', ({ params }) => {
    const c = mustGet('clients', params.id);
    c.cases = listCases({ client_id: params.id });
    return c;
  });
  route('POST', '/api/clients', async ({ req }) => ({ id: insert('clients', clean(await readJson(req), SPEC.client, ['name'])) }));
  route('PUT', '/api/clients/:id', async ({ req, params }) => {
    mustGet('clients', params.id);
    update('clients', params.id, clean(await readJson(req), SPEC.client, ['name'], true));
    return { ok: true };
  });
  route('DELETE', '/api/clients/:id', ({ params, user }) => {
    if (!isManager(user)) throw new HttpError(403, 'Only partners or admins can delete clients');
    mustGet('clients', params.id);
    if (get('SELECT 1 FROM cases WHERE client_id=?', params.id)) throw bad('This client has cases. Reassign or delete them first.');
    run('DELETE FROM clients WHERE id=?', params.id);
    return { ok: true };
  });

  // Cases
  route('GET', '/api/cases', ({ query }) => listCases(query));
  route('GET', '/api/cases/:id', ({ params }) => caseDetail(params.id));
  route('POST', '/api/cases', async ({ req, user }) => {
    const body = await readJson(req);
    const obj = clean(body, SPEC.case, ['title']);
    checkRefs(obj);
    if (!obj.internal_ref) {
      const n = get('SELECT COALESCE(MAX(id),0)+1 AS n FROM cases').n;
      obj.internal_ref = `LIT-${String(n).padStart(4, '0')}`;
    }
    const id = insert('cases', obj);
    setTeam(id, body.team);
    log(id, user.id, 'Matter opened');
    return { id };
  });
  route('PUT', '/api/cases/:id', async ({ req, user, params }) => {
    const prev = mustGet('cases', params.id);
    const body = await readJson(req);
    const obj = clean(body, SPEC.case, ['title'], true);
    checkRefs(obj);
    if (obj.status && obj.status !== prev.status) {
      log(params.id, user.id, `Status changed: ${prev.status} → ${obj.status}`);
      if (CLOSED_STATUSES.includes(obj.status) && !prev.closed_date && !('closed_date' in obj)) obj.closed_date = today();
    } else {
      log(params.id, user.id, 'Matter details updated');
    }
    obj.updated_at = new Date().toISOString().replace('T', ' ').slice(0, 19);
    update('cases', params.id, obj);
    setTeam(params.id, body.team);
    return { ok: true };
  });
  route('DELETE', '/api/cases/:id', ({ params, user }) => {
    if (!isManager(user)) throw new HttpError(403, 'Only partners or admins can delete cases');
    mustGet('cases', params.id);
    for (const d of all('SELECT stored_name FROM documents WHERE case_id=?', params.id)) fs.rm(path.join(uploadDir, d.stored_name), { force: true }, () => {});
    run('DELETE FROM cases WHERE id=?', params.id);
    return { ok: true };
  });

  // Events (hearings, deadlines, ...)
  route('GET', '/api/events', ({ query }) => {
    const where = []; const p = [];
    if (query.case_id) where.push('e.case_id=?'), p.push(+query.case_id);
    if (query.from) where.push('e.starts_at>=?'), p.push(query.from);
    if (query.to) where.push('e.starts_at<?'), p.push(query.to);
    if (query.open) where.push('e.completed=0');
    if (query.kind) where.push('e.kind=?'), p.push(query.kind);
    if (query.attorney) where.push('(c.lead_attorney_id=? OR c.id IN (SELECT case_id FROM case_team WHERE user_id=?))'), p.push(+query.attorney, +query.attorney);
    return all(`${EVENT_SQL}${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY e.starts_at`, ...p);
  });
  const crudCaseChild = (name, table, spec, required, label) => {
    route('POST', `/api/${name}`, async ({ req, user }) => {
      const obj = clean(await readJson(req), spec, required);
      checkRefs(obj);
      if (table === 'time_entries') {
        if (obj.user_id == null) obj.user_id = user.id;
        if (obj.rate == null) obj.rate = get('SELECT hourly_rate FROM users WHERE id=?', obj.user_id).hourly_rate;
      } else if (table === 'expenses') {
        if (obj.user_id == null) obj.user_id = user.id;
      } else if (table !== 'contacts') obj.created_by = user.id;
      const id = insert(table, obj);
      log(obj.case_id, user.id, `${label} added: ${obj.title || obj.name || obj.description || (obj.hours != null ? `${obj.hours}h` : '')}`);
      touchCase(obj.case_id);
      return { id };
    });
    route('PUT', `/api/${name}/:id`, async ({ req, user, params }) => {
      const prev = mustGet(table, params.id);
      if (prev.invoice_id) throw bad('This entry is on an invoice. Void or delete the invoice first to change it.');
      const obj = clean(await readJson(req), spec, required, true);
      checkRefs(obj);
      if (table === 'time_entries' && 'rate' in obj && obj.rate == null) {
        obj.rate = get('SELECT hourly_rate FROM users WHERE id=?', obj.user_id ?? prev.user_id)?.hourly_rate ?? 0;
      }
      update(table, params.id, obj);
      const title = obj.title || obj.name || prev.title || prev.name || prev.description || label;
      let action = `${label} updated: ${title}`;
      if (obj.status === 'done' && prev.status !== 'done') action = `${label} completed: ${title}`;
      if (obj.completed === 1 && !prev.completed) action = `${label} marked done: ${title}`;
      log(obj.case_id || prev.case_id, user.id, action);
      touchCase(obj.case_id || prev.case_id);
      return { ok: true };
    });
    route('DELETE', `/api/${name}/:id`, ({ user, params }) => {
      const prev = mustGet(table, params.id);
      if (prev.invoice_id) throw bad('This entry is on an invoice. Void or delete the invoice first to delete it.');
      run(`DELETE FROM ${table} WHERE id=?`, params.id);
      log(prev.case_id, user.id, `${label} deleted: ${prev.title || prev.name || prev.description || label}`);
      return { ok: true };
    });
  };
  crudCaseChild('events', 'events', SPEC.event, ['case_id', 'title', 'starts_at'], 'Event');
  crudCaseChild('tasks', 'tasks', SPEC.task, ['title'], 'Task');
  crudCaseChild('time', 'time_entries', SPEC.time, ['case_id', 'work_date', 'hours'], 'Time entry');
  crudCaseChild('expenses', 'expenses', SPEC.expense, ['case_id', 'expense_date', 'amount'], 'Expense');
  crudCaseChild('contacts', 'contacts', SPEC.contact, ['case_id', 'name'], 'Contact');

  route('GET', '/api/tasks', ({ query, user }) => {
    const where = []; const p = [];
    if (query.case_id) where.push('t.case_id=?'), p.push(+query.case_id);
    if (query.assignee === 'me') where.push('t.assignee_id=?'), p.push(user.id);
    else if (query.assignee) where.push('t.assignee_id=?'), p.push(+query.assignee);
    if (query.status === 'open') where.push("t.status!='done'");
    else if (query.status) where.push('t.status=?'), p.push(query.status);
    return all(`${TASK_SQL}${where.length ? ` WHERE ${where.join(' AND ')}` : ''}
      ORDER BY t.status='done', t.due_date IS NULL, t.due_date, CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END`, ...p);
  });

  route('GET', '/api/time', ({ query }) => {
    const where = []; const p = [];
    if (query.case_id) where.push('te.case_id=?'), p.push(+query.case_id);
    if (query.user_id) where.push('te.user_id=?'), p.push(+query.user_id);
    if (query.from) where.push('te.work_date>=?'), p.push(query.from);
    if (query.to) where.push('te.work_date<=?'), p.push(query.to);
    return all(`${TIME_SQL}${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY te.work_date DESC, te.id DESC`, ...p);
  });

  // Notes
  route('GET', '/api/notes', ({ query }) => {
    if (!query.case_id) throw bad('case_id is required');
    return all(`SELECT n.*, u.name AS user_name FROM notes n LEFT JOIN users u ON u.id=n.user_id WHERE n.case_id=? ORDER BY n.created_at DESC, n.id DESC`, +query.case_id);
  });
  route('POST', '/api/notes', async ({ req, user }) => {
    const obj = clean(await readJson(req), { case_id: 'int', body: 'text' }, ['case_id', 'body']);
    checkRefs(obj);
    obj.user_id = user.id;
    const id = insert('notes', obj);
    log(obj.case_id, user.id, 'Note added');
    touchCase(obj.case_id);
    return { id };
  });
  route('DELETE', '/api/notes/:id', ({ params, user }) => {
    const n = mustGet('notes', params.id);
    if (n.user_id !== user.id && !isManager(user)) throw new HttpError(403, 'You can only delete your own notes');
    run('DELETE FROM notes WHERE id=?', params.id);
    log(n.case_id, user.id, 'Note deleted');
    return { ok: true };
  });

  // Documents
  route('GET', '/api/documents', ({ query }) => {
    if (!query.case_id) throw bad('case_id is required');
    return all(`SELECT d.id,d.case_id,d.name,d.category,d.mime,d.size,d.created_at,u.name AS uploaded_by_name FROM documents d
      LEFT JOIN users u ON u.id=d.uploaded_by WHERE d.case_id=? ORDER BY d.created_at DESC, d.id DESC`, +query.case_id);
  });
  route('POST', '/api/cases/:id/documents', async ({ req, user, params }) => {
    mustGet('cases', params.id);
    const name = decodeURIComponent(String(req.headers['x-filename'] || '')).replace(/[\\/\0]/g, '_').slice(0, 255).trim();
    if (!name) throw bad('File name is required');
    let category = String(req.headers['x-category'] || 'other');
    if (!ENUMS.doc_category.includes(category)) category = 'other';
    const buf = await readBody(req, MAX_UPLOAD);
    if (!buf.length) throw bad('File is empty');
    const stored = crypto.randomBytes(16).toString('hex');
    fs.writeFileSync(path.join(uploadDir, stored), buf);
    const mime = String(req.headers['content-type'] || 'application/octet-stream').slice(0, 100);
    const id = insert('documents', { case_id: params.id, name, category, stored_name: stored, mime, size: buf.length, uploaded_by: user.id });
    log(params.id, user.id, `Document uploaded: ${name}`);
    touchCase(params.id);
    return { id };
  });
  route('GET', '/api/documents/:id/download', ({ params, res }) => {
    const d = mustGet('documents', params.id);
    const file = path.join(uploadDir, d.stored_name);
    if (!fs.existsSync(file)) throw new HttpError(404, 'File missing from storage');
    res.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Content-Length': d.size,
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(d.name)}`,
      'X-Content-Type-Options': 'nosniff',
    });
    fs.createReadStream(file).pipe(res);
    return undefined;
  });
  route('DELETE', '/api/documents/:id', ({ params, user }) => {
    const d = mustGet('documents', params.id);
    run('DELETE FROM documents WHERE id=?', params.id);
    fs.rm(path.join(uploadDir, d.stored_name), { force: true }, () => {});
    log(d.case_id, user.id, `Document deleted: ${d.name}`);
    return { ok: true };
  });

  // Activity
  route('GET', '/api/activity', ({ query }) => {
    const p = []; let where = '';
    if (query.case_id) { where = 'WHERE a.case_id=?'; p.push(+query.case_id); }
    return all(`SELECT a.*, u.name AS user_name, c.title AS case_title FROM activity a LEFT JOIN users u ON u.id=a.user_id
      LEFT JOIN cases c ON c.id=a.case_id ${where} ORDER BY a.created_at DESC, a.id DESC LIMIT 200`, ...p);
  });

  // Dashboard
  route('GET', '/api/dashboard', ({ user }) => {
    const t = today();
    const ph = CLOSED_STATUSES.map(() => '?').join(',');
    const monthStart = `${t.slice(0, 7)}-01`;
    return {
      today: t,
      counts: {
        open_cases: get(`SELECT COUNT(*) n FROM cases WHERE status NOT IN (${ph})`, ...CLOSED_STATUSES).n,
        my_cases: get(`SELECT COUNT(*) n FROM cases WHERE status NOT IN (${ph}) AND (lead_attorney_id=? OR id IN (SELECT case_id FROM case_team WHERE user_id=?))`, ...CLOSED_STATUSES, user.id, user.id).n,
        events_week: get('SELECT COUNT(*) n FROM events WHERE completed=0 AND starts_at>=? AND starts_at<?', t, addDays(t, 7)).n,
        overdue_tasks: get("SELECT COUNT(*) n FROM tasks WHERE status!='done' AND due_date<?", t).n,
        hours_month: get('SELECT COALESCE(SUM(hours),0) n FROM time_entries WHERE work_date>=?', monthStart).n,
        my_hours_month: get('SELECT COALESCE(SUM(hours),0) n FROM time_entries WHERE work_date>=? AND user_id=?', monthStart, user.id).n,
        unbilled: round2(get(`SELECT COALESCE((SELECT SUM(hours*rate) FROM time_entries WHERE billable=1 AND invoice_id IS NULL),0)
          + COALESCE((SELECT SUM(amount) FROM expenses WHERE billable=1 AND invoice_id IS NULL),0) AS n`).n),
        outstanding: round2(get(`SELECT COALESCE(SUM(total - (SELECT COALESCE(SUM(amount),0) FROM payments p WHERE p.invoice_id=i.id)),0) n
          FROM invoices i WHERE status='sent'`).n),
      },
      by_status: all('SELECT status, COUNT(*) n FROM cases GROUP BY status'),
      upcoming: all(`${EVENT_SQL} WHERE e.completed=0 AND e.starts_at>=? AND e.starts_at<? ORDER BY e.starts_at LIMIT 15`, t, addDays(t, 30)),
      missed: all(`${EVENT_SQL} WHERE e.completed=0 AND e.starts_at<? ORDER BY e.starts_at DESC LIMIT 10`, t),
      my_tasks: all(`${TASK_SQL} WHERE t.assignee_id=? AND t.status!='done' ORDER BY t.due_date IS NULL, t.due_date LIMIT 10`, user.id),
      overdue: all(`${TASK_SQL} WHERE t.status!='done' AND t.due_date<? ORDER BY t.due_date LIMIT 10`, t),
      sol: all(`SELECT id,title,internal_ref,statute_of_limitations FROM cases WHERE statute_of_limitations IS NOT NULL
        AND status NOT IN (${ph}) AND statute_of_limitations<=? ORDER BY statute_of_limitations`, ...CLOSED_STATUSES, addDays(t, 365)),
      activity: all(`SELECT a.*, u.name AS user_name, c.title AS case_title FROM activity a LEFT JOIN users u ON u.id=a.user_id
        LEFT JOIN cases c ON c.id=a.case_id ORDER BY a.created_at DESC, a.id DESC LIMIT 12`),
    };
  });

  // Reports
  route('GET', '/api/reports', ({ query }) => {
    const from = query.from || '0000-01-01';
    const to = query.to || '9999-12-31';
    return {
      by_status: all('SELECT status AS label, COUNT(*) n FROM cases GROUP BY status ORDER BY n DESC'),
      by_type: all("SELECT COALESCE(case_type,'Unspecified') AS label, COUNT(*) n FROM cases GROUP BY label ORDER BY n DESC"),
      by_attorney: all(`SELECT COALESCE(u.name,'Unassigned') AS label, COUNT(*) n FROM cases c LEFT JOIN users u ON u.id=c.lead_attorney_id
        WHERE c.status NOT IN ('settled','judgment','closed') GROUP BY label ORDER BY n DESC`),
      time_by_user: all(`SELECT COALESCE(u.name,'Unknown') AS label, SUM(te.hours) hours, SUM(CASE WHEN te.billable=1 THEN te.hours ELSE 0 END) billable_hours,
        SUM(CASE WHEN te.billable=1 THEN te.hours*te.rate ELSE 0 END) value FROM time_entries te LEFT JOIN users u ON u.id=te.user_id
        WHERE te.work_date BETWEEN ? AND ? GROUP BY label ORDER BY hours DESC`, from, to),
      invoiced: get("SELECT COALESCE(SUM(total),0) n FROM invoices WHERE status!='void' AND issue_date BETWEEN ? AND ?", from, to).n,
      collected: get('SELECT COALESCE(SUM(amount),0) n FROM payments WHERE payment_date BETWEEN ? AND ?', from, to).n,
      expenses: get('SELECT COALESCE(SUM(amount),0) n FROM expenses WHERE expense_date BETWEEN ? AND ?', from, to).n,
      time_by_case: all(`SELECT c.id, c.title AS label, c.internal_ref, SUM(te.hours) hours,
        SUM(CASE WHEN te.billable=1 THEN te.hours*te.rate ELSE 0 END) value FROM time_entries te JOIN cases c ON c.id=te.case_id
        WHERE te.work_date BETWEEN ? AND ? GROUP BY c.id ORDER BY value DESC`, from, to),
    };
  });

  // Conflict-of-interest check: searches clients, opposing parties/counsel, and case titles.
  route('GET', '/api/conflicts', ({ query }) => {
    const q = String(query.q || '').trim();
    if (q.length < 2) throw bad('Enter at least 2 characters');
    const like = `%${q}%`;
    return {
      clients: all('SELECT id,name,type FROM clients WHERE name LIKE ? OR contact_person LIKE ? ORDER BY name', like, like),
      opposing: all(`SELECT c.id,c.title,c.internal_ref,c.status,c.opposing_party,c.opposing_counsel,cl.name AS client_name FROM cases c
        LEFT JOIN clients cl ON cl.id=c.client_id WHERE c.opposing_party LIKE ? OR c.opposing_counsel LIKE ? ORDER BY c.title`, like, like),
      cases: all(`SELECT c.id,c.title,c.internal_ref,c.status FROM cases c WHERE c.title LIKE ? ORDER BY c.title`, like),
      contacts: all(`SELECT ct.id,ct.name,ct.role,ct.organization,c.id AS case_id,c.title AS case_title,c.internal_ref FROM contacts ct
        JOIN cases c ON c.id=ct.case_id WHERE ct.name LIKE ? OR ct.organization LIKE ? ORDER BY ct.name`, like, like),
    };
  });


  // ---------------------------------------------------------- contacts & expenses lists
  route('GET', '/api/contacts', ({ query }) => {
    if (!query.case_id) throw bad('case_id is required');
    return all('SELECT * FROM contacts WHERE case_id=? ORDER BY role, name', +query.case_id);
  });
  route('GET', '/api/expenses', ({ query }) => {
    const where = []; const p = [];
    if (query.case_id) where.push('x.case_id=?'), p.push(+query.case_id);
    if (query.from) where.push('x.expense_date>=?'), p.push(query.from);
    if (query.to) where.push('x.expense_date<=?'), p.push(query.to);
    return all(`SELECT x.*, u.name AS user_name, c.title AS case_title, c.internal_ref, i.number AS invoice_number FROM expenses x
      LEFT JOIN users u ON u.id=x.user_id JOIN cases c ON c.id=x.case_id LEFT JOIN invoices i ON i.id=x.invoice_id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY x.expense_date DESC, x.id DESC`, ...p);
  });

  // ---------------------------------------------------------- hearing outcome + next date
  route('POST', '/api/events/:id/outcome', async ({ req, user, params }) => {
    const ev = mustGet('events', params.id);
    const body = clean(await readJson(req), { outcome: 'text', next_at: 'datetime', next_title: 'text', next_kind: ['enum', 'event_kind'] }, ['outcome']);
    run('UPDATE events SET completed=1, outcome=? WHERE id=?', body.outcome, ev.id);
    log(ev.case_id, user.id, `${ev.title} — outcome recorded: ${body.outcome}`);
    let nextId = null;
    if (body.next_at) {
      nextId = insert('events', { case_id: ev.case_id, kind: body.next_kind || ev.kind, title: body.next_title || ev.title,
        starts_at: body.next_at, location: ev.location, created_by: user.id });
      log(ev.case_id, user.id, `Next date scheduled: ${body.next_title || ev.title} on ${body.next_at.replace('T', ' ')}`);
    }
    touchCase(ev.case_id);
    return { ok: true, next_id: nextId };
  });

  // ---------------------------------------------------------- settings
  route('GET', '/api/settings', () => settings());
  route('PUT', '/api/settings', async ({ req, user }) => {
    requireRole(user, 'admin');
    const body = await readJson(req);
    const stmt = db.prepare('INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
    for (const key of Object.keys(DEFAULT_SETTINGS)) {
      if (!(key in body)) continue;
      let v = String(body[key] ?? '').trim().slice(0, 5000);
      if (key === 'currency') { v = v.toUpperCase(); if (!/^[A-Z]{3}$/.test(v)) throw bad('Currency must be a 3-letter code such as USD, EUR or SAR'); }
      if (key === 'tax_rate' && (!Number.isFinite(+v) || +v < 0 || +v > 100)) throw bad('Tax rate must be between 0 and 100');
      if (key === 'payment_terms' && (!Number.isInteger(+v) || +v < 0)) throw bad('Payment terms must be a whole number of days');
      if (key === 'holidays') {
        const dates = v.split(/[\s,]+/).filter(Boolean);
        for (const d of dates) if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) throw bad(`Holiday "${d}" must be a date in YYYY-MM-DD format`);
        v = dates.join('\n');
      }
      if (key === 'firm_name' && !v) throw bad('Firm name is required');
      stmt.run(key, v);
    }
    return settings();
  });

  // ---------------------------------------------------------- invoices & payments
  const INVOICE_SQL = `SELECT i.*, c.title AS case_title, c.internal_ref, c.case_number, c.client_id, cl.name AS client_name,
      (SELECT COALESCE(SUM(amount),0) FROM payments p WHERE p.invoice_id=i.id) AS paid
    FROM invoices i JOIN cases c ON c.id=i.case_id LEFT JOIN clients cl ON cl.id=c.client_id`;
  const withBalance = (i) => ({ ...i, balance: round2(i.total - i.paid), overdue: i.status === 'sent' && i.due_date && i.due_date < today() ? 1 : 0 });

  function refreshInvoiceStatus(id) {
    const i = get(INVOICE_SQL + ' WHERE i.id=?', id);
    if (i.status === 'void') return;
    if (i.paid >= i.total - 0.005 && i.total > 0) run("UPDATE invoices SET status='paid' WHERE id=?", id);
    else if (i.status === 'paid') run("UPDATE invoices SET status='sent' WHERE id=?", id);
  }
  const releaseEntries = (id) => {
    run('UPDATE time_entries SET invoice_id=NULL WHERE invoice_id=?', id);
    run('UPDATE expenses SET invoice_id=NULL WHERE invoice_id=?', id);
  };
  function tx(fn) {
    db.exec('BEGIN');
    try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; }
  }

  route('GET', '/api/invoices', ({ query }) => {
    const where = []; const p = [];
    if (query.case_id) where.push('i.case_id=?'), p.push(+query.case_id);
    if (query.client_id) where.push('c.client_id=?'), p.push(+query.client_id);
    if (query.status === 'overdue') where.push("i.status='sent' AND i.due_date<?"), p.push(today());
    else if (query.status === 'unpaid') where.push("i.status IN ('draft','sent')");
    else if (query.status) where.push('i.status=?'), p.push(query.status);
    return all(`${INVOICE_SQL}${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY i.issue_date DESC, i.id DESC`, ...p).map(withBalance);
  });
  route('GET', '/api/invoices/:id', ({ params }) => {
    const i = get(INVOICE_SQL + ' WHERE i.id=?', params.id);
    if (!i) throw new HttpError(404, 'Invoice not found');
    const inv = withBalance(i);
    inv.client = i.client_id ? get('SELECT * FROM clients WHERE id=?', i.client_id) : null;
    inv.time = all(`SELECT te.*, u.name AS user_name, round(te.hours*te.rate,2) AS amount FROM time_entries te LEFT JOIN users u ON u.id=te.user_id
      WHERE te.invoice_id=? ORDER BY te.work_date, te.id`, params.id);
    inv.expenses = all('SELECT * FROM expenses WHERE invoice_id=? ORDER BY expense_date, id', params.id);
    inv.payments = all('SELECT p.*, u.name AS user_name FROM payments p LEFT JOIN users u ON u.id=p.created_by WHERE invoice_id=? ORDER BY payment_date, id', params.id);
    inv.firm = settings();
    return inv;
  });
  route('GET', '/api/cases/:id/unbilled', ({ params, query }) => {
    mustGet('cases', params.id);
    const u = unbilled(params.id, query.up_to || '9999-12-31');
    return { time_count: u.time.length, expense_count: u.exp.length, time_total: u.time_total, expense_total: u.expense_total, total: u.total };
  });
  route('POST', '/api/invoices', async ({ req, user }) => {
    requireRole(user, ...BILLING_ROLES);
    const b = clean(await readJson(req), { case_id: 'int', issue_date: 'date', due_date: 'date', up_to: 'date', discount: 'real', tax_rate: 'real', notes: 'text' }, ['case_id']);
    mustGet('cases', b.case_id);
    const s = settings();
    const issue = b.issue_date || today();
    const due = b.due_date || addDays(issue, Number(s.payment_terms) || 0);
    const u = unbilled(b.case_id, b.up_to || '9999-12-31');
    if (!u.time.length && !u.exp.length) throw bad('There is no unbilled billable time or expenses on this matter.');
    const discount = round2(Math.max(0, b.discount || 0));
    if (discount > u.total) throw bad('Discount cannot be larger than the invoice amount');
    const taxRate = b.tax_rate ?? (Number(s.tax_rate) || 0);
    if (taxRate < 0 || taxRate > 100) throw bad('Tax rate must be between 0 and 100');
    const tax = round2(((u.total - discount) * taxRate) / 100);
    const id = tx(() => {
      let seq = get('SELECT COUNT(*)+1 AS n FROM invoices').n;
      let number;
      do { number = `${s.invoice_prefix || ''}${String(seq++).padStart(4, '0')}`; } while (get('SELECT 1 FROM invoices WHERE number=?', number));
      const newId = insert('invoices', { number, case_id: b.case_id, issue_date: issue, due_date: due, status: 'draft',
        time_total: u.time_total, expense_total: u.expense_total, discount, tax_rate: taxRate, tax, total: round2(u.total - discount + tax),
        notes: b.notes, created_by: user.id });
      for (const r of u.time) run('UPDATE time_entries SET invoice_id=? WHERE id=?', newId, r.id);
      for (const r of u.exp) run('UPDATE expenses SET invoice_id=? WHERE id=?', newId, r.id);
      log(b.case_id, user.id, `Invoice ${number} created`);
      return newId;
    });
    return { id };
  });
  route('PUT', '/api/invoices/:id', async ({ req, user, params }) => {
    requireRole(user, ...BILLING_ROLES);
    const prev = mustGet('invoices', params.id);
    const b = clean(await readJson(req), { status: ['enum', 'invoice_status'], due_date: 'date', notes: 'text' }, [], true);
    if (prev.status === 'void' && b.status && b.status !== 'void') throw bad('A void invoice cannot be reopened. Create a new invoice instead.');
    if (b.status === 'paid') throw bad('Record a payment to mark an invoice as paid.');
    tx(() => {
      update('invoices', params.id, b);
      if (b.status === 'void' && prev.status !== 'void') {
        releaseEntries(params.id);
        log(prev.case_id, user.id, `Invoice ${prev.number} voided`);
      } else if (b.status && b.status !== prev.status) {
        log(prev.case_id, user.id, `Invoice ${prev.number} marked ${b.status}`);
      }
    });
    return { ok: true };
  });
  route('DELETE', '/api/invoices/:id', ({ user, params }) => {
    requireRole(user, ...BILLING_ROLES);
    const prev = mustGet('invoices', params.id);
    if (!['draft', 'void'].includes(prev.status)) throw bad('Only draft or void invoices can be deleted. Void it first.');
    tx(() => {
      releaseEntries(params.id);
      run('DELETE FROM invoices WHERE id=?', params.id);
      log(prev.case_id, user.id, `Invoice ${prev.number} deleted`);
    });
    return { ok: true };
  });
  route('POST', '/api/invoices/:id/payments', async ({ req, user, params }) => {
    requireRole(user, ...BILLING_ROLES);
    const inv = get(INVOICE_SQL + ' WHERE i.id=?', params.id);
    if (!inv) throw new HttpError(404, 'Invoice not found');
    if (inv.status === 'void') throw bad('Cannot record a payment on a void invoice');
    const b = clean(await readJson(req), { payment_date: 'date', amount: 'real', method: ['enum', 'payment_method'], reference: 'text' }, ['payment_date', 'amount']);
    if (b.amount <= 0) throw bad('Amount must be greater than zero');
    if (b.amount > round2(inv.total - inv.paid) + 0.005) throw bad(`Amount is more than the balance due (${round2(inv.total - inv.paid)})`);
    tx(() => {
      insert('payments', { ...b, invoice_id: inv.id, created_by: user.id });
      if (inv.status === 'draft') run("UPDATE invoices SET status='sent' WHERE id=?", inv.id);
      refreshInvoiceStatus(inv.id);
      log(inv.case_id, user.id, `Payment of ${b.amount} recorded on invoice ${inv.number}`);
    });
    return { ok: true };
  });
  route('DELETE', '/api/payments/:id', ({ user, params }) => {
    requireRole(user, ...BILLING_ROLES);
    const p = mustGet('payments', params.id);
    const inv = mustGet('invoices', p.invoice_id);
    tx(() => {
      run('DELETE FROM payments WHERE id=?', params.id);
      refreshInvoiceStatus(inv.id);
      log(inv.case_id, user.id, `Payment of ${p.amount} removed from invoice ${inv.number}`);
    });
    return { ok: true };
  });

  // ---------------------------------------------------------- task checklists (templates)
  function cleanTemplate(body, partial) {
    const obj = clean(body, { name: 'text', case_type: 'text' }, ['name'], partial);
    if ('items' in body || !partial) {
      if (!Array.isArray(body.items) || !body.items.length) throw bad('Add at least one task to the checklist');
      obj.items = JSON.stringify(body.items.slice(0, 100).map((it) => {
        const title = String(it.title || '').trim().slice(0, 500);
        if (!title) throw bad('Every checklist task needs a title');
        const days = Number(it.days) || 0;
        if (!Number.isInteger(days) || Math.abs(days) > 3650) throw bad('Days must be a whole number');
        const priority = ENUMS.priority.includes(it.priority) ? it.priority : 'normal';
        return { title, days, priority };
      }));
    }
    return obj;
  }
  route('GET', '/api/templates', () => all('SELECT * FROM templates ORDER BY name').map((t) => ({ ...t, items: JSON.parse(t.items) })));
  route('POST', '/api/templates', async ({ req, user }) => {
    if (!isManager(user)) throw new HttpError(403, 'Only partners or admins can manage checklists');
    return { id: insert('templates', cleanTemplate(await readJson(req), false)) };
  });
  route('PUT', '/api/templates/:id', async ({ req, user, params }) => {
    if (!isManager(user)) throw new HttpError(403, 'Only partners or admins can manage checklists');
    mustGet('templates', params.id);
    update('templates', params.id, cleanTemplate(await readJson(req), true));
    return { ok: true };
  });
  route('DELETE', '/api/templates/:id', ({ user, params }) => {
    if (!isManager(user)) throw new HttpError(403, 'Only partners or admins can manage checklists');
    run('DELETE FROM templates WHERE id=?', params.id);
    return { ok: true };
  });
  route('POST', '/api/cases/:id/apply-template', async ({ req, user, params }) => {
    const c = mustGet('cases', params.id);
    const b = clean(await readJson(req), { template_id: 'int', start_date: 'date', assignee_id: 'int' }, ['template_id']);
    const t = mustGet('templates', b.template_id);
    checkRefs(b);
    const start = b.start_date || today();
    const assignee = b.assignee_id ?? c.lead_attorney_id;
    const items = JSON.parse(t.items);
    tx(() => {
      for (const it of items) {
        insert('tasks', { case_id: c.id, title: it.title, due_date: addDays(start, it.days), priority: it.priority, assignee_id: assignee, status: 'todo', created_by: user.id });
      }
      log(c.id, user.id, `Checklist applied: ${t.name} (${items.length} tasks)`);
    });
    touchCase(c.id);
    return { created: items.length };
  });

  // ---------------------------------------------------------- global search
  route('GET', '/api/search', ({ query }) => {
    const q = String(query.q || '').trim();
    if (q.length < 2) throw bad('Enter at least 2 characters');
    const like = `%${q}%`;
    return {
      cases: all(`SELECT c.id,c.title,c.internal_ref,c.case_number,c.status,cl.name AS client_name FROM cases c LEFT JOIN clients cl ON cl.id=c.client_id
        WHERE c.title LIKE ? OR c.case_number LIKE ? OR c.internal_ref LIKE ? OR c.opposing_party LIKE ? OR c.court LIKE ? OR c.judge LIKE ? OR c.description LIKE ?
        ORDER BY c.updated_at DESC LIMIT 20`, like, like, like, like, like, like, like),
      clients: all('SELECT id,name,type,email,phone FROM clients WHERE name LIKE ? OR contact_person LIKE ? OR email LIKE ? OR phone LIKE ? ORDER BY name LIMIT 20', like, like, like, like),
      contacts: all(`SELECT ct.id,ct.name,ct.role,ct.organization,ct.case_id,c.title AS case_title FROM contacts ct JOIN cases c ON c.id=ct.case_id
        WHERE ct.name LIKE ? OR ct.organization LIKE ? OR ct.email LIKE ? ORDER BY ct.name LIMIT 20`, like, like, like),
      documents: all(`SELECT d.id,d.name,d.category,d.case_id,c.title AS case_title FROM documents d JOIN cases c ON c.id=d.case_id
        WHERE d.name LIKE ? ORDER BY d.created_at DESC LIMIT 20`, like),
      notes: all(`SELECT n.id,n.body,n.case_id,n.created_at,c.title AS case_title FROM notes n JOIN cases c ON c.id=n.case_id
        WHERE n.body LIKE ? ORDER BY n.created_at DESC LIMIT 20`, like),
      tasks: all(`SELECT t.id,t.title,t.status,t.due_date,t.case_id,c.title AS case_title FROM tasks t LEFT JOIN cases c ON c.id=t.case_id
        WHERE t.title LIKE ? OR t.notes LIKE ? ORDER BY t.due_date LIMIT 20`, like, like),
      events: all(`SELECT e.id,e.title,e.kind,e.starts_at,e.case_id,c.title AS case_title FROM events e JOIN cases c ON c.id=e.case_id
        WHERE e.title LIKE ? OR e.location LIKE ? OR e.notes LIKE ? OR e.outcome LIKE ? ORDER BY e.starts_at DESC LIMIT 20`, like, like, like, like),
      invoices: all(`SELECT i.id,i.number,i.total,i.status,c.title AS case_title FROM invoices i JOIN cases c ON c.id=i.case_id
        WHERE i.number LIKE ? ORDER BY i.issue_date DESC LIMIT 20`, like),
    };
  });

  // ---------------------------------------------------------- notifications (computed live)
  route('GET', '/api/notifications', ({ user }) => {
    const t = today();
    const items = [];
    // Partners and admins see firm-wide alerts; everyone else sees alerts for the matters they work on.
    const scope = isManager(user) ? "1=1" : MY_CASES;
    const mine = isManager(user) ? [] : [user.id, user.id];
    for (const e of all(`${EVENT_SQL} WHERE e.completed=0 AND e.starts_at>=? AND e.starts_at<? AND ${scope} ORDER BY e.starts_at`, t, addDays(t, 3), ...mine)) {
      const d = e.starts_at.slice(0, 10);
      items.push({ level: d === t ? 'high' : 'normal', text: `${e.kind === 'deadline' ? 'Deadline' : label(e.kind)} ${d === t ? 'today' : d === addDays(t, 1) ? 'tomorrow' : `on ${d}`}: ${e.title}`, sub: e.case_title, link: `#/cases/${e.case_id}/schedule`, date: e.starts_at });
    }
    for (const e of all(`${EVENT_SQL} WHERE e.completed=0 AND e.starts_at<? AND ${scope} ORDER BY e.starts_at DESC LIMIT 20`, t, ...mine)) {
      items.push({ level: 'high', text: `Record outcome: ${e.title} (${e.starts_at.slice(0, 10)})`, sub: e.case_title, link: `#/cases/${e.case_id}/schedule`, date: e.starts_at });
    }
    for (const k of all(`${TASK_SQL} WHERE t.assignee_id=? AND t.status!='done' AND t.due_date IS NOT NULL AND t.due_date<=? ORDER BY t.due_date`, user.id, addDays(t, 1))) {
      const txt = k.due_date < t ? `Overdue task: ${k.title}` : k.due_date === t ? `Task due today: ${k.title}` : `Task due tomorrow: ${k.title}`;
      items.push({ level: k.due_date <= t ? 'high' : 'normal', text: txt, sub: k.case_title || 'General', link: k.case_id ? `#/cases/${k.case_id}/tasks` : '#/tasks', date: k.due_date });
    }
    for (const c of all(`SELECT c.id,c.title,c.statute_of_limitations FROM cases c WHERE c.statute_of_limitations IS NOT NULL AND c.statute_of_limitations<=?
        AND c.status NOT IN ('settled','judgment','closed') AND ${scope}`, addDays(t, 60), ...mine)) {
      items.push({ level: 'high', text: `Limitation deadline ${c.statute_of_limitations}`, sub: c.title, link: `#/cases/${c.id}`, date: c.statute_of_limitations });
    }
    if (BILLING_ROLES.includes(user.role)) {
      for (const i of all(`${INVOICE_SQL} WHERE i.status='sent' AND i.due_date<? ORDER BY i.due_date`, t)) {
        items.push({ level: 'normal', text: `Invoice ${i.number} overdue (due ${i.due_date})`, sub: i.client_name || i.case_title, link: `#/invoices/${i.id}`, date: i.due_date });
      }
    }
    return items;
  });

  // ---------------------------------------------------------- calendar feed (iCalendar)
  function icsFor(events) {
    const esc = (s) => String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
    const fold = (line) => line.match(/.{1,73}/g).join('\r\n ');
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Litigation Manager//EN', 'CALSCALE:GREGORIAN', `X-WR-CALNAME:${esc(settings().firm_name)} — Court calendar`];
    for (const e of events) {
      const [d, tm] = e.starts_at.split('T');
      const ymd = d.replace(/-/g, '');
      lines.push('BEGIN:VEVENT', `UID:event-${e.id}@litigation-manager`, `DTSTAMP:${stamp}`);
      if (tm) {
        const [hh, mm] = tm.split(':').map(Number);
        const end = new Date(Date.UTC(2000, 0, 1, hh + 1, mm));
        const endDay = end.getUTCDate() === 2 ? addDays(d, 1).replace(/-/g, '') : ymd;
        lines.push(`DTSTART:${ymd}T${String(hh).padStart(2, '0')}${String(mm).padStart(2, '0')}00`,
          `DTEND:${endDay}T${String(end.getUTCHours()).padStart(2, '0')}${String(end.getUTCMinutes()).padStart(2, '0')}00`);
      } else {
        lines.push(`DTSTART;VALUE=DATE:${ymd}`);
      }
      lines.push(`SUMMARY:${esc(`[${label(e.kind)}] ${e.title} — ${e.internal_ref || ''} ${e.case_title}`)}`);
      if (e.location) lines.push(`LOCATION:${esc(e.location)}`);
      if (e.notes) lines.push(`DESCRIPTION:${esc(e.notes)}`);
      if (e.completed) lines.push('STATUS:CONFIRMED');
      lines.push('END:VEVENT');
    }
    lines.push('END:VCALENDAR');
    return lines.map(fold).join('\r\n') + '\r\n';
  }
  const icsEvents = () => all(`${EVENT_SQL} WHERE e.starts_at>=? ORDER BY e.starts_at`, addDays(today(), -90));
  route('GET', '/api/me/calendar-feed', ({ user }) => {
    let tok = get('SELECT ical_token FROM users WHERE id=?', user.id).ical_token;
    if (!tok) { tok = crypto.randomBytes(24).toString('hex'); run('UPDATE users SET ical_token=? WHERE id=?', tok, user.id); }
    return { path: `/api/ical/${tok}.ics` };
  });
  route('POST', '/api/me/calendar-feed/reset', ({ user }) => {
    const tok = crypto.randomBytes(24).toString('hex');
    run('UPDATE users SET ical_token=? WHERE id=?', tok, user.id);
    return { path: `/api/ical/${tok}.ics` };
  });
  route('GET', '/api/ical/:token.ics', ({ params, res }) => {
    const u = get('SELECT id FROM users WHERE ical_token=? AND active=1', params.token);
    if (!u) throw new HttpError(404, 'Calendar feed not found');
    res.writeHead(200, { 'Content-Type': 'text/calendar; charset=utf-8', 'Cache-Control': 'no-cache' });
    res.end(icsFor(icsEvents()));
    return undefined;
  }, { auth: false });
  route('GET', '/api/calendar.ics', ({ res }) => {
    res.writeHead(200, { 'Content-Type': 'text/calendar; charset=utf-8', 'Content-Disposition': 'attachment; filename="court-calendar.ics"' });
    res.end(icsFor(icsEvents()));
    return undefined;
  });

  // ---------------------------------------------------------- backup (admin)
  route('GET', '/api/admin/backup', ({ user, res }) => {
    requireRole(user, 'admin');
    const tmp = path.join(os.tmpdir(), `litigation-backup-${crypto.randomBytes(8).toString('hex')}.db`);
    db.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`);
    const size = fs.statSync(tmp).size;
    res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': size,
      'Content-Disposition': `attachment; filename="litigation-backup-${today()}.db"` });
    const stream = fs.createReadStream(tmp);
    stream.pipe(res);
    stream.on('close', () => fs.rm(tmp, { force: true }, () => {}));
    return undefined;
  });

  // CSV export
  route('GET', '/api/export/cases.csv', ({ res }) => {
    const rows = listCases({});
    const cols = ['internal_ref', 'case_number', 'title', 'client_name', 'client_role', 'opposing_party', 'opposing_counsel', 'court', 'judge',
      'case_type', 'status', 'priority', 'lead_attorney_name', 'filed_date', 'closed_date', 'statute_of_limitations', 'claim_amount', 'next_event', 'open_tasks'];
    const esc = (v) => {
      let s = v == null ? '' : String(v);
      if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // guard against spreadsheet formula injection
      return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const csv = [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\r\n');
    res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="cases-${today()}.csv"` });
    res.end(`﻿${csv}`);
    return undefined;
  });

  // ---------------------------------------------------------- static files
  const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
  function serveStatic(req, res, pathname) {
    let file = path.normalize(path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname));
    if (!file.startsWith(PUBLIC_DIR + path.sep)) return send(res, 403, 'Forbidden');
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(PUBLIC_DIR, 'index.html');
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:",
      'Cache-Control': 'no-cache',
    });
    fs.createReadStream(file).pipe(res);
  }

  // ---------------------------------------------------------- dispatcher
  async function handle(req, res) {
    const url = new URL(req.url, 'http://localhost');
    const pathname = url.pathname;
    try {
      if (!pathname.startsWith('/api/')) {
        if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Method not allowed');
        return serveStatic(req, res, pathname);
      }
      // CSRF defence for state-changing requests: require same-origin.
      if (req.method !== 'GET' && req.headers.origin) {
        const host = req.headers['x-forwarded-host'] || req.headers.host;
        if (new URL(req.headers.origin).host !== host) throw new HttpError(403, 'Cross-origin request blocked');
      }
      for (const r of routes) {
        if (r.method !== req.method) continue;
        const m = pathname.match(r.re);
        if (!m) continue;
        const user = currentUser(req);
        if (r.auth && !user) throw new HttpError(401, 'Please sign in');
        const params = {};
        r.keys.forEach((k, i) => { params[k] = k === 'token' ? m[i + 1] : Number(m[i + 1]); });
        const query = Object.fromEntries(url.searchParams);
        const result = await r.handler({ req, res, user, params, query });
        if (result !== undefined) send(res, 200, result);
        return;
      }
      throw new HttpError(404, 'Not found');
    } catch (err) {
      if (!(err instanceof HttpError)) console.error(err);
      if (res.headersSent) { res.end(); return; }
      const status = err instanceof HttpError ? err.status : 500;
      send(res, status, { error: err instanceof HttpError ? err.message : 'Internal server error' });
    }
  }

  return { handle, db };
}

if (require.main === module) {
  const app = createApp({ seed: process.env.SEED !== '0' });
  const server = http.createServer(app.handle);
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') console.error(`Port ${PORT} is already in use. Is the app already running? Close the other window, or start with a different PORT.`);
    else console.error(err);
    process.exit(1);
  });
  server.listen(PORT, HOST, () => {
    console.log(`Litigation Manager running at http://localhost:${PORT}`);
    console.log(`Data directory: ${DATA_DIR}`);
    console.log('Keep this window open while you use the app. Press Ctrl+C to stop.');
    if (process.argv.includes('--open')) {
      const url = `http://localhost:${PORT}`;
      const { exec } = require('node:child_process');
      const cmd = process.platform === 'win32' ? `start "" "${url}"` : process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`;
      exec(cmd, () => {});
    }
  });
}

module.exports = { createApp };
