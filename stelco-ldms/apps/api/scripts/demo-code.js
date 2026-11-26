// Prints the current 6-digit sign-in code for the demo users (local development only),
// so you can sign in without an authenticator app. Each code works once (replay protection);
// if it is refused, wait for the next 30-second window and run this again.
const { existsSync } = require('node:fs');
const { join } = require('node:path');
const { authenticator } = require('otplib');

const envFile = join(__dirname, '..', '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);
if (process.env.NODE_ENV === 'production') { console.error('Not available in production.'); process.exit(1); }
const secret = process.env.DEMO_TOTP_SECRET;
if (!secret) { console.error('DEMO_TOTP_SECRET is not set. Run `pnpm setup:env` first.'); process.exit(1); }
const left = 30 - (Math.floor(Date.now() / 1000) % 30);
console.log(`Code: ${authenticator.generate(secret)}   (valid for ~${left}s)`);
