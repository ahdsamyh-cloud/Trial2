import { describe, expect, it } from 'vitest';
import { PDFDocument, rgb } from 'pdf-lib';
import { drawLine, embedReportFonts, isRtl, latinSafe, runs, widthOf } from './core/reports/pdf-text';
import { ReportsService } from './core/reports/reports.service';

describe('PDF text with Dhivehi (Thaana)', () => {
  it('splits Thaana and Latin runs and detects the paragraph direction', () => {
    expect(runs('Finance ފައިނޭންސް ޑިޕާޓްމަންޓް 2026').map((r) => r.thaana)).toEqual([false, true, false]);
    expect(isRtl('ދިވެހި report')).toBe(true);
    expect(isRtl('Report ދިވެހި')).toBe(false);
    expect(latinSafe('a—b ✓')).toBe('a—b ?');
  });

  it('draws Thaana with the embedded font (no "cannot encode" error) and keeps widths sane', async () => {
    const doc = await PDFDocument.create();
    const fonts = await embedReportFonts(doc);
    const page = doc.addPage();
    const w = drawLine(page, 'ދިވެހި ބަސް', { x: 300, y: 700, size: 12, font: fonts.regular, fonts, color: rgb(0, 0, 0), align: 'right' });
    expect(w).toBeGreaterThan(20);
    expect(widthOf('ދިވެހި ބަސް', 12, fonts.regular, fonts)).toBeCloseTo(w);
    const bytes = await doc.save({ useObjectStreams: false });
    expect(Buffer.from(bytes).toString('latin1')).toContain('NotoSansThaana');
  });

  it('the management report PDF renders a Dhivehi department name', async () => {
    const svc = new ReportsService(null as never, null as never, null as never, null as never, null as never, null as never);
    const pdf = await svc.pdf({ title: 'Legal Department monthly management report', period: '2026-11', from: new Date(), to: new Date(), generatedAt: new Date(),
      sections: [{ title: 'Compliance by department', rows: [['ފައިނޭންސް ޑިޕާޓްމަންޓް (Finance)', 12], ['Human Resources', 3], ['ދިވެހި ބަހުން ލިޔެފައިވާ ސުރުޚީ', '100%']] }] } as never);
    if (process.env.PDF_OUT) (await import('node:fs')).writeFileSync(process.env.PDF_OUT, pdf);
    expect(pdf.length).toBeGreaterThan(1000);
  });
});
