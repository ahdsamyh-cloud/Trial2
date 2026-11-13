/* eslint-disable no-console */
/**
 * Bootstrap the first Super Admin (an admin account: no legal content access).
 *   DATABASE_URL=<owner url> node -r @swc-node/register scripts/create-admin.ts <username> <email> "<Display Name>"
 * Prints a one-time temporary password. The admin must change it and enrol TOTP at first sign-in.
 */
import { PrismaClient } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import * as argon2 from 'argon2';
import { PrismaService } from '../src/common/prisma.service';
import { AuditService } from '../src/core/audit/audit.service';
import { runAsSystem } from '../src/common/context';

async function main() {
  const [username, email, displayName] = process.argv.slice(2);
  if (!username || !email || !displayName || !/^[a-z0-9._-]{3,40}$/.test(username)) {
    console.error('usage: create-admin.ts <username> <email> "<Display Name>"');
    process.exit(2);
  }
  const db = new PrismaClient();
  await db.$executeRaw`SELECT set_config('app.ctx', 'system', false)`;
  if (await db.user.findFirst({ where: { OR: [{ username }, { email: email.toLowerCase() }] } })) throw new Error('A user with that username or email already exists');
  const temp = randomBytes(18).toString('base64url');
  const hash = await argon2.hash(temp, { type: argon2.argon2id, memoryCost: 65536, timeCost: 3, parallelism: 1 });
  const it = await db.department.findFirst({ where: { code: 'IT' } });
  const user = await db.user.create({
    data: {
      username, email: email.toLowerCase(), displayName, departmentId: it?.id, status: 'ACTIVE', isAdminAccount: true, mustChangePassword: true,
      identities: { create: { provider: 'LOCAL', subject: username } }, credential: { create: { passwordHash: hash } }, roles: { create: [{ role: 'SUPER_ADMIN' }] },
    },
  });
  const audit = new AuditService(new PrismaService(), { register: () => undefined } as never);
  await runAsSystem(() => audit.log({ action: 'user.created', entityType: 'User', entityId: user.id, actorName: 'bootstrap-cli', after: { username, roles: ['SUPER_ADMIN'], isAdminAccount: true } }));
  console.log(`Created admin account "${user.username}".`);
  console.log(`Temporary password (shown once, give it in person): ${temp}`);
  console.log('At first sign-in the admin must change the password and set up an authenticator app.');
  await db.$disconnect();
}
main().catch((e) => { console.error(e.message); process.exit(1); });
