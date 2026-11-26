import type { Project, Vec2 } from '../model/types';
import { applianceDef } from '../model/appliances';
import { moduleDef } from '../model/furniture';
import { serviceDef } from '../model/catalog';
import { add, dot, scale, sub } from '../model/geometry';
import {
  axes,
  convexOverlap,
  footprint,
  localToPlan,
  nearestWall,
  planToLocal,
  snapToWall,
  type Placed,
} from '../model/structure';
import type { OpeningKind, ServiceKind } from '../model/types';

export const OPENING_DEFAULTS: Record<OpeningKind, { width: number; height: number; sill: number }> = {
  door: { width: 900, height: 2100, sill: 0 },
  window: { width: 1200, height: 1200, sill: 900 },
  opening: { width: 1000, height: 2100, sill: 0 },
};

export const roundTo = (n: number, s: number) => Math.round(n / s) * s;

export function placeOpening(project: Project, cursor: Vec2, width: number, tol: number) {
  const nw = nearestWall(project, cursor, Math.max(tol, 400));
  if (!nw) return null;
  const f = nw.frame;
  const w = Math.min(width, f.length - 20);
  const offset = Math.max(0, Math.min(f.length - w, roundTo(nw.offset - w / 2, 10)));
  return { wallId: f.wall.id, offset, width: w, frame: f };
}

export function placeService(project: Project, kind: ServiceKind, cursor: Vec2, grid: number) {
  const def = serviceDef(kind);
  if (def.mount === 'wall') {
    const nw = nearestWall(project, cursor, 600);
    if (nw) return { wallId: nw.frame.wall.id, offset: roundTo(nw.offset, 10), x: cursor.x, y: cursor.y };
  }
  return { wallId: null, offset: 0, x: roundTo(cursor.x, grid / 2), y: roundTo(cursor.y, grid / 2) };
}

export function placeColumn(project: Project, cursor: Vec2, size: { width: number; depth: number }, grid: number) {
  const nw = nearestWall(project, cursor, 350);
  if (nw) {
    const f = nw.frame;
    let u = nw.offset;
    // snap into a corner if close
    if (u < size.width / 2 + 150) u = size.width / 2;
    if (u > f.length - size.width / 2 - 150) u = f.length - size.width / 2;
    const c = add(add(f.a, scale(f.dir, u)), scale(f.inward, size.depth / 2));
    return { x: c.x, y: c.y, rotation: f.rotation };
  }
  return { x: roundTo(cursor.x, grid), y: roundTo(cursor.y, grid), rotation: 0 };
}

interface Others {
  items: (Placed & { id: string })[];
}

/** Slide along the run so the item butts against neighbours with the same back line. */
function snapToNeighbours(p: Placed, others: Others, tol: number): { placed: Placed; snapped: boolean } {
  const { uy } = axes(p.rotation);
  const line = dot({ x: p.x, y: p.y }, uy);
  let best: { du: number; d: number } | null = null;
  for (const o of others.items) {
    if (Math.abs((((o.rotation - p.rotation) % 360) + 360) % 360) > 0.5) continue;
    if (Math.abs(dot({ x: o.x, y: o.y }, uy) - line) > 40) continue;
    const ou = planToLocal(p, { x: o.x, y: o.y }).u;
    // my right edge to their left edge, my left edge to their right edge, aligned starts
    for (const du of [ou - p.width, ou + o.width, ou, ou + o.width - p.width]) {
      if (Math.abs(du) < tol && (!best || Math.abs(du) < best.d)) best = { du, d: Math.abs(du) };
    }
  }
  if (!best) return { placed: p, snapped: false };
  const o = localToPlan(p, best.du, 0);
  return { placed: { ...p, x: o.x, y: o.y }, snapped: true };
}

/**
 * Position a module/appliance under the cursor: snap its back to the nearest wall,
 * then butt it against neighbours; built-ins drop into the cabinet underneath.
 */
export function placeBox(
  project: Project,
  kind: 'module' | 'appliance',
  type: string,
  size: Placed,
  cursor: Vec2,
  tol: number,
  ignore: Set<string>,
): { placed: Placed; wallId: string | null; host?: string } {
  const centred: Placed = { ...size, x: cursor.x, y: cursor.y };
  const { ux, uy } = axes(size.rotation);
  // free placement: cursor at the centre
  let placed: Placed = { ...centred, x: cursor.x - ux.x * size.width / 2 - uy.x * size.depth / 2, y: cursor.y - ux.y * size.width / 2 - uy.y * size.depth / 2 };
  let wallId: string | null = null;
  let host: string | undefined;
  const adef = kind === 'appliance' ? applianceDef(type) : undefined;

  // built-in appliances: drop into a module under the cursor
  if (adef?.mount === 'built-in' || adef?.mount === 'inset') {
    const hostMod = project.modules.find((m) => !ignore.has(m.id) && convexOverlap(footprint(m), [cursor, add(cursor, { x: 1, y: 0 }), add(cursor, { x: 1, y: 1 })], 0));
    if (hostMod) {
      host = hostMod.id;
      const u = Math.max(0, Math.min(hostMod.width - size.width, planToLocal(hostMod, cursor).u - size.width / 2));
      const v = adef.mount === 'inset' ? Math.max(30, (hostMod.depth - size.depth) / 2) : 20;
      const o = localToPlan(hostMod, roundTo(u, 5), v);
      const top = hostMod.elevation + hostMod.height + project.countertop.thickness;
      let elevation = size.elevation;
      if (adef.mount === 'inset') elevation = adef.cutout?.kind === 'sink' ? top - size.height : top - 40;
      else if (hostMod.elevation + hostMod.height < size.elevation || hostMod.elevation > size.elevation)
        elevation = Math.max(hostMod.elevation + 100, Math.min(size.elevation, hostMod.elevation + hostMod.height - size.height - 50));
      return { placed: { ...size, x: o.x, y: o.y, rotation: hostMod.rotation, elevation }, wallId: null, host };
    }
  }

  const w = snapToWall(project, size, cursor, tol + size.depth / 2);
  if (w) {
    placed = w.placed;
    wallId = w.wallId;
    if (adef?.mount === 'inset') {
      const o = localToPlan(placed, 0, 50);
      placed = { ...placed, x: o.x, y: o.y };
    }
  }
  const others: Others = {
    items: [...project.modules, ...project.appliances].filter((o) => !ignore.has(o.id)) as (Placed & { id: string })[],
  };
  const sn = snapToNeighbours(placed, others, Math.max(tol, 60));
  placed = sn.placed;
  // elevation defaults
  if (kind === 'appliance' && adef?.mount === 'counter') {
    const below = project.modules.find((m) => convexOverlap(footprint(m), footprint(placed), 5) && m.elevation < 300);
    placed = { ...placed, elevation: below ? below.elevation + below.height + project.countertop.thickness : size.elevation };
  }
  if (kind === 'module' && !moduleDef(type)) return { placed, wallId };
  return { placed: { ...placed, x: Math.round(placed.x * 10) / 10, y: Math.round(placed.y * 10) / 10 }, wallId, host };
}

export const vsub = sub;
