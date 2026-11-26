import { buildModule, moduleDef } from './furniture';
import { applianceDef } from './appliances';
import { finishById, serviceDef, stoneById } from './catalog';
import { dot, sub } from './geometry';
import { beamPolygon, clampOpening, columnPolygon, findWall, openingsOnWall, type Placed, type WallFrame } from './structure';
import { asPlaced, type CounterPiece } from './countertop';
import type { Project, Vec2 } from './types';

export interface ElevRect {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  kind: 'module' | 'front' | 'appliance' | 'opening' | 'beam' | 'column' | 'counter' | 'splash' | 'shelf';
  fill: string;
  label?: string;
  id?: string;
  dashed?: boolean;
}

export interface ElevationData {
  frame: WallFrame;
  title: string;
  length: number;
  height: number;
  rects: ElevRect[];
  handles: { x: number; z: number; orient: 'h' | 'v'; len: number }[];
  services: { x: number; z: number; symbol: string; color: string; name: string }[];
  /** x positions of item edges for the dimension chain */
  chain: number[];
  /** distinct heights for the vertical dimension chain */
  heights: number[];
}

const angDiff = (a: number, b: number) => Math.abs(((((a - b) % 360) + 540) % 360) - 180);

function along(f: WallFrame, p: Vec2) {
  const d = sub(p, f.a);
  return { u: dot(d, f.dir), v: dot(d, f.inward) };
}

function facing(f: WallFrame, it: Placed, maxV = 450): { x0: number; x1: number } | null {
  if (angDiff(it.rotation, f.rotation) > 1) return null;
  const l = along(f, { x: it.x, y: it.y });
  if (l.v < -30 || l.v > maxV) return null;
  if (l.u + it.width < 0 || l.u > f.length) return null;
  return { x0: l.u, x1: l.u + it.width };
}

export function elevationFor(project: Project, wallId: string, pieces: CounterPiece[] = []): ElevationData | null {
  const f = findWall(project, wallId);
  if (!f) return null;
  const rects: ElevRect[] = [];
  const handles: ElevationData['handles'] = [];
  const chain = new Set<number>([0, f.length]);
  const heights = new Set<number>([0, f.wall.height]);

  for (const o0 of openingsOnWall(project, wallId)) {
    const o = clampOpening(o0, f.length);
    rects.push({ x0: o.offset, x1: o.offset + o.width, z0: o.sill, z1: o.sill + o.height, kind: 'opening', fill: o.kind === 'window' ? '#cfe6f3' : '#ffffff', label: o.kind, id: o.id });
    chain.add(o.offset);
    chain.add(o.offset + o.width);
    if (o.sill) heights.add(o.sill);
    heights.add(o.sill + o.height);
  }

  for (const m of project.modules) {
    const r = facing(f, m);
    if (!r) continue;
    const def = moduleDef(m.type);
    rects.push({ x0: r.x0, x1: r.x1, z0: m.elevation, z1: m.elevation + m.height, kind: 'module', fill: finishById(m.board?.finish ?? project.settings.board.finish).color, label: m.name, id: m.id, dashed: def?.kind === 'wall' });
    const b = buildModule(m, project);
    for (const p of b.panels) {
      const isFace = p.isFront || p.role === 'filler' || p.role === 'plinth';
      const openShelf = !b.panels.some((q) => q.isFront) && (p.role === 'shelf' || p.role === 'partition');
      if (!isFace && !openShelf) continue;
      rects.push({
        x0: r.x0 + p.box.x,
        x1: r.x0 + p.box.x + p.box.dx,
        z0: m.elevation + p.box.z,
        z1: m.elevation + p.box.z + p.box.dz,
        kind: openShelf ? 'shelf' : 'front',
        fill: p.role === 'plinth' ? '#555a60' : finishById(p.finish).color,
        id: m.id,
      });
    }
    for (const h of b.handles) handles.push({ x: r.x0 + h.x, z: m.elevation + h.z, orient: h.orient, len: h.length });
    chain.add(Math.round(r.x0));
    chain.add(Math.round(r.x1));
    heights.add(Math.round(m.elevation));
    heights.add(Math.round(m.elevation + m.height));
  }

  for (const a of project.appliances) {
    const r = facing(f, a, 700);
    if (!r) continue;
    const def = applianceDef(a.type);
    if (def?.mount === 'inset') continue; // hidden in the worktop
    rects.push({ x0: r.x0, x1: r.x1, z0: a.elevation, z1: a.elevation + a.height, kind: 'appliance', fill: def?.color ?? '#ccc', label: a.name, id: a.id, dashed: false });
    heights.add(Math.round(a.elevation + a.height));
  }

  const stone = stoneById(project.countertop.stone);
  for (const p of pieces) {
    const r = facing(f, asPlaced(p));
    if (!r) continue;
    rects.push({ x0: r.x0, x1: r.x1, z0: p.z, z1: p.z + p.thickness, kind: 'counter', fill: stone.color, label: 'Countertop' });
    if (p.backsplash && p.backsplash.length > 0) {
      const l = along(f, { x: p.x, y: p.y });
      if (l.v < 30) rects.push({ x0: r.x0, x1: r.x0 + p.backsplash.length, z0: p.z + p.thickness, z1: p.z + p.thickness + p.backsplash.height, kind: 'splash', fill: stone.color });
    }
    heights.add(Math.round(p.z + p.thickness));
  }

  const projectPoly = (poly: Vec2[]) => {
    const ls = poly.map((q) => along(f, q));
    const vmin = Math.min(...ls.map((l) => l.v));
    const u0 = Math.max(0, Math.min(...ls.map((l) => l.u)));
    const u1 = Math.min(f.length, Math.max(...ls.map((l) => l.u)));
    return { vmin, u0, u1 };
  };
  for (const b of project.beams) {
    const pr = projectPoly(beamPolygon(b));
    if (pr.vmin > 60 || pr.u1 - pr.u0 < 1) continue;
    rects.push({ x0: pr.u0, x1: pr.u1, z0: b.bottom, z1: b.bottom + b.depth, kind: 'beam', fill: '#cbb3e6', label: 'Beam', id: b.id });
    heights.add(Math.round(b.bottom));
  }
  for (const c of project.columns) {
    const pr = projectPoly(columnPolygon(c));
    if (pr.vmin > 60 || pr.u1 - pr.u0 < 1) continue;
    rects.push({ x0: pr.u0, x1: pr.u1, z0: 0, z1: Math.min(c.height, f.wall.height), kind: 'column', fill: '#9aa0a6', label: 'Column', id: c.id });
    chain.add(Math.round(pr.u0));
    chain.add(Math.round(pr.u1));
  }

  const services = project.services
    .filter((s) => s.wallId === wallId)
    .map((s) => {
      const d = serviceDef(s.kind);
      return { x: s.offset, z: s.height, symbol: d.symbol, color: d.color, name: d.name };
    });

  return {
    frame: f,
    title: `${f.room.name} — wall ${f.index + 1}`,
    length: f.length,
    height: f.wall.height,
    rects,
    handles,
    services,
    chain: [...chain].filter((x) => x >= -1 && x <= f.length + 1).sort((a, b) => a - b),
    heights: [...heights].sort((a, b) => a - b),
  };
}

/** Walls worth drawing: those with furniture, openings or services. */
export function interestingWalls(project: Project): string[] {
  const out: string[] = [];
  for (const r of project.rooms)
    for (const w of r.walls) {
      const e = elevationFor(project, w.id);
      if (e && (e.rects.length || e.services.length)) out.push(w.id);
    }
  return out;
}
