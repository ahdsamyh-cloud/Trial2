import { buildModule } from './furniture';
import { finishById, stoneById } from './catalog';
import { buildCutList, edgeMetres, optimiseSheets, type CutRow, type SheetGroup } from './cutlist';
import { buildCountertop, countertopLayout } from './countertop';
import type { Project } from './types';

const SQFT = 304.8 * 304.8;
const EDGE_WASTE = 1.1;

export interface CostLine {
  label: string;
  qty: string;
  amount: number;
}

export interface ModuleCost {
  moduleId: string;
  name: string;
  board: number;
  finish: number;
  edge: number;
  hardware: number;
  total: number;
}

export interface CostEstimate {
  currency: string;
  lines: CostLine[];
  modules: ModuleCost[];
  countertop: number;
  subtotal: number;
  labour: number;
  total: number;
  sheets: SheetGroup[];
  sheetCount: number;
}

/** Faces that receive the finish: fronts both sides, carcass one, backs/drawer bottoms none. */
function finishedFaces(r: CutRow): number {
  if (r.role === 'door' || r.role === 'drawer-front' || r.role === 'worktop' || r.role === 'deck') return 2;
  if (r.role === 'back' || r.role === 'drawer-bottom' || r.role === 'drawer-back' || r.role === 'drawer-side') return 0;
  return 1;
}

export function estimateCost(project: Project): CostEstimate {
  const P = project.prices;
  const rows = buildCutList(project);
  const sheets = optimiseSheets(project, rows);
  const lines: CostLine[] = [];

  // boards: real sheet count × price; each module carries an area share of its group's cost
  const groupRate = new Map<string, number>(); // currency per mm² of part
  let boardTotal = 0;
  let sheetCount = 0;
  for (const g of sheets) {
    const n = g.result.sheets.length;
    const price = P.boards[`${g.material}-${g.thickness}`] ?? 0;
    const cost = n * price;
    sheetCount += n;
    boardTotal += cost;
    groupRate.set(g.key, g.partArea ? cost / g.partArea : 0);
    lines.push({ label: `Boards: ${g.material.toUpperCase()} ${g.thickness} mm (${finishById(g.finish).name})`, qty: `${n} sheet${n === 1 ? '' : 's'}`, amount: cost });
  }

  const modules = new Map<string, ModuleCost>();
  const mc = (id: string, name: string) => {
    let c = modules.get(id);
    if (!c) modules.set(id, (c = { moduleId: id, name, board: 0, finish: 0, edge: 0, hardware: 0, total: 0 }));
    return c;
  };

  let finishTotal = 0;
  const edgeByT = new Map<number, number>();
  for (const r of rows) {
    const c = mc(r.moduleId, r.module);
    const area = r.cutLength * r.cutWidth * r.qty;
    c.board += area * (groupRate.get(`${r.material}|${r.thickness}|${r.finish}`) ?? 0);
    const f = finishById(r.finish);
    const fc = ((r.length * r.width * r.qty * finishedFaces(r)) / SQFT) * (P.finishPerSqft[f.kind] ?? 0);
    c.finish += fc;
    finishTotal += fc;
    for (const [t, m] of edgeMetres(r)) {
      const metres = m * r.qty * EDGE_WASTE;
      edgeByT.set(t, (edgeByT.get(t) ?? 0) + metres);
      c.edge += metres * (P.edgeBandPerM[String(t)] ?? 0);
    }
  }
  if (finishTotal) lines.push({ label: 'Laminate / veneer / paint finish', qty: '', amount: finishTotal });
  for (const [t, m] of [...edgeByT.entries()].sort((a, b) => a[0] - b[0]))
    lines.push({ label: `Edge band ${t} mm`, qty: `${m.toFixed(1)} m`, amount: m * (P.edgeBandPerM[String(t)] ?? 0) });

  let hwTotal = 0;
  for (const m of project.modules) {
    const c = mc(m.id, m.name);
    for (const h of buildModule(m, project).hardware) {
      const cost = h.qty * (P.hardware[h.id] ?? 0);
      c.hardware += cost;
      hwTotal += cost;
    }
  }
  if (hwTotal) lines.push({ label: 'Hardware', qty: '', amount: hwTotal });

  let countertop = 0;
  if (project.countertop.enabled) {
    const pieces = buildCountertop(project);
    if (pieces.length) {
      const layout = countertopLayout(project, pieces);
      countertop = layout.areaSqft * (P.stonePerSqft[project.countertop.stone] ?? 0);
      lines.push({ label: `Countertop: ${stoneById(project.countertop.stone).name}`, qty: `${layout.areaSqft.toFixed(1)} sq ft`, amount: countertop });
    }
  }

  for (const c of modules.values()) c.total = c.board + c.finish + c.edge + c.hardware;
  const subtotal = boardTotal + finishTotal + [...edgeByT.entries()].reduce((s, [t, m]) => s + m * (P.edgeBandPerM[String(t)] ?? 0), 0) + hwTotal + countertop;
  const labour = (subtotal * P.labourPercent) / 100;
  return {
    currency: P.currency,
    lines,
    modules: [...modules.values()],
    countertop,
    subtotal,
    labour,
    total: subtotal + labour,
    sheets,
    sheetCount,
  };
}

export const money = (n: number, cur: string) => `${cur}${Math.round(n).toLocaleString('en-IN')}`;
