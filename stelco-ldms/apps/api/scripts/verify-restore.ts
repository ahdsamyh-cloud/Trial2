/* eslint-disable no-console */
/**
 * Post-restore verification: row counts, audit hash chain, and document integrity (SHA-256 of a
 * sample of stored files). Exit code 1 on any failure. Used by infra/backup/restore.sh and drills.
 */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { PrismaService } from '../src/common/prisma.service';
import { AuditService } from '../src/core/audit/audit.service';
import { runAsSystem } from '../src/common/context';

async function main() {
  const prisma = new PrismaService();
  const audit = new AuditService(prisma, { register: () => undefined } as never);
  await runAsSystem(async () => {
    const counts = {
      users: await prisma.db.user.count(), matters: await prisma.db.matter.count(), documents: await prisma.db.document.count(),
      versions: await prisma.db.documentVersion.count(), auditEntries: await prisma.base.auditLog.count(),
    };
    console.log('[verify] counts', JSON.stringify(counts));
    const chain = await audit.verify();
    console.log('[verify] audit chain', JSON.stringify(chain));
    let checked = 0;
    let bad = 0;
    const root = process.env.STORAGE_FS_ROOT;
    if (root) {
      const sample = await prisma.db.documentVersion.findMany({ where: { scanStatus: 'CLEAN' }, take: 200, orderBy: { createdAt: 'desc' } });
      for (const v of sample) {
        try {
          const buf = await readFile(join(resolve(root), 'clean', v.storageKey));
          if (createHash('sha256').update(buf).digest('hex') !== v.sha256) bad++;
          checked++;
        } catch { bad++; }
      }
      console.log(`[verify] documents: ${checked} checked, ${bad} missing or corrupt`);
    }
    await prisma.onModuleDestroy();
    if (!chain.ok || bad > 0 || counts.users === 0) { console.error('[verify] FAILED'); process.exit(1); }
    console.log('[verify] OK');
  });
}
main().catch((e) => { console.error(e); process.exit(1); });
