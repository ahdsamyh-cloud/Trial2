#!/usr/bin/env node
// Prints the current 6-digit sign-in code for the demo users of the LDMS local edition.
// Each code can be used once; if it is refused, wait for the next 30-second window and run again.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import otplib from 'otplib';

const file = join(dirname(fileURLToPath(import.meta.url)), 'data', 'local.env');
let secret;
try {
  secret = readFileSync(file, 'utf8').split(/\r?\n/).find((l) => l.startsWith('DEMO_TOTP_SECRET='))?.slice('DEMO_TOTP_SECRET='.length);
} catch { /* handled below */ }
if (!secret) {
  console.error('No demo login yet. Run `npm start` once first (it creates data/local.env).');
  process.exit(1);
}
const left = 30 - (Math.floor(Date.now() / 1000) % 30);
console.log(`Code: ${otplib.authenticator.generate(secret)}   (valid for about ${left} more seconds)`);
