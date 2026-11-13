import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import * as argon2 from 'argon2';
import { passwordPolicyErrors } from '@ldms/shared';
import { config } from '../../config';

/** OWASP-recommended Argon2id parameters (m=64 MiB, t=3, p=1). Parameters are encoded in each hash. */
const ARGON = { type: argon2.argon2id, memoryCost: 65536, timeCost: 3, parallelism: 1 } as const;
const TEST_ARGON = { type: argon2.argon2id, memoryCost: 4096, timeCost: 2, parallelism: 1 } as const;

let blocklist: Set<string> | undefined;
function list(): Set<string> {
  if (blocklist) return blocklist;
  const files = [join(__dirname, '..', '..', '..', 'data', 'common-passwords.txt')];
  const extra = config().BREACHED_PASSWORDS_FILE;
  if (extra) files.push(extra);
  blocklist = new Set();
  for (const f of files) {
    if (!existsSync(f)) continue;
    for (const line of readFileSync(f, 'utf8').split(/\r?\n/)) if (line) blocklist.add(line.trim().toLowerCase());
  }
  return blocklist;
}

function params() {
  return process.env.NODE_ENV === 'test' ? TEST_ARGON : ARGON;
}

export async function hashPassword(pw: string): Promise<string> {
  return argon2.hash(pw, params());
}

export async function hashSecret(s: string): Promise<string> {
  return argon2.hash(s, params());
}

export async function verifyHash(hash: string, pw: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, pw);
  } catch {
    return false;
  }
}

/** A fixed hash used to equalise timing when the username does not exist. */
let dummy: Promise<string> | undefined;
export function dummyHash(): Promise<string> {
  dummy ??= hashPassword('dummy-password-for-timing-equalisation');
  return dummy;
}

export function checkPassword(pw: string, context: { username?: string; displayName?: string } = {}): string[] {
  const errors = passwordPolicyErrors(pw, context);
  const lower = pw.toLowerCase();
  const stripped = lower.replace(/[\d\W_]+$/g, '');
  const bl = list();
  if (bl.has(lower) || (stripped.length >= 4 && bl.has(stripped)) || bl.has(lower.replace(/\s+/g, ''))) {
    errors.push('This password is too common or has appeared in a data breach. Choose another.');
  }
  return errors;
}
