import { moduleDef } from './furniture/modules';
import { applianceDef } from './appliances';
import { axes, localToPlan, planToLocal, type Placed } from './structure';
import { dot } from './geometry';
import type { Project } from './types';

/** A 3D dimension line in plan millimetres: x/y on the plan, z = height above the floor. */
export interface Dim3 {
  a: { x: number; y: number; z: number };
  b: { x: number; y: number; z: number };
  value: number;
  kind: 'chain' | 'overall' | 'height' | 'depth';
}

export interface Run {
  ref: Placed;
  items: (Placed & { id: string; wall: boolean; tall: boolean })[];
  u0: number;
  u1: number;
  depth: number;
  baseTop: number;
  top: number;
}

const normRot = (r: number) => ((r % 360) + 360) % 360;

/** Group furniture standing against the same line (same rotation, same back line) into contiguous runs. */
export function furnitureRuns(project: Project): Run[] {
  const items: Run['items'] = [];
  for (const m of project.modules) {
    const k = moduleDef(m.type)?.kind;
    items.push({ ...m, wall: k === 'wall', tall: k === 'tall' });
  }
  for (const a of project.appliances) {
    const d = applianceDef(a.type);
    if (d?.mount === 'floor') items.push({ ...a, wall: false, tall: a.height > 1200 });
  }
  const groups: Run['items'][] = [];
  for (const it of items) {
    const { uy } = axes(it.rotation);
    const line = dot({ x: it.x, y: it.y }, uy);
    const g = groups.find((gr) => Math.abs(normRot(gr[0].rotation) - normRot(it.rotation)) < 0.5 && Math.abs(dot({ x: gr[0].x, y: gr[0].y }, uy) - line) < 40);
    if (g) g.push(it);
    else groups.push([it]);
  }
  const runs: Run[] = [];
  for (const g of groups) {
    const ref = g[0];
    const us = g.map((it) => ({ it, u: planToLocal(ref, { x: it.x, y: it.y }).u })).sort((a, b) => a.u - b.u);
    // split where floor items leave a gap > 60 mm (wall units may float over gaps)
    let cur: typeof us = [];
    const flush = () => {
      if (!cur.length) return;
      const floor = cur.filter((c) => !c.it.wall);
      const u0 = Math.min(...cur.map((c) => c.u));
      const u1 = Math.max(...cur.map((c) => c.u + c.it.width));
      runs.push({
        ref: { ...ref, ...localToPlan(ref, u0, 0) } as Placed,
        items: cur.map((c) => c.it),
        u0: 0,
        u1: u1 - u0,
        depth: Math.max(...(floor.length ? floor : cur).map((c) => c.it.depth)),
        baseTop: Math.max(0, ...floor.filter((c) => !c.it.tall).map((c) => c.it.elevation + c.it.height)),
        top: Math.max(...cur.map((c) => c.it.elevation + c.it.height)),
      });
      cur = [];
    };
    for (const s of us) {
      const end = cur.length ? Math.max(...cur.map((c) => c.u + c.it.width)) : -Infinity;
      if (cur.length && s.u - end > 60) flush();
      cur.push(s);
    }
    flush();
  }
  return runs;
}

/** Dimension lines like a joiner's sketch: unit widths, overall length, heights and depth. */
export function dimensionLines(project: Project, counterThickness = project.countertop.thickness): Dim3[] {
  const out: Dim3[] = [];
  const runs = furnitureRuns(project);
  for (const run of runs) {
    // put heights on the free end of the run (away from other runs, e.g. not in an inside corner)
    const others = runs.filter((r) => r !== run).flatMap((r) => r.items.map((i) => localToPlan(i, i.width / 2, i.depth / 2)));
    const near = (u: number) => (others.length ? Math.min(...others.map((o) => Math.hypot(o.x - localToPlan(run.ref, u, run.depth / 2).x, o.y - localToPlan(run.ref, u, run.depth / 2).y))) : Infinity);
    const startFree = near(0) >= near(run.u1);
    const hu = startFree ? -260 : run.u1 + 260;
    const du = startFree ? -80 : run.u1 + 80;
    const P = (u: number, v: number, z: number) => ({ ...localToPlan(run.ref, u, v), z });
    const fy = run.depth + 220;
    // chain of floor units along the front, on the floor
    const floor = run.items.filter((i) => !i.wall).map((i) => ({ u: planToLocal(run.ref, { x: i.x, y: i.y }).u, w: i.width })).sort((a, b) => a.u - b.u);
    for (const f of floor) out.push({ a: P(f.u, fy, 0), b: P(f.u + f.w, fy, 0), value: f.w, kind: 'chain' });
    // wall units chain above them
    const walls = run.items.filter((i) => i.wall).map((i) => ({ u: planToLocal(run.ref, { x: i.x, y: i.y }).u, w: i.width, top: i.elevation + i.height })).sort((a, b) => a.u - b.u);
    for (const w of walls) out.push({ a: P(w.u, -10, w.top + 120), b: P(w.u + w.w, -10, w.top + 120), value: w.w, kind: 'chain' });
    // overall length along the wall, above everything
    if (run.u1 > 0) out.push({ a: P(0, -10, run.top + 320), b: P(run.u1, -10, run.top + 320), value: run.u1, kind: 'overall' });
    // heights at the start of the run
    if (run.baseTop > 0) {
      const h = run.baseTop + (project.countertop.enabled ? counterThickness : 0);
      out.push({ a: P(hu, run.depth, 0), b: P(hu, run.depth, h), value: h, kind: 'height' });
    }
    if (run.top > run.baseTop + 300) out.push({ a: P(hu, 0, 0), b: P(hu, 0, run.top), value: run.top, kind: 'height' });
    // depth on the same free end, on the floor
    out.push({ a: P(du, 0, 0), b: P(du, run.depth, 0), value: run.depth, kind: 'depth' });
  }
  return out;
}

/** Walls that have furniture against them (shown in presentation renders). */
export function furnishedWallIds(project: Project): Set<string> {
  const ids = new Set<string>();
  for (const r of project.rooms) {
    const n = r.points.length;
    r.walls.forEach((w, i) => {
      const a = r.points[i];
      const b = r.points[(i + 1) % n];
      const L = Math.hypot(b.x - a.x, b.y - a.y);
      const dir = { x: (b.x - a.x) / L, y: (b.y - a.y) / L };
      const inward = { x: -dir.y, y: dir.x };
      const hit = [...project.modules, ...project.appliances].some((it) => {
        const d = { x: it.x - a.x, y: it.y - a.y };
        const u = dot(d, dir);
        const v = dot(d, inward);
        const rot = (Math.atan2(dir.y, dir.x) * 180) / Math.PI;
        return Math.abs(normRot(it.rotation) - normRot(rot)) < 1 && v > -30 && v < 120 && u > -it.width && u < L;
      });
      if (hit) ids.add(w.id);
    });
  }
  return ids;
}
