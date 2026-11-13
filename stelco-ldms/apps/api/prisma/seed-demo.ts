import type { PrismaClient } from '@prisma/client';

const day = 86400_000;
async function ref(db: PrismaClient, prefix: string) {
  const year = new Date().getUTCFullYear();
  const r = await db.$queryRaw<{ last: number }[]>`INSERT INTO "ReferenceSequence" ("prefix","year","last") VALUES (${prefix}, ${year}, 1)
    ON CONFLICT ("prefix","year") DO UPDATE SET "last" = "ReferenceSequence"."last" + 1 RETURNING "last"`;
  return `LGL-${prefix}-${year}-${String(r[0]!.last).padStart(4, '0')}`;
}
async function uid(db: PrismaClient, username: string) {
  return (await db.user.findUniqueOrThrow({ where: { username } })).id;
}

/** Demo records per unit. Idempotent: skipped if demo matters already exist. */
export async function seedDemo(db: PrismaClient) {
  await db.$executeRaw`SELECT set_config('app.ctx', 'system', false)`;
  if (await db.matter.count({ where: { tags: { has: 'demo' } } })) return;
  const hod = await uid(db, 'hod');
  const lit1 = await uid(db, 'lo.lit1');
  const lit2 = await uid(db, 'lo.lit2');
  const civil = await db.court.findUniqueOrThrow({ where: { name: 'Civil Court' } });
  const emp = await db.court.findUniqueOrThrow({ where: { name: 'Employment Tribunal' } });
  const firm = await db.lawFirm.findFirstOrThrow({ where: { name: 'Shah & Partners LLP' } });
  const fin = await db.department.findUniqueOrThrow({ where: { code: 'FIN' } });

  // ---------------- Litigation
  const cases = [
    { title: 'ABC Pvt Ltd v STELCO — unpaid cable supply invoices', no: 'CV-2025-1123', court: civil.id, type: 'COMMERCIAL', role: 'DEFENDANT', claim: '1250000.00', risk: 'POSSIBLE', officer: lit1, status: 'PENDING_HEARING', hearing: 9 },
    { title: 'A. Ibrahim v STELCO — unfair dismissal', no: 'EMP-2025-0042', court: emp.id, type: 'LABOUR', role: 'DEFENDANT', claim: '85000.00', risk: 'PROBABLE', officer: lit2, status: 'FILED', hearing: 21 },
    { title: 'STELCO v Island Contractors — liquidated damages', no: 'CV-2024-0877', court: civil.id, type: 'COMMERCIAL', role: 'PLAINTIFF', claim: '3400000.00', risk: 'REMOTE', officer: lit1, status: 'APPEAL', hearing: -3 },
  ];
  for (const c of cases) {
    const reference = await ref(db, 'LIT');
    const m = await db.matter.create({ data: { reference, unit: 'LIT', title: c.title, status: c.status, tags: ['demo'], createdById: hod, requestingDeptId: fin.id } });
    await db.litigationCase.create({ data: { matterId: m.id, courtCaseNo: c.no, courtId: c.court, caseType: c.type, ourRole: c.role, claimAmount: c.claim, risk: c.risk as never, externalFirmId: firm.id, responsibleOfficerId: c.officer, filingDate: new Date(Date.now() - 300 * day) } });
    await db.matterAssignment.create({ data: { matterId: m.id, userId: c.officer, role: 'ASSIGNEE' } });
    const startsAt = new Date(Date.now() + c.hearing * day);
    const h = await db.hearing.create({ data: { caseId: m.id, startsAt, courtId: c.court, status: c.hearing < 0 ? 'HELD' : 'SCHEDULED' } });
    await db.calendarEvent.create({ data: { kind: 'HEARING', unit: 'LIT', title: `${reference} hearing (${c.no})`, sourceType: 'Hearing', sourceId: h.id, startsAt, ownerId: c.officer, matterId: m.id } });
    await db.statusTransition.create({ data: { matterId: m.id, toStatus: c.status, action: 'seed', actorId: hod } });
  }

  // ---------------- Compliance
  const ura = await db.regulator.findUniqueOrThrow({ where: { name: 'Utility Regulatory Authority' } });
  const cmp1 = await uid(db, 'lo.cmp1');
  const law = await db.law.create({ data: { title: 'Electricity Regulations (demo)', type: 'REGULATION', regulatorId: ura.id, status: 'IN_FORCE', summary: 'Licensing, safety and reporting duties for electricity utilities.', officerId: cmp1, effectiveOn: new Date('2024-01-01') } });
  await db.lawVersion.create({ data: { lawId: law.id, versionNo: 1, notes: 'Initial version' } });
  const ops = await db.department.findUniqueOrThrow({ where: { code: 'OPS' } });
  await db.obligation.create({ data: { lawId: law.id, description: 'Report every outage longer than 4 hours to the regulator within 48 hours', article: 'Reg. 21', frequency: 'QUARTERLY', risk: 'HIGH', evidenceRequired: 'Outage reports sent to the regulator', departmentIds: [ops.id, fin.id], nextCheckAt: new Date() } });
  await db.obligation.create({ data: { lawId: law.id, description: 'Publish approved tariffs on the company website', article: 'Reg. 9', frequency: 'ANNUAL', risk: 'MEDIUM', departmentIds: [fin.id], nextCheckAt: new Date() } });
  const d = await db.dissemination.create({ data: { subject: 'Reminder: outage reporting duty', body: 'Outages longer than 4 hours must be reported to the regulator within 48 hours.', lawId: law.id, sentById: cmp1, dueAt: new Date(Date.now() + 7 * day) } });
  await db.disseminationRecipient.createMany({ data: [{ disseminationId: d.id, departmentId: fin.id }, { disseminationId: d.id, departmentId: ops.id }] });
  await db.licence.create({ data: { name: 'Generation licence — Male', kind: 'LICENCE', regulatorId: ura.id, number: 'URA/GEN/0001', expiresOn: new Date(Date.now() + 75 * day) } });
}
