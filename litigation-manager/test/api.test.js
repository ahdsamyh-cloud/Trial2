'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createApp } = require('../server');

let server; let base; let dir; let cookie = '';

async function call(method, url, body, headers = {}) {
  const init = { method, headers: { cookie, ...headers } };
  if (body !== undefined) {
    if (Buffer.isBuffer(body)) init.body = body;
    else { init.body = JSON.stringify(body); init.headers['content-type'] = 'application/json'; }
  }
  const r = await fetch(base + url, init);
  const sc = r.headers.get('set-cookie');
  if (sc) cookie = sc.split(';')[0];
  const ct = r.headers.get('content-type') || '';
  return { status: r.status, body: ct.includes('json') ? await r.json() : await r.text() };
}

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'litmgr-'));
  const app = createApp({ dataDir: dir, seed: true });
  server = http.createServer(app.handle);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server.close(); fs.rmSync(dir, { recursive: true, force: true }); });

test('rejects unauthenticated and bad logins', async () => {
  assert.equal((await call('GET', '/api/cases')).status, 401);
  assert.equal((await call('POST', '/api/login', { email: 'admin@firm.local', password: 'nope' })).status, 401);
});

test('login, dashboard and case listing', async () => {
  const r = await call('POST', '/api/login', { email: 'admin@firm.local', password: 'admin123' });
  assert.equal(r.status, 200);
  assert.equal(r.body.role, 'admin');
  const d = await call('GET', '/api/dashboard');
  assert.equal(d.status, 200);
  assert.ok(d.body.counts.open_cases >= 3);
  const open = await call('GET', '/api/cases?status=open');
  assert.ok(open.body.every((c) => !['settled', 'judgment', 'closed'].includes(c.status)));
  const search = await call('GET', '/api/cases?q=Blue%20Ocean');
  assert.equal(search.body.length, 1);
});

test('case lifecycle with events, tasks, notes, time, documents', async () => {
  const c = await call('POST', '/api/cases', { title: 'Test v. Example', status: 'active', priority: 'high', team: [2, 3] });
  assert.equal(c.status, 200);
  const id = c.body.id;
  let detail = (await call('GET', `/api/cases/${id}`)).body;
  assert.match(detail.internal_ref, /^LIT-\d{4}$/);
  assert.equal(detail.team.length, 2);

  assert.equal((await call('POST', '/api/cases', { title: '' })).status, 400);
  assert.equal((await call('POST', '/api/cases', { title: 'x', status: 'bogus' })).status, 400);

  const ev = await call('POST', '/api/events', { case_id: id, title: 'Hearing', kind: 'hearing', starts_at: '2030-01-05T10:00' });
  assert.equal(ev.status, 200);
  assert.equal((await call('PUT', `/api/events/${ev.body.id}`, { completed: true })).status, 200);

  const t = await call('POST', '/api/tasks', { case_id: id, title: 'Draft brief', due_date: '2030-01-01' });
  assert.equal((await call('PUT', `/api/tasks/${t.body.id}`, { status: 'done' })).status, 200);

  assert.equal((await call('POST', '/api/notes', { case_id: id, body: 'Hello' })).status, 200);

  const te = await call('POST', '/api/time', { case_id: id, work_date: '2030-01-02', hours: 2, user_id: 2 });
  assert.equal(te.status, 200);
  detail = (await call('GET', `/api/cases/${id}`)).body;
  assert.equal(detail.totals.hours, 2);
  assert.equal(detail.totals.billable_value, 900); // Sara's default rate 450
  assert.equal((await call('PUT', `/api/time/${te.body.id}`, { rate: '' })).status, 200);

  const up = await call('POST', `/api/cases/${id}/documents`, Buffer.from('PDFDATA'), { 'x-filename': encodeURIComponent('brief ü.pdf'), 'x-category': 'pleading', 'content-type': 'application/pdf' });
  assert.equal(up.status, 200);
  const dl = await call('GET', `/api/documents/${up.body.id}/download`);
  assert.equal(dl.body, 'PDFDATA');

  const upd = await call('PUT', `/api/cases/${id}`, { status: 'settled' });
  assert.equal(upd.status, 200);
  detail = (await call('GET', `/api/cases/${id}`)).body;
  assert.ok(detail.closed_date, 'closing a case stamps closed_date');

  const act = (await call('GET', `/api/activity?case_id=${id}`)).body;
  assert.ok(act.some((a) => a.action.includes('Status changed')));

  const csv = await call('GET', '/api/export/cases.csv');
  assert.ok(csv.body.includes('Test v. Example'));

  assert.equal((await call('DELETE', `/api/cases/${id}`)).status, 200);
  assert.equal((await call('GET', `/api/cases/${id}`)).status, 404);
});

test('conflict check finds adverse parties', async () => {
  const r = await call('GET', '/api/conflicts?q=Mercer');
  assert.equal(r.status, 200);
  assert.equal(r.body.opposing.length, 1);
});

test('role restrictions', async () => {
  await call('POST', '/api/logout');
  await call('POST', '/api/login', { email: 'lina@firm.local', password: 'password' });
  assert.equal((await call('POST', '/api/users', { name: 'X', email: 'x@x', role: 'staff', password: '12345678' })).status, 403);
  assert.equal((await call('DELETE', '/api/cases/1')).status, 403);
});

test('blocks cross-origin writes', async () => {
  const r = await call('POST', '/api/notes', { case_id: 1, body: 'x' }, { origin: 'http://evil.example' });
  assert.equal(r.status, 403);
});

test('billing: invoice, payment, lock, void', async () => {
  await call('POST', '/api/logout');
  await call('POST', '/api/login', { email: 'sara@firm.local', password: 'password' });
  const c = (await call('POST', '/api/cases', { title: 'Billing test' })).body.id;
  const te = (await call('POST', '/api/time', { case_id: c, work_date: '2026-01-10', hours: 2 })).body.id; // 2 x 450
  await call('POST', '/api/expenses', { case_id: c, expense_date: '2026-01-11', amount: 100, category: 'court_fees' });
  await call('POST', '/api/expenses', { case_id: c, expense_date: '2026-01-11', amount: 50, billable: false });
  const pre = (await call('GET', `/api/cases/${c}/unbilled`)).body;
  assert.equal(pre.total, 1000);

  const inv = await call('POST', '/api/invoices', { case_id: c, tax_rate: 10, discount: 100 });
  assert.equal(inv.status, 200, JSON.stringify(inv.body));
  let i = (await call('GET', `/api/invoices/${inv.body.id}`)).body;
  assert.equal(i.total, 990); // (1000 - 100) * 1.1
  assert.equal(i.time.length, 1);
  assert.equal(i.expenses.length, 1);
  assert.equal((await call('POST', '/api/invoices', { case_id: c })).status, 400, 'nothing left to bill');
  assert.equal((await call('PUT', `/api/time/${te}`, { hours: 5 })).status, 400, 'billed entries are locked');

  assert.equal((await call('POST', `/api/invoices/${i.id}/payments`, { payment_date: '2026-02-01', amount: 2000 })).status, 400, 'overpayment');
  await call('POST', `/api/invoices/${i.id}/payments`, { payment_date: '2026-02-01', amount: 500 });
  i = (await call('GET', `/api/invoices/${i.id}`)).body;
  assert.equal(i.status, 'sent');
  assert.equal(i.balance, 490);
  await call('POST', `/api/invoices/${i.id}/payments`, { payment_date: '2026-02-02', amount: 490 });
  i = (await call('GET', `/api/invoices/${i.id}`)).body;
  assert.equal(i.status, 'paid');
  await call('DELETE', `/api/payments/${i.payments[1].id}`);
  assert.equal((await call('GET', `/api/invoices/${i.id}`)).body.status, 'sent');

  assert.equal((await call('PUT', `/api/invoices/${i.id}`, { status: 'void' })).status, 200);
  assert.equal((await call('GET', `/api/cases/${c}/unbilled`)).body.total, 1000, 'voiding releases entries');
  assert.equal((await call('DELETE', `/api/invoices/${i.id}`)).status, 200);
});

test('hearing outcome schedules next date; checklists; contacts', async () => {
  const ev = (await call('POST', '/api/events', { case_id: 1, title: 'Mention hearing', kind: 'hearing', starts_at: '2026-01-01T09:00' })).body.id;
  const r = await call('POST', `/api/events/${ev}/outcome`, { outcome: 'Adjourned', next_at: '2030-02-01T09:00' });
  assert.equal(r.status, 200);
  assert.ok(r.body.next_id);
  const evs = (await call('GET', '/api/events?case_id=1')).body;
  assert.equal(evs.find((e) => e.id === ev).outcome, 'Adjourned');
  assert.ok(evs.find((e) => e.id === r.body.next_id));

  const tpls = (await call('GET', '/api/templates')).body;
  assert.ok(tpls.length >= 3);
  const ap = await call('POST', '/api/cases/2/apply-template', { template_id: tpls[0].id, start_date: '2030-01-01' });
  assert.equal(ap.body.created, tpls[0].items.length);

  assert.equal((await call('POST', '/api/contacts', { case_id: 2, name: 'Zed Witness', role: 'witness' })).status, 200);
  const conf = (await call('GET', '/api/conflicts?q=Zed')).body;
  assert.equal(conf.contacts.length, 1);
});

test('search, notifications, settings, calendar feed, backup', async () => {
  const s = (await call('GET', '/api/search?q=Blue%20Ocean')).body;
  assert.ok(s.cases.length >= 1);
  assert.ok(Array.isArray((await call('GET', '/api/notifications')).body));

  assert.equal((await call('PUT', '/api/settings', { currency: 'EUR' })).status, 403, 'partner cannot change settings');
  await call('POST', '/api/logout');
  await call('POST', '/api/login', { email: 'admin@firm.local', password: 'admin123' });
  assert.equal((await call('PUT', '/api/settings', { currency: 'xx' })).status, 400);
  const st = await call('PUT', '/api/settings', { currency: 'eur', holidays: '2026-12-25, 2026-12-26' });
  assert.equal(st.body.currency, 'EUR');
  assert.equal(st.body.holidays, '2026-12-25\n2026-12-26');

  const feed = (await call('GET', '/api/me/calendar-feed')).body.path;
  const saved = cookie; cookie = '';
  const ics = await call('GET', feed);
  cookie = saved;
  assert.equal(ics.status, 200);
  assert.match(ics.body, /BEGIN:VCALENDAR[\s\S]*BEGIN:VEVENT/);
  assert.equal((await call('GET', '/api/ical/' + 'a'.repeat(48) + '.ics')).status, 404);

  const bk = await fetch(base + '/api/admin/backup', { headers: { cookie } });
  assert.equal(bk.status, 200);
  const buf = Buffer.from(await bk.arrayBuffer());
  assert.equal(buf.subarray(0, 15).toString(), 'SQLite format 3');
});
