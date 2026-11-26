import { add, closestOnSegment, dist, len, lineIntersection, sub } from './geometry';
import type { Vec2 } from './types';

export interface SnapOptions {
  grid: number;
  snapGrid: boolean;
  snapAngle: boolean;
  snapObjects: boolean;
  /** Snap radius in mm (callers convert from screen pixels). */
  tolerance: number;
  /** Previous point of the segment being drawn: enables angle snapping. */
  prev?: Vec2;
  /** Points that attract (corners). */
  points?: Vec2[];
  /** Segments that attract (wall faces). */
  segments?: [Vec2, Vec2][];
  /** Points to align with horizontally/vertically (e.g. neighbours of a dragged corner). */
  alignTo?: Vec2[];
  angleStepDeg?: number;
}

export type SnapGuide =
  | { kind: 'point'; at: Vec2 }
  | { kind: 'segment'; a: Vec2; b: Vec2 }
  | { kind: 'alignX'; from: Vec2; to: Vec2 }
  | { kind: 'alignY'; from: Vec2; to: Vec2 }
  | { kind: 'angle'; from: Vec2; to: Vec2; deg: number };

export interface SnapResult {
  point: Vec2;
  guides: SnapGuide[];
}

export const roundTo = (n: number, step: number): number => (step > 0 ? Math.round(n / step) * step : n);

/** Snap a point to the angle grid (45°/90°) relative to `prev`, rounding the length. */
export function snapToAngle(prev: Vec2, raw: Vec2, stepDeg: number, lengthStep: number): { point: Vec2; deg: number } {
  const d = sub(raw, prev);
  const l = len(d);
  if (l < 1e-6) return { point: raw, deg: 0 };
  const ang = Math.atan2(d.y, d.x);
  const step = (stepDeg * Math.PI) / 180;
  const snapped = Math.round(ang / step) * step;
  const L = Math.max(roundTo(l, lengthStep), lengthStep > 0 ? lengthStep : 0);
  const p = add(prev, { x: Math.cos(snapped) * L, y: Math.sin(snapped) * L });
  // kill floating noise like 1e-13
  const clean = { x: Math.round(p.x * 1000) / 1000, y: Math.round(p.y * 1000) / 1000 };
  return { point: clean, deg: ((-snapped * 180) / Math.PI + 360) % 360 };
}

/**
 * Snapping pipeline (later stages win):
 *   1. grid (or angle lock when drawing from a previous point)
 *   2. horizontal/vertical alignment with reference points
 *   3. wall faces (segments)
 *   4. corners (points) — strongest
 */
export function snapPoint(raw: Vec2, o: SnapOptions): SnapResult {
  const guides: SnapGuide[] = [];
  let p = { ...raw };
  const lengthStep = o.snapGrid ? Math.min(o.grid, 50) : 10;

  if (o.prev && o.snapAngle) {
    const r = snapToAngle(o.prev, raw, o.angleStepDeg ?? 45, lengthStep);
    p = r.point;
    guides.push({ kind: 'angle', from: o.prev, to: p, deg: r.deg });
  } else if (o.snapGrid) {
    p = { x: roundTo(raw.x, o.grid), y: roundTo(raw.y, o.grid) };
  }

  if (o.snapObjects) {
    // alignment
    let bestX: Vec2 | null = null;
    let bestY: Vec2 | null = null;
    for (const a of o.alignTo ?? []) {
      if (Math.abs(a.x - raw.x) < o.tolerance && (!bestX || Math.abs(a.x - raw.x) < Math.abs(bestX.x - raw.x))) bestX = a;
      if (Math.abs(a.y - raw.y) < o.tolerance && (!bestY || Math.abs(a.y - raw.y) < Math.abs(bestY.y - raw.y))) bestY = a;
    }
    if (bestX || bestY) {
      // alignment overrides angle snap only for the aligned axis
      if (bestX) p = { x: bestX.x, y: o.snapGrid && !bestY ? roundTo(raw.y, o.grid) : p.y };
      if (bestY) p = { x: bestX ? p.x : o.snapGrid ? roundTo(raw.x, o.grid) : p.x, y: bestY.y };
      if (bestX) guides.push({ kind: 'alignX', from: bestX, to: p });
      if (bestY) guides.push({ kind: 'alignY', from: bestY, to: p });
    }

    // segments
    let segBest: { point: Vec2; d: number; a: Vec2; b: Vec2 } | null = null;
    for (const [a, b] of o.segments ?? []) {
      const c = closestOnSegment(raw, a, b);
      if (c.d < o.tolerance && (!segBest || c.d < segBest.d)) segBest = { point: c.point, d: c.d, a, b };
    }
    if (segBest) {
      // While angle-locked, keep the angle: slide along the locked ray to meet the wall face.
      let hit: Vec2 | null = null;
      if (o.prev && o.snapAngle && dist(p, o.prev) > 1e-6) {
        hit = lineIntersection(o.prev, sub(p, o.prev), segBest.a, sub(segBest.b, segBest.a));
        if (hit && (dist(hit, raw) > o.tolerance * 1.5 || closestOnSegment(hit, segBest.a, segBest.b).d > 0.5)) hit = null;
      }
      p = hit ?? segBest.point;
      guides.length = 0;
      guides.push({ kind: 'segment', a: segBest.a, b: segBest.b });
    }

    // points
    let ptBest: { p: Vec2; d: number } | null = null;
    for (const q of o.points ?? []) {
      const d = dist(raw, q);
      if (d < o.tolerance && (!ptBest || d < ptBest.d)) ptBest = { p: q, d };
    }
    if (ptBest) {
      p = { ...ptBest.p };
      guides.length = 0;
      guides.push({ kind: 'point', at: p });
    }
  }
  return { point: p, guides };
}

