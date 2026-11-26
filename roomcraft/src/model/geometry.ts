import type { Room, Vec2 } from './types';

export const v = (x: number, y: number): Vec2 => ({ x, y });
export const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
export const scale = (a: Vec2, s: number): Vec2 => ({ x: a.x * s, y: a.y * s });
export const dot = (a: Vec2, b: Vec2): number => a.x * b.x + a.y * b.y;
export const cross = (a: Vec2, b: Vec2): number => a.x * b.y - a.y * b.x;
export const len = (a: Vec2): number => Math.hypot(a.x, a.y);
export const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);
export const norm = (a: Vec2): Vec2 => {
  const l = len(a);
  return l > 1e-9 ? { x: a.x / l, y: a.y / l } : { x: 0, y: 0 };
};
export const lerp = (a: Vec2, b: Vec2, t: number): Vec2 => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

/** Shoelace signed area (×1, not ×½ inverted): positive for our canonical orientation. */
export function signedArea(pts: Vec2[]): number {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    s += a.x * b.y - b.x * a.y;
  }
  return s / 2;
}

export const polygonArea = (pts: Vec2[]): number => Math.abs(signedArea(pts));

export function perimeter(pts: Vec2[]): number {
  let p = 0;
  for (let i = 0; i < pts.length; i++) p += dist(pts[i], pts[(i + 1) % pts.length]);
  return p;
}

export function centroid(pts: Vec2[]): Vec2 {
  const a = signedArea(pts);
  if (Math.abs(a) < 1e-9) {
    const s = pts.reduce((acc, p) => add(acc, p), v(0, 0));
    return scale(s, 1 / Math.max(1, pts.length));
  }
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    const f = p.x * q.y - q.x * p.y;
    cx += (p.x + q.x) * f;
    cy += (p.y + q.y) * f;
  }
  return { x: cx / (6 * a), y: cy / (6 * a) };
}

/** Is the room orientation canonical (positive area)? */
export const isCanonical = (pts: Vec2[]): boolean => signedArea(pts) > 0;

/** Outward unit normal for edge a→b of a canonical polygon. */
export function outwardNormal(a: Vec2, b: Vec2): Vec2 {
  const d = norm(sub(b, a));
  return { x: d.y, y: -d.x };
}

/** Intersection of two infinite lines p1+t·d1 and p2+s·d2; null if parallel. */
export function lineIntersection(p1: Vec2, d1: Vec2, p2: Vec2, d2: Vec2): Vec2 | null {
  const c = cross(d1, d2);
  if (Math.abs(c) < 1e-9) return null;
  const t = cross(sub(p2, p1), d2) / c;
  return add(p1, scale(d1, t));
}

/**
 * Offset each edge of a canonical polygon outward by its own distance and return the
 * mitred corner points. outer[i] is the outer corner matching pts[i].
 * Very sharp corners are clamped so the miter cannot shoot off to infinity.
 */
export function offsetPolygon(pts: Vec2[], distances: number[]): Vec2[] {
  const n = pts.length;
  const out: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    const prev = (i - 1 + n) % n;
    const a0 = pts[prev];
    const a1 = pts[i];
    const b1 = pts[(i + 1) % n];
    const dPrev = norm(sub(a1, a0));
    const dCur = norm(sub(b1, a1));
    const nPrev = outwardNormal(a0, a1);
    const nCur = outwardNormal(a1, b1);
    const pPrev = add(a1, scale(nPrev, distances[prev]));
    const pCur = add(a1, scale(nCur, distances[i]));
    const hit = lineIntersection(pPrev, dPrev, pCur, dCur);
    const maxMiter = 4 * Math.max(distances[prev], distances[i]);
    if (!hit || dist(hit, a1) > maxMiter) out.push(pCur);
    else out.push(hit);
  }
  return out;
}

/** Wall footprint quads (inner a, inner b, outer b, outer a) for each wall of a room. */
export function wallQuads(room: Room): Vec2[][] {
  const outer = offsetPolygon(
    room.points,
    room.walls.map((w) => w.thickness),
  );
  const n = room.points.length;
  return room.points.map((p, i) => {
    const j = (i + 1) % n;
    return [p, room.points[j], outer[j], outer[i]];
  });
}

export function outerPolygon(room: Room): Vec2[] {
  return offsetPolygon(room.points, room.walls.map((w) => w.thickness));
}

/** Closest point on segment ab to p, with parameter t in [0,1]. */
export function closestOnSegment(p: Vec2, a: Vec2, b: Vec2): { point: Vec2; t: number; d: number } {
  const ab = sub(b, a);
  const l2 = dot(ab, ab);
  let t = l2 > 0 ? dot(sub(p, a), ab) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  const point = add(a, scale(ab, t));
  return { point, t, d: dist(p, point) };
}

export function pointInPolygon(p: Vec2, pts: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i];
    const b = pts[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function boundsOf(pts: Vec2[]): Bounds | null {
  if (!pts.length) return null;
  const b = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const p of pts) {
    b.minX = Math.min(b.minX, p.x);
    b.minY = Math.min(b.minY, p.y);
    b.maxX = Math.max(b.maxX, p.x);
    b.maxY = Math.max(b.maxY, p.y);
  }
  return b;
}

/** Angle of a→b in degrees, measured with y up (counter-clockwise on screen) in [0, 360). */
export function angleDeg(a: Vec2, b: Vec2): number {
  const deg = (Math.atan2(-(b.y - a.y), b.x - a.x) * 180) / Math.PI;
  return (deg + 360) % 360;
}

/** Remove consecutive duplicates and collinear points (within tolerance). */
export function cleanPolygon(pts: Vec2[], tol = 0.5): Vec2[] {
  let out = pts.filter((p, i) => dist(p, pts[(i + 1) % pts.length]) > tol);
  let changed = true;
  while (changed && out.length > 3) {
    changed = false;
    for (let i = 0; i < out.length; i++) {
      const a = out[(i - 1 + out.length) % out.length];
      const b = out[i];
      const c = out[(i + 1) % out.length];
      const area2 = Math.abs(cross(sub(b, a), sub(c, a)));
      if (area2 / Math.max(dist(a, c), 1) < tol) {
        out = out.filter((_, k) => k !== i);
        changed = true;
        break;
      }
    }
  }
  return out;
}

/** Do two segments properly intersect (excluding shared endpoints)? */
export function segmentsIntersect(a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean {
  const d1 = cross(sub(d, c), sub(a, c));
  const d2 = cross(sub(d, c), sub(b, c));
  const d3 = cross(sub(b, a), sub(c, a));
  const d4 = cross(sub(b, a), sub(d, a));
  return d1 * d2 < -1e-9 && d3 * d4 < -1e-9;
}

export function isSimplePolygon(pts: Vec2[]): boolean {
  const n = pts.length;
  if (n < 3) return false;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (Math.abs(i - j) <= 1 || (i === 0 && j === n - 1)) continue;
      if (segmentsIntersect(pts[i], pts[(i + 1) % n], pts[j], pts[(j + 1) % n])) return false;
    }
  }
  return true;
}
