import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import writeXlsxFile from 'write-excel-file/browser';
import type { Project, Vec2, LengthUnit } from '../model/types';
import { buildCutList, cutListCsv, cutRowValues, CUT_HEADERS, groupLabel, hardwareList, type SheetGroup } from '../model/cutlist';
import { estimateCost, money as moneyRaw, type CostEstimate } from '../model/cost';

/** jsPDF's standard fonts are Latin-1 only: spell out symbols such as ₹. */
const pdfCurrency = (c: string) => (/^[\x20-\xff]*$/.test(c) ? c : ({ '₹': 'Rs ', '€': 'EUR ', '¥': 'JPY ', '₩': 'KRW ', '₺': 'TRY ' }[c] ?? `${c.normalize('NFKD').replace(/[^\x20-\x7e]/g, '')} `));
const money = (n: number, c: string) => moneyRaw(n, pdfCurrency(c));
import { buildCountertop, countertopLayout, asPlaced } from '../model/countertop';
import { elevationFor, interestingWalls, type ElevationData } from '../model/elevation';
import { boundsOf, centroid, dist, outerPolygon, polygonArea, wallQuads } from '../model/geometry';
import { formatArea, formatLength } from '../model/units';
import { clampOpening, columnPolygon, beamPolygon, findWall, footprint, servicePosition } from '../model/structure';
import { finishById, serviceDef, stoneById } from '../model/catalog';
import { applianceDef } from '../model/appliances';
import { moduleDef } from '../model/furniture';
import { openingSymbol } from '../plan2d/layers';
import type { NestSheet } from '../model/nesting';

const fileBase = (p: Project) => p.name.replace(/[^\w\- ]+/g, '').trim() || 'roomcraft';

export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export function exportCutListCsv(project: Project) {
  const csv = cutListCsv(buildCutList(project));
  download(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }), `${fileBase(project)} - cut list.csv`);
}

export async function exportExcel(project: Project) {
  const rows = buildCutList(project);
  const hw = hardwareList(project);
  const cost = estimateCost(project);
  const head = (cells: string[]) => cells.map((value) => ({ value, fontWeight: 'bold' as const, backgroundColor: '#E6EFEB' }));
  const cut = [head(CUT_HEADERS), ...rows.map((r, i) => cutRowValues(r, i).map((value) => ({ value })))];
  const hardware = [head(['Item', 'Unit', 'Qty', 'Used in']), ...hw.map((h) => [{ value: h.name }, { value: h.unit }, { value: h.qty }, { value: h.modules.join(', ') }])];
  const sheets = [
    head(['Board', 'Sheets', 'Parts', 'Yield %']),
    ...cost.sheets.map((g) => [
      { value: groupLabel(g) },
      { value: g.result.sheets.length },
      { value: g.result.sheets.reduce((n, s) => n + s.placements.length, 0) },
      { value: Math.round(g.result.efficiency * 100) },
    ]),
  ];
  const costs = [
    head(['Item', 'Quantity', `Amount (${cost.currency})`]),
    ...cost.lines.map((l) => [{ value: l.label }, { value: l.qty }, { value: Math.round(l.amount) }]),
    [{ value: 'Subtotal', fontWeight: 'bold' as const }, { value: '' }, { value: Math.round(cost.subtotal) }],
    [{ value: `Labour & installation (${project.prices.labourPercent}%)` }, { value: '' }, { value: Math.round(cost.labour) }],
    [{ value: 'TOTAL', fontWeight: 'bold' as const }, { value: '' }, { value: Math.round(cost.total), fontWeight: 'bold' as const }],
    [],
    head(['Module', 'Boards', 'Finish', 'Edge band', 'Hardware', 'Total']),
    ...cost.modules.map((m) => [m.name, m.board, m.finish, m.edge, m.hardware, m.total].map((v) => ({ value: typeof v === 'number' ? Math.round(v) : v }))),
  ];
  await writeXlsxFile(
    [
      { sheet: 'Cut list', data: cut, columns: [6, 22, 22, 10, 10, 8, 10, 10, 10, 20, 26, 12, 6, 24].map((width) => ({ width })) },
      { sheet: 'Sheets', data: sheets, columns: [{ width: 40 }, { width: 10 }, { width: 10 }, { width: 10 }] },
      { sheet: 'Hardware', data: hardware, columns: [{ width: 36 }, { width: 8 }, { width: 8 }, { width: 60 }] },
      { sheet: 'Cost', data: costs, columns: [{ width: 46 }, { width: 14 }, { width: 14 }, { width: 12 }, { width: 12 }, { width: 12 }] },
    ],
    {},
  ).toFile(`${fileBase(project)} - cut list.xlsx`);
}

/* ====================================================================== */
/*  PDF                                                                   */
/* ====================================================================== */

type Doc = jsPDF & { lastAutoTable?: { finalY: number } };

const A4L = { w: 297, h: 210 };
const M = 12;

function hex(c: string): [number, number, number] {
  const n = parseInt(c.replace('#', '').slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function header(doc: Doc, project: Project, title: string) {
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.setTextColor(30, 30, 30);
  doc.text(title, M, M + 2);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(110, 110, 110);
  doc.text(`${project.name} · RoomCraft · ${new Date().toLocaleDateString()}`, A4L.w - M, M + 2, { align: 'right' });
  doc.setDrawColor(200, 200, 200);
  doc.line(M, M + 5, A4L.w - M, M + 5);
}

function poly(doc: Doc, pts: { x: number; y: number }[], style: 'S' | 'F' | 'FD') {
  if (pts.length < 2) return;
  const [p0, ...rest] = pts;
  const segs = rest.map((p, i) => [p.x - (i === 0 ? p0.x : rest[i - 1].x), p.y - (i === 0 ? p0.y : rest[i - 1].y)]);
  doc.lines(segs, p0.x, p0.y, [1, 1], style, true);
}

function drawPlan(doc: Doc, project: Project, units: LengthUnit, box: { x: number; y: number; w: number; h: number }) {
  const outer = project.rooms.flatMap((r) => outerPolygon(r));
  const b = boundsOf(outer);
  if (!b) return;
  const s = Math.min(box.w / (b.maxX - b.minX + 1200), box.h / (b.maxY - b.minY + 1200));
  const ox = box.x + (box.w - (b.maxX - b.minX) * s) / 2 - b.minX * s;
  const oy = box.y + (box.h - (b.maxY - b.minY) * s) / 2 - b.minY * s;
  const T = (p: Vec2) => ({ x: ox + p.x * s, y: oy + p.y * s });

  for (const r of project.rooms) {
    doc.setFillColor(246, 242, 234);
    poly(doc, r.points.map(T), 'F');
    doc.setFillColor(90, 95, 100);
    doc.setDrawColor(50, 50, 50);
    doc.setLineWidth(0.15);
    for (const q of wallQuads(r)) poly(doc, q.map(T), 'FD');
  }
  // openings
  for (const o0 of project.openings) {
    const f = findWall(project, o0.wallId);
    if (!f) continue;
    const o = clampOpening(o0, f.length);
    const sym = openingSymbol(f, o);
    doc.setFillColor(o.kind === 'window' ? 214 : 255, o.kind === 'window' ? 236 : 255, o.kind === 'window' ? 247 : 255);
    poly(doc, sym.gap.map(T), 'FD');
    doc.setDrawColor(40, 40, 40);
    for (const l of sym.lines) {
      const pts = l.map(T);
      for (let i = 1; i < pts.length; i++) doc.line(pts[i - 1].x, pts[i - 1].y, pts[i].x, pts[i].y);
    }
  }
  // structure
  doc.setFillColor(120, 120, 120);
  for (const c of project.columns) poly(doc, columnPolygon(c).map(T), 'FD');
  doc.setDrawColor(138, 79, 191);
  for (const bm of project.beams) {
    doc.setLineDashPattern([1.5, 1], 0);
    poly(doc, beamPolygon(bm).map(T), 'S');
    doc.setLineDashPattern([], 0);
  }
  // countertop
  const stone = stoneById(project.countertop.stone);
  for (const p of buildCountertop(project)) {
    doc.setFillColor(...hex(stone.color));
    doc.setDrawColor(110, 100, 90);
    poly(doc, footprint(asPlaced(p)).map(T), 'FD');
  }
  // furniture
  doc.setFontSize(5.5);
  for (const m of project.modules) {
    const def = moduleDef(m.type);
    const fp = footprint(m).map(T);
    doc.setDrawColor(90, 74, 56);
    if (def?.kind === 'wall') {
      doc.setLineDashPattern([1, 0.8], 0);
      poly(doc, fp, 'S');
      doc.setLineDashPattern([], 0);
    } else {
      doc.setFillColor(...hex(finishById(m.frontFinish ?? project.settings.frontFinish).color));
      poly(doc, fp, 'FD');
    }
    const c = T(centroid(footprint(m)));
    doc.setTextColor(30, 30, 30);
    doc.text(m.name, c.x, c.y, { align: 'center', baseline: 'middle', maxWidth: Math.max(10, m.width * s) });
  }
  for (const a of project.appliances) {
    doc.setFillColor(...hex(applianceDef(a.type)?.color ?? '#cccccc'));
    doc.setDrawColor(60, 60, 60);
    poly(doc, footprint(a).map(T), 'FD');
  }
  // services
  for (const sv of project.services) {
    const d = serviceDef(sv.kind);
    const p = T(servicePosition(project, sv));
    doc.setFillColor(...hex(d.color));
    doc.circle(p.x, p.y, 1.6, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(3.5);
    doc.text(d.symbol, p.x, p.y + 0.1, { align: 'center', baseline: 'middle' });
  }
  // wall dimensions + room labels
  doc.setTextColor(45, 79, 138);
  doc.setFontSize(6);
  for (const r of project.rooms) {
    const n = r.points.length;
    for (let i = 0; i < n; i++) {
      const a = r.points[i];
      const bb = r.points[(i + 1) % n];
      const L = dist(a, bb);
      const dir = { x: (bb.x - a.x) / L, y: (bb.y - a.y) / L };
      const inward = { x: -dir.y, y: dir.x };
      const mid = T({ x: (a.x + bb.x) / 2 + inward.x * 180, y: (a.y + bb.y) / 2 + inward.y * 180 });
      let ang = (-Math.atan2(dir.y, dir.x) * 180) / Math.PI;
      if (ang < -90 || ang > 90) ang += 180;
      doc.text(formatLength(L, units), mid.x, mid.y, { align: 'center', baseline: 'middle', angle: ang });
    }
    const c = T(centroid(r.points));
    doc.setTextColor(30, 30, 30);
    doc.setFontSize(8);
    doc.text(`${r.name}  ${formatArea(polygonArea(r.points), units)}`, c.x, c.y, { align: 'center' });
    doc.setFontSize(6);
    doc.setTextColor(45, 79, 138);
  }
  // scale bar
  const bar = 1000 * s;
  doc.setDrawColor(30, 30, 30);
  doc.setLineWidth(0.4);
  doc.line(box.x, box.y + box.h + 4, box.x + bar, box.y + box.h + 4);
  doc.setFontSize(6);
  doc.setTextColor(30, 30, 30);
  doc.text('1 m', box.x + bar + 2, box.y + box.h + 5);
  doc.setLineWidth(0.15);
}

function drawElevation(doc: Doc, e: ElevationData, units: LengthUnit, box: { x: number; y: number; w: number; h: number }) {
  const s = Math.min(box.w / (e.length + 900), box.h / (e.height + 700));
  const ox = box.x + 500 * s;
  const base = box.y + 150 * s + e.height * s;
  const X = (x: number) => ox + x * s;
  const Z = (z: number) => base - z * s;
  doc.setFontSize(9);
  doc.setTextColor(30, 30, 30);
  doc.setFont('helvetica', 'bold');
  doc.text(e.title, box.x, box.y + 3);
  doc.setFont('helvetica', 'normal');
  doc.setDrawColor(60, 60, 60);
  doc.setFillColor(250, 249, 246);
  doc.rect(X(0), Z(e.height), e.length * s, e.height * s, 'FD');
  for (const r of e.rects) {
    doc.setFillColor(...hex(r.fill));
    doc.setDrawColor(r.kind === 'front' ? 80 : 60, 60, 60);
    if (r.dashed) doc.setLineDashPattern([1, 0.7], 0);
    doc.rect(X(r.x0), Z(r.z1), Math.max(0.2, (r.x1 - r.x0) * s), Math.max(0.2, (r.z1 - r.z0) * s), r.kind === 'module' && r.dashed ? 'S' : 'FD');
    doc.setLineDashPattern([], 0);
  }
  doc.setDrawColor(150, 150, 150);
  doc.setLineWidth(0.5);
  for (const h of e.handles) {
    if (h.orient === 'h') doc.line(X(h.x - h.len / 2), Z(h.z), X(h.x + h.len / 2), Z(h.z));
    else doc.line(X(h.x), Z(h.z + h.len / 2), X(h.x), Z(h.z - h.len / 2));
  }
  doc.setLineWidth(0.15);
  for (const sv of e.services) {
    doc.setFillColor(...hex(sv.color));
    doc.circle(X(sv.x), Z(sv.z), 1.3, 'F');
  }
  // horizontal chain
  doc.setDrawColor(45, 79, 138);
  doc.setTextColor(45, 79, 138);
  doc.setFontSize(5.5);
  const y1 = Z(0) + 5;
  doc.line(X(0), y1, X(e.length), y1);
  e.chain.forEach((x, i) => {
    doc.line(X(x), y1 - 1.2, X(x), y1 + 1.2);
    if (i > 0 && (x - e.chain[i - 1]) * s > 5) doc.text(formatLength(x - e.chain[i - 1], units, { suffix: false }), X((x + e.chain[i - 1]) / 2), y1 - 1, { align: 'center' });
  });
  doc.setFontSize(7);
  doc.text(formatLength(e.length, units), X(e.length / 2), y1 + 5, { align: 'center' });
  // vertical chain
  const x1 = X(0) - 6;
  doc.setFontSize(5.5);
  doc.line(x1, Z(0), x1, Z(e.height));
  e.heights.forEach((z, i) => {
    doc.line(x1 - 1.2, Z(z), x1 + 1.2, Z(z));
    if (i > 0 && (z - e.heights[i - 1]) * s > 4) doc.text(formatLength(z - e.heights[i - 1], units, { suffix: false }), x1 - 1, Z((z + e.heights[i - 1]) / 2), { align: 'center', angle: 90 });
  });
}

function drawSheet<T>(doc: Doc, sheet: NestSheet<T>, W: number, H: number, title: string, box: { x: number; y: number; w: number; h: number }) {
  const s = Math.min(box.w / W, (box.h - 6) / H);
  doc.setFontSize(8);
  doc.setTextColor(30, 30, 30);
  doc.text(`${title} — ${((sheet.usedArea / (W * H)) * 100).toFixed(0)}% used`, box.x, box.y + 3);
  const oy = box.y + 5;
  doc.setDrawColor(120, 120, 120);
  doc.setFillColor(238, 234, 226);
  doc.rect(box.x, oy, W * s, H * s, 'FD');
  const palette = ['#e8c58f', '#a9d3c4', '#c6b8e6', '#f2b4a5', '#b5cde8', '#e6d49a', '#c9e2a6', '#e8b8d4'];
  const keys = new Map<string, string>();
  for (const p of sheet.placements) {
    const k = p.part.label.split(':')[0];
    if (!keys.has(k)) keys.set(k, palette[keys.size % palette.length]);
    doc.setFillColor(...hex(keys.get(k)!));
    doc.rect(box.x + p.x * s, oy + p.y * s, p.w * s, p.h * s, 'FD');
    if (p.w * s > 12 && p.h * s > 5) {
      doc.setFontSize(Math.max(3.5, Math.min(6, (p.h * s) / 3)));
      const label = p.part.label.length > 34 ? p.part.label.slice(0, 33) + '…' : p.part.label;
      doc.text([label, `${Math.round(p.rotated ? p.h : p.w)} × ${Math.round(p.rotated ? p.w : p.h)}`], box.x + (p.x + p.w / 2) * s, oy + (p.y + p.h / 2) * s, { align: 'center', baseline: 'middle', maxWidth: p.w * s - 1 });
    }
  }
}

export interface PdfOptions {
  units: LengthUnit;
  snapshot?: string | null;
}

export function exportPdf(project: Project, opts: PdfOptions) {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' }) as Doc;
  const cost: CostEstimate = estimateCost(project);
  const rows = buildCutList(project);

  /* cover */
  header(doc, project, project.name);
  doc.setFontSize(10);
  doc.setTextColor(40, 40, 40);
  const summary = [
    ['Rooms', project.rooms.map((r) => `${r.name} (${formatArea(polygonArea(r.points), opts.units)})`).join(', ') || '—'],
    ['Furniture modules', String(project.modules.length)],
    ['Appliances', String(project.appliances.length)],
    ['Panels', String(rows.reduce((s, r) => s + r.qty, 0))],
    ['Board sheets', `${cost.sheetCount} (${project.settings.sheet.length} × ${project.settings.sheet.width} mm, kerf ${project.settings.sheet.kerf} mm)`],
    ['Estimated total', money(cost.total, cost.currency)],
  ];
  autoTable(doc, { startY: 26, body: summary, theme: 'plain', styles: { fontSize: 10 }, columnStyles: { 0: { fontStyle: 'bold', cellWidth: 50 } }, margin: { left: M } });
  if (opts.snapshot) {
    const y = (doc.lastAutoTable?.finalY ?? 60) + 6;
    const h = A4L.h - y - M;
    doc.addImage(opts.snapshot, 'JPEG', M, y, (h * 16) / 10, h);
  }

  /* floor plan */
  if (project.rooms.length) {
    doc.addPage();
    header(doc, project, 'Floor plan');
    drawPlan(doc, project, opts.units, { x: M, y: M + 10, w: A4L.w - 2 * M, h: A4L.h - 2 * M - 18 });
  }

  /* elevations: two per page */
  const walls = interestingWalls(project);
  const pieces = buildCountertop(project);
  for (let i = 0; i < walls.length; i += 2) {
    doc.addPage();
    header(doc, project, 'Wall elevations');
    for (let k = 0; k < 2 && i + k < walls.length; k++) {
      const e = elevationFor(project, walls[i + k], pieces);
      if (e) drawElevation(doc, e, opts.units, { x: M + k * ((A4L.w - 2 * M) / 2), y: M + 12, w: (A4L.w - 2 * M) / 2 - 4, h: A4L.h - 2 * M - 16 });
    }
  }

  /* 3D snapshot (full page) */
  if (opts.snapshot) {
    doc.addPage();
    header(doc, project, '3D view');
    const w = A4L.w - 2 * M;
    const h = Math.min(A4L.h - 2 * M - 12, (w * 10) / 16);
    doc.addImage(opts.snapshot, 'JPEG', M, M + 10, (h * 16) / 10, h);
  }

  /* cut list */
  if (rows.length) {
    doc.addPage();
    header(doc, project, 'Cut list');
    autoTable(doc, {
      startY: M + 9,
      head: [CUT_HEADERS],
      body: rows.map((r, i) => cutRowValues(r, i).map(String)),
      styles: { fontSize: 6.5, cellPadding: 1 },
      headStyles: { fillColor: [31, 111, 92] },
      margin: { left: M, right: M, top: M + 9 },
      didDrawPage: () => header(doc, project, 'Cut list'),
    });

    /* sheets */
    const groups: SheetGroup[] = cost.sheets;
    const { length: SW, width: SH } = project.settings.sheet;
    const perPage = 4;
    const all = groups.flatMap((g) => g.result.sheets.map((sh, i) => ({ sh, title: `${groupLabel(g)} — sheet ${i + 1}/${g.result.sheets.length}` })));
    for (let i = 0; i < all.length; i += perPage) {
      doc.addPage();
      header(doc, project, `Sheet layouts (${SW} × ${SH} mm, kerf ${project.settings.sheet.kerf} mm)`);
      const bw = (A4L.w - 2 * M - 8) / 2;
      const bh = (A4L.h - 2 * M - 16) / 2;
      all.slice(i, i + perPage).forEach((s, k) => drawSheet(doc, s.sh, SW, SH, s.title, { x: M + (k % 2) * (bw + 8), y: M + 10 + Math.floor(k / 2) * (bh + 2), w: bw, h: bh }));
    }

    /* hardware */
    doc.addPage();
    header(doc, project, 'Hardware');
    autoTable(doc, {
      startY: M + 9,
      head: [['Item', 'Unit', 'Qty', 'Used in']],
      body: hardwareList(project).map((h) => [h.name, h.unit, String(h.qty), h.modules.join(', ')]),
      styles: { fontSize: 8 },
      headStyles: { fillColor: [31, 111, 92] },
      margin: { left: M, right: M },
    });
  }

  /* countertop */
  if (pieces.length) {
    doc.addPage();
    header(doc, project, `Countertop — ${stoneById(project.countertop.stone).name}, ${project.countertop.thickness} mm`);
    autoTable(doc, {
      startY: M + 9,
      head: [['Piece', 'Length', 'Depth', 'Cut-outs', 'Joints', 'Backsplash']],
      body: pieces.map((p) => [
        p.label,
        `${Math.round(p.length)}`,
        `${Math.round(p.depth)}`,
        p.cutouts.map((c) => `${c.kind} ${c.w}×${c.d} @ ${c.u}/${c.v}`).join('\n') || '—',
        p.joints.join('\n') || '—',
        p.backsplash ? `${Math.round(p.backsplash.length)} × ${p.backsplash.height}` : '—',
      ]),
      styles: { fontSize: 8 },
      headStyles: { fillColor: [31, 111, 92] },
      margin: { left: M, right: M },
    });
    const lay = countertopLayout(project, pieces);
    const y = (doc.lastAutoTable?.finalY ?? 60) + 6;
    const ct = project.countertop;
    lay.sheets.slice(0, 2).forEach((sh, k) => drawSheet(doc, sh, ct.slabLength, ct.slabWidth, `Slab ${k + 1}`, { x: M + k * ((A4L.w - 2 * M) / 2), y, w: (A4L.w - 2 * M) / 2 - 6, h: A4L.h - y - M }));
  }

  /* cost */
  doc.addPage();
  header(doc, project, 'Cost estimate');
  autoTable(doc, {
    startY: M + 9,
    head: [['Item', 'Quantity', 'Amount']],
    body: [
      ...cost.lines.map((l) => [l.label, l.qty, money(l.amount, cost.currency)]),
      [{ content: 'Subtotal', styles: { fontStyle: 'bold' } }, '', money(cost.subtotal, cost.currency)],
      [`Labour & installation (${project.prices.labourPercent}%)`, '', money(cost.labour, cost.currency)],
      [{ content: 'Total', styles: { fontStyle: 'bold' } }, '', { content: money(cost.total, cost.currency), styles: { fontStyle: 'bold' } }],
    ],
    styles: { fontSize: 8.5 },
    headStyles: { fillColor: [31, 111, 92] },
    columnStyles: { 2: { halign: 'right' } },
    margin: { left: M, right: A4L.w / 2 + 4 },
  });
  autoTable(doc, {
    startY: M + 9,
    head: [['Module', 'Boards', 'Finish', 'Edge', 'Hardware', 'Total']],
    body: cost.modules.map((m) => [m.name, ...[m.board, m.finish, m.edge, m.hardware, m.total].map((v) => money(v, cost.currency))]),
    styles: { fontSize: 7.5 },
    headStyles: { fillColor: [31, 111, 92] },
    columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'right' } },
    margin: { left: A4L.w / 2 + 4, right: M },
  });

  doc.save(`${fileBase(project)}.pdf`);
}
