'use strict';
// Litigation Manager — HTTP server and JSON API. No external dependencies.

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { open, hashPassword, verifyPassword } = require('./db');

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
};
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
    const keys = Object.keys(obj);
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
    event: { case_id: 'int', kind: ['enum', 'event_kind'], title: 'text', starts_at: 'datetime', location: 'text', notes: 'text', completed: 'bool' },
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
    c.counts = {
      events: get('SELECT COUNT(*) n FROM events WHERE case_id=?', id).n,
      tasks: get("SELECT COUNT(*) n FROM tasks WHERE case_id=? AND status!='done'", id).n,
      documents: get('SELECT COUNT(*) n FROM documents WHERE case_id=?', id).n,
      notes: get('SELECT COUNT(*) n FROM notes WHERE case_id=?', id).n,
    };
    return c;
  }

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
    const re = new RegExp(`^${pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '(\\d+)'; })}$`);
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
      } else obj.created_by = user.id;
      const id = insert(table, obj);
      log(obj.case_id, user.id, `${label} added: ${obj.title || obj.description || `${obj.hours}h`}`);
      touchCase(obj.case_id);
      return { id };
    });
    route('PUT', `/api/${name}/:id`, async ({ req, user, params }) => {
      const prev = mustGet(table, params.id);
      const obj = clean(await readJson(req), spec, required, true);
      checkRefs(obj);
      if (table === 'time_entries' && 'rate' in obj && obj.rate == null) {
        obj.rate = get('SELECT hourly_rate FROM users WHERE id=?', obj.user_id ?? prev.user_id)?.hourly_rate ?? 0;
      }
      update(table, params.id, obj);
      const title = obj.title || prev.title || prev.description || label;
      let action = `${label} updated: ${title}`;
      if (obj.status === 'done' && prev.status !== 'done') action = `${label} completed: ${title}`;
      if (obj.completed === 1 && !prev.completed) action = `${label} marked done: ${title}`;
      log(obj.case_id || prev.case_id, user.id, action);
      touchCase(obj.case_id || prev.case_id);
      return { ok: true };
    });
    route('DELETE', `/api/${name}/:id`, ({ user, params }) => {
      const prev = mustGet(table, params.id);
      run(`DELETE FROM ${table} WHERE id=?`, params.id);
      log(prev.case_id, user.id, `${label} deleted: ${prev.title || prev.description || label}`);
      return { ok: true };
    });
  };
  crudCaseChild('events', 'events', SPEC.event, ['case_id', 'title', 'starts_at'], 'Event');
  crudCaseChild('tasks', 'tasks', SPEC.task, ['title'], 'Task');
  crudCaseChild('time', 'time_entries', SPEC.time, ['case_id', 'work_date', 'hours'], 'Time entry');

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
    };
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
        r.keys.forEach((k, i) => { params[k] = Number(m[i + 1]); });
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
  http.createServer(app.handle).listen(PORT, HOST, () => {
    console.log(`Litigation Manager running at http://localhost:${PORT}`);
    console.log(`Data directory: ${DATA_DIR}`);
  });
}

module.exports = { createApp };
