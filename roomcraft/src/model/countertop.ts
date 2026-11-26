import { applianceDef } from './appliances';
import { moduleDef } from './furniture/modules';
import { allWallFrames, axes, convexOverlap, footprint, localToPlan, planToLocal, type Placed } from './structure';
import { closestOnSegment, dot } from './geometry';
import { nest, type NestResult } from './nesting';
import type { Project, Vec2 } from './types';

export interface Cutout {
  kind: 'sink' | 'hob';
  /** centre in piece-local coords (u along length, v from back towards the front) */
  u: number;
  v: number;
  w: number;
  d: number;
  radius: number;
  label: string;
}

export interface CounterPiece {
  id: string;
  label: string;
  /** plan placement (back-left corner) */
  x: number;
  y: number;
  rotation: number;
  length: number;
  depth: number;
  /** underside height above floor */
  z: number;
  thickness: number;
  cutouts: Cutout[];
  joints: string[];
  backsplash: { length: number; height: number } | null;
}

interface Item extends Placed {
  id: string;
}

const ROT_TOL = 0.5;
const normRot = (r: number) => ((r % 360) + 360) % 360;

/** Base-height items the worktop runs over: base modules and under-counter appliances. */
function counterItems(project: Project): Item[] {
  const items: Item[] = [];
  for (const m of project.modules) {
    const def = moduleDef(m.type);
    if (!def || def.kind !== 'base' || def.category !== 'kitchen' || m.elevation > 300) continue;
    items.push(m);
  }
  for (const a of project.appliances) {
    if (a.type === 'dishwasher' || (a.type === 'washer' && a.height < 900)) items.push({ ...a, height: Math.max(a.height, 820) });
  }
  return items;
}

export function buildCountertop(project: Project): CounterPiece[] {
  const ct = project.countertop;
  if (!ct.enabled) return [];
  const items = counterItems(project);
  // group by rotation and back line
  const groups: Item[][] = [];
  for (const it of items) {
    const r = normRot(it.rotation);
    const { uy } = axes(r);
    const line = dot({ x: it.x, y: it.y }, uy);
    const g = groups.find((gr) => {
      const g0 = gr[0];
      const r0 = normRot(g0.rotation);
      return Math.abs(r0 - r) < ROT_TOL && Math.abs(dot({ x: g0.x, y: g0.y }, axes(r0).uy) - line) < 30;
    });
    if (g) g.push(it);
    else groups.push([it]);
  }

  const pieces: CounterPiece[] = [];
  for (const g of groups) {
    const ref = g[0];
    const sorted = g
      .map((it) => ({ it, u: planToLocal(ref, { x: it.x, y: it.y }).u }))
      .sort((a, b) => a.u - b.u);
    // split into contiguous runs (gaps > 30 mm break the top)
    let run: typeof sorted = [];
    const flush = () => {
      if (!run.length) return;
      const u0 = run[0].u;
      const u1 = Math.max(...run.map((r) => r.u + r.it.width));
      const depth = Math.max(...run.map((r) => r.it.depth)) + ct.frontOverhang;
      const z = Math.max(...run.map((r) => r.it.elevation + r.it.height));
      const origin = localToPlan(ref, u0, 0);
      pieces.push({
        id: `ct${pieces.length + 1}`,
        label: `Top ${pieces.length + 1}`,
        x: origin.x,
        y: origin.y,
        rotation: ref.rotation,
        length: u1 - u0,
        depth,
        z,
        thickness: ct.thickness,
        cutouts: [],
        joints: [],
        backsplash: ct.backsplashHeight > 0 ? { length: u1 - u0, height: ct.backsplashHeight } : null,
      });
      run = [];
    };
    for (const s of sorted) {
      const end = run.length ? Math.max(...run.map((r) => r.u + r.it.width)) : -Infinity;
      if (run.length && s.u - end > 30) flush();
      run.push(s);
    }
    flush();
  }

  // L / U joints: the longer piece runs through the corner; the other is trimmed to butt against it
  const order = [...pieces].sort((a, b) => b.length - a.length);
  for (let i = 0; i < order.length; i++) {
    for (let j = i + 1; j < order.length; j++) {
      const A = order[i];
      const B = order[j];
      const dr = Math.abs(normRot(A.rotation - B.rotation) % 180);
      if (Math.abs(dr - 90) > 1) continue;
      const fa = footprint(asPlaced(A), 2);
      if (!convexOverlap(fa, footprint(asPlaced(B)), 0.5)) continue;
      // projection of A's footprint on B's length axis
      const us = fa.map((p) => planToLocal(asPlaced(B), p).u);
      const a0 = Math.min(...us);
      const a1 = Math.max(...us);
      if (a0 <= 1 && a1 > 0) {
        const cut = Math.min(a1 - 2, B.length);
        const o = localToPlan(asPlaced(B), cut, 0);
        B.x = o.x;
        B.y = o.y;
        B.length -= cut;
        if (B.backsplash) B.backsplash.length = Math.max(0, B.backsplash.length - cut + A.depth - ct.frontOverhang);
      } else if (a1 >= B.length - 1 && a0 < B.length) {
        const keep = Math.max(0, a0 + 2);
        if (B.backsplash) B.backsplash.length = Math.max(0, B.backsplash.length - (B.length - keep) + A.depth - ct.frontOverhang);
        B.length = keep;
      } else continue;
      A.joints.push(`Butt joint with ${B.label}`);
      B.joints.push(`Butts against ${A.label}`);
    }
  }

  // side overhang on free ends (not against a wall or another piece)
  const walls = allWallFrames(project);
  // tall cabinets and full-height appliances also stop the worktop
  const stops = [
    ...project.modules.filter((m) => moduleDef(m.type)?.kind === 'tall'),
    ...project.appliances.filter((a) => a.elevation < 100 && a.height > 1200),
  ].map((x) => footprint(x, 5));
  const nearWall = (p: Vec2) => walls.some((f) => closestOnSegment(p, f.a, f.b).d < 40) || stops.some((fp) => convexOverlap(fp, [p, { x: p.x + 1, y: p.y }, { x: p.x, y: p.y + 1 }], 0));
  for (const P of pieces) {
    const pl = asPlaced(P);
    const startFree = !nearWall(localToPlan(pl, -5, P.depth / 2)) && !P.joints.some((j) => j.startsWith('Butts'));
    const endFree = !nearWall(localToPlan(pl, P.length + 5, P.depth / 2));
    if (startFree && ct.sideOverhang) {
      const o = localToPlan(pl, -ct.sideOverhang, 0);
      P.x = o.x;
      P.y = o.y;
      P.length += ct.sideOverhang;
    }
    if (endFree && ct.sideOverhang) P.length += ct.sideOverhang;
  }

  // cut-outs for inset appliances
  for (const a of project.appliances) {
    const def = applianceDef(a.type);
    if (!def?.cutout) continue;
    const afp = footprint(a);
    for (const P of pieces) {
      if (!convexOverlap(footprint(asPlaced(P)), afp, 5)) continue;
      const centre = localToPlan(a, a.width / 2, a.depth / 2);
      const loc = planToLocal(asPlaced(P), centre);
      const rel = Math.abs(normRot(a.rotation - P.rotation) % 180);
      const swap = Math.abs(rel - 90) < 1;
      P.cutouts.push({
        kind: def.cutout.kind,
        u: Math.round(loc.u),
        v: Math.round(loc.v),
        w: swap ? def.cutout.depth : def.cutout.width,
        d: swap ? def.cutout.width : def.cutout.depth,
        radius: def.cutout.radius ?? 0,
        label: a.name,
      });
      break;
    }
  }
  return pieces.filter((p) => p.length > 10);
}

export const asPlaced = (p: CounterPiece): Placed => ({
  x: p.x,
  y: p.y,
  rotation: p.rotation,
  width: p.length,
  depth: p.depth,
  height: p.thickness,
  elevation: p.z,
});

export interface StoneLayout extends NestResult<{ piece: string; kind: 'top' | 'splash' }> {
  areaSqft: number;
}

export function countertopLayout(project: Project, pieces: CounterPiece[]): StoneLayout {
  const ct = project.countertop;
  const parts = pieces.flatMap((p) => {
    type Part = { id: string; w: number; h: number; canRotate: boolean; label: string; ref: { piece: string; kind: 'top' | 'splash' } };
    const out: Part[] = [{ id: p.id, w: p.length, h: p.depth, canRotate: true, label: `${p.label} ${Math.round(p.length)}×${Math.round(p.depth)}`, ref: { piece: p.id, kind: 'top' as const } }];
    if (p.backsplash && p.backsplash.length > 10)
      out.push({ id: `${p.id}-bs`, w: p.backsplash.length, h: p.backsplash.height, canRotate: true, label: `${p.label} splash`, ref: { piece: p.id, kind: 'splash' as const } });
    return out;
  });
  const res = nest(parts, ct.slabLength, ct.slabWidth, { kerf: 5, trim: 10 });
  const area = parts.reduce((s, p) => s + p.w * p.h, 0);
  return { ...res, areaSqft: area / (304.8 * 304.8) };
}
