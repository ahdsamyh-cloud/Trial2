// k6 load test for staging (k6 run -e BASE=https://ldms-staging.stelco.internal -e COOKIE="ldms_sid=…" k6-load.js)
// Target from PLAN §10: p95 < 500 ms for list views at 200 concurrent users.
// COOKIE: a session cookie of a test account created for load testing (sessions cannot be scripted past TOTP).
import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [{ duration: '1m', target: 50 }, { duration: '3m', target: 200 }, { duration: '1m', target: 0 }],
  thresholds: { http_req_failed: ['rate<0.01'], 'http_req_duration{kind:list}': ['p(95)<500'], 'http_req_duration{kind:search}': ['p(95)<1500'] },
};
const BASE = __ENV.BASE;
const headers = { Cookie: __ENV.COOKIE, Accept: 'application/json' };
const pages = ['/api/my/work', '/api/matters?pageSize=25', '/api/litigation/cases?pageSize=25&open=true', '/api/notifications?unread=true', '/api/calendar?from=2026-01-01T00:00:00Z&to=2026-12-31T00:00:00Z'];

export default function () {
  for (const p of pages) check(http.get(`${BASE}${p}`, { headers, tags: { kind: 'list' } }), { ok: (r) => r.status === 200 });
  check(http.get(`${BASE}/api/search?q=contract`, { headers, tags: { kind: 'search' } }), { ok: (r) => r.status === 200 });
  sleep(1 + Math.random() * 2);
}
