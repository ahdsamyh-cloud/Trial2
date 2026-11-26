#!/usr/bin/env node
// Starts the API (:4000) and the web app (:3000) together for local development (any OS).
// Ctrl+C stops both. Open http://localhost:3000
import { spawn } from 'node:child_process';

const procs = [
  ['api', ['--filter', 'api', 'dev']],
  ['web', ['--filter', 'web', 'dev']],
].map(([name, args]) => {
  // shell: true lets Windows find pnpm.cmd; the arguments are fixed strings, never user input.
  const p = spawn('pnpm', args, { stdio: 'inherit', shell: process.platform === 'win32' });
  p.on('exit', (code) => {
    if (code && code !== 0) console.error(`\n[${name}] exited with code ${code}`);
    for (const other of procs) if (other !== p && other.exitCode === null) other.kill();
    process.exitCode = code ?? 0;
  });
  return p;
});

console.log('Starting API on http://localhost:4000 and web on http://localhost:3000 (Ctrl+C to stop)...');
const stop = () => { for (const p of procs) if (p.exitCode === null) p.kill(); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
