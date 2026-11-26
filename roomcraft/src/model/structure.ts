import { add, dist, dot, norm, offsetPolygon, scale, sub, closestOnSegment } from './geometry';
import type { Opening, Project, Room, RoomStructure, ServicePoint, Vec2, Wall } from './types';

export const DEFAULT_STRUCTURE: RoomStructure = {
  floorSlab: 150,
  ceilingSlab: 150,
  skirtingHeight: 100,
  skirtingThickness: 12,
  dropCeiling: null,
};

export const roomStructure = (r: Room): RoomStructure => ({ ...DEFAULT_STRUCTURE, ...r.structure });

/** Everything about one wall needed for placing things on it. */
export interface WallFrame {
  room: Room;
  wall: Wall;
  index: number;
  a: Vec2; // inner face start
  b: Vec2; // inner face end
  dir: Vec2; // unit a→b
  inward: Vec2; // unit normal pointing into the room
  length: number;
  /** outer face corners (mitred) */
  oa: Vec2;
  ob: Vec2;
  /** rotation (deg) that aligns an object's width axis with the wall, front facing into the room */
  rotation: number;
}

export function wallFrame(room: Room, index: number, outer?: Vec2[]): WallFrame {
  const n = room.points.length;
  const a = room.points[index];
  const b = room.points[(index + 1) % n];
  const dir = norm(sub(b, a));
  const o = outer ?? offsetPolygon(room.points, room.walls.map((w) => w.thickness));
  return {
    room,
    wall: room.walls[index],
    index,
    a,
    b,
    dir,
    inward: { x: -dir.y, y: dir.x },
    length: dist(a, b),
    oa: o[index],
    ob: o[(index + 1) % n],
    rotation: (Math.atan2(dir.y, dir.x) * 180) / Math.PI,
  };
}

export function allWallFrames(project: Project): WallFrame[] {
  const out: WallFrame[] = [];
  for (const r of project.rooms) {
    const o = offsetPolygon(r.points, r.walls.map((w) => w.thickness));
    r.walls.forEach((_, i) => out.push(wallFrame(r, i, o)));
  }
  return out;
}

export function findWall(project: Project, wallId: string): WallFrame | null {
  for (const r of project.rooms) {
    const i = r.walls.findIndex((w) => w.id === wallId);
    if (i >= 0) return wallFrame(r, i);
  }
  return null;
}

/** Point along a wall's inner face. */
export const pointOnWall = (f: WallFrame, offset: number): Vec2 => add(f.a, scale(f.dir, offset));

/** Nearest wall (inner face) to a plan point. */
export function nearestWall(project: Project, p: Vec2, maxDist = Infinity): { frame: WallFrame; offset: number; d: number } | null {
  let best: { frame: WallFrame; offset: number; d: number } | null = null;
  for (const f of allWallFrames(project)) {
    const c = closestOnSegment(p, f.a, f.b);
    // ignore points on the outside of the wall (behind it by more than its thickness)
    const side = dot(sub(p, c.point), f.inward);
    const d = side < 0 ? Math.max(c.d, 0) : c.d;
    if (side < -f.wall.thickness - 50) continue;
    if (d < maxDist && (!best || d < best.d)) best = { frame: f, offset: c.t * f.length, d };
  }
  return best;
}

/** Resolve a service point's plan position (wall-mounted items follow their wall). */
export function servicePosition(project: Project, s: ServicePoint): Vec2 {
  if (s.wallId) {
    const f = findWall(project, s.wallId);
    if (f) return pointOnWall(f, Math.max(0, Math.min(f.length, s.offset)));
  }
  return { x: s.x, y: s.y };
}

export function openingsOnWall(project: Project, wallId: string): Opening[] {
  return project.openings.filter((o) => o.wallId === wallId).sort((a, b) => a.offset - b.offset);
}

/** Clamp an opening so it lies within its wall. */
export function clampOpening(o: Opening, wallLength: number): Opening {
  const width = Math.min(o.width, Math.max(100, wallLength - 20));
  const offset = Math.max(0, Math.min(wallLength - width, o.offset));
  return { ...o, width, offset };
}

/* ---------- 3D wall pieces with holes for openings ---------- */

export interface WallPiece {
  polygon: Vec2[]; // plan footprint of this slice of the wall
  z0: number;
  z1: number;
}

/** Clip a polygon to s0 <= dot(p - origin, dir) <= s1 (Sutherland–Hodgman on two half-planes). */
export function clipAlong(poly: Vec2[], origin: Vec2, dir: Vec2, s0: number, s1: number): Vec2[] {
  const clip = (pts: Vec2[], keep: (s: number) => boolean, at: number): Vec2[] => {
    const out: Vec2[] = [];
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const q = pts[(i + 1) % pts.length];
      const sp = dot(sub(p, origin), dir);
      const sq = dot(sub(q, origin), dir);
      const pin = keep(sp);
      const qin = keep(sq);
      if (pin) out.push(p);
      if (pin !== qin) {
        const t = (at - sp) / (sq - sp);
        out.push(add(p, scale(sub(q, p), t)));
      }
    }
    return out;
  };
  let r = clip(poly, (s) => s >= s0 - 1e-6, s0);
  if (r.length) r = clip(r, (s) => s <= s1 + 1e-6, s1);
  return r;
}

/**
 * Split a wall's footprint into vertical pieces so doors/windows become holes:
 * solid slices run full height; slices at an opening keep the parts below the sill and above the head.
 */
export function wallPieces(project: Project, f: WallFrame): WallPiece[] {
  const quad = [f.a, f.b, f.ob, f.oa];
  const H = f.wall.height;
  const ops = openingsOnWall(project, f.wall.id).map((o) => clampOpening(o, f.length));
  const pieces: WallPiece[] = [];
  // use a big range at the ends so mitred corners are kept whole
  let cursor = -1e5;
  for (const o of ops) {
    const s0 = o.offset;
    const s1 = o.offset + o.width;
    if (s0 > cursor) pieces.push({ polygon: clipAlong(quad, f.a, f.dir, cursor, s0), z0: 0, z1: H });
    const slice = clipAlong(quad, f.a, f.dir, s0, s1);
    if (o.sill > 0) pieces.push({ polygon: slice, z0: 0, z1: Math.min(o.sill, H) });
    const head = o.sill + o.height;
    if (head < H) pieces.push({ polygon: slice, z0: head, z1: H });
    cursor = Math.max(cursor, s1);
  }
  pieces.push({ polygon: clipAlong(quad, f.a, f.dir, cursor, 1e5), z0: 0, z1: H });
  return pieces.filter((p) => p.polygon.length >= 3 && p.z1 - p.z0 > 0.5);
}

/* ---------- placement frames for modules / appliances ---------- */

export interface Placed {
  x: number;
  y: number;
  rotation: number;
  width: number;
  depth: number;
  height: number;
  elevation: number;
}

export function axes(rotationDeg: number): { ux: Vec2; uy: Vec2 } {
  const r = (rotationDeg * Math.PI) / 180;
  return { ux: { x: Math.cos(r), y: Math.sin(r) }, uy: { x: -Math.sin(r), y: Math.cos(r) } };
}

/** Plan point of local (u along width, v along depth towards the front). */
export function localToPlan(p: Placed, u: number, v: number): Vec2 {
  const { ux, uy } = axes(p.rotation);
  return { x: p.x + ux.x * u + uy.x * v, y: p.y + ux.y * u + uy.y * v };
}

export function planToLocal(p: Placed, q: Vec2): { u: number; v: number } {
  const { ux, uy } = axes(p.rotation);
  const d = sub(q, { x: p.x, y: p.y });
  return { u: dot(d, ux), v: dot(d, uy) };
}

/** Footprint polygon: back-left, back-right, front-right, front-left. */
export function footprint(p: Placed, grow = 0): Vec2[] {
  return [
    localToPlan(p, -grow, -grow),
    localToPlan(p, p.width + grow, -grow),
    localToPlan(p, p.width + grow, p.depth + grow),
    localToPlan(p, -grow, p.depth + grow),
  ];
}

/** Separating-axis test for two convex polygons (strict overlap, tolerance in mm). */
export function convexOverlap(A: Vec2[], B: Vec2[], tol = 1): boolean {
  for (const poly of [A, B]) {
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i];
      const q = poly[(i + 1) % poly.length];
      const n = norm({ x: -(q.y - p.y), y: q.x - p.x });
      let aMin = Infinity, aMax = -Infinity, bMin = Infinity, bMax = -Infinity;
      for (const v of A) {
        const s = dot(v, n);
        aMin = Math.min(aMin, s);
        aMax = Math.max(aMax, s);
      }
      for (const v of B) {
        const s = dot(v, n);
        bMin = Math.min(bMin, s);
        bMax = Math.max(bMax, s);
      }
      if (aMax - tol <= bMin || bMax - tol <= aMin) return false;
    }
  }
  return true;
}

/** Rectangle polygon for a column. */
export function columnPolygon(c: { x: number; y: number; width: number; depth: number; rotation: number }): Vec2[] {
  const { ux, uy } = axes(c.rotation);
  const hw = c.width / 2;
  const hd = c.depth / 2;
  const pts = [
    [-hw, -hd],
    [hw, -hd],
    [hw, hd],
    [-hw, hd],
  ];
  return pts.map(([u, v]) => ({ x: c.x + ux.x * u + uy.x * v, y: c.y + ux.y * u + uy.y * v }));
}

export function beamPolygon(b: { a: Vec2; b: Vec2; width: number }): Vec2[] {
  const d = norm(sub(b.b, b.a));
  const n = { x: -d.y * (b.width / 2), y: d.x * (b.width / 2) };
  return [add(b.a, n), add(b.b, n), sub(b.b, n), sub(b.a, n)];
}

/**
 * Snap a rectangular object (module/appliance) to the nearest wall: back against the
 * inner face, rotated to the wall, kept within the wall's length.
 */
export function snapToWall(project: Project, p: Placed, cursor: Vec2, maxDist: number): { placed: Placed; wallId: string } | null {
  const nw = nearestWall(project, cursor, maxDist + p.depth);
  if (!nw) return null;
  const f = nw.frame;
  let u = nw.offset - p.width / 2;
  u = Math.max(0, Math.min(f.length - p.width, u));
  const origin = add(f.a, scale(f.dir, u));
  return { placed: { ...p, x: origin.x, y: origin.y, rotation: f.rotation }, wallId: f.wall.id };
}
