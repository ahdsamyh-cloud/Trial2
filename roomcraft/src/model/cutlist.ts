import { buildModule, moduleDef, type HardwareLine, type Panel } from './furniture';
import { finishById, hardwareById, materialName } from './catalog';
import { nest, type NestResult } from './nesting';
import type { EdgeBand, PanelEdges, Project } from './types';

export interface CutRow {
  id: string;
  moduleId: string;
  module: string;
  panelKeys: string[];
  name: string;
  role: Panel['role'];
  length: number;
  width: number;
  thickness: number;
  cutLength: number;
  cutWidth: number;
  material: string;
  finish: string;
  edges: PanelEdges;
  edgeText: string;
  grain: Panel['grain'];
  qty: number;
  notes: string;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
/** "Left side" / "Right side" → "Side", "Door 2" → "Door", "Drawer 1 side L" → "Drawer side" */
const baseName = (n: string) =>
  cap(
    n
      .replace(/^(Left|Right) /, '')
      .replace(/ [LR]$/, '')
      .replace(/ \d+( |$)/g, '$1')
      .trim(),
  );

export function edgeText(e: PanelEdges): string {
  const groups = new Map<number, string[]>();
  (['L1', 'L2', 'W1', 'W2'] as const).forEach((k) => {
    const b = e[k];
    if (b) groups.set(b.thickness, [...(groups.get(b.thickness) ?? []), k]);
  });
  if (!groups.size) return '—';
  return [...groups.entries()].map(([t, ks]) => `${ks.join(' ')} @${t}mm`).join('; ');
}

/** Edge band metres per thickness for one panel. */
export function edgeMetres(p: { length: number; width: number; edges: PanelEdges }): Map<number, number> {
  const out = new Map<number, number>();
  const add = (b: EdgeBand | null, len: number) => b && out.set(b.thickness, (out.get(b.thickness) ?? 0) + len / 1000);
  add(p.edges.L1, p.length);
  add(p.edges.L2, p.length);
  add(p.edges.W1, p.width);
  add(p.edges.W2, p.width);
  return out;
}

const sig = (p: Panel) =>
  [baseName(p.name), p.length, p.width, p.thickness, p.material, p.finish, p.grain, edgeText(p.edges), p.role].join('|');

/** Cut list: identical panels within a module are merged with a quantity. */
export function buildCutList(project: Project): CutRow[] {
  const rows: CutRow[] = [];
  for (const m of project.modules) {
    const b = buildModule(m, project);
    const bySig = new Map<string, CutRow>();
    for (const p of b.panels) {
      const k = sig(p);
      const existing = bySig.get(k);
      if (existing) {
        existing.qty++;
        existing.panelKeys.push(p.key);
        continue;
      }
      const row: CutRow = {
        id: `${m.id}:${p.key}`,
        moduleId: m.id,
        module: m.name,
        panelKeys: [p.key],
        name: existingName(p, b.panels),
        role: p.role,
        length: p.length,
        width: p.width,
        thickness: p.thickness,
        cutLength: p.cutLength,
        cutWidth: p.cutWidth,
        material: p.material,
        finish: p.finish,
        edges: p.edges,
        edgeText: edgeText(p.edges),
        grain: p.grain,
        qty: 1,
        notes: p.note ?? '',
      };
      bySig.set(k, row);
      rows.push(row);
    }
  }
  return rows;
}

function existingName(p: Panel, all: Panel[]): string {
  const bn = baseName(p.name);
  const same = all.filter((q) => sig(q) === sig(p));
  return same.length > 1 ? bn : p.name;
}

/* ---------------- sheet optimisation ---------------- */

export interface SheetGroup {
  key: string;
  material: string;
  thickness: number;
  finish: string;
  grain: boolean;
  result: NestResult<{ row: CutRow }>;
  partArea: number; // mm²
}

/** Nest all panels onto stock sheets, one group per material / thickness / finish. */
export function optimiseSheets(project: Project, rows = buildCutList(project)): SheetGroup[] {
  const { length, width, kerf, trim } = project.settings.sheet;
  const groups = new Map<string, CutRow[]>();
  for (const r of rows) {
    const k = `${r.material}|${r.thickness}|${r.finish}`;
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  const out: SheetGroup[] = [];
  for (const [key, rs] of groups) {
    const parts = rs.flatMap((r) =>
      Array.from({ length: r.qty }, (_, i) => ({
        id: `${r.id}#${i}`,
        w: r.cutLength,
        h: r.cutWidth,
        canRotate: r.grain === 'none',
        label: `${r.module}: ${r.name}`,
        ref: { row: r },
      })),
    );
    const [material, t, finish] = key.split('|');
    const result = nest(parts, length, width, { kerf, trim });
    out.push({
      key,
      material,
      thickness: Number(t),
      finish,
      grain: finishById(finish).grain,
      result,
      partArea: parts.reduce((s, p) => s + p.w * p.h, 0),
    });
  }
  return out.sort((a, b) => b.thickness - a.thickness || a.material.localeCompare(b.material));
}

export const groupLabel = (g: { material: string; thickness: number; finish: string }) =>
  `${materialName(g.material)} ${g.thickness} mm · ${finishById(g.finish).name}`;

/* ---------------- hardware ---------------- */

export interface HardwareRow {
  id: string;
  name: string;
  unit: string;
  qty: number;
  modules: string[];
}

export function hardwareList(project: Project): HardwareRow[] {
  const map = new Map<string, HardwareRow>();
  for (const m of project.modules) {
    for (const h of buildModule(m, project).hardware) addHw(map, h, m.name);
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function addHw(map: Map<string, HardwareRow>, h: HardwareLine, moduleName: string) {
  const def = hardwareById(h.id);
  const row = map.get(h.id) ?? { id: h.id, name: def?.name ?? h.id, unit: def?.unit ?? 'pc', qty: 0, modules: [] };
  row.qty += h.qty;
  if (!row.modules.includes(moduleName)) row.modules.push(moduleName);
  map.set(h.id, row);
}

/* ---------------- CSV ---------------- */

const csvCell = (v: unknown) => {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export const CUT_HEADERS = [
  'No',
  'Module',
  'Panel',
  'Finished length',
  'Finished width',
  'Thickness',
  'Cut length',
  'Cut width',
  'Material',
  'Finish',
  'Edge banding',
  'Grain',
  'Qty',
  'Notes',
];

export function cutRowValues(r: CutRow, i: number): (string | number)[] {
  return [
    i + 1,
    r.module,
    r.name,
    r.length,
    r.width,
    r.thickness,
    r.cutLength,
    r.cutWidth,
    materialName(r.material),
    finishById(r.finish).name,
    r.edgeText,
    r.grain === 'length' ? 'Along length' : 'None',
    r.qty,
    r.notes,
  ];
}

export function cutListCsv(rows: CutRow[]): string {
  const lines = [CUT_HEADERS.map(csvCell).join(',')];
  rows.forEach((r, i) => lines.push(cutRowValues(r, i).map(csvCell).join(',')));
  return lines.join('\n');
}

export function moduleTypeName(type: string) {
  return moduleDef(type)?.name ?? type;
}
