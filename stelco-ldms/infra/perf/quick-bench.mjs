// Indicative local benchmark (no k6 needed): N concurrent virtual users hammer list endpoints through the BFF.
//   node quick-bench.mjs http://localhost:3000 "ldms_sid=…; ldms_csrf=…" 50 20
const [base, cookie, vus = '50', seconds = '20'] = process.argv.slice(2);
const paths = ['/api/my/work', '/api/matters?pageSize=25', '/api/litigation/cases?pageSize=25&open=true', '/api/notifications?unread=true', '/api/search?q=contract'];
const times = Object.fromEntries(paths.map((p) => [p, []]));
let errors = 0;
const end = Date.now() + Number(seconds) * 1000;
async function vu() {
  while (Date.now() < end) {
    for (const p of paths) {
      const t0 = performance.now();
      const r = await fetch(base + p, { headers: { cookie } }).catch(() => null);
      if (!r || r.status !== 200) errors++;
      else await r.arrayBuffer();
      times[p].push(performance.now() - t0);
    }
  }
}
await Promise.all(Array.from({ length: Number(vus) }, vu));
const pct = (a, q) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(q * s.length))]?.toFixed(0); };
for (const p of paths) console.log(`${p.padEnd(48)} n=${String(times[p].length).padStart(5)} p50=${pct(times[p], 0.5)}ms p95=${pct(times[p], 0.95)}ms`);
console.log(`errors: ${errors}`);
