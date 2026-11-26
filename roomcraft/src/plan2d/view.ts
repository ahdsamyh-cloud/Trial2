import type { Vec2 } from '../model/types';
import type { Bounds } from '../model/geometry';

/** 2D view transform: screen = world * scale + offset. scale is pixels per millimetre. */
export interface ViewTransform {
  scale: number;
  x: number;
  y: number;
}

export const MIN_SCALE = 0.005; // 1 m = 5 px
export const MAX_SCALE = 3; // 1 mm = 3 px

export const clampScale = (s: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));

export const toWorld = (v: ViewTransform, p: Vec2): Vec2 => ({ x: (p.x - v.x) / v.scale, y: (p.y - v.y) / v.scale });
export const toScreen = (v: ViewTransform, p: Vec2): Vec2 => ({ x: p.x * v.scale + v.x, y: p.y * v.scale + v.y });

/** Zoom by `factor` keeping the world point under screen point `at` fixed. */
export function zoomAt(v: ViewTransform, at: Vec2, factor: number): ViewTransform {
  const scale = clampScale(v.scale * factor);
  const w = toWorld(v, at);
  return { scale, x: at.x - w.x * scale, y: at.y - w.y * scale };
}

export function fitBounds(b: Bounds | null, width: number, height: number, padding = 0.12): ViewTransform {
  const box = b ?? { minX: -500, minY: -500, maxX: 5500, maxY: 4500 };
  const bw = Math.max(box.maxX - box.minX, 1000);
  const bh = Math.max(box.maxY - box.minY, 1000);
  const scale = clampScale(Math.min((width * (1 - 2 * padding)) / bw, (height * (1 - 2 * padding)) / bh));
  const cx = (box.minX + box.maxX) / 2;
  const cy = (box.minY + box.maxY) / 2;
  return { scale, x: width / 2 - cx * scale, y: height / 2 - cy * scale };
}
