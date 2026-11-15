import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import ExcelJS from 'exceljs';
import PizZip from 'pizzip';
import { updatable } from './common/zod';
import { changedFields } from './core/audit/audit.service';
import { ReportTemplatesService } from './core/reports/report-templates.service';

const svc = new ReportTemplatesService(null as never, null as never, null as never, null as never, null as never);

describe('updatable(): PATCH schemas never apply defaults', () => {
  const create = z.object({ name: z.string(), currency: z.string().default('MVR'), active: z.boolean().default(true), tags: z.array(z.string()).default([]) }).strict();
  it('leaves fields that were not sent untouched', () => {
    expect(create.partial().parse({ name: 'x' })).toEqual({ name: 'x', currency: 'MVR', active: true, tags: [] }); // the bug
    expect(updatable(create).parse({ name: 'x' })).toEqual({ name: 'x' });
    expect(updatable(create).parse({ active: false })).toEqual({ active: false });
    expect(() => updatable(create).parse({ other: 1 })).toThrow(); // still strict
  });
});

describe('changedFields(): only real changes, secrets masked', () => {
  it('diffs and masks', () => {
    const d = changedFields(
      { title: 'A', dueAt: new Date('2026-01-01T00:00:00Z'), amountEnc: 'v1.x', exposure: '10', notes: null },
      { title: 'A', dueAt: new Date('2026-02-01T00:00:00Z'), exposure: '20', notes: undefined },
    );
    expect(d).toEqual({ before: { dueAt: '2026-01-01T00:00:00.000Z', exposure: '[changed]' }, after: { dueAt: '2026-02-01T00:00:00.000Z', exposure: '[changed]' } });
    expect(changedFields({ a: 1 }, { a: 1 })).toBeNull();
  });
});

describe('report periods (Maldives time)', () => {
  it('weekly = Sunday..Saturday containing the date; monthly = calendar month', () => {
    const w = svc.range('WEEKLY', '2026-11-18'); // a Wednesday
    expect(w.from.toISOString()).toBe('2026-11-14T19:00:00.000Z'); // Sun 15 Nov 00:00 MVT
    expect(w.to.toISOString()).toBe('2026-11-21T19:00:00.000Z');
    expect(w.label).toBe('Week 15 Nov – 21 Nov 2026');
    const m = svc.range('MONTHLY', '2026-02');
    expect(m.from.toISOString()).toBe('2026-01-31T19:00:00.000Z');
    expect(m.label).toBe('February 2026');
    expect(() => svc.range('MONTHLY', '2026-13')).toThrow();
    expect(() => svc.range('WEEKLY', 'next week')).toThrow();
  });
});

describe('filling report formats', () => {
  const data = { report: { title: 'Weekly', period: 'Week 1' }, totals: { opened: 3 }, lit: { hearings: [{ date: '01 Nov', reference: 'LIT-1', note: '=HYPERLINK("x")' }, { date: '02 Nov', reference: 'LIT-2', note: 'ޝުކުރިއްޔާ' }], empty: [] } };
  it('Excel: scalars, repeated rows, numbers kept numeric, formula-looking text neutralised, empty lists cleared', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('R');
    ws.addRow(['{{report.title}} – {{report.period}}', '{{totals.opened}}']);
    ws.addRow(['{{#}}', '{{lit.hearings.date}}', '{{lit.hearings.reference}}', '{{lit.hearings.note}}']);
    ws.addRow(['{{lit.empty.x}}']);
    ws.addRow(['end']);
    const out = new ExcelJS.Workbook();
    await out.xlsx.load((await svc.fillXlsx(Buffer.from(await wb.xlsx.writeBuffer()), data)) as unknown as ArrayBuffer);
    const s = out.worksheets[0]!;
    expect(s.getCell('A1').value).toBe('Weekly – Week 1');
    expect(s.getCell('B1').value).toBe(3);
    expect([s.getCell('A2').value, s.getCell('B2').value, s.getCell('C2').value]).toEqual(['1', '01 Nov', 'LIT-1']);
    expect(s.getCell('D2').value).toBe('\'=HYPERLINK("x")');
    expect([s.getCell('A3').value, s.getCell('C3').value, s.getCell('D3').value]).toEqual(['2', 'LIT-2', 'ޝުކުރިއްޔާ']);
    expect(s.getCell('A4').value).toBeNull();
    expect(s.getCell('A5').value).toBe('end');
  });
  it('Word: dotted values and loops; values are escaped text', () => {
    const zip = new PizZip();
    zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
    zip.file('_rels/.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
    zip.file('word/document.xml', '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>{{report.title}}: {{#lit.hearings}}[{{reference}} {{report.period}}]{{/lit.hearings}}</w:t></w:r></w:p></w:body></w:document>');
    const out = svc.fillDocx(zip.generate({ type: 'nodebuffer' }), { ...data, lit: { hearings: [{ reference: '<b>LIT-1</b>' }] } });
    const xml = new PizZip(out).file('word/document.xml')!.asText();
    expect(xml).toContain('Weekly: [&lt;b&gt;LIT-1&lt;/b&gt; Week 1]');
    expect(() => svc.fillDocx(Buffer.from('not a docx'), data)).toThrow();
  });
});
