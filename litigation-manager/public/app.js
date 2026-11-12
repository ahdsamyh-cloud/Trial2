'use strict';
/* Litigation Manager — single-page front end (no framework, no build step). */

// ------------------------------------------------------------------ utilities
class Raw { constructor(s) { this.s = s; } toString() { return this.s; } }
const raw = (s) => new Raw(s);
const escHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function val(v) {
  if (v == null || v === false) return '';
  if (v instanceof Raw) return v.s;
  if (Array.isArray(v)) return v.map(val).join('');
  return escHtml(v);
}
// Tagged template that HTML-escapes every interpolated value unless wrapped in raw().
function h(strings, ...values) {
  let out = strings[0];
  values.forEach((v, i) => { out += val(v) + strings[i + 1]; });
  return raw(out);
}
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const label = (s) => (s ? String(s).replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase()) : '');
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n) => String(n).padStart(2, '0');
const isoDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const todayStr = () => isoDate(new Date());
function parseLocal(s) {
  if (!s) return null;
  const [d, t] = s.split('T');
  const [y, m, dd] = d.split('-').map(Number);
  const [hh, mm] = (t || '00:00').split(':').map(Number);
  return new Date(y, m - 1, dd, hh, mm);
}
function fmtDate(s) {
  if (!s) return '';
  const d = parseLocal(s.slice(0, 10));
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}
function fmtTime(s) {
  if (!s || !s.includes('T')) return '';
  const d = parseLocal(s);
  let hr = d.getHours(); const ap = hr >= 12 ? 'PM' : 'AM'; hr = hr % 12 || 12;
  return `${hr}:${pad(d.getMinutes())} ${ap}`;
}
const fmtDateTime = (s) => (s ? `${fmtDate(s)}${fmtTime(s) ? `, ${fmtTime(s)}` : ''}` : '');
const fmtStamp = (s) => { // SQLite UTC 'YYYY-MM-DD HH:MM:SS' -> local
  if (!s) return '';
  const d = new Date(`${s.replace(' ', 'T')}Z`);
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
function fmtMoney(n, digits) {
  try {
    return Number(n || 0).toLocaleString(undefined, { style: 'currency', currency: state.settings?.currency || 'USD', minimumFractionDigits: digits, maximumFractionDigits: digits });
  } catch { return `${state.settings?.currency || ''} ${Number(n || 0).toFixed(digits)}`; }
}
const money = (n) => (n == null || n === '' ? '' : fmtMoney(n, 0));
const money2 = (n) => fmtMoney(n, 2);
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
};
const hours = (n) => `${Math.round(Number(n || 0) * 100) / 100}h`;
const bytes = (n) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);
function daysFrom(s) {
  const a = parseLocal(s.slice(0, 10)); const b = parseLocal(todayStr());
  return Math.round((a - b) / 86400000);
}
function dueLabel(s, done) {
  if (!s) return '';
  const n = daysFrom(s);
  if (done) return h`<span class="muted">${fmtDate(s)}</span>`;
  if (n < 0) return h`<span class="overdue">${fmtDate(s)} · ${-n}d overdue</span>`;
  if (n === 0) return h`<span class="soon">Today</span>`;
  if (n === 1) return h`<span class="soon">Tomorrow</span>`;
  if (n <= 7) return h`<span class="soon">${fmtDate(s)} · in ${n}d</span>`;
  return h`<span>${fmtDate(s)}</span>`;
}
const badge = (cls, text) => h`<span class="badge ${cls}">${label(text)}</span>`;
const statusBadge = (s) => badge(`b-${s}`, s);
const prioBadge = (p) => badge(`p-${p}`, p);
const kindBadge = (k) => badge(`k-${k}`, k);

function toast(msg, err = false) {
  const t = $('#toast');
  t.textContent = msg; t.className = `show${err ? ' err' : ''}`;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { t.className = ''; }, 2600);
}

const ICONS = {
  dash: 'M3 13h8V3H3zm0 8h8v-6H3zm10 0h8V11h-8zm0-18v6h8V3z',
  cases: 'M10 2h4a2 2 0 0 1 2 2v2h4a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4V4a2 2 0 0 1 2-2m4 4V4h-4v2z',
  cal: 'M19 4h-1V2h-2v2H8V2H6v2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2m0 16H5V9h14z',
  tasks: 'M19 3h-4.18A3 3 0 0 0 12 1a3 3 0 0 0-2.82 2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2m-9 14-4-4 1.41-1.41L10 14.17l6.59-6.59L18 9z',
  clients: 'M16 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6m-8 0a3 3 0 1 0 0-6 3 3 0 0 0 0 6m0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5C15 14.17 10.33 13 8 13m8 0c-.29 0-.62.02-.97.05A4.2 4.2 0 0 1 17 16.5V19h6v-2.5c0-2.33-4.67-3.5-7-3.5',
  time: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20m4.2 14.2L11 13V7h1.5v5.2l4.5 2.7z',
  conflict: 'M15.5 14h-.79l-.28-.27A6.47 6.47 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16a6.47 6.47 0 0 0 4.23-1.57l.27.28v.79l5 4.99L20.49 19zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14',
  reports: 'M5 9.2h3V19H5zM10.6 5h2.8v14h-2.8zm5.6 8H19v6h-2.8z',
  users: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8m0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4',
  logo: 'M12 2 3 6v2h18V6zM5 10v8h2v-8zm6 0v8h2v-8zm6 0v8h2v-8zM3 20v2h18v-2z',
  board: 'M4 4h4v16H4zm6 0h4v10h-4zm6 0h4v13h-4z',
  billing: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zm-1 7V3.5L18.5 9zM8 13h8v2H8zm0 4h5v2H8z',
  calc: 'M7 2h10a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2m0 2v4h10V4zm0 6v2h2v-2zm4 0v2h2v-2zm4 0v2h2v-2zm-8 4v2h2v-2zm4 0v2h2v-2zm4 0v6h2v-6zm-8 4v2h2v-2zm4 0v2h2v-2z',
  settings: 'M19.14 12.94a7 7 0 0 0 0-1.88l2.03-1.58-1.92-3.32-2.39.96a7 7 0 0 0-1.63-.94L14.87 3.6h-3.84l-.36 2.58a7 7 0 0 0-1.63.94l-2.39-.96-1.92 3.32 2.03 1.58a7 7 0 0 0 0 1.88l-2.03 1.58 1.92 3.32 2.39-.96c.5.38 1.05.7 1.63.94l.36 2.58h3.84l.36-2.58a7 7 0 0 0 1.63-.94l2.39.96 1.92-3.32zM12.95 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7',
  bell: 'M12 22a2 2 0 0 0 2-2h-4a2 2 0 0 0 2 2m6-6V11a6 6 0 0 0-5-5.91V4a1 1 0 0 0-2 0v1.09A6 6 0 0 0 6 11v5l-2 2v1h16v-1z',
};
const icon = (k) => raw(`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${ICONS[k]}"/></svg>`);

// ------------------------------------------------------------------ API
async function api(method, url, body, opts = {}) {
  const init = { method, headers: {}, credentials: 'same-origin' };
  if (body instanceof Blob) { init.body = body; Object.assign(init.headers, opts.headers || {}); } else if (body !== undefined) {
    init.body = JSON.stringify(body); init.headers['Content-Type'] = 'application/json';
  }
  const r = await fetch(url, init);
  const data = r.headers.get('content-type')?.includes('json') ? await r.json() : await r.text();
  if (r.status === 401 && url !== '/api/login') { state.me = null; renderLogin(); throw new Error('Session expired'); }
  if (!r.ok) throw new Error(data.error || `Request failed (${r.status})`);
  return data;
}
const GET = (u) => api('GET', u);
const qs = (o) => { const p = new URLSearchParams(); Object.entries(o).forEach(([k, v]) => { if (v !== '' && v != null) p.set(k, v); }); const s = p.toString(); return s ? `?${s}` : ''; };

// ------------------------------------------------------------------ state
const state = { me: null, enums: {}, closed: [], users: [], clients: [], settings: {}, notifications: [] };
const canBill = () => ['admin', 'partner', 'attorney'].includes(state.me?.role);
const userName = (id) => state.users.find((u) => u.id === id)?.name || '';
const activeUsers = () => state.users.filter((u) => u.active);
const isManager = () => ['admin', 'partner'].includes(state.me?.role);
async function loadLookups() {
  [state.users, state.clients, state.settings] = await Promise.all([GET('/api/users'), GET('/api/clients'), GET('/api/settings')]);
}

// ------------------------------------------------------------------ event delegation
let acts = {};
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el || !acts[el.dataset.act]) return;
  e.preventDefault();
  Promise.resolve(acts[el.dataset.act](el, e)).catch((err) => toast(err.message, true));
});
document.addEventListener('change', (e) => {
  const el = e.target.closest('[data-change]');
  if (!el || !acts[el.dataset.change]) return;
  Promise.resolve(acts[el.dataset.change](el, e)).catch((err) => toast(err.message, true));
});
document.addEventListener('submit', (e) => {
  const el = e.target.closest('form[data-submit]');
  if (!el || !acts[el.dataset.submit]) return;
  e.preventDefault();
  Promise.resolve(acts[el.dataset.submit](el, e)).catch((err) => toast(err.message, true));
});
document.addEventListener('mousedown', (e) => { if (e.target.classList?.contains('modal-backdrop')) closeModal(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

// ------------------------------------------------------------------ modal forms
const opts = (list, withBlank = '—') => [...(withBlank !== null ? [['', withBlank]] : []), ...list.map((x) => (Array.isArray(x) ? x : [x, label(x)]))];
const enumOpts = (key, blank = null) => opts(state.enums[key] || [], blank);
const userOpts = (blank = '—') => opts(activeUsers().map((u) => [u.id, u.name]), blank);
const clientOpts = () => opts(state.clients.map((c) => [c.id, c.name]));

function fieldHtml(f, v) {
  const id = `f_${f.name}`;
  const req = f.required ? raw(' required') : '';
  let input;
  if (f.type === 'select') {
    input = h`<select id="${id}" name="${f.name}"${req}>${f.options.map(([ov, ol]) => h`<option value="${ov}"${String(ov) === String(v ?? '') ? raw(' selected') : ''}>${ol}</option>`)}</select>`;
  } else if (f.type === 'textarea') {
    input = h`<textarea id="${id}" name="${f.name}" rows="${f.rows || 4}"${req}>${v ?? ''}</textarea>`;
  } else if (f.type === 'checkbox') {
    return h`<div class="field ${f.full ? 'full' : ''}"><label class="check-list"><span><input type="checkbox" name="${f.name}"${v ? raw(' checked') : ''}> ${f.label}</span></label></div>`;
  } else if (f.type === 'checks') {
    const set = new Set((v || []).map(String));
    input = h`<div class="check-list">${f.options.map(([ov, ol]) => h`<label><input type="checkbox" name="${f.name}" value="${ov}"${set.has(String(ov)) ? raw(' checked') : ''}> ${ol}</label>`)}</div>`;
  } else {
    const type = { date: 'date', datetime: 'datetime-local', number: 'number', email: 'email', password: 'password', file: 'file' }[f.type] || 'text';
    const extra = raw([f.step ? ` step="${f.step}"` : '', f.min != null ? ` min="${f.min}"` : '', f.list ? ` list="dl_${f.name}"` : '', f.placeholder ? ` placeholder="${escHtml(f.placeholder)}"` : '', f.autocomplete ? ` autocomplete="${f.autocomplete}"` : ''].join(''));
    input = h`<input id="${id}" type="${type}" name="${f.name}" value="${type === 'file' ? '' : v ?? ''}"${req}${extra}>`;
    if (f.list) input = h`${input}<datalist id="dl_${f.name}">${f.list.map((o) => h`<option value="${o}">`)}</datalist>`;
  }
  return h`<div class="field ${f.full ? 'full' : ''}"><label for="${id}">${f.label}${f.required ? ' *' : ''}</label>${input}${f.help ? h`<div class="muted small">${f.help}</div>` : ''}</div>`;
}

function readForm(form, fields) {
  const out = {};
  for (const f of fields) {
    if (f.type === 'checks') out[f.name] = $$(`input[name="${f.name}"]:checked`, form).map((i) => Number(i.value));
    else if (f.type === 'checkbox') out[f.name] = form.elements[f.name].checked;
    else if (f.type === 'file') out[f.name] = form.elements[f.name].files[0];
    else {
      let v = form.elements[f.name].value;
      if (f.numeric && v !== '') v = Number(v);
      out[f.name] = v;
    }
  }
  return out;
}

function closeModal() { $('#modal-root').innerHTML = ''; }

function openForm({ title, fields, values = {}, submitLabel = 'Save', onSubmit, size = '', extraButtons = '' }) {
  $('#modal-root').innerHTML = val(h`
    <div class="modal-backdrop">
      <form class="modal ${size}" data-submit="modalSubmit" novalidate>
        <div class="modal-head"><h2>${title}</h2><button type="button" class="link" data-act="closeModal" aria-label="Close">✕</button></div>
        <div class="modal-body"><div class="error" hidden></div><div class="form-grid">${fields.map((f) => fieldHtml(f, values[f.name]))}</div></div>
        <div class="modal-foot">${raw(extraButtons)}<button type="button" data-act="closeModal">Cancel</button><button class="primary" type="submit">${submitLabel}</button></div>
      </form>
    </div>`);
  const form = $('#modal-root form');
  const first = form.querySelector('input:not([type=checkbox]),select,textarea');
  if (first) first.focus();
  acts.modalSubmit = async () => {
    const errBox = $('.error', form);
    for (const f of fields) {
      if (f.required && f.type !== 'checks' && !form.elements[f.name].value) {
        errBox.textContent = `${f.label} is required`; errBox.hidden = false; form.elements[f.name].focus(); return;
      }
    }
    const btn = $('button[type=submit]', form); btn.disabled = true;
    try {
      await onSubmit(readForm(form, fields));
      closeModal();
    } catch (err) {
      errBox.textContent = err.message; errBox.hidden = false;
    } finally { btn.disabled = false; }
  };
}

function confirmDialog(message, okLabel = 'Delete') {
  return new Promise((resolve) => {
    $('#modal-root').innerHTML = val(h`
      <div class="modal-backdrop"><div class="modal sm">
        <div class="modal-head"><h2>Please confirm</h2></div>
        <div class="modal-body">${message}</div>
        <div class="modal-foot"><button type="button" data-act="confirmNo">Cancel</button><button type="button" class="primary" data-act="confirmYes">${okLabel}</button></div>
      </div></div>`);
    acts.confirmYes = () => { closeModal(); resolve(true); };
    acts.confirmNo = () => { closeModal(); resolve(false); };
  });
}

// ------------------------------------------------------------------ shared form definitions
const CASE_TYPES = ['Commercial / Contract', 'Personal Injury', 'Employment', 'Construction', 'Real Estate', 'Family', 'Criminal Defense',
  'Intellectual Property', 'Insurance', 'Administrative', 'Debt Recovery', 'Arbitration'];

function caseFields() {
  return [
    { name: 'title', label: 'Matter title', required: true, full: true, placeholder: 'e.g. Smith v. Jones' },
    { name: 'internal_ref', label: 'Internal reference', placeholder: 'Auto-generated if blank' },
    { name: 'case_number', label: 'Court case number' },
    { name: 'client_id', label: 'Client', type: 'select', options: clientOpts(), numeric: true },
    { name: 'client_role', label: 'Client role', type: 'select', options: enumOpts('client_role', '—') },
    { name: 'opposing_party', label: 'Opposing party' },
    { name: 'opposing_counsel', label: 'Opposing counsel' },
    { name: 'court', label: 'Court / tribunal' },
    { name: 'judge', label: 'Judge' },
    { name: 'jurisdiction', label: 'Jurisdiction' },
    { name: 'case_type', label: 'Practice area', list: CASE_TYPES },
    { name: 'status', label: 'Status', type: 'select', options: enumOpts('case_status') },
    { name: 'priority', label: 'Priority', type: 'select', options: enumOpts('priority') },
    { name: 'lead_attorney_id', label: 'Lead attorney', type: 'select', options: userOpts(), numeric: true },
    { name: 'filed_date', label: 'Filed date', type: 'date' },
    { name: 'statute_of_limitations', label: 'Limitation deadline', type: 'date' },
    { name: 'closed_date', label: 'Closed date', type: 'date' },
    { name: 'claim_amount', label: 'Amount in dispute', type: 'number', step: '0.01', numeric: true },
    { name: 'fee_arrangement', label: 'Fee arrangement', list: ['Hourly', 'Contingency', 'Fixed fee', 'Retainer', 'Pro bono'] },
    { name: 'team', label: 'Case team', type: 'checks', options: activeUsers().map((u) => [u.id, u.name]), full: true },
    { name: 'description', label: 'Summary', type: 'textarea', full: true },
    { name: 'outcome', label: 'Outcome / resolution', type: 'textarea', full: true, rows: 2 },
  ];
}

async function caseOptions() {
  const cases = await GET('/api/cases?status=open');
  return opts(cases.map((c) => [c.id, `${c.internal_ref || ''} — ${c.title}`]), 'Select a matter…');
}

const eventFields = (caseOpts) => [
  ...(caseOpts ? [{ name: 'case_id', label: 'Matter', type: 'select', options: caseOpts, required: true, full: true, numeric: true }] : []),
  { name: 'title', label: 'Title', required: true, full: true },
  { name: 'kind', label: 'Type', type: 'select', options: enumOpts('event_kind') },
  { name: 'starts_at', label: 'Date & time', type: 'datetime', required: true },
  { name: 'location', label: 'Location', full: true },
  { name: 'notes', label: 'Notes', type: 'textarea', full: true, rows: 3 },
  { name: 'completed', label: 'Completed / held', type: 'checkbox', full: true },
];

const taskFields = (caseOpts) => [
  { name: 'title', label: 'Task', required: true, full: true },
  ...(caseOpts ? [{ name: 'case_id', label: 'Matter', type: 'select', options: caseOpts.map(([v, l]) => [v, v === '' ? '— General (no matter)' : l]), full: true, numeric: true }] : []),
  { name: 'assignee_id', label: 'Assigned to', type: 'select', options: userOpts('Unassigned'), numeric: true },
  { name: 'due_date', label: 'Due date', type: 'date' },
  { name: 'priority', label: 'Priority', type: 'select', options: enumOpts('priority') },
  { name: 'status', label: 'Status', type: 'select', options: enumOpts('task_status') },
  { name: 'notes', label: 'Notes', type: 'textarea', full: true, rows: 3 },
];

const timeFields = (caseOpts) => [
  ...(caseOpts ? [{ name: 'case_id', label: 'Matter', type: 'select', options: caseOpts, required: true, full: true, numeric: true }] : []),
  { name: 'work_date', label: 'Date', type: 'date', required: true },
  { name: 'hours', label: 'Hours', type: 'number', step: '0.1', min: 0, required: true, numeric: true },
  { name: 'user_id', label: 'Timekeeper', type: 'select', options: userOpts(null), numeric: true },
  { name: 'rate', label: 'Rate (per hour)', type: 'number', step: '0.01', numeric: true, help: 'Leave blank to use the timekeeper\'s default rate' },
  { name: 'description', label: 'Description of work', type: 'textarea', full: true, rows: 3 },
  { name: 'billable', label: 'Billable', type: 'checkbox', full: true },
];

const clientFields = () => [
  { name: 'name', label: 'Client name', required: true, full: true },
  { name: 'type', label: 'Type', type: 'select', options: enumOpts('client_type') },
  { name: 'contact_person', label: 'Contact person' },
  { name: 'email', label: 'Email', type: 'email' },
  { name: 'phone', label: 'Phone' },
  { name: 'address', label: 'Address', full: true },
  { name: 'notes', label: 'Notes', type: 'textarea', full: true, rows: 3 },
];

function editEvent(ev, { caseOpts, after }) {
  openForm({
    title: ev?.id ? 'Edit event' : 'Schedule hearing / deadline',
    fields: eventFields(caseOpts),
    values: ev?.id ? ev : { kind: 'hearing', ...ev },
    onSubmit: async (d) => {
      if (ev?.id) await api('PUT', `/api/events/${ev.id}`, d); else await api('POST', '/api/events', { ...d, case_id: d.case_id || ev.case_id });
      toast('Event saved'); after();
    },
  });
}
function editTask(t, { caseOpts, after }) {
  openForm({
    title: t?.id ? 'Edit task' : 'New task',
    fields: taskFields(caseOpts),
    values: t?.id ? t : { status: 'todo', priority: 'normal', assignee_id: state.me.id, ...t },
    onSubmit: async (d) => {
      const body = caseOpts ? d : { ...d, case_id: t.case_id };
      if (t?.id) await api('PUT', `/api/tasks/${t.id}`, body); else await api('POST', '/api/tasks', body);
      toast('Task saved'); after();
    },
  });
}
function editTime(te, { caseOpts, after }) {
  openForm({
    title: te?.id ? 'Edit time entry' : 'Log time',
    fields: timeFields(caseOpts),
    values: te?.id ? te : { work_date: todayStr(), billable: true, user_id: state.me.id, ...te },
    onSubmit: async (d) => {
      const body = caseOpts ? d : { ...d, case_id: te.case_id };
      if (te?.id) await api('PUT', `/api/time/${te.id}`, body); else await api('POST', '/api/time', body);
      toast('Time saved'); after();
    },
  });
}
function editCase(c, after) {
  openForm({
    title: c?.id ? 'Edit matter' : 'Open new matter',
    fields: caseFields(),
    values: c?.id ? { ...c, team: c.team?.map((u) => u.id) } : { status: 'intake', priority: 'normal', lead_attorney_id: state.me.id, ...c },
    onSubmit: async (d) => {
      if (c?.id) { await api('PUT', `/api/cases/${c.id}`, d); toast('Matter updated'); after(c.id); } else {
        const r = await api('POST', '/api/cases', d); toast('Matter opened'); after(r.id);
      }
    },
  });
}
function editClient(c, after) {
  openForm({
    title: c?.id ? 'Edit client' : 'New client',
    fields: clientFields(),
    values: c?.id ? c : { type: 'individual' },
    onSubmit: async (d) => {
      let id = c?.id;
      if (id) await api('PUT', `/api/clients/${id}`, d); else id = (await api('POST', '/api/clients', d)).id;
      state.clients = await GET('/api/clients');
      toast('Client saved'); after(id);
    },
  });
}

// ------------------------------------------------------------------ shell & router
const NAV = [
  ['dashboard', 'Dashboard', 'dash'], ['cases', 'Cases', 'cases'], ['board', 'Case board', 'board'], ['calendar', 'Calendar', 'cal'],
  ['tasks', 'Tasks', 'tasks'], ['clients', 'Clients', 'clients'], ['time', 'Time & expenses', 'time'], ['billing', 'Billing', 'billing'],
  ['conflicts', 'Conflict check', 'conflict'], ['deadlines', 'Deadline calculator', 'calc'], ['reports', 'Reports', 'reports'],
];

function renderShell() {
  const nav = [...NAV, ...(state.me.role === 'admin' ? [['settings', 'Settings', 'settings'], ['users', 'Users', 'users']] : [])];
  $('#app').innerHTML = val(h`
    <div class="shell">
      <aside class="sidebar" id="sidebar">
        <div class="logo">${icon('logo')} <span>Litigation Manager<div class="firm">${state.settings.firm_name}</div></span></div>
        <nav class="nav">${nav.map(([k, l, i]) => h`<a href="#/${k}" data-nav="${k}">${icon(i)} ${l}</a>`)}</nav>
        <div class="spacer"></div>
        <div class="userbox">
          <div class="name">${state.me.name}</div>
          <div>${label(state.me.role)}</div>
          <div class="actions"><button class="ghost" data-act="go" data-href="#/account">Account</button><button class="ghost" data-act="logout">Sign out</button></div>
        </div>
      </aside>
      <main class="main">
        <div class="topbar">
          <button class="menu-toggle" data-act="toggleMenu">☰ Menu</button>
          <form class="search-box" data-submit="globalSearch" role="search"><input type="search" name="q" placeholder="Search cases, clients, contacts, documents, notes…" aria-label="Search everything"></form>
          <div id="timer" class="timer"></div>
          <div class="bell-wrap"><button class="bell" data-act="toggleBell" aria-label="Notifications">${icon('bell')}<span id="bell-count" class="bell-count" hidden></span></button>
            <div id="bell-panel" class="bell-panel" hidden></div></div>
        </div>
        <div id="view"></div>
      </main>
    </div>`);
}

const view = () => $('#view');
function setView(html) { view().innerHTML = val(html); }
const loading = () => setView(h`<div class="empty">Loading…</div>`);

const ROUTES = [
  [/^\/dashboard$/, () => viewDashboard()],
  [/^\/cases$/, () => viewCases()],
  [/^\/cases\/(\d+)(?:\/(\w+))?$/, (m) => viewCase(Number(m[1]), m[2] || 'overview')],
  [/^\/calendar(?:\/(\d{4})-(\d{2}))?$/, (m) => viewCalendar(m[1] ? Number(m[1]) : null, m[2] ? Number(m[2]) : null)],
  [/^\/tasks$/, () => viewTasks()],
  [/^\/clients$/, () => viewClients()],
  [/^\/clients\/(\d+)$/, (m) => viewClient(Number(m[1]))],
  [/^\/time$/, () => viewTime()],
  [/^\/conflicts$/, () => viewConflicts()],
  [/^\/reports$/, () => viewReports()],
  [/^\/users$/, () => viewUsers()],
  [/^\/board$/, () => viewBoard()],
  [/^\/billing$/, () => viewBilling()],
  [/^\/invoices\/(\d+)$/, (m) => viewInvoice(Number(m[1]))],
  [/^\/deadlines$/, () => viewDeadlines()],
  [/^\/search$/, (m, q) => viewSearch(q.get('q') || '')],
  [/^\/settings$/, () => viewSettings()],
  [/^\/account$/, () => viewAccount()],
];

const baseActs = {
  logout: async () => { await api('POST', '/api/logout'); state.me = null; location.hash = ''; renderLogin(); },
  toggleMenu: () => $('#sidebar').classList.toggle('open'),
  closeModal: () => closeModal(),
  go: (el) => { location.hash = el.dataset.href; },
  globalSearch: (form) => { const q = form.q.value.trim(); if (q.length >= 2) location.hash = `#/search?q=${encodeURIComponent(q)}`; },
  toggleBell: () => { const p = $('#bell-panel'); p.hidden = !p.hidden; },
  timerStart: () => { store.set('lm_timer', { running: true, start: Date.now(), elapsed: 0 }); renderTimer(); },
  timerPause: () => {
    const t = store.get('lm_timer'); if (!t) return;
    if (t.running) store.set('lm_timer', { running: false, elapsed: t.elapsed + (Date.now() - t.start) });
    else store.set('lm_timer', { running: true, start: Date.now(), elapsed: t.elapsed });
    renderTimer();
  },
  timerStop: async () => {
    const ms = timerMs();
    store.set('lm_timer', null); renderTimer();
    const hrs = Math.max(0.1, Math.ceil((ms / 3600000) * 10) / 10);
    editTime({ hours: hrs, description: '' }, { caseOpts: await caseOptions(), after: () => { if (/^#\/(time|cases)/.test(location.hash)) rerender(); } });
  },
  timerDiscard: async () => { if (await confirmDialog('Discard the running timer?', 'Discard')) { store.set('lm_timer', null); renderTimer(); } },
};

// ------------------------------------------------------------------ timer
function timerMs() {
  const t = store.get('lm_timer');
  if (!t) return 0;
  return t.elapsed + (t.running ? Date.now() - t.start : 0);
}
function fmtClock(ms) {
  const sec = Math.floor(ms / 1000);
  return `${pad(Math.floor(sec / 3600))}:${pad(Math.floor((sec % 3600) / 60))}:${pad(sec % 60)}`;
}
function renderTimer() {
  const el = $('#timer'); if (!el) return;
  const t = store.get('lm_timer');
  el.innerHTML = val(t
    ? h`<span class="clock ${t.running ? 'running' : ''}" id="timer-clock">${fmtClock(timerMs())}</span>
      <button class="link" data-act="timerPause" title="${t.running ? 'Pause' : 'Resume'}">${t.running ? '⏸' : '▶'}</button>
      <button class="link" data-act="timerStop" title="Stop and log time">■ Log</button>
      <button class="link danger" data-act="timerDiscard" title="Discard">✕</button>`
    : h`<button data-act="timerStart" title="Start a stopwatch to time your work">⏱ Start timer</button>`);
}
setInterval(() => { const c = $('#timer-clock'); if (c) c.textContent = fmtClock(timerMs()); }, 1000);

// ------------------------------------------------------------------ notifications
async function loadNotifications() {
  try { state.notifications = await GET('/api/notifications'); } catch { return; }
  const n = state.notifications.length;
  const badgeEl = $('#bell-count'); const panel = $('#bell-panel');
  if (!badgeEl) return;
  badgeEl.hidden = !n; badgeEl.textContent = n > 99 ? '99+' : n;
  panel.innerHTML = val(h`<div class="bell-head"><b>Notifications</b><span class="muted small">${n} item${n === 1 ? '' : 's'}</span></div>
    ${n ? h`<ul class="list">${state.notifications.map((x) => h`<li><span class="dot ${x.level}"></span><a class="grow" href="${x.link}">${x.text}<div class="muted small">${x.sub}</div></a></li>`)}</ul>`
    : h`<div class="empty">You're all caught up.</div>`}`);
}
document.addEventListener('click', (e) => {
  const p = $('#bell-panel');
  if (p && !p.hidden && !e.target.closest('.bell-wrap')) p.hidden = true;
  if (p && !p.hidden && e.target.closest('#bell-panel a')) p.hidden = true;
});

async function router() {
  if (!state.me) return;
  const [path0, qstr] = location.hash.replace(/^#/, '').split('?');
  const path = path0 || '/dashboard';
  const query = new URLSearchParams(qstr || '');
  const top = path.split('/')[1];
  const navKey = top === 'invoices' ? 'billing' : top;
  $$('[data-nav]').forEach((a) => a.classList.toggle('active', a.dataset.nav === navKey));
  $('#sidebar')?.classList.remove('open');
  closeModal();
  acts = { ...baseActs };
  for (const [re, fn] of ROUTES) {
    const m = path.match(re);
    if (m) {
      loading();
      loadNotifications();
      try { await fn(m, query); } catch (err) { if (err.message !== 'Session expired') setView(h`<div class="card"><div class="empty">${err.message}</div></div>`); }
      return;
    }
  }
  location.hash = '#/dashboard';
}
window.addEventListener('hashchange', router);
const rerender = () => router();

// ------------------------------------------------------------------ login
function renderLogin() {
  acts = {
    ...baseActs,
    login: async (form) => {
      const err = $('.error', form);
      try {
        state.me = await api('POST', '/api/login', { email: form.email.value, password: form.password.value });
        await boot();
      } catch (e) { err.textContent = e.message; err.hidden = false; }
    },
  };
  $('#app').innerHTML = val(h`
    <div class="login-wrap">
      <form class="card login" data-submit="login">
        <div class="logo">${icon('logo')} Litigation Manager</div>
        <p class="muted" style="margin-top:0">Sign in to manage your firm's matters.</p>
        <div class="error" hidden></div>
        <div class="field"><label for="email">Email</label><input id="email" name="email" type="email" autocomplete="username" required autofocus></div>
        <div class="field"><label for="password">Password</label><input id="password" name="password" type="password" autocomplete="current-password" required></div>
        <button class="primary" type="submit" style="width:100%;justify-content:center">Sign in</button>
        <div class="hint muted">Demo accounts: <b>admin@firm.local</b> / admin123 &nbsp;·&nbsp; <b>sara@firm.local</b> / password</div>
      </form>
    </div>`);
}

// ------------------------------------------------------------------ dashboard
function eventItem(e, showCase = true) {
  const d = parseLocal(e.starts_at);
  return h`<li>
    <div class="datebox"><div class="m">${MONTHS[d.getMonth()]}</div><div class="d">${d.getDate()}</div></div>
    <div class="grow">
      <div>${kindBadge(e.kind)} <b>${e.title}</b></div>
      <div class="muted small">${fmtTime(e.starts_at)}${e.location ? ` · ${e.location}` : ''}</div>
      ${showCase ? h`<div class="small"><a href="#/cases/${e.case_id}/schedule">${e.internal_ref ? `${e.internal_ref} · ` : ''}${e.case_title}</a></div>` : ''}
    </div>
    <div class="small nowrap">${dueLabel(e.starts_at.slice(0, 10))}</div>
  </li>`;
}
function taskItem(t) {
  return h`<li>
    <input type="checkbox" data-change="toggleTask" data-id="${t.id}" ${t.status === 'done' ? raw('checked') : ''} aria-label="Mark done">
    <div class="grow"><div class="title">${t.title} ${t.priority !== 'normal' ? prioBadge(t.priority) : ''}</div>
      <div class="muted small">${t.case_id ? h`<a href="#/cases/${t.case_id}/tasks">${t.case_title}</a>` : 'General'}${t.assignee_name ? ` · ${t.assignee_name}` : ''}</div></div>
    <div class="small nowrap">${dueLabel(t.due_date, t.status === 'done')}</div>
  </li>`;
}
const listOrEmpty = (items, fn, empty) => (items.length ? h`<ul class="list">${items.map(fn)}</ul>` : h`<div class="empty">${empty}</div>`);
const toggleTaskAct = async (el) => {
  await api('PUT', `/api/tasks/${el.dataset.id}`, { status: el.checked ? 'done' : 'todo' });
  toast(el.checked ? 'Task completed' : 'Task reopened');
};

async function viewDashboard() {
  const d = await GET('/api/dashboard');
  const c = d.counts;
  acts.toggleTask = async (el) => { await toggleTaskAct(el); rerender(); };
  acts.newCase = () => editCase(null, (id) => { location.hash = `#/cases/${id}`; });
  setView(h`
    <div class="page-head"><div><h1>Good ${new Date().getHours() < 12 ? 'morning' : new Date().getHours() < 18 ? 'afternoon' : 'evening'}, ${state.me.name.split(' ')[0]}</h1>
      <div class="muted sub">${fmtDate(d.today)}</div></div>
      <button class="primary" data-act="newCase">+ New matter</button></div>
    <div class="stats">
      <a class="card stat" href="#/cases"><div class="label">Open matters</div><div class="value">${c.open_cases}</div></a>
      <div class="card stat"><div class="label">My open matters</div><div class="value">${c.my_cases}</div></div>
      <a class="card stat" href="#/calendar"><div class="label">Events next 7 days</div><div class="value">${c.events_week}</div></a>
      <a class="card stat ${c.overdue_tasks ? 'alert' : ''}" href="#/tasks"><div class="label">Overdue tasks</div><div class="value">${c.overdue_tasks}</div></a>
      <a class="card stat" href="#/time"><div class="label">My hours this month</div><div class="value">${hours(c.my_hours_month)}</div></a>
      ${canBill() ? h`<a class="card stat" href="#/billing"><div class="label">Unbilled work</div><div class="value">${money(c.unbilled)}</div></a>
      <a class="card stat" href="#/billing"><div class="label">Outstanding invoices</div><div class="value">${money(c.outstanding)}</div></a>` : ''}
    </div>
    ${d.missed.length ? h`<div class="card" style="margin-bottom:16px;border-color:#fecdca"><div class="card-head"><h2 class="overdue">Past events not marked done</h2></div>
      <div class="card-body flush">${listOrEmpty(d.missed, (e) => eventItem(e), '')}</div></div>` : ''}
    <div class="grid cols-2">
      <div class="card"><div class="card-head"><h2>Upcoming hearings & deadlines</h2><a href="#/calendar" class="small">Calendar →</a></div>
        <div class="card-body flush">${listOrEmpty(d.upcoming, (e) => eventItem(e), 'Nothing scheduled in the next 30 days.')}</div></div>
      <div class="card"><div class="card-head"><h2>My open tasks</h2><a href="#/tasks" class="small">All tasks →</a></div>
        <div class="card-body flush">${listOrEmpty(d.my_tasks, taskItem, 'No open tasks assigned to you.')}</div></div>
      <div class="card"><div class="card-head"><h2>Overdue tasks (firm-wide)</h2></div>
        <div class="card-body flush">${listOrEmpty(d.overdue, taskItem, 'Nothing overdue. 🎉')}</div></div>
      <div class="card"><div class="card-head"><h2>Limitation deadlines (next 12 months)</h2></div>
        <div class="card-body flush">${listOrEmpty(d.sol, (s) => h`<li><div class="grow"><a href="#/cases/${s.id}">${s.internal_ref} · ${s.title}</a></div><div class="small nowrap">${dueLabel(s.statute_of_limitations)}</div></li>`, 'No limitation deadlines tracked.')}</div></div>
      <div class="card"><div class="card-head"><h2>Matters by status</h2></div>
        <div class="card-body">${bars(d.by_status.map((r) => ({ label: label(r.status), n: r.n })))}</div></div>
      <div class="card"><div class="card-head"><h2>Recent activity</h2></div>
        <div class="card-body flush">${activityList(d.activity, true)}</div></div>
    </div>`);
}

function bars(rows, fmt = (n) => n) {
  if (!rows.length) return h`<div class="empty">No data.</div>`;
  const max = Math.max(...rows.map((r) => r.n), 1);
  return rows.map((r) => h`<div class="bar-row"><div class="small" title="${r.label}" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${r.label}</div>
    <div class="bar"><span style="width:${((r.n / max) * 100).toFixed(1)}%"></span></div><div class="small right">${fmt(r.n)}</div></div>`);
}
function activityList(items, showCase) {
  return listOrEmpty(items, (a) => h`<li><div class="grow"><div>${a.action}</div>
    <div class="muted small">${a.user_name || 'System'} · ${fmtStamp(a.created_at)}${showCase && a.case_title ? h` · <a href="#/cases/${a.case_id}">${a.case_title}</a>` : ''}</div></div></li>`, 'No activity yet.');
}

// ------------------------------------------------------------------ cases list
const caseFilter = { q: '', status: 'open', attorney: '', priority: '', case_type: '' };
async function viewCases() {
  const rows = await GET(`/api/cases${qs(caseFilter)}`);
  const statusOpts = [['open', 'All open'], ['closed', 'All closed'], ['', 'All matters'], ...state.enums.case_status.map((s) => [s, label(s)])];
  acts.filter = (el) => { caseFilter[el.name] = el.value; rerender(); };
  acts.search = (form) => { caseFilter.q = form.q.value.trim(); rerender(); };
  acts.newCase = () => editCase(null, (id) => { location.hash = `#/cases/${id}`; });
  const sel = (name, options) => h`<select name="${name}" data-change="filter">${options.map(([v, l]) => h`<option value="${v}"${String(caseFilter[name]) === String(v) ? raw(' selected') : ''}>${l}</option>`)}</select>`;
  setView(h`
    <div class="page-head"><div><h1>Cases</h1><div class="muted sub">${rows.length} matter${rows.length === 1 ? '' : 's'}</div></div>
      <div class="actions"><a class="btn" href="/api/export/cases.csv">Export CSV</a><button class="primary" data-act="newCase">+ New matter</button></div></div>
    <div class="toolbar">
      <form data-submit="search" style="display:contents"><input type="search" name="q" placeholder="Search title, number, client, opposing party, court, judge…" value="${caseFilter.q}"></form>
      ${sel('status', statusOpts)}
      ${sel('attorney', [['', 'Any attorney'], ...activeUsers().map((u) => [u.id, u.name])])}
      ${sel('priority', [['', 'Any priority'], ...state.enums.priority.map((p) => [p, label(p)])])}
    </div>
    <div class="card"><div class="table-wrap">${rows.length ? h`<table>
      <thead><tr><th>Ref</th><th>Matter</th><th>Court</th><th>Status</th><th>Priority</th><th>Lead</th><th>Next event</th><th class="right">Open tasks</th></tr></thead>
      <tbody>${rows.map((c) => h`<tr class="click" data-act="go" data-href="#/cases/${c.id}">
        <td class="nowrap"><b>${c.internal_ref}</b><div class="muted small">${c.case_number}</div></td>
        <td><b>${c.title}</b><div class="muted small">${c.client_name || 'No client'}${c.client_role ? ` (${label(c.client_role)})` : ''}${c.opposing_party ? ` v. ${c.opposing_party}` : ''}</div></td>
        <td>${c.court}<div class="muted small">${c.judge}</div></td>
        <td>${statusBadge(c.status)}</td><td>${prioBadge(c.priority)}</td>
        <td class="nowrap">${c.lead_attorney_name}</td>
        <td class="nowrap small">${c.next_event ? dueLabel(c.next_event.slice(0, 10)) : h`<span class="muted">—</span>`}</td>
        <td class="right">${c.open_tasks}</td></tr>`)}</tbody></table>` : h`<div class="empty">No matters match these filters.</div>`}</div></div>`);
}

// ------------------------------------------------------------------ case detail
async function viewCase(id, tab) {
  const c = await GET(`/api/cases/${id}`);
  const reload = () => rerender();
  const TABS = [['overview', 'Overview'], ['schedule', 'Hearings & deadlines', c.counts.events], ['tasks', 'Tasks', c.counts.tasks],
    ['documents', 'Documents', c.counts.documents], ['notes', 'Notes', c.counts.notes], ['contacts', 'Contacts', c.counts.contacts],
    ['billing', 'Time & billing'], ['activity', 'Activity']];
  if (tab === 'time') tab = 'billing';
  Object.assign(acts, {
    editCase: () => editCase(c, reload),
    deleteCase: async () => {
      if (!(await confirmDialog(h`Delete <b>${c.title}</b> and all its events, tasks, notes, documents and time entries? This cannot be undone.`))) return;
      await api('DELETE', `/api/cases/${id}`); toast('Matter deleted'); location.hash = '#/cases';
    },
    printCase: () => { if (tab !== 'overview') { location.hash = `#/cases/${id}`; setTimeout(() => window.print(), 600); } else window.print(); },
    quickStatus: async (el) => { await api('PUT', `/api/cases/${id}`, { status: el.value }); toast('Status updated'); reload(); },
  });
  const head = h`
    <div style="margin-bottom:6px" class="small"><a href="#/cases">← Cases</a></div>
    <div class="page-head"><div>
        <h1>${c.title}</h1>
        <div class="muted sub">${c.internal_ref}${c.case_number ? ` · ${c.case_number}` : ''}${c.court ? ` · ${c.court}` : ''} &nbsp; ${statusBadge(c.status)} ${prioBadge(c.priority)}</div>
      </div>
      <div class="actions">
        <select data-change="quickStatus" aria-label="Change status" style="width:auto">${state.enums.case_status.map((s) => h`<option value="${s}"${s === c.status ? raw(' selected') : ''}>${label(s)}</option>`)}</select>
        <button data-act="printCase">Print summary</button>
        <button data-act="editCase">Edit</button>
        ${isManager() ? h`<button class="danger" data-act="deleteCase">Delete</button>` : ''}
      </div></div>
    <nav class="tabs">${TABS.map(([k, l, n]) => h`<a href="#/cases/${id}/${k}" class="${k === tab ? 'active' : ''}">${l}${n ? h`<span class="count">${n}</span>` : ''}</a>`)}</nav>`;
  const body = await ({ overview: caseOverview, schedule: caseSchedule, tasks: caseTasks, documents: caseDocuments, notes: caseNotes,
    contacts: caseContacts, billing: caseBilling, activity: caseActivity }[tab] || caseOverview)(c, reload);
  setView(h`${head}${body}`);
}

function kv(pairs) {
  return h`<dl class="kv">${pairs.filter(([, v]) => v !== '' && v != null).map(([k, v]) => h`<dt>${k}</dt><dd>${v}</dd>`)}</dl>`;
}
function caseOverview(c) {
  const cl = c.client;
  return h`<div class="grid cols-2">
    <div class="card"><div class="card-head"><h2>Matter</h2></div><div class="card-body">${kv([
      ['Practice area', c.case_type], ['Status', statusBadge(c.status)], ['Priority', prioBadge(c.priority)],
      ['Lead attorney', c.lead_attorney_name || '—'], ['Team', c.team.map((u) => u.name).join(', ') || '—'],
      ['Filed', fmtDate(c.filed_date)], ['Limitation deadline', c.statute_of_limitations ? dueLabel(c.statute_of_limitations) : ''],
      ['Closed', fmtDate(c.closed_date)], ['Amount in dispute', money(c.claim_amount)], ['Fee arrangement', c.fee_arrangement],
      ['Opened in system', fmtStamp(c.created_at)],
    ])}</div></div>
    <div class="card"><div class="card-head"><h2>Parties & court</h2></div><div class="card-body">${kv([
      ['Client', cl ? h`<a href="#/clients/${cl.id}">${cl.name}</a>` : '—'], ['Client role', label(c.client_role)],
      ['Opposing party', c.opposing_party], ['Opposing counsel', c.opposing_counsel], ['Court / tribunal', c.court],
      ['Judge', c.judge], ['Jurisdiction', c.jurisdiction], ['Court case no.', c.case_number],
    ])}</div></div>
    <div class="card"><div class="card-head"><h2>Summary</h2></div><div class="card-body pre">${c.description || h`<span class="muted">No summary yet.</span>`}</div>
      ${c.outcome ? h`<div class="card-head" style="border-top:1px solid var(--border)"><h2>Outcome</h2></div><div class="card-body pre">${c.outcome}</div>` : ''}</div>
    <div class="card"><div class="card-head"><h2>At a glance</h2></div><div class="card-body">${kv([
      ['Next event', c.next_event ? h`<a href="#/cases/${c.id}/schedule">${fmtDateTime(c.next_event)}</a>` : '—'],
      ['Open tasks', h`<a href="#/cases/${c.id}/tasks">${c.open_tasks}</a>`],
      ['Documents', h`<a href="#/cases/${c.id}/documents">${c.counts.documents}</a>`],
      ['Hours recorded', hours(c.totals.hours)], ['Billable time value', money2(c.totals.billable_value)],
      ['Expenses', money2(c.totals.expenses)], ['Unbilled (WIP)', h`<a href="#/cases/${c.id}/billing">${money2(c.totals.unbilled)}</a>`],
      ['Invoiced / paid', `${money2(c.totals.invoiced)} / ${money2(c.totals.paid)}`],
      ...(cl ? [['Client contact', [cl.contact_person, cl.email, cl.phone].filter(Boolean).join(' · ')]] : []),
    ])}</div></div>
  </div>`;
}

async function caseSchedule(c, reload) {
  const events = await GET(`/api/events?case_id=${c.id}`);
  Object.assign(acts, {
    addEvent: () => editEvent({ case_id: c.id }, { after: reload }),
    editEvent: (el) => editEvent(events.find((e) => e.id === +el.dataset.id), { after: reload }),
    toggleEvent: async (el) => { await api('PUT', `/api/events/${el.dataset.id}`, { completed: el.checked }); reload(); },
    outcome: (el) => recordOutcome(events.find((e) => e.id === +el.dataset.id), reload),
    delEvent: async (el) => {
      const e = events.find((x) => x.id === +el.dataset.id);
      if (await confirmDialog(h`Delete <b>${e.title}</b>?`)) { await api('DELETE', `/api/events/${e.id}`); toast('Event deleted'); reload(); }
    },
  });
  const t = todayStr();
  const upcoming = events.filter((e) => !e.completed && e.starts_at.slice(0, 10) >= t);
  const past = events.filter((e) => e.completed || e.starts_at.slice(0, 10) < t).reverse();
  const row = (e) => h`<tr class="${e.completed ? 'done-row' : ''}">
    <td><input type="checkbox" data-change="toggleEvent" data-id="${e.id}" ${e.completed ? raw('checked') : ''} aria-label="Done"></td>
    <td class="nowrap">${fmtDateTime(e.starts_at)}<div class="small">${e.completed ? '' : dueLabel(e.starts_at.slice(0, 10))}</div></td>
    <td>${kindBadge(e.kind)}</td><td><b class="title">${e.title}</b><div class="muted small pre">${e.notes}</div>
      ${e.outcome ? h`<div class="outcome small"><b>Outcome:</b> ${e.outcome}</div>` : ''}</td><td>${e.location}</td>
    <td class="right nowrap">${!e.completed && e.starts_at.slice(0, 10) <= t ? h`<button class="link" data-act="outcome" data-id="${e.id}"><b>Record outcome</b></button>` : ''}
      <button class="link" data-act="editEvent" data-id="${e.id}">Edit</button><button class="link danger" data-act="delEvent" data-id="${e.id}">Delete</button></td></tr>`;
  const table = (list, empty) => (list.length ? h`<div class="table-wrap"><table><thead><tr><th></th><th>When</th><th>Type</th><th>Event</th><th>Location</th><th></th></tr></thead><tbody>${list.map(row)}</tbody></table></div>` : h`<div class="empty">${empty}</div>`);
  return h`<div class="card" style="margin-bottom:16px"><div class="card-head"><h2>Upcoming</h2><button class="primary" data-act="addEvent">+ Add hearing / deadline</button></div>
    <div class="card-body flush">${table(upcoming, 'No upcoming events.')}</div></div>
    <div class="card"><div class="card-head"><h2>Past & completed</h2></div><div class="card-body flush">${table(past, 'None yet.')}</div></div>`;
}

function taskTable(tasks, { showCase = false } = {}) {
  if (!tasks.length) return h`<div class="empty">No tasks.</div>`;
  return h`<div class="table-wrap"><table><thead><tr><th></th><th>Task</th>${showCase ? h`<th>Matter</th>` : ''}<th>Assigned</th><th>Due</th><th>Priority</th><th>Status</th><th></th></tr></thead>
    <tbody>${tasks.map((t) => h`<tr class="${t.status === 'done' ? 'done-row' : ''}">
      <td><input type="checkbox" data-change="toggleTask" data-id="${t.id}" ${t.status === 'done' ? raw('checked') : ''} aria-label="Done"></td>
      <td><b class="title">${t.title}</b><div class="muted small pre">${t.notes}</div></td>
      ${showCase ? h`<td>${t.case_id ? h`<a href="#/cases/${t.case_id}/tasks">${t.internal_ref} · ${t.case_title}</a>` : h`<span class="muted">General</span>`}</td>` : ''}
      <td class="nowrap">${t.assignee_name || h`<span class="muted">Unassigned</span>`}</td>
      <td class="nowrap small">${dueLabel(t.due_date, t.status === 'done')}</td><td>${prioBadge(t.priority)}</td><td>${label(t.status)}</td>
      <td class="right nowrap"><button class="link" data-act="editTask" data-id="${t.id}">Edit</button><button class="link danger" data-act="delTask" data-id="${t.id}">Delete</button></td></tr>`)}</tbody></table></div>`;
}
function taskActs(tasks, reload, caseOpts) {
  Object.assign(acts, {
    toggleTask: async (el) => { await toggleTaskAct(el); reload(); },
    editTask: (el) => editTask(tasks.find((t) => t.id === +el.dataset.id), { caseOpts, after: reload }),
    delTask: async (el) => {
      const t = tasks.find((x) => x.id === +el.dataset.id);
      if (await confirmDialog(h`Delete task <b>${t.title}</b>?`)) { await api('DELETE', `/api/tasks/${t.id}`); toast('Task deleted'); reload(); }
    },
  });
}
async function caseTasks(c, reload) {
  const tasks = await GET(`/api/tasks?case_id=${c.id}`);
  taskActs(tasks, reload);
  acts.addTask = () => editTask({ case_id: c.id }, { after: reload });
  acts.applyChecklist = () => applyChecklist(c, reload);
  return h`<div class="card"><div class="card-head"><h2>Tasks</h2><div class="actions"><button data-act="applyChecklist">Apply checklist</button><button class="primary" data-act="addTask">+ Add task</button></div></div>
    <div class="card-body flush">${taskTable(tasks)}</div></div>`;
}

async function caseDocuments(c, reload) {
  const docs = await GET(`/api/documents?case_id=${c.id}`);
  Object.assign(acts, {
    upload: async (form) => {
      const files = [...form.file.files];
      if (!files.length) { toast('Choose a file first', true); return; }
      const btn = $('button[type=submit]', form); btn.disabled = true; btn.textContent = 'Uploading…';
      try {
        for (const f of files) {
          if (f.size > 25 * 1024 * 1024) throw new Error(`${f.name} is larger than 25 MB`);
          await api('POST', `/api/cases/${c.id}/documents`, f, { headers: { 'X-Filename': encodeURIComponent(f.name), 'X-Category': form.category.value, 'Content-Type': f.type || 'application/octet-stream' } });
        }
        toast(`${files.length} document${files.length > 1 ? 's' : ''} uploaded`); reload();
      } finally { btn.disabled = false; btn.textContent = 'Upload'; }
    },
    delDoc: async (el) => {
      const d = docs.find((x) => x.id === +el.dataset.id);
      if (await confirmDialog(h`Delete document <b>${d.name}</b>?`)) { await api('DELETE', `/api/documents/${d.id}`); toast('Document deleted'); reload(); }
    },
  });
  return h`<div class="card"><div class="card-head"><h2>Documents</h2></div>
    <div class="card-body" style="border-bottom:1px solid var(--border)">
      <form data-submit="upload" class="toolbar" style="margin:0">
        <input type="file" name="file" multiple style="max-width:340px">
        <select name="category">${state.enums.doc_category.map((k) => h`<option value="${k}">${label(k)}</option>`)}</select>
        <button class="primary" type="submit">Upload</button><span class="muted small">Max 25 MB per file</span>
      </form></div>
    <div class="card-body flush">${docs.length ? h`<div class="table-wrap"><table><thead><tr><th>Name</th><th>Category</th><th>Size</th><th>Uploaded</th><th></th></tr></thead>
      <tbody>${docs.map((d) => h`<tr><td><a href="/api/documents/${d.id}/download">${d.name}</a></td><td>${badge('', d.category)}</td><td class="nowrap">${bytes(d.size)}</td>
        <td class="small">${fmtStamp(d.created_at)}<div class="muted">${d.uploaded_by_name}</div></td>
        <td class="right nowrap"><a class="btn" href="/api/documents/${d.id}/download">Download</a> <button class="link danger" data-act="delDoc" data-id="${d.id}">Delete</button></td></tr>`)}</tbody></table></div>`
      : h`<div class="empty">No documents uploaded yet.</div>`}</div></div>`;
}

async function caseNotes(c, reload) {
  const notes = await GET(`/api/notes?case_id=${c.id}`);
  Object.assign(acts, {
    addNote: async (form) => {
      const body = form.body.value.trim();
      if (!body) return;
      await api('POST', '/api/notes', { case_id: c.id, body }); toast('Note added'); reload();
    },
    delNote: async (el) => {
      if (await confirmDialog('Delete this note?')) { await api('DELETE', `/api/notes/${el.dataset.id}`); toast('Note deleted'); reload(); }
    },
  });
  return h`<div class="card" style="margin-bottom:16px"><div class="card-body">
      <form data-submit="addNote"><div class="field"><label for="nb">Add a note</label><textarea id="nb" name="body" rows="3" placeholder="Call summaries, strategy, instructions from the client…"></textarea></div>
      <button class="primary" type="submit">Add note</button></form></div></div>
    ${notes.length ? notes.map((n) => h`<div class="card note" style="margin-bottom:10px"><div class="card-body">
      <div class="pre">${n.body}</div>
      <div class="muted small" style="margin-top:8px;display:flex;justify-content:space-between">${n.user_name} · ${fmtStamp(n.created_at)}
        ${n.user_id === state.me.id || isManager() ? h`<button class="link danger" data-act="delNote" data-id="${n.id}">Delete</button>` : ''}</div></div></div>`)
    : h`<div class="card"><div class="empty">No notes yet.</div></div>`}`;
}

function timeTable(entries, { showCase = false } = {}) {
  if (!entries.length) return h`<div class="empty">No time recorded.</div>`;
  const tot = entries.reduce((a, e) => ({ h: a.h + e.hours, v: a.v + (e.billable ? e.hours * e.rate : 0) }), { h: 0, v: 0 });
  return h`<div class="table-wrap"><table><thead><tr><th>Date</th>${showCase ? h`<th>Matter</th>` : ''}<th>Timekeeper</th><th>Description</th><th class="right">Hours</th><th class="right">Rate</th><th class="right">Value</th><th></th></tr></thead>
    <tbody>${entries.map((e) => h`<tr><td class="nowrap">${fmtDate(e.work_date)}</td>
      ${showCase ? h`<td><a href="#/cases/${e.case_id}/time">${e.internal_ref} · ${e.case_title}</a></td>` : ''}
      <td class="nowrap">${e.user_name}</td><td class="pre">${e.description}${e.billable ? '' : h` <span class="badge">Non-billable</span>`}</td>
      <td class="right">${e.hours}</td><td class="right nowrap">${money2(e.rate)}</td><td class="right nowrap">${e.billable ? money2(e.hours * e.rate) : '—'}</td>
      <td class="right nowrap">${e.invoice_id ? h`<span class="badge b-settled">Billed</span>` : h`<button class="link" data-act="editTime" data-id="${e.id}">Edit</button><button class="link danger" data-act="delTime" data-id="${e.id}">Delete</button>`}</td></tr>`)}
      <tr><td colspan="${showCase ? 4 : 3}"><b>Total</b></td><td class="right"><b>${Math.round(tot.h * 100) / 100}</b></td><td></td><td class="right nowrap"><b>${money2(tot.v)}</b></td><td></td></tr>
    </tbody></table></div>`;
}
function timeActs(entries, reload, caseOpts) {
  Object.assign(acts, {
    editTime: (el) => editTime(entries.find((e) => e.id === +el.dataset.id), { caseOpts, after: reload }),
    delTime: async (el) => {
      if (await confirmDialog('Delete this time entry?')) { await api('DELETE', `/api/time/${el.dataset.id}`); toast('Entry deleted'); reload(); }
    },
  });
}
function expenseTable(list, { showCase = false } = {}) {
  if (!list.length) return h`<div class="empty">No expenses recorded.</div>`;
  const tot = list.reduce((a, x) => a + x.amount, 0);
  return h`<div class="table-wrap"><table><thead><tr><th>Date</th>${showCase ? h`<th>Matter</th>` : ''}<th>Category</th><th>Description</th><th>By</th><th class="right">Amount</th><th></th></tr></thead>
    <tbody>${list.map((x) => h`<tr><td class="nowrap">${fmtDate(x.expense_date)}</td>
      ${showCase ? h`<td><a href="#/cases/${x.case_id}/billing">${x.internal_ref} · ${x.case_title}</a></td>` : ''}
      <td>${badge('', x.category)}</td><td class="pre">${x.description}${x.billable ? '' : h` <span class="badge">Non-billable</span>`}${x.invoice_number ? h` <span class="badge b-settled">Billed ${x.invoice_number}</span>` : ''}</td>
      <td class="nowrap">${x.user_name}</td><td class="right nowrap">${money2(x.amount)}</td>
      <td class="right nowrap">${x.invoice_id ? '' : h`<button class="link" data-act="editExpense" data-id="${x.id}">Edit</button><button class="link danger" data-act="delExpense" data-id="${x.id}">Delete</button>`}</td></tr>`)}
      <tr><td colspan="${showCase ? 5 : 4}"><b>Total</b></td><td class="right nowrap"><b>${money2(tot)}</b></td><td></td></tr></tbody></table></div>`;
}
const expenseFields = (caseOpts) => [
  ...(caseOpts ? [{ name: 'case_id', label: 'Matter', type: 'select', options: caseOpts, required: true, full: true, numeric: true }] : []),
  { name: 'expense_date', label: 'Date', type: 'date', required: true },
  { name: 'amount', label: 'Amount', type: 'number', step: '0.01', min: 0, required: true, numeric: true },
  { name: 'category', label: 'Category', type: 'select', options: enumOpts('expense_category') },
  { name: 'user_id', label: 'Paid by', type: 'select', options: userOpts(null), numeric: true },
  { name: 'description', label: 'Description', type: 'textarea', full: true, rows: 2 },
  { name: 'billable', label: 'Bill this to the client', type: 'checkbox', full: true },
];
function editExpense(x, { caseOpts, after }) {
  openForm({
    title: x?.id ? 'Edit expense' : 'Add expense',
    fields: expenseFields(caseOpts),
    values: x?.id ? x : { expense_date: todayStr(), billable: true, category: 'court_fees', user_id: state.me.id, ...x },
    onSubmit: async (d) => {
      const body = caseOpts ? d : { ...d, case_id: x.case_id };
      if (x?.id) await api('PUT', `/api/expenses/${x.id}`, body); else await api('POST', '/api/expenses', body);
      toast('Expense saved'); after();
    },
  });
}
function expenseActs(list, reload, caseOpts) {
  Object.assign(acts, {
    editExpense: (el) => editExpense(list.find((x) => x.id === +el.dataset.id), { caseOpts, after: reload }),
    delExpense: async (el) => {
      if (await confirmDialog('Delete this expense?')) { await api('DELETE', `/api/expenses/${el.dataset.id}`); toast('Expense deleted'); reload(); }
    },
  });
}
function invoiceTable(list, { showCase = true } = {}) {
  if (!list.length) return h`<div class="empty">No invoices.</div>`;
  return h`<div class="table-wrap"><table><thead><tr><th>Invoice</th><th>Issued</th><th>Due</th>${showCase ? h`<th>Client / matter</th>` : ''}<th>Status</th><th class="right">Total</th><th class="right">Balance</th></tr></thead>
    <tbody>${list.map((i) => h`<tr class="click" data-act="go" data-href="#/invoices/${i.id}"><td><b>${i.number}</b></td><td class="nowrap">${fmtDate(i.issue_date)}</td>
      <td class="nowrap small">${i.status === 'sent' ? dueLabel(i.due_date) : fmtDate(i.due_date)}</td>
      ${showCase ? h`<td>${i.client_name || '—'}<div class="muted small">${i.internal_ref} · ${i.case_title}</div></td>` : ''}
      <td>${invoiceBadge(i)}</td><td class="right nowrap">${money2(i.total)}</td><td class="right nowrap">${i.status === 'void' ? '—' : money2(i.balance)}</td></tr>`)}</tbody></table></div>`;
}
const invoiceBadge = (i) => (i.overdue ? badge('p-urgent', 'overdue') : badge({ draft: 'b-closed', sent: 'b-active', paid: 'b-settled', void: 'p-low' }[i.status], i.status));

async function newInvoice(caseId, after) {
  const caseOpts = caseId ? null : await caseOptions();
  const fields = [
    ...(caseOpts ? [{ name: 'case_id', label: 'Matter', type: 'select', options: caseOpts, required: true, full: true, numeric: true }] : []),
    { name: 'issue_date', label: 'Invoice date', type: 'date', required: true },
    { name: 'due_date', label: 'Due date', type: 'date', help: `Blank = ${state.settings.payment_terms || 0} days after invoice date` },
    { name: 'up_to', label: 'Include work up to', type: 'date', help: 'Blank = all unbilled work' },
    { name: 'tax_rate', label: 'Tax / VAT rate (%)', type: 'number', step: '0.01', numeric: true },
    { name: 'discount', label: 'Discount (amount)', type: 'number', step: '0.01', numeric: true },
    { name: 'notes', label: 'Notes shown on invoice', type: 'textarea', full: true, rows: 2, placeholder: 'e.g. Payment instructions, bank details' },
  ];
  let preview = '';
  if (caseId) {
    const u = await GET(`/api/cases/${caseId}/unbilled`);
    preview = `<div class="muted" style="margin-bottom:6px">Unbilled on this matter: <b>${escHtml(money2(u.total))}</b> (${u.time_count} time entr${u.time_count === 1 ? 'y' : 'ies'}, ${u.expense_count} expense${u.expense_count === 1 ? '' : 's'}).</div>`;
  }
  openForm({
    title: 'Create invoice',
    fields,
    values: { issue_date: todayStr(), tax_rate: state.settings.tax_rate },
    submitLabel: 'Create invoice',
    extraButtons: '',
    onSubmit: async (d) => {
      const r = await api('POST', '/api/invoices', { ...d, case_id: caseId || d.case_id });
      toast('Invoice created as draft'); after(r.id);
    },
  });
  if (preview) $('.modal-body').insertAdjacentHTML('afterbegin', preview);
}

async function caseBilling(c, reload) {
  const [entries, expenses, invoices] = await Promise.all([GET(`/api/time?case_id=${c.id}`), GET(`/api/expenses?case_id=${c.id}`), GET(`/api/invoices?case_id=${c.id}`)]);
  timeActs(entries, reload);
  expenseActs(expenses, reload);
  acts.addTime = () => editTime({ case_id: c.id }, { after: reload });
  acts.addExpense = () => editExpense({ case_id: c.id }, { after: reload });
  acts.newInvoice = () => newInvoice(c.id, (id) => { location.hash = `#/invoices/${id}`; });
  return h`<div class="stats">
      <div class="card stat"><div class="label">Hours recorded</div><div class="value">${hours(c.totals.hours)}</div></div>
      <div class="card stat"><div class="label">Unbilled (WIP)</div><div class="value">${money2(c.totals.unbilled)}</div></div>
      <div class="card stat"><div class="label">Invoiced</div><div class="value">${money2(c.totals.invoiced)}</div></div>
      <div class="card stat"><div class="label">Received</div><div class="value">${money2(c.totals.paid)}</div></div>
      <div class="card stat"><div class="label">Fee arrangement</div><div class="value" style="font-size:18px">${c.fee_arrangement || '—'}</div></div>
    </div>
    <div class="card" style="margin-bottom:16px"><div class="card-head"><h2>Invoices</h2>${canBill() ? h`<button class="primary" data-act="newInvoice">+ Create invoice</button>` : ''}</div>
      <div class="card-body flush">${invoiceTable(invoices, { showCase: false })}</div></div>
    <div class="card" style="margin-bottom:16px"><div class="card-head"><h2>Time entries</h2><button data-act="addTime">+ Log time</button></div>
      <div class="card-body flush">${timeTable(entries)}</div></div>
    <div class="card"><div class="card-head"><h2>Expenses</h2><button data-act="addExpense">+ Add expense</button></div>
      <div class="card-body flush">${expenseTable(expenses)}</div></div>`;
}

async function caseContacts(c, reload) {
  const list = await GET(`/api/contacts?case_id=${c.id}`);
  const fields = [
    { name: 'name', label: 'Name', required: true },
    { name: 'role', label: 'Role', type: 'select', options: enumOpts('contact_role') },
    { name: 'organization', label: 'Organisation' },
    { name: 'email', label: 'Email', type: 'email' },
    { name: 'phone', label: 'Phone' },
    { name: 'notes', label: 'Notes', type: 'textarea', full: true, rows: 3 },
  ];
  const edit = (x) => openForm({
    title: x ? 'Edit contact' : 'Add contact', fields, values: x || { role: 'witness' },
    onSubmit: async (d) => {
      if (x) await api('PUT', `/api/contacts/${x.id}`, d); else await api('POST', '/api/contacts', { ...d, case_id: c.id });
      toast('Contact saved'); reload();
    },
  });
  Object.assign(acts, {
    addContact: () => edit(null),
    editContact: (el) => edit(list.find((x) => x.id === +el.dataset.id)),
    delContact: async (el) => {
      const x = list.find((y) => y.id === +el.dataset.id);
      if (await confirmDialog(h`Remove <b>${x.name}</b> from this matter?`)) { await api('DELETE', `/api/contacts/${x.id}`); toast('Contact removed'); reload(); }
    },
  });
  return h`<div class="card"><div class="card-head"><h2>People involved</h2><button class="primary" data-act="addContact">+ Add contact</button></div>
    <div class="card-body flush">${list.length ? h`<div class="table-wrap"><table><thead><tr><th>Name</th><th>Role</th><th>Organisation</th><th>Contact</th><th>Notes</th><th></th></tr></thead>
      <tbody>${list.map((x) => h`<tr><td><b>${x.name}</b></td><td>${badge('', x.role)}</td><td>${x.organization}</td>
        <td class="small">${x.email ? h`<a href="mailto:${x.email}">${x.email}</a>` : ''}${x.email && x.phone ? h`<br>` : ''}${x.phone}</td><td class="small pre">${x.notes}</td>
        <td class="right nowrap"><button class="link" data-act="editContact" data-id="${x.id}">Edit</button><button class="link danger" data-act="delContact" data-id="${x.id}">Delete</button></td></tr>`)}</tbody></table></div>`
      : h`<div class="empty">Add witnesses, experts, opposing counsel, court clerks, insurers and other people involved in this matter.</div>`}</div></div>`;
}

function recordOutcome(ev, after) {
  openForm({
    title: `Record outcome — ${ev.title}`,
    fields: [
      { name: 'outcome', label: 'What happened?', type: 'textarea', required: true, full: true, rows: 3, placeholder: 'e.g. Adjourned at request of defendant; court ordered disclosure within 14 days' },
      { name: 'next_at', label: 'Next hearing / date (optional)', type: 'datetime' },
      { name: 'next_kind', label: 'Next event type', type: 'select', options: enumOpts('event_kind') },
      { name: 'next_title', label: 'Next event title', full: true, placeholder: ev.title },
    ],
    values: { next_kind: ev.kind },
    submitLabel: 'Save outcome',
    onSubmit: async (d) => {
      const r = await api('POST', `/api/events/${ev.id}/outcome`, d);
      toast(r.next_id ? 'Outcome saved and next date scheduled' : 'Outcome saved'); after();
    },
  });
}

async function applyChecklist(c, after) {
  const templates = await GET('/api/templates');
  if (!templates.length) { toast('No checklists yet. An admin can create them in Settings.', true); return; }
  openForm({
    title: 'Apply a task checklist',
    fields: [
      { name: 'template_id', label: 'Checklist', type: 'select', options: templates.map((t) => [t.id, `${t.name} (${t.items.length} tasks)`]), required: true, full: true, numeric: true },
      { name: 'start_date', label: 'Count due dates from', type: 'date', required: true },
      { name: 'assignee_id', label: 'Assign tasks to', type: 'select', options: userOpts('Lead attorney'), numeric: true },
    ],
    values: { start_date: todayStr() },
    submitLabel: 'Create tasks',
    onSubmit: async (d) => {
      const r = await api('POST', `/api/cases/${c.id}/apply-template`, d);
      toast(`${r.created} tasks created`); after();
    },
  });
}

async function caseActivity(c) {
  const items = await GET(`/api/activity?case_id=${c.id}`);
  return h`<div class="card"><div class="card-head"><h2>Audit trail</h2></div><div class="card-body flush">${activityList(items, false)}</div></div>`;
}

// ------------------------------------------------------------------ calendar
let calMine = false;
async function viewCalendar(y, m) {
  const now = new Date();
  const year = y || now.getFullYear(); const month = m ? m - 1 : now.getMonth();
  const first = new Date(year, month, 1);
  const start = new Date(first); start.setDate(1 - ((first.getDay() + 6) % 7)); // Monday-start grid
  const end = new Date(start); end.setDate(start.getDate() + 42);
  const events = await GET(`/api/events${qs({ from: isoDate(start), to: isoDate(end), attorney: calMine ? state.me.id : '' })}`);
  const byDay = {};
  events.forEach((e) => { (byDay[e.starts_at.slice(0, 10)] ||= []).push(e); });
  const ym = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
  const prev = new Date(year, month - 1, 1); const next = new Date(year, month + 1, 1);
  let caseOpts = null;
  const getCaseOpts = async () => (caseOpts ||= await caseOptions());
  Object.assign(acts, {
    calMine: (el) => { calMine = el.checked; rerender(); },
    newEvent: async (el) => editEvent({ starts_at: `${el.dataset.date || todayStr()}T09:00` }, { caseOpts: await getCaseOpts(), after: rerender }),
    openEvent: async (el, e) => { e.stopPropagation(); editEvent(events.find((x) => x.id === +el.dataset.id), { caseOpts: await getCaseOpts(), after: rerender }); },
  });
  const t = todayStr();
  const days = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(start); d.setDate(start.getDate() + i);
    const ds = isoDate(d);
    days.push(h`<div class="day ${d.getMonth() !== month ? 'other' : ''} ${ds === t ? 'today' : ''}" data-act="newEvent" data-date="${ds}" title="Add event on ${fmtDate(ds)}">
      <span class="num">${d.getDate()}</span>
      ${(byDay[ds] || []).map((e) => h`<span class="ev badge k-${e.kind} ${e.completed ? 'done' : ''}" data-act="openEvent" data-id="${e.id}" title="${fmtTime(e.starts_at)} ${e.title} — ${e.case_title}">${fmtTime(e.starts_at)} ${e.title}</span>`)}
    </div>`);
  }
  const monthEvents = events.filter((e) => e.starts_at.slice(0, 7) === ym(first));
  setView(h`
    <div class="page-head"><div><h1>Calendar</h1><div class="muted sub">Hearings, deadlines, filings and meetings across all matters</div></div>
      <button class="primary" data-act="newEvent">+ New event</button></div>
    <div class="toolbar">
      <a class="btn" href="#/calendar/${ym(prev)}">‹</a><a class="btn" href="#/calendar">Today</a><a class="btn" href="#/calendar/${ym(next)}">›</a>
      <h2 style="margin:0 8px">${first.toLocaleString(undefined, { month: 'long', year: 'numeric' })}</h2>
      <label class="check-list" style="margin-left:auto"><span><input type="checkbox" data-change="calMine" ${calMine ? raw('checked') : ''}> Only my matters</span></label>
    </div>
    <div class="card" style="margin-bottom:16px;overflow:hidden"><div class="cal">
      ${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => h`<div class="dow">${d}</div>`)}${days}
    </div></div>
    <div class="card"><div class="card-head"><h2>Agenda — ${first.toLocaleString(undefined, { month: 'long' })}</h2></div>
      <div class="card-body flush">${listOrEmpty(monthEvents, (e) => eventItem(e), 'No events this month.')}</div></div>`);
}

// ------------------------------------------------------------------ tasks page
const taskFilter = { assignee: 'me', status: 'open' };
async function viewTasks() {
  const tasks = await GET(`/api/tasks${qs(taskFilter)}`);
  const caseOpts = await caseOptions();
  taskActs(tasks, rerender, caseOpts);
  acts.addTask = () => editTask({}, { caseOpts, after: rerender });
  acts.filter = (el) => { taskFilter[el.name] = el.value; rerender(); };
  const sel = (name, options) => h`<select name="${name}" data-change="filter">${options.map(([v, l]) => h`<option value="${v}"${String(taskFilter[name]) === String(v) ? raw(' selected') : ''}>${l}</option>`)}</select>`;
  setView(h`
    <div class="page-head"><div><h1>Tasks</h1><div class="muted sub">${tasks.length} task${tasks.length === 1 ? '' : 's'}</div></div><button class="primary" data-act="addTask">+ New task</button></div>
    <div class="toolbar">
      ${sel('assignee', [['me', 'Assigned to me'], ['', 'Everyone'], ...activeUsers().map((u) => [u.id, u.name])])}
      ${sel('status', [['open', 'Open'], ['todo', 'To do'], ['in_progress', 'In progress'], ['done', 'Done'], ['', 'All']])}
    </div>
    <div class="card">${taskTable(tasks, { showCase: true })}</div>`);
}

// ------------------------------------------------------------------ clients
async function viewClients() {
  state.clients = await GET('/api/clients');
  acts.newClient = () => editClient(null, (id) => { location.hash = `#/clients/${id}`; });
  acts.search = (form) => {
    const q = form.q.value.trim().toLowerCase();
    $$('tbody tr', view()).forEach((tr) => { tr.hidden = q && !tr.textContent.toLowerCase().includes(q); });
  };
  setView(h`
    <div class="page-head"><div><h1>Clients</h1><div class="muted sub">${state.clients.length} clients</div></div><button class="primary" data-act="newClient">+ New client</button></div>
    <div class="toolbar"><form data-submit="search" style="display:contents"><input type="search" name="q" placeholder="Filter clients… (press Enter)"></form></div>
    <div class="card"><div class="table-wrap">${state.clients.length ? h`<table><thead><tr><th>Name</th><th>Type</th><th>Contact</th><th class="right">Open matters</th><th class="right">Total matters</th></tr></thead>
      <tbody>${state.clients.map((c) => h`<tr class="click" data-act="go" data-href="#/clients/${c.id}"><td><b>${c.name}</b></td><td>${label(c.type)}</td>
        <td>${c.contact_person}<div class="muted small">${[c.email, c.phone].filter(Boolean).join(' · ')}</div></td><td class="right">${c.open_cases}</td><td class="right">${c.case_count}</td></tr>`)}</tbody></table>`
      : h`<div class="empty">No clients yet.</div>`}</div></div>`);
}

async function viewClient(id) {
  const c = await GET(`/api/clients/${id}`);
  Object.assign(acts, {
    editClient: () => editClient(c, rerender),
    delClient: async () => {
      if (!(await confirmDialog(h`Delete client <b>${c.name}</b>?`))) return;
      await api('DELETE', `/api/clients/${id}`); state.clients = await GET('/api/clients'); toast('Client deleted'); location.hash = '#/clients';
    },
    newCase: () => editCase({ client_id: id }, (cid) => { location.hash = `#/cases/${cid}`; }),
  });
  setView(h`
    <div style="margin-bottom:6px" class="small"><a href="#/clients">← Clients</a></div>
    <div class="page-head"><div><h1>${c.name}</h1><div class="muted sub">${label(c.type)} client since ${fmtStamp(c.created_at).split(' ').slice(0, 3).join(' ')}</div></div>
      <div class="actions"><button data-act="newCase">+ New matter</button><button data-act="editClient">Edit</button>${isManager() ? h`<button class="danger" data-act="delClient">Delete</button>` : ''}</div></div>
    <div class="grid cols-2">
      <div class="card"><div class="card-head"><h2>Contact</h2></div><div class="card-body">${kv([
        ['Contact person', c.contact_person], ['Email', c.email ? h`<a href="mailto:${c.email}">${c.email}</a>` : ''], ['Phone', c.phone],
        ['Address', c.address], ['Notes', c.notes ? h`<span class="pre">${c.notes}</span>` : ''],
      ])}</div></div>
      <div class="card"><div class="card-head"><h2>Matters</h2></div><div class="card-body flush">${listOrEmpty(c.cases, (k) => h`<li>
        <div class="grow"><a href="#/cases/${k.id}"><b>${k.internal_ref}</b> · ${k.title}</a><div class="muted small">${k.court}${k.lead_attorney_name ? ` · ${k.lead_attorney_name}` : ''}</div></div>
        <div>${statusBadge(k.status)}</div></li>`, 'No matters for this client.')}</div></div>
    </div>`);
}

// ------------------------------------------------------------------ time page
const timeFilter = { user_id: '', from: '', to: '' };
async function viewTime() {
  if (!timeFilter.from) { const d = new Date(); timeFilter.from = isoDate(new Date(d.getFullYear(), d.getMonth(), 1)); }
  const [entries, expenses, caseOpts] = await Promise.all([GET(`/api/time${qs(timeFilter)}`), GET(`/api/expenses${qs({ from: timeFilter.from, to: timeFilter.to })}`), caseOptions()]);
  timeActs(entries, rerender, caseOpts);
  expenseActs(expenses, rerender, caseOpts);
  acts.addTime = () => editTime({}, { caseOpts, after: rerender });
  acts.addExpense = () => editExpense({}, { caseOpts, after: rerender });
  acts.filter = (el) => { timeFilter[el.name] = el.value; rerender(); };
  setView(h`
    <div class="page-head"><div><h1>Time & expenses</h1><div class="muted sub">Work and costs across all matters. Tip: use ⏱ Start timer at the top of the page.</div></div>
      <div class="actions"><button data-act="addExpense">+ Add expense</button><button class="primary" data-act="addTime">+ Log time</button></div></div>
    <div class="toolbar">
      <select name="user_id" data-change="filter">${[['', 'All timekeepers'], ...state.users.map((u) => [u.id, u.name])].map(([v, l]) => h`<option value="${v}"${String(timeFilter.user_id) === String(v) ? raw(' selected') : ''}>${l}</option>`)}</select>
      <label class="small" style="margin:0">From</label><input type="date" name="from" value="${timeFilter.from}" data-change="filter">
      <label class="small" style="margin:0">To</label><input type="date" name="to" value="${timeFilter.to}" data-change="filter">
    </div>
    <div class="card" style="margin-bottom:16px"><div class="card-head"><h2>Time entries</h2></div>${timeTable(entries, { showCase: true })}</div>
    <div class="card"><div class="card-head"><h2>Expenses</h2></div>${expenseTable(expenses, { showCase: true })}</div>`);
}

// ------------------------------------------------------------------ conflict check
async function viewConflicts() {
  acts.check = async (form) => {
    const q = form.q.value.trim();
    const out = $('#conflict-results');
    try {
      const r = await GET(`/api/conflicts${qs({ q })}`);
      const total = r.clients.length + r.opposing.length + r.cases.length + r.contacts.length;
      out.innerHTML = val(h`
        <div class="card" style="margin-bottom:16px;border-color:${total ? '#fec84b' : '#a6f4c5'}"><div class="card-body">
          ${total ? h`<b class="soon">⚠ ${total} potential match${total > 1 ? 'es' : ''} for “${q}”.</b> Review each before accepting the engagement.`
            : h`<b style="color:var(--ok)">✓ No matches for “${q}”.</b> <span class="muted">Searched clients, opposing parties, opposing counsel, matter titles and people on matters.</span>`}
        </div></div>
        <div class="grid cols-2">
          <div class="card"><div class="card-head"><h2>Existing clients</h2><span class="badge">${r.clients.length}</span></div><div class="card-body flush">
            ${listOrEmpty(r.clients, (c) => h`<li><a href="#/clients/${c.id}">${c.name}</a><span class="muted small">${label(c.type)}</span></li>`, 'None')}</div></div>
          <div class="card"><div class="card-head"><h2>Adverse parties / counsel</h2><span class="badge">${r.opposing.length}</span></div><div class="card-body flush">
            ${listOrEmpty(r.opposing, (c) => h`<li><div class="grow"><a href="#/cases/${c.id}">${c.internal_ref} · ${c.title}</a>
              <div class="muted small">Opposing: ${c.opposing_party || '—'}${c.opposing_counsel ? ` · Counsel: ${c.opposing_counsel}` : ''}<br>Our client: ${c.client_name || '—'}</div></div>${statusBadge(c.status)}</li>`, 'None')}</div></div>
          <div class="card"><div class="card-head"><h2>Matter titles</h2><span class="badge">${r.cases.length}</span></div><div class="card-body flush">
            ${listOrEmpty(r.cases, (c) => h`<li><div class="grow"><a href="#/cases/${c.id}">${c.internal_ref} · ${c.title}</a></div>${statusBadge(c.status)}</li>`, 'None')}</div></div>
          <div class="card"><div class="card-head"><h2>People on matters (witnesses, experts…)</h2><span class="badge">${r.contacts.length}</span></div><div class="card-body flush">
            ${listOrEmpty(r.contacts, (c) => h`<li><div class="grow"><b>${c.name}</b> ${badge('', c.role)}<div class="muted small">${c.organization || ''} · <a href="#/cases/${c.case_id}/contacts">${c.internal_ref} · ${c.case_title}</a></div></div></li>`, 'None')}</div></div>
        </div>`);
    } catch (err) { out.innerHTML = val(h`<div class="error">${err.message}</div>`); }
  };
  setView(h`
    <div class="page-head"><div><h1>Conflict check</h1><div class="muted sub">Search a prospective client or adverse party against the firm's records before opening a matter.</div></div></div>
    <form class="toolbar" data-submit="check"><input type="search" name="q" placeholder="Name of person, company or law firm…" required minlength="2" autofocus><button class="primary" type="submit">Run check</button></form>
    <div id="conflict-results"></div>`);
}

// ------------------------------------------------------------------ reports
const reportFilter = { from: '', to: '' };
async function viewReports() {
  const r = await GET(`/api/reports${qs(reportFilter)}`);
  acts.filter = (el) => { reportFilter[el.name] = el.value; rerender(); };
  acts.print = () => window.print();
  const tot = r.time_by_user.reduce((a, x) => ({ h: a.h + x.hours, b: a.b + x.billable_hours, v: a.v + x.value }), { h: 0, b: 0, v: 0 });
  setView(h`
    <div class="page-head"><div><h1>Reports</h1><div class="muted sub">Caseload and time analytics</div></div><button data-act="print">Print</button></div>
    <div class="grid cols-3" style="margin-bottom:16px">
      <div class="card"><div class="card-head"><h2>Matters by status</h2></div><div class="card-body">${bars(r.by_status.map((x) => ({ label: label(x.label), n: x.n })))}</div></div>
      <div class="card"><div class="card-head"><h2>Matters by practice area</h2></div><div class="card-body">${bars(r.by_type.map((x) => ({ label: x.label, n: x.n })))}</div></div>
      <div class="card"><div class="card-head"><h2>Open matters by lead attorney</h2></div><div class="card-body">${bars(r.by_attorney.map((x) => ({ label: x.label, n: x.n })))}</div></div>
    </div>
    <div class="toolbar"><b>Time period:</b>
      <label class="small" style="margin:0">From</label><input type="date" name="from" value="${reportFilter.from}" data-change="filter">
      <label class="small" style="margin:0">To</label><input type="date" name="to" value="${reportFilter.to}" data-change="filter">
      <span class="muted small">(blank = all time)</span></div>
    <div class="stats">
      <div class="card stat"><div class="label">Invoiced in period</div><div class="value">${money2(r.invoiced)}</div></div>
      <div class="card stat"><div class="label">Collected in period</div><div class="value">${money2(r.collected)}</div></div>
      <div class="card stat"><div class="label">Expenses in period</div><div class="value">${money2(r.expenses)}</div></div>
      <div class="card stat"><div class="label">Hours in period</div><div class="value">${hours(tot.h)}</div></div>
    </div>
    <div class="grid cols-2">
      <div class="card"><div class="card-head"><h2>Time by timekeeper</h2></div><div class="card-body flush">${r.time_by_user.length ? h`<div class="table-wrap"><table>
        <thead><tr><th>Timekeeper</th><th class="right">Hours</th><th class="right">Billable h</th><th class="right">Value</th></tr></thead>
        <tbody>${r.time_by_user.map((x) => h`<tr><td>${x.label}</td><td class="right">${x.hours}</td><td class="right">${x.billable_hours}</td><td class="right">${money2(x.value)}</td></tr>`)}
        <tr><td><b>Total</b></td><td class="right"><b>${tot.h}</b></td><td class="right"><b>${tot.b}</b></td><td class="right"><b>${money2(tot.v)}</b></td></tr></tbody></table></div>` : h`<div class="empty">No time in this period.</div>`}</div></div>
      <div class="card"><div class="card-head"><h2>Billable value by matter</h2></div><div class="card-body">${bars(r.time_by_case.map((x) => ({ label: `${x.internal_ref} · ${x.label}`, n: x.value })), money)}</div></div>
    </div>`);
}

// ------------------------------------------------------------------ users (admin)
async function viewUsers() {
  state.users = await GET('/api/users');
  const fields = (isNew) => [
    { name: 'name', label: 'Full name', required: true },
    { name: 'email', label: 'Email', type: 'email', required: true },
    { name: 'role', label: 'Role', type: 'select', options: enumOpts('role') },
    { name: 'hourly_rate', label: 'Default hourly rate', type: 'number', step: '0.01', numeric: true },
    { name: 'password', label: isNew ? 'Password' : 'New password', type: 'password', required: isNew, help: isNew ? 'At least 8 characters' : 'Leave blank to keep the current password', autocomplete: 'new-password' },
    ...(isNew ? [] : [{ name: 'active', label: 'Active (can sign in)', type: 'checkbox' }]),
  ];
  const save = async (u, d) => {
    if (!d.password) delete d.password;
    if (u) await api('PUT', `/api/users/${u.id}`, d); else await api('POST', '/api/users', d);
    toast('User saved'); rerender();
  };
  acts.newUser = () => openForm({ title: 'New user', fields: fields(true), values: { role: 'attorney', hourly_rate: 0 }, onSubmit: (d) => save(null, d) });
  acts.editUser = (el) => { const u = state.users.find((x) => x.id === +el.dataset.id); openForm({ title: `Edit ${u.name}`, fields: fields(false), values: u, onSubmit: (d) => save(u, d) }); };
  setView(h`
    <div class="page-head"><div><h1>Users</h1><div class="muted sub">People who can sign in to the system</div></div><button class="primary" data-act="newUser">+ New user</button></div>
    <div class="card"><div class="table-wrap"><table><thead><tr><th>Name</th><th>Email</th><th>Role</th><th class="right">Rate</th><th>Status</th><th></th></tr></thead>
      <tbody>${state.users.map((u) => h`<tr class="${u.active ? '' : 'done-row'}"><td><b>${u.name}</b></td><td>${u.email}</td><td>${label(u.role)}</td><td class="right">${money2(u.hourly_rate)}</td>
        <td>${u.active ? badge('b-settled', 'active') : badge('b-closed', 'inactive')}</td><td class="right"><button class="link" data-act="editUser" data-id="${u.id}">Edit</button></td></tr>`)}</tbody></table></div></div>`);
}

// ------------------------------------------------------------------ account
async function viewAccount() {
  const feed = await GET('/api/me/calendar-feed');
  acts.copyFeed = async () => {
    const inp = $('#feed-url');
    try { await navigator.clipboard.writeText(inp.value); toast('Link copied'); } catch { inp.select(); toast('Press Ctrl+C to copy'); }
  };
  acts.resetFeed = async () => {
    if (await confirmDialog('Create a new private link? The old link will stop working in any calendar app that uses it.', 'Reset link')) {
      await api('POST', '/api/me/calendar-feed/reset'); toast('New link created'); rerender();
    }
  };
  acts.changePw = async (form) => {
    if (form.next.value !== form.confirm.value) { toast('New passwords do not match', true); return; }
    await api('PUT', '/api/me/password', { current: form.current.value, next: form.next.value });
    form.reset(); toast('Password changed');
  };
  setView(h`
    <div class="page-head"><div><h1>My account</h1><div class="muted sub">${state.me.email} · ${label(state.me.role)}</div></div></div>
    <div class="card" style="max-width:440px"><div class="card-head"><h2>Change password</h2></div><div class="card-body">
      <form data-submit="changePw">
        <div class="field"><label>Current password</label><input type="password" name="current" required autocomplete="current-password"></div>
        <div class="field"><label>New password</label><input type="password" name="next" required minlength="8" autocomplete="new-password"></div>
        <div class="field"><label>Confirm new password</label><input type="password" name="confirm" required minlength="8" autocomplete="new-password"></div>
        <button class="primary" type="submit">Update password</button>
      </form></div></div>
    <div class="card" style="max-width:640px;margin-top:16px"><div class="card-head"><h2>Sync to Outlook / Google / Apple Calendar</h2></div><div class="card-body">
      <p style="margin-top:0">Subscribe to this private link in your calendar app to see all hearings and deadlines on your phone. Keep it secret — anyone with the link can see the calendar.</p>
      <div class="toolbar"><input id="feed-url" readonly value="${location.origin}${feed.path}" style="flex:1"><button data-act="copyFeed">Copy</button></div>
      <div class="actions"><a class="btn" href="/api/calendar.ics">Download .ics file</a><button data-act="resetFeed">Reset link</button></div>
      <p class="muted small">Google Calendar: Other calendars → + → From URL. Outlook: Add calendar → Subscribe from web. The link only works while this app is reachable from that device (e.g. hosted on a server).</p>
    </div></div>`);
}

// ------------------------------------------------------------------ case board (kanban)
async function viewBoard() {
  const cases = await GET('/api/cases');
  const cols = state.enums.case_status;
  acts.boardNew = () => editCase(null, (id) => { location.hash = `#/cases/${id}`; });
  setView(h`
    <div class="page-head"><div><h1>Case board</h1><div class="muted sub">Drag a card to another column to change the matter's status</div></div>
      <button class="primary" data-act="boardNew">+ New matter</button></div>
    <div class="board">${cols.map((st) => {
      const list = cases.filter((c) => c.status === st);
      return h`<div class="board-col" data-status="${st}"><div class="board-col-head">${statusBadge(st)} <span class="muted small">${list.length}</span></div>
        <div class="board-cards">${list.map((c) => h`<div class="board-card" draggable="true" data-id="${c.id}" data-act="go" data-href="#/cases/${c.id}">
          <div class="small muted">${c.internal_ref}${c.priority !== 'normal' ? h` ${prioBadge(c.priority)}` : ''}</div>
          <div><b>${c.title}</b></div>
          <div class="small muted">${c.client_name || ''}${c.lead_attorney_name ? ` · ${c.lead_attorney_name}` : ''}</div>
          ${c.next_event ? h`<div class="small">Next: ${dueLabel(c.next_event.slice(0, 10))}</div>` : ''}
        </div>`)}</div></div>`;
    })}</div>`);
  const board = $('.board');
  let dragId = null;
  board.addEventListener('dragstart', (e) => { const card = e.target.closest('.board-card'); if (card) { dragId = card.dataset.id; card.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; } });
  board.addEventListener('dragend', (e) => { e.target.closest('.board-card')?.classList.remove('dragging'); $$('.board-col.over').forEach((x) => x.classList.remove('over')); });
  board.addEventListener('dragover', (e) => { const col = e.target.closest('.board-col'); if (col) { e.preventDefault(); $$('.board-col.over').forEach((x) => x !== col && x.classList.remove('over')); col.classList.add('over'); } });
  board.addEventListener('drop', async (e) => {
    const col = e.target.closest('.board-col');
    if (!col || !dragId) return;
    e.preventDefault();
    const c = cases.find((x) => x.id === +dragId);
    if (c && c.status !== col.dataset.status) {
      try { await api('PUT', `/api/cases/${c.id}`, { status: col.dataset.status }); toast(`${c.title} → ${label(col.dataset.status)}`); } catch (err) { toast(err.message, true); }
      rerender();
    }
  });
}

// ------------------------------------------------------------------ billing
const billingFilter = { status: 'unpaid' };
async function viewBilling() {
  const [list, dash] = await Promise.all([GET(`/api/invoices${qs(billingFilter)}`), GET('/api/dashboard')]);
  acts.filter = (el) => { billingFilter[el.name] = el.value; rerender(); };
  acts.newInvoice = () => newInvoice(null, (id) => { location.hash = `#/invoices/${id}`; });
  const overdue = list.filter((i) => i.overdue);
  setView(h`
    <div class="page-head"><div><h1>Billing</h1><div class="muted sub">Invoices, payments and unbilled work</div></div>
      ${canBill() ? h`<button class="primary" data-act="newInvoice">+ Create invoice</button>` : ''}</div>
    <div class="stats">
      <div class="card stat"><div class="label">Unbilled work (WIP)</div><div class="value">${money2(dash.counts.unbilled)}</div></div>
      <div class="card stat"><div class="label">Outstanding (sent)</div><div class="value">${money2(dash.counts.outstanding)}</div></div>
      <div class="card stat ${overdue.length ? 'alert' : ''}"><div class="label">Overdue invoices (shown)</div><div class="value">${overdue.length}</div></div>
    </div>
    <div class="toolbar"><select name="status" data-change="filter">${[['unpaid', 'Unpaid (draft + sent)'], ['overdue', 'Overdue'], ['draft', 'Draft'], ['sent', 'Sent'], ['paid', 'Paid'], ['void', 'Void'], ['', 'All invoices']]
      .map(([v, l]) => h`<option value="${v}"${billingFilter.status === v ? raw(' selected') : ''}>${l}</option>`)}</select>
      <span class="muted small">Invoices are created from a matter's unbilled time and expenses.</span></div>
    <div class="card">${invoiceTable(list)}</div>`);
}

async function viewInvoice(id) {
  const i = await GET(`/api/invoices/${id}`);
  const f = i.firm;
  const reload = () => rerender();
  Object.assign(acts, {
    print: () => window.print(),
    markSent: async () => { await api('PUT', `/api/invoices/${id}`, { status: 'sent' }); toast('Marked as sent'); reload(); },
    voidInv: async () => {
      if (!(await confirmDialog(h`Void invoice <b>${i.number}</b>? Its time and expenses become unbilled again.`, 'Void invoice'))) return;
      await api('PUT', `/api/invoices/${id}`, { status: 'void' }); toast('Invoice voided'); reload();
    },
    delInv: async () => {
      if (!(await confirmDialog(h`Delete invoice <b>${i.number}</b>? Its time and expenses become unbilled again.`))) return;
      await api('DELETE', `/api/invoices/${id}`); toast('Invoice deleted'); location.hash = `#/cases/${i.case_id}/billing`;
    },
    editInv: () => openForm({
      title: `Edit ${i.number}`, fields: [{ name: 'due_date', label: 'Due date', type: 'date' }, { name: 'notes', label: 'Notes shown on invoice', type: 'textarea', full: true }],
      values: i, onSubmit: async (d) => { await api('PUT', `/api/invoices/${id}`, d); toast('Invoice updated'); reload(); },
    }),
    addPayment: () => openForm({
      title: `Record payment — ${i.number}`, size: 'sm',
      fields: [
        { name: 'payment_date', label: 'Date received', type: 'date', required: true, full: true },
        { name: 'amount', label: 'Amount', type: 'number', step: '0.01', required: true, numeric: true, full: true },
        { name: 'method', label: 'Method', type: 'select', options: enumOpts('payment_method'), full: true },
        { name: 'reference', label: 'Reference', full: true, placeholder: 'Cheque no., transfer ref…' },
      ],
      values: { payment_date: todayStr(), amount: i.balance, method: 'bank_transfer' },
      onSubmit: async (d) => { await api('POST', `/api/invoices/${id}/payments`, d); toast('Payment recorded'); reload(); },
    }),
    delPayment: async (el) => {
      if (await confirmDialog('Delete this payment?')) { await api('DELETE', `/api/payments/${el.dataset.id}`); toast('Payment deleted'); reload(); }
    },
  });
  const cl = i.client;
  setView(h`
    <div style="margin-bottom:6px" class="small"><a href="#/billing">← Billing</a> · <a href="#/cases/${i.case_id}/billing">Matter billing</a></div>
    <div class="page-head"><div><h1>Invoice ${i.number}</h1><div class="muted sub">${invoiceBadge(i)} &nbsp; Balance due: <b>${money2(i.status === 'void' ? 0 : i.balance)}</b></div></div>
      <div class="actions">
        <button data-act="print">Print / Save as PDF</button>
        ${canBill() && i.status === 'draft' ? h`<button data-act="editInv">Edit</button><button data-act="markSent">Mark as sent</button>` : ''}
        ${canBill() && ['draft', 'sent'].includes(i.status) ? h`<button class="primary" data-act="addPayment">Record payment</button>` : ''}
        ${canBill() && i.status !== 'void' ? h`<button class="danger" data-act="voidInv">Void</button>` : ''}
        ${canBill() && ['draft', 'void'].includes(i.status) ? h`<button class="danger" data-act="delInv">Delete</button>` : ''}
      </div></div>
    <div class="card invoice"><div class="card-body">
      <div class="inv-head">
        <div><div class="inv-firm">${f.firm_name}</div><div class="muted pre">${f.firm_address}</div><div class="muted">${[f.firm_email, f.firm_phone].filter(Boolean).join(' · ')}</div></div>
        <div class="right"><div class="inv-title">INVOICE ${i.status === 'void' ? '(VOID)' : ''}</div>
          <div>No. <b>${i.number}</b></div><div>Date: ${fmtDate(i.issue_date)}</div><div>Due: ${fmtDate(i.due_date)}</div></div>
      </div>
      <div class="inv-parties">
        <div><div class="muted small">BILL TO</div><b>${cl?.name || '—'}</b>${cl?.contact_person ? h`<div>Attn: ${cl.contact_person}</div>` : ''}<div class="pre">${cl?.address || ''}</div><div>${cl?.email || ''}</div></div>
        <div><div class="muted small">MATTER</div><b>${i.case_title}</b><div>${i.internal_ref}${i.case_number ? ` · ${i.case_number}` : ''}</div></div>
      </div>
      ${i.time.length ? h`<h3 class="inv-sec">Professional services</h3><div class="table-wrap"><table><thead><tr><th>Date</th><th>Timekeeper</th><th>Description</th><th class="right">Hours</th><th class="right">Rate</th><th class="right">Amount</th></tr></thead>
        <tbody>${i.time.map((t) => h`<tr><td class="nowrap">${fmtDate(t.work_date)}</td><td class="nowrap">${t.user_name}</td><td class="pre">${t.description}</td><td class="right">${t.hours}</td><td class="right nowrap">${money2(t.rate)}</td><td class="right nowrap">${money2(t.amount)}</td></tr>`)}</tbody></table></div>` : ''}
      ${i.expenses.length ? h`<h3 class="inv-sec">Expenses & disbursements</h3><div class="table-wrap"><table><thead><tr><th>Date</th><th>Category</th><th>Description</th><th class="right">Amount</th></tr></thead>
        <tbody>${i.expenses.map((x) => h`<tr><td class="nowrap">${fmtDate(x.expense_date)}</td><td>${label(x.category)}</td><td class="pre">${x.description}</td><td class="right nowrap">${money2(x.amount)}</td></tr>`)}</tbody></table></div>` : ''}
      <table class="inv-totals"><tbody>
        <tr><td>Professional fees</td><td class="right">${money2(i.time_total)}</td></tr>
        <tr><td>Expenses</td><td class="right">${money2(i.expense_total)}</td></tr>
        ${i.discount ? h`<tr><td>Discount</td><td class="right">− ${money2(i.discount)}</td></tr>` : ''}
        ${i.tax_rate ? h`<tr><td>Tax / VAT (${i.tax_rate}%)</td><td class="right">${money2(i.tax)}</td></tr>` : ''}
        <tr class="grand"><td>Total</td><td class="right">${money2(i.total)}</td></tr>
        <tr><td>Paid</td><td class="right">${money2(i.paid)}</td></tr>
        <tr class="grand"><td>Balance due</td><td class="right">${money2(i.status === 'void' ? 0 : i.balance)}</td></tr>
      </tbody></table>
      ${i.notes ? h`<div class="inv-notes pre">${i.notes}</div>` : ''}
    </div></div>
    <div class="card no-print" style="margin-top:16px"><div class="card-head"><h2>Payments</h2></div><div class="card-body flush">
      ${listOrEmpty(i.payments, (p) => h`<li><div class="grow"><b>${money2(p.amount)}</b> · ${label(p.method)}${p.reference ? ` · ${p.reference}` : ''}
        <div class="muted small">${fmtDate(p.payment_date)} · recorded by ${p.user_name || '—'}</div></div>
        ${canBill() ? h`<button class="link danger" data-act="delPayment" data-id="${p.id}">Delete</button>` : ''}</li>`, 'No payments recorded.')}</div></div>`);
}

// ------------------------------------------------------------------ deadline calculator
function holidaySet() { return new Set(String(state.settings.holidays || '').split(/\s+/).filter(Boolean)); }
function calcDeadline(start, n, mode, dir, roll) {
  const hol = holidaySet();
  const isOff = (d) => d.getDay() === 0 || d.getDay() === 6 || hol.has(isoDate(d));
  const d = parseLocal(start);
  const step = dir === 'before' ? -1 : 1;
  const skipped = [];
  if (mode === 'court') {
    let left = n;
    while (left > 0) { d.setDate(d.getDate() + step); if (isOff(d)) skipped.push(isoDate(d)); else left--; }
  } else d.setDate(d.getDate() + step * n);
  let rolled = null;
  if (roll && isOff(d)) {
    const orig = isoDate(d);
    while (isOff(d)) d.setDate(d.getDate() + step);
    rolled = orig;
  }
  return { date: isoDate(d), skipped, rolled };
}
async function viewDeadlines() {
  acts.calc = (form) => {
    const start = form.start.value; const n = Number(form.days.value);
    if (!start || !Number.isInteger(n) || n < 0) { toast('Enter a trigger date and a whole number of days', true); return; }
    const r = calcDeadline(start, n, form.mode.value, form.dir.value, form.roll.checked);
    const d = parseLocal(r.date);
    $('#calc-result').innerHTML = val(h`<div class="card"><div class="card-body">
      <div class="muted small">DEADLINE</div>
      <div class="calc-date">${d.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</div>
      <div class="muted">${n} ${form.mode.value === 'court' ? 'court (business) days' : 'calendar days'} ${form.dir.value} ${fmtDate(start)}.
        ${r.skipped.length ? `Skipped ${r.skipped.length} weekend/holiday day${r.skipped.length > 1 ? 's' : ''}. ` : ''}
        ${r.rolled ? `${fmtDate(r.rolled)} is a weekend or holiday, so the deadline moved to the next ${form.dir.value === 'before' ? 'earlier' : ''} working day.` : ''}</div>
      <div class="actions" style="margin-top:12px"><button class="primary" data-act="calcAdd" data-date="${r.date}">Add this deadline to a matter</button></div>
    </div></div>`);
  };
  acts.calcAdd = async (el) => editEvent({ kind: 'deadline', starts_at: `${el.dataset.date}T17:00`, title: $('#calc-title').value || '' }, { caseOpts: await caseOptions(), after: () => toast('Deadline added to the calendar') });
  const hol = holidaySet().size;
  setView(h`
    <div class="page-head"><div><h1>Deadline calculator</h1><div class="muted sub">Work out a court deadline from a trigger date (service, filing, judgment…)</div></div></div>
    <div class="grid cols-2">
      <div class="card"><div class="card-body"><form data-submit="calc">
        <div class="field"><label for="calc-title">What is the deadline? (optional)</label><input id="calc-title" placeholder="e.g. Defence due after service of claim"></div>
        <div class="form-grid">
          <div class="field"><label>Trigger date *</label><input type="date" name="start" value="${todayStr()}" required></div>
          <div class="field"><label>Number of days *</label><input type="number" name="days" min="0" step="1" value="14" required></div>
          <div class="field"><label>Count</label><select name="mode"><option value="calendar">Calendar days</option><option value="court">Court (business) days — skip weekends & holidays</option></select></div>
          <div class="field"><label>Direction</label><select name="dir"><option value="after">After the trigger date</option><option value="before">Before the trigger date</option></select></div>
        </div>
        <div class="field"><label class="check-list"><span><input type="checkbox" name="roll" checked> If the deadline falls on a weekend or holiday, move it to the next working day</span></label></div>
        <button class="primary" type="submit">Calculate</button>
        <div class="muted small" style="margin-top:10px">${hol} court holiday${hol === 1 ? '' : 's'} configured${state.me.role === 'admin' ? h` — <a href="#/settings">edit in Settings</a>` : ''}. Weekends are Saturday and Sunday. Always verify against the applicable court rules.</div>
      </form></div></div>
      <div id="calc-result"></div>
    </div>`);
}

// ------------------------------------------------------------------ global search
async function viewSearch(q) {
  const box = $('.search-box input'); if (box) box.value = q;
  if (q.length < 2) { setView(h`<div class="card"><div class="empty">Type at least 2 characters in the search box above.</div></div>`); return; }
  const r = await GET(`/api/search${qs({ q })}`);
  const total = Object.values(r).reduce((a, x) => a + x.length, 0);
  const section = (title, items, fn) => (items.length ? h`<div class="card" style="margin-bottom:16px"><div class="card-head"><h2>${title}</h2><span class="badge">${items.length}</span></div>
    <div class="card-body flush"><ul class="list">${items.map(fn)}</ul></div></div>` : '');
  const snippet = (text) => {
    const i = text.toLowerCase().indexOf(q.toLowerCase());
    const s0 = Math.max(0, i - 60);
    return `${s0 > 0 ? '…' : ''}${text.slice(s0, i + q.length + 100)}${i + q.length + 100 < text.length ? '…' : ''}`;
  };
  setView(h`
    <div class="page-head"><div><h1>Search results</h1><div class="muted sub">${total} result${total === 1 ? '' : 's'} for “${q}”</div></div></div>
    ${total ? '' : h`<div class="card"><div class="empty">Nothing found. Try a different word.</div></div>`}
    ${section('Cases', r.cases, (c) => h`<li><div class="grow"><a href="#/cases/${c.id}"><b>${c.internal_ref}</b> · ${c.title}</a><div class="muted small">${c.case_number} ${c.client_name || ''}</div></div>${statusBadge(c.status)}</li>`)}
    ${section('Clients', r.clients, (c) => h`<li><div class="grow"><a href="#/clients/${c.id}">${c.name}</a><div class="muted small">${[c.email, c.phone].filter(Boolean).join(' · ')}</div></div></li>`)}
    ${section('Contacts', r.contacts, (c) => h`<li><div class="grow"><b>${c.name}</b> ${badge('', c.role)}<div class="muted small">${c.organization || ''} · <a href="#/cases/${c.case_id}/contacts">${c.case_title}</a></div></div></li>`)}
    ${section('Hearings & deadlines', r.events, (e) => h`<li><div class="grow">${kindBadge(e.kind)} <a href="#/cases/${e.case_id}/schedule">${e.title}</a><div class="muted small">${fmtDateTime(e.starts_at)} · ${e.case_title}</div></div></li>`)}
    ${section('Tasks', r.tasks, (t) => h`<li><div class="grow"><a href="${t.case_id ? `#/cases/${t.case_id}/tasks` : '#/tasks'}">${t.title}</a><div class="muted small">${label(t.status)} · ${t.case_title || 'General'}</div></div><div class="small">${dueLabel(t.due_date, t.status === 'done')}</div></li>`)}
    ${section('Documents', r.documents, (d) => h`<li><div class="grow"><a href="/api/documents/${d.id}/download">${d.name}</a><div class="muted small">${label(d.category)} · <a href="#/cases/${d.case_id}/documents">${d.case_title}</a></div></div></li>`)}
    ${section('Notes', r.notes, (n) => h`<li><div class="grow"><a href="#/cases/${n.case_id}/notes">${n.case_title}</a><div class="small">${snippet(n.body)}</div><div class="muted small">${fmtStamp(n.created_at)}</div></div></li>`)}
    ${section('Invoices', r.invoices, (i) => h`<li><div class="grow"><a href="#/invoices/${i.id}">${i.number}</a><div class="muted small">${i.case_title}</div></div>${badge('', i.status)} <span class="small">${money2(i.total)}</span></li>`)}`);
}

// ------------------------------------------------------------------ settings (admin)
async function viewSettings() {
  const [st, templates] = await Promise.all([GET('/api/settings'), GET('/api/templates')]);
  const parseItems = (text) => text.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
    const [title, days, priority] = l.split('|').map((x) => (x || '').trim());
    return { title, days: Number(days) || 0, priority: priority || 'normal' };
  });
  const itemsText = (t) => t.items.map((it) => `${it.title} | ${it.days} | ${it.priority}`).join('\n');
  const tplForm = (t) => openForm({
    title: t ? 'Edit checklist' : 'New checklist',
    fields: [
      { name: 'name', label: 'Checklist name', required: true, full: true },
      { name: 'items', label: 'Tasks — one per line:  Task title | days after start | priority', type: 'textarea', required: true, full: true, rows: 10,
        help: 'Example:  File defence | 14 | high      (priority: low, normal, high or urgent)' },
    ],
    values: t ? { name: t.name, items: itemsText(t) } : {},
    onSubmit: async (d) => {
      const body = { name: d.name, items: parseItems(d.items) };
      if (t) await api('PUT', `/api/templates/${t.id}`, body); else await api('POST', '/api/templates', body);
      toast('Checklist saved'); rerender();
    },
  });
  Object.assign(acts, {
    saveSettings: async (form) => {
      const body = Object.fromEntries(['firm_name', 'firm_address', 'firm_email', 'firm_phone', 'currency', 'tax_rate', 'invoice_prefix', 'payment_terms', 'holidays'].map((k) => [k, form.elements[k].value]));
      state.settings = await api('PUT', '/api/settings', body);
      toast('Settings saved'); renderShell(); renderTimer(); router();
    },
    newTpl: () => tplForm(null),
    editTpl: (el) => tplForm(templates.find((t) => t.id === +el.dataset.id)),
    delTpl: async (el) => {
      const t = templates.find((x) => x.id === +el.dataset.id);
      if (await confirmDialog(h`Delete checklist <b>${t.name}</b>?`)) { await api('DELETE', `/api/templates/${t.id}`); toast('Checklist deleted'); rerender(); }
    },
  });
  const f = (name, lbl, extra = '') => h`<div class="field"><label for="s_${name}">${lbl}</label><input id="s_${name}" name="${name}" value="${st[name]}" ${raw(extra)}></div>`;
  setView(h`
    <div class="page-head"><div><h1>Settings</h1><div class="muted sub">Firm details, billing defaults, court holidays, checklists and backups</div></div></div>
    <div class="grid cols-2">
      <div class="card"><div class="card-head"><h2>Firm & billing</h2></div><div class="card-body"><form data-submit="saveSettings">
        <div class="form-grid">
          <div class="full">${f('firm_name', 'Firm name *', 'required')}</div>
          <div class="field full"><label for="s_firm_address">Address (shown on invoices)</label><textarea id="s_firm_address" name="firm_address" rows="2">${st.firm_address}</textarea></div>
          ${f('firm_email', 'Email')}${f('firm_phone', 'Phone')}
          ${f('currency', 'Currency code', 'maxlength="3" placeholder="USD, EUR, GBP, SAR, AED…"')}
          ${f('tax_rate', 'Default tax / VAT %', 'type="number" step="0.01" min="0" max="100"')}
          ${f('invoice_prefix', 'Invoice number prefix')}
          ${f('payment_terms', 'Payment terms (days)', 'type="number" min="0" step="1"')}
          <div class="field full"><label for="s_holidays">Court holidays (one date per line, YYYY-MM-DD)</label>
            <textarea id="s_holidays" name="holidays" rows="5" placeholder="2026-12-25">${st.holidays}</textarea>
            <div class="muted small">Used by the deadline calculator to skip non-working days.</div></div>
        </div>
        <button class="primary" type="submit">Save settings</button>
      </form></div></div>
      <div>
        <div class="card" style="margin-bottom:16px"><div class="card-head"><h2>Task checklists</h2><button data-act="newTpl">+ New checklist</button></div>
          <div class="card-body flush">${listOrEmpty(templates, (t) => h`<li><div class="grow"><b>${t.name}</b><div class="muted small">${t.items.length} tasks: ${t.items.slice(0, 3).map((x) => x.title).join(', ')}${t.items.length > 3 ? '…' : ''}</div></div>
            <button class="link" data-act="editTpl" data-id="${t.id}">Edit</button><button class="link danger" data-act="delTpl" data-id="${t.id}">Delete</button></li>`, 'No checklists yet.')}</div></div>
        <div class="card"><div class="card-head"><h2>Backup</h2></div><div class="card-body">
          <p style="margin-top:0">Download a copy of the whole database (cases, clients, billing, etc.). Keep it somewhere safe.</p>
          <a class="btn primary" href="/api/admin/backup">Download database backup</a>
          <p class="muted small">Uploaded document files are stored separately in the <code>data/uploads</code> folder — copy that folder too.
          To restore, stop the app and replace <code>data/litigation.db</code> with the backup file.</p>
        </div></div>
      </div>
    </div>`);
}

// ------------------------------------------------------------------ boot
async function boot() {
  const me = await GET('/api/me');
  state.enums = me.enums; state.closed = me.closed_statuses;
  delete me.enums; delete me.closed_statuses;
  state.me = me;
  await loadLookups();
  renderShell();
  renderTimer();
  router();
}

(async () => {
  try {
    const r = await fetch('/api/me', { credentials: 'same-origin' });
    if (r.ok) await boot(); else renderLogin();
  } catch { renderLogin(); }
})();
