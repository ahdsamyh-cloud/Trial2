/**
 * Sheet optimisation: MaxRects bin packing (best short side fit) with saw kerf,
 * edge trim and grain-direction constraints.
 */
export interface NestPart<T = unknown> {
  id: string;
  /** size along the sheet's length when not rotated (grain direction) */
  w: number;
  h: number;
  canRotate: boolean;
  label: string;
  ref?: T;
}

export interface Placement<T = unknown> {
  part: NestPart<T>;
  x: number;
  y: number;
  w: number;
  h: number;
  rotated: boolean;
}

export interface NestSheet<T = unknown> {
  placements: Placement<T>[];
  usedArea: number;
}

export interface NestResult<T = unknown> {
  sheets: NestSheet<T>[];
  unplaced: NestPart<T>[];
  sheetW: number;
  sheetH: number;
  /** fraction of total sheet area covered by parts (excluding kerf) */
  efficiency: number;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const contains = (a: Rect, b: Rect) => b.x >= a.x && b.y >= a.y && b.x + b.w <= a.x + a.w && b.y + b.h <= a.y + a.h;
const intersects = (a: Rect, b: Rect) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

class Bin {
  free: Rect[];
  placed: Rect[] = [];
  constructor(w: number, h: number) {
    this.free = [{ x: 0, y: 0, w, h }];
  }

  /** Best short side fit; returns the candidate with its score (lower is better). */
  find(w: number, h: number, canRotate: boolean): { rect: Rect; rotated: boolean; score: number; score2: number } | null {
    let best: { rect: Rect; rotated: boolean; score: number; score2: number } | null = null;
    for (const f of this.free) {
      const tries: [number, number, boolean][] = [[w, h, false]];
      if (canRotate && w !== h) tries.push([h, w, true]);
      for (const [tw, th, rot] of tries) {
        if (tw <= f.w + 1e-6 && th <= f.h + 1e-6) {
          const ls = Math.min(f.w - tw, f.h - th);
          const ll = Math.max(f.w - tw, f.h - th);
          if (!best || ls < best.score || (ls === best.score && ll < best.score2))
            best = { rect: { x: f.x, y: f.y, w: tw, h: th }, rotated: rot, score: ls, score2: ll };
        }
      }
    }
    return best;
  }

  place(r: Rect) {
    const next: Rect[] = [];
    for (const f of this.free) {
      if (!intersects(f, r)) {
        next.push(f);
        continue;
      }
      if (r.x > f.x) next.push({ x: f.x, y: f.y, w: r.x - f.x, h: f.h });
      if (r.x + r.w < f.x + f.w) next.push({ x: r.x + r.w, y: f.y, w: f.x + f.w - (r.x + r.w), h: f.h });
      if (r.y > f.y) next.push({ x: f.x, y: f.y, w: f.w, h: r.y - f.y });
      if (r.y + r.h < f.y + f.h) next.push({ x: f.x, y: r.y + r.h, w: f.w, h: f.y + f.h - (r.y + r.h) });
    }
    // prune rectangles contained in others
    this.free = next.filter((a, i) => a.w > 0.5 && a.h > 0.5 && !next.some((b, j) => j !== i && contains(b, a) && !(contains(a, b) && j > i)));
    this.placed.push(r);
  }
}

export function nest<T>(parts: NestPart<T>[], sheetW: number, sheetH: number, opts: { kerf?: number; trim?: number } = {}): NestResult<T> {
  const kerf = opts.kerf ?? 3;
  const trim = opts.trim ?? 0;
  const usableW = sheetW - 2 * trim + kerf;
  const usableH = sheetH - 2 * trim + kerf;
  const sorted = [...parts].sort((a, b) => Math.max(b.w, b.h) - Math.max(a.w, a.h) || b.w * b.h - a.w * a.h);
  const bins: { bin: Bin; sheet: NestSheet<T> }[] = [];
  const unplaced: NestPart<T>[] = [];

  for (const part of sorted) {
    const pw = part.w + kerf;
    const ph = part.h + kerf;
    let target: { b: (typeof bins)[number]; c: NonNullable<ReturnType<Bin['find']>> } | null = null;
    for (const b of bins) {
      const c = b.bin.find(pw, ph, part.canRotate);
      if (c && (!target || c.score < target.c.score)) target = { b, c };
      if (c && c.score === 0) break;
    }
    if (!target) {
      const fresh = new Bin(usableW, usableH);
      const c = fresh.find(pw, ph, part.canRotate);
      if (!c) {
        unplaced.push(part);
        continue;
      }
      const entry = { bin: fresh, sheet: { placements: [], usedArea: 0 } as NestSheet<T> };
      bins.push(entry);
      target = { b: entry, c };
    }
    const { b, c } = target;
    b.bin.place(c.rect);
    const w = c.rotated ? part.h : part.w;
    const h = c.rotated ? part.w : part.h;
    b.sheet.placements.push({ part, x: c.rect.x + trim, y: c.rect.y + trim, w, h, rotated: c.rotated });
    b.sheet.usedArea += part.w * part.h;
  }
  const sheets = bins.map((b) => b.sheet);
  const used = sheets.reduce((s, sh) => s + sh.usedArea, 0);
  return { sheets, unplaced, sheetW, sheetH, efficiency: sheets.length ? used / (sheets.length * sheetW * sheetH) : 0 };
}
