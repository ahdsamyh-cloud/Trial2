// Collects every t('…') string in the web app into messages/en.json (gettext style:
// English text is the key). Translators copy en.json to <lang>.json and translate values.
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const files = [];
const walk = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) { if (!['node_modules', '.next', 'e2e'].includes(f)) walk(p); } else if (/\.tsx?$/.test(f)) files.push(p); } };
['app', 'components', 'lib'].forEach((d) => walk(join(root, d)));
const keys = new Set();
const re = /\bt\(\s*'((?:[^'\\]|\\.)*)'/g;
for (const f of files) for (const m of readFileSync(f, 'utf8').matchAll(re)) keys.add(m[1].replace(/\\'/g, "'"));
const out = Object.fromEntries([...keys].sort().map((k) => [k, k]));
writeFileSync(join(root, 'messages', 'en.json'), `${JSON.stringify(out, null, 2)}\n`);
console.log(`messages/en.json: ${keys.size} strings`);
