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
