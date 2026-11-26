import { Injectable } from '@nestjs/common';
import { currentUser } from '../../common/context';
import { PrismaService } from '../../common/prisma.service';
import { AuditService } from '../audit/audit.service';
import { DocumentsService } from '../documents/documents.service';
import { PolicyService } from '../policy/policy.service';

export interface SearchHit { type: 'matter' | 'document' | 'email' | 'law' | 'contract' | 'opinion' | 'faq'; id: string; title: string; subtitle?: string; snippet?: string; link: string }

const HEADLINE = 'StartSel=«, StopSel=», MaxWords=30, MinWords=10, MaxFragments=2';

/**
 * Global search over matters, documents (incl. OCR'd text), emails, laws, contracts, opinions and FAQ.
 * Full-text candidates are fetched in an RLS transaction, then re-filtered through the same
 * PolicyService scopes used everywhere else, so restricted matters never appear.
 */
@Injectable()
export class SearchService {
  constructor(private readonly prisma: PrismaService, private readonly policy: PolicyService, private readonly documents: DocumentsService, private readonly audit: AuditService) {}

  async search(q: string, types?: string[]): Promise<{ q: string; hits: SearchHit[] }> {
    const query = q.trim().slice(0, 200);
    if (query.length < 2) return { q: query, hits: [] };
    const user = currentUser();
    const want = (t: string) => !types?.length || types.includes(t);
    const like = `%${query.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
    const legal = user.perms.has('matter:read');
    const hits: SearchHit[] = [];

    await this.prisma.tx(async (tx) => {
      // ---- matters
      if (want('matter') && (legal || user.perms.has('portal:use'))) {
        const ids = await tx.$queryRaw<{ id: string }[]>`
          SELECT id FROM "Matter"
          WHERE to_tsvector('english', coalesce("reference",'') || ' ' || coalesce("title",'') || ' ' || coalesce("description",'') || ' ' || coalesce("searchText",'')) @@ websearch_to_tsquery('english', ${query})
             OR "reference" ILIKE ${like} OR "title" ILIKE ${like}
          LIMIT 200`;
        const rows = await tx.matter.findMany({ where: { AND: [{ id: { in: ids.map((r) => r.id) } }, this.policy.matterScope()] }, select: { id: true, reference: true, title: true, unit: true, status: true }, take: 50 });
        for (const m of rows) hits.push({ type: 'matter', id: m.id, title: `${m.reference} — ${m.title}`, subtitle: `${m.unit} · ${m.status.replace(/_/g, ' ').toLowerCase()}`, link: m.unit === 'LIT' ? `/litigation/${m.id}` : m.unit === 'DRF' ? `/drafting/${m.id}` : `/matters/${m.id}` });
      }

      // ---- documents (filename + extracted / OCR text)
      if (want('document') && (legal || user.perms.has('portal:use'))) {
        const rows = await tx.$queryRaw<{ documentId: string; versionId: string; filename: string; title: string; snippet: string | null }[]>`
          SELECT DISTINCT ON (d.id) d.id AS "documentId", v.id AS "versionId", v.filename, d.title,
                 ts_headline('english', coalesce(v."extractedText", ''), websearch_to_tsquery('english', ${query}), ${HEADLINE}) AS snippet
          FROM "DocumentVersion" v JOIN "Document" d ON d.id = v."documentId"
          WHERE d."deletedAt" IS NULL AND v."scanStatus" = 'CLEAN'
            AND (to_tsvector('english', coalesce(v."filename",'') || ' ' || coalesce(v."extractedText",'')) @@ websearch_to_tsquery('english', ${query}) OR d.title ILIKE ${like})
          ORDER BY d.id, v."versionNo" DESC
          LIMIT 100`;
        let shown = 0;
        for (const r of rows) {
          if (shown >= 30) break;
          const doc = await tx.document.findUnique({ where: { id: r.documentId } });
          if (!doc) continue;
          try { await this.documents.assertDocRead(doc); } catch { continue; }
          const link = doc.matterId ? `/matters/${doc.matterId}` : doc.lawId ? `/compliance/laws/${doc.lawId}` : doc.sessionId ? `/awareness/sessions/${doc.sessionId}` : doc.contractId ? '/drafting' : doc.checkItemId ? '/compliance' : doc.findingId ? `/compliance/findings/${doc.findingId}` : doc.intakeId ? `/intake/${doc.intakeId}` : '/drafting';
          hits.push({ type: 'document', id: r.documentId, title: r.title, subtitle: r.filename, snippet: r.snippet ?? undefined, link });
          shown++;
        }
      }

      // ---- emails (intake originals)
      if (want('email') && user.perms.has('intake:read')) {
        const rows = await tx.$queryRaw<{ intakeId: string; subject: string | null; fromAddr: string | null; snippet: string | null }[]>`
          SELECT e."intakeId", e.subject, e."fromAddr", ts_headline('english', coalesce(e."bodyText",''), websearch_to_tsquery('english', ${query}), ${HEADLINE}) AS snippet
          FROM "EmailMessage" e
          WHERE to_tsvector('english', coalesce(e.subject,'') || ' ' || coalesce(e."bodyText",'')) @@ websearch_to_tsquery('english', ${query}) OR e.subject ILIKE ${like}
          LIMIT 50`;
        for (const r of rows) {
          const intake = await tx.intake.findUnique({ where: { id: r.intakeId }, select: { id: true, intakeNo: true, matterId: true } });
          if (!intake) continue;
          if (intake.matterId && !(await tx.matter.count({ where: { AND: [{ id: intake.matterId }, this.policy.matterScope()] } }))) continue;
          hits.push({ type: 'email', id: intake.id, title: r.subject ?? '(no subject)', subtitle: `${intake.intakeNo} · ${r.fromAddr ?? ''}`, snippet: r.snippet ?? undefined, link: `/intake/${intake.id}` });
        }
      }

      // ---- laws
      if (want('law')) {
        const rows = await tx.$queryRaw<{ id: string; title: string; type: string }[]>`
          SELECT id, title, type FROM "Law"
          WHERE to_tsvector('english', coalesce(title,'') || ' ' || coalesce(summary,'')) @@ websearch_to_tsquery('english', ${query}) OR title ILIKE ${like} LIMIT 30`;
        for (const l of rows) hits.push({ type: 'law', id: l.id, title: l.title, subtitle: l.type.toLowerCase(), link: `/compliance/laws/${l.id}` });
      }

      // ---- contracts and opinions (Drafting registers)
      if (this.policy.covers('matter:read', 'DRF')) {
        if (want('contract')) {
          const rows = await tx.$queryRaw<{ id: string; title: string; status: string }[]>`
            SELECT id, title, status FROM "Contract"
            WHERE to_tsvector('english', coalesce(title,'') || ' ' || coalesce("keyObligations",'')) @@ websearch_to_tsquery('english', ${query})
               OR title ILIKE ${like} OR array_to_string(parties, ' ') ILIKE ${like} LIMIT 30`;
          for (const c of rows) hits.push({ type: 'contract', id: c.id, title: c.title, subtitle: c.status.toLowerCase(), link: '/drafting' });
        }
        if (want('opinion')) {
          const rows = await tx.$queryRaw<{ id: string; title: string; snippet: string | null }[]>`
            SELECT id, title, ts_headline('english', summary, websearch_to_tsquery('english', ${query}), ${HEADLINE}) AS snippet FROM "LegalOpinion"
            WHERE to_tsvector('english', title || ' ' || question || ' ' || summary) @@ websearch_to_tsquery('english', ${query}) OR title ILIKE ${like} LIMIT 30`;
          for (const o of rows) hits.push({ type: 'opinion', id: o.id, title: o.title, snippet: o.snippet ?? undefined, link: '/drafting' });
        }
      }

      // ---- FAQ (everyone)
      if (want('faq')) {
        const rows = await tx.faqEntry.findMany({ where: { published: true, OR: [{ question: { contains: query, mode: 'insensitive' } }, { answer: { contains: query, mode: 'insensitive' } }] }, take: 10 });
        for (const f of rows) hits.push({ type: 'faq', id: f.id, title: f.question, snippet: f.answer.slice(0, 200), link: '/knowledge' });
      }
    }, { timeout: 30_000 });

    await this.audit.log({ action: 'search', meta: { q: query, results: hits.length } });
    return { q: query, hits };
  }
}
