#!/usr/bin/env node
/**
 * Builds the "local edition": a folder that runs the whole app with plain Node.js + npm
 * (embedded PostgreSQL via PGlite; no Docker/Redis/ClamAV/pnpm needed by the person running it).
 *
 *   pnpm build:local            ->  dist-local/stelco-ldms-local/
 *
 * Layout of the result:
 *   package.json, .npmrc, package-lock.json   plain npm project (npm install / npm start / npm run code)
 *   start.mjs, code.mjs, README.txt            launcher (local/), sign-in code helper, instructions
 *   app/api/      compiled API (dist, dist-tools/seed) + prisma schema/migrations/sql + data
 *   app/shared/   compiled @ldms/shared (installed by npm as a local package)
 *   app/web/      Next.js standalone server (dependencies bundled, symlinks resolved)
 *   source/       the full readable source code (tracked files of the repository)
 */
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'dist-local', 'stelco-ldms-local');
const shell = process.platform === 'win32';
const sh = (cmd, args, cwd = root) => execFileSync(cmd, args, { cwd, stdio: 'inherit', shell });

// Versions of the embedded database (pinned; at least 7 days old when chosen, like the rest of the lockfile).
const LOCAL_DEPS = { '@electric-sql/pglite': '0.5.15', '@electric-sql/pglite-socket': '0.2.18' };

console.log('> building shared, api and web');
sh('pnpm', ['build:shared']);
sh('pnpm', ['--filter', 'api', 'prisma:generate']);
sh('pnpm', ['--filter', 'api', 'build']);
sh('pnpm', ['--filter', 'web', 'build']);

console.log(`> assembling ${out}`);
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
/**
 * Copy a file/folder, replacing EVERY symlink (at any depth) with a real copy of its target.
 * pnpm/Next standalone output is full of symlinks, often absolute paths into this machine;
 * zip tools on Windows do not restore them, so the bundle must contain real files only.
 * `skip(name)` drops entries by name (used to leave out platform-specific binaries).
 */
function copyDeref(src, dst, skip = () => false) {
  const real = lstatSync(src).isSymbolicLink() ? realpathSync(src) : src;
  if (statSync(real).isDirectory()) {
    mkdirSync(dst, { recursive: true });
    for (const name of readdirSync(real)) if (!skip(name)) copyDeref(join(real, name), join(dst, name), skip);
  } else {
    mkdirSync(dirname(dst), { recursive: true });
    copyFileSync(real, dst);
  }
}
const copy = (from, to, skip) => copyDeref(join(root, from), join(out, to), skip);
// sharp (next/image optimisation) is not used by this app and ships per-platform binaries.
const notSharp = (name) => name === 'sharp' || name.startsWith('@img+') || name.startsWith('sharp@') || name === '@img';

// API (compiled) + database definition + bundled data files
for (const d of ['dist', 'dist-tools', 'data']) copy(`apps/api/${d}`, `app/api/${d}`);
copy('apps/api/prisma/schema.prisma', 'app/api/prisma/schema.prisma');
copy('apps/api/prisma/migrations', 'app/api/prisma/migrations');
copy('apps/api/prisma/sql', 'app/api/prisma/sql');
// The local edition never runs the dev .ts seeds or the dist sources' map files from the repo layout.
writeFileSync(join(out, 'app/api/package.json'), JSON.stringify({ name: 'ldms-api-compiled', private: true, type: 'commonjs' }, null, 2) + '\n');

// Shared package (compiled)
const sharedPkg = JSON.parse(readFileSync(join(root, 'packages/shared/package.json'), 'utf8'));
copy('packages/shared/dist', 'app/shared/dist');
writeFileSync(join(out, 'app/shared/package.json'), JSON.stringify({ name: sharedPkg.name, version: sharedPkg.version, private: true, main: sharedPkg.main, types: sharedPkg.types }, null, 2) + '\n');

// Web: Next standalone output. pnpm's node_modules use symlinks; `dereference` turns them into
// real files so the folder works after unzipping on Windows (zip tools do not restore symlinks).
// The standalone server + app files, without pnpm's node_modules (rebuilt flat below).
copy('apps/web/.next/standalone', 'app/web', (name) => name === 'node_modules');
// Flat node_modules (the layout npm itself creates): every package from pnpm's .pnpm store is copied
// to app/web/node_modules/<name>, so Node's normal lookup finds each package's dependencies.
// The traced set is small (~25 packages); a name with two different versions would be ambiguous,
// so the build stops instead of guessing.
{
  const store = join(root, 'apps/web/.next/standalone/node_modules/.pnpm');
  const seen = new Map();
  for (const entry of readdirSync(store)) {
    const nm = join(store, entry, 'node_modules');
    if (!existsSync(nm)) continue;
    for (const name of readdirSync(nm)) {
      const pkgs = name.startsWith('@') ? readdirSync(join(nm, name)).map((m) => `${name}/${m}`) : [name];
      for (const pkg of pkgs) {
        const src = join(nm, pkg);
        if (lstatSync(src).isSymbolicLink() || notSharp(pkg.split('/')[0]) || notSharp(pkg)) continue; // links point at other store entries
        if (seen.has(pkg)) throw new Error(`web dependency ${pkg} exists twice (${seen.get(pkg)} and ${entry}); cannot flatten`);
        seen.set(pkg, entry);
        copyDeref(src, join(out, 'app/web/node_modules', pkg));
      }
    }
  }
  // apps/web/node_modules held only pnpm links (next, react); the flat folder above replaces them.
  rmSync(join(out, 'app/web/apps/web/node_modules'), { recursive: true, force: true });
  console.log(`  web: ${seen.size} packages flattened`);
}
copy('apps/web/.next/static', 'app/web/apps/web/.next/static');
if (existsSync(join(root, 'apps/web/public'))) copy('apps/web/public', 'app/web/apps/web/public');

// Launcher, helper, instructions
for (const f of ['start.mjs', 'code.mjs', 'README.txt', 'HOSTING-ONLINE.txt']) copy(`local/${f}`, f);

// npm project: the API's runtime dependencies + the embedded database
const apiPkg = JSON.parse(readFileSync(join(root, 'apps/api/package.json'), 'utf8'));
const rootPkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const deps = { ...apiPkg.dependencies, ...LOCAL_DEPS, '@ldms/shared': 'file:app/shared' };
const overrides = Object.fromEntries(Object.entries(rootPkg.pnpm?.overrides ?? {}).map(([sel, v]) => [sel.replace(/@[<>=^~].*$/, ''), v]));
writeFileSync(join(out, 'package.json'), JSON.stringify({
  name: 'stelco-ldms-local',
  version: rootPkg.version ?? '0.1.0',
  private: true,
  description: 'STELCO LDMS - local edition (Node.js only). See README.txt.',
  engines: { node: '>=22' },
  scripts: {
    start: 'node start.mjs',
    code: 'node code.mjs',
    // Downloads the Prisma query engine for THIS computer's operating system.
    postinstall: 'prisma generate --schema app/api/prisma/schema.prisma',
  },
  dependencies: Object.fromEntries(Object.entries(deps).sort(([a], [b]) => a.localeCompare(b))),
  overrides,
}, null, 2) + '\n');
// install-links: copy the local @ldms/shared package instead of symlinking it (works everywhere).
writeFileSync(join(out, '.npmrc'), 'install-links=true\nsave-exact=true\nfund=false\n');

// Readable source code: every tracked file of the repository, as it is in the working tree.
console.log('> copying source');
const files = execFileSync('git', ['ls-files', '-z', '--', '.', ':!:dist-local'], { cwd: root }).toString('utf8').split('\0').filter(Boolean);
for (const f of files) {
  const src = join(root, f);
  if (!existsSync(src)) continue; // deleted in the working tree
  const dst = join(out, 'source', 'stelco-ldms', f);
  mkdirSync(dirname(dst), { recursive: true });
  copyFileSync(src, dst);
}

console.log('> resolving package-lock.json');
sh('npm', ['install', '--package-lock-only', '--ignore-scripts', '--no-audit'], out);

console.log(`\nDone: ${out}\nTry it: cd there, npm install, npm start`);
