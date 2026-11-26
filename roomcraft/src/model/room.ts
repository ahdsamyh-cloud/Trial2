import { add, boundsOf, cleanPolygon, dist, lerp, norm, scale, signedArea, sub } from './geometry';
import { uid } from './ids';
import type { Project, Room, Vec2, Wall } from './types';

export const DEFAULT_WALL_THICKNESS = 230;
export const DEFAULT_WALL_HEIGHT = 3000;

export function makeWall(thickness: number, height: number): Wall {
  return { id: uid('wall'), thickness, height };
}

/** Ensure positive orientation; reverses points and walls together (keeping wall ↔ edge pairing). */
export function canonicalize(room: Room): Room {
  if (signedArea(room.points) >= 0) return room;
  const n = room.points.length;
  // Reversed polygon q_k = p_{n-1-k}; edge k of q runs q_k→q_{k+1} = p_{n-1-k}→p_{n-2-k},
  // which is original edge (n-2-k) mod n.
  const points = [...room.points].reverse();
  const walls = points.map((_, k) => room.walls[(((n - 2 - k) % n) + n) % n]);
  return { ...room, points, walls };
}

export function createRoom(
  name: string,
  points: Vec2[],
  thickness = DEFAULT_WALL_THICKNESS,
  height = DEFAULT_WALL_HEIGHT,
): Room {
  const clean = cleanPolygon(points.map((p) => ({ x: round3(p.x), y: round3(p.y) })));
  const room: Room = {
    id: uid('room'),
    name,
    points: clean,
    walls: clean.map(() => makeWall(thickness, height)),
  };
  return canonicalize(room);
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

export function wallLength(room: Room, i: number): number {
  const n = room.points.length;
  return dist(room.points[i], room.points[(i + 1) % n]);
}

/**
 * Change the inner length of wall i. Point i stays fixed; the far corner (i+1) and the
 * corner after it (i+2) are both moved along the wall direction so the following wall
 * is translated parallel to itself. For rectangles/L/U shapes this keeps all right angles.
 */
export function setWallLength(room: Room, i: number, newLength: number): Room {
  const n = room.points.length;
  if (newLength <= 0 || n < 3) return room;
  const a = room.points[i];
  const b = room.points[(i + 1) % n];
  const dir = norm(sub(b, a));
  const delta = scale(dir, newLength - dist(a, b));
  const j = (i + 1) % n;
  const k = (i + 2) % n;
  const points = room.points.map((p, idx) => (idx === j || (idx === k && k !== i) ? add(p, delta) : p));
  if (n === 3) {
    // Triangle: only move the far corner.
    points[k] = room.points[k];
  }
  return canonicalize({ ...room, points: points.map((p) => ({ x: round3(p.x), y: round3(p.y) })) });
}

export function moveCorner(room: Room, index: number, to: Vec2): Room {
  const points = room.points.map((p, i) => (i === index ? { x: round3(to.x), y: round3(to.y) } : p));
  return canonicalize({ ...room, points });
}

export function translateRoom(room: Room, d: Vec2): Room {
  return { ...room, points: room.points.map((p) => ({ x: round3(p.x + d.x), y: round3(p.y + d.y) })) };
}

/** Split wall i at parameter t (0..1), inserting a new corner. The new wall copies wall i's properties. */
export function insertCorner(room: Room, wallIndex: number, t = 0.5): Room {
  const n = room.points.length;
  const a = room.points[wallIndex];
  const b = room.points[(wallIndex + 1) % n];
  const p = lerp(a, b, t);
  const points = [...room.points];
  points.splice(wallIndex + 1, 0, { x: round3(p.x), y: round3(p.y) });
  const walls = [...room.walls];
  const src = room.walls[wallIndex];
  walls.splice(wallIndex + 1, 0, { ...src, id: uid('wall') });
  return { ...room, points, walls };
}

/** Remove corner i (min 3 corners). The walls on either side merge into the earlier wall. */
export function removeCorner(room: Room, index: number): Room {
  const n = room.points.length;
  if (n <= 3) return room;
  const points = room.points.filter((_, i) => i !== index);
  // wall (index-1) now runs to the old point index+1; drop wall `index`.
  const walls = room.walls.filter((_, i) => i !== index);
  return canonicalize({ ...room, points, walls });
}

/* ---------- Templates ---------- */

export type TemplateKind = 'rect' | 'L' | 'U';

export interface TemplateParams {
  width: number; // along x
  length: number; // along y
  /** L: size of the cut-out corner. U: width/depth of the notch. */
  cutWidth?: number;
  cutLength?: number;
}

export function templatePoints(kind: TemplateKind, p: TemplateParams, origin: Vec2 = { x: 0, y: 0 }): Vec2[] {
  const { width: W, length: L } = p;
  let pts: Vec2[];
  switch (kind) {
    case 'rect':
      pts = [
        { x: 0, y: 0 },
        { x: W, y: 0 },
        { x: W, y: L },
        { x: 0, y: L },
      ];
      break;
    case 'L': {
      const cw = Math.min(p.cutWidth ?? W / 2, W - 1);
      const cl = Math.min(p.cutLength ?? L / 2, L - 1);
      // notch removed from the top-right corner
      pts = [
        { x: 0, y: 0 },
        { x: W - cw, y: 0 },
        { x: W - cw, y: cl },
        { x: W, y: cl },
        { x: W, y: L },
        { x: 0, y: L },
      ];
      break;
    }
    case 'U': {
      const cw = Math.min(p.cutWidth ?? W / 3, W - 2);
      const cl = Math.min(p.cutLength ?? L / 2, L - 1);
      const side = (W - cw) / 2;
      // notch open at the top, centred
      pts = [
        { x: 0, y: 0 },
        { x: side, y: 0 },
        { x: side, y: cl },
        { x: side + cw, y: cl },
        { x: side + cw, y: 0 },
        { x: W, y: 0 },
        { x: W, y: L },
        { x: 0, y: L },
      ];
      break;
    }
  }
  return pts.map((q) => add(q, origin));
}

/** Where to drop a new room so it doesn't overlap existing ones: to the right of everything. */
export function nextRoomOrigin(project: Project, gap = 1000): Vec2 {
  const all = project.rooms.flatMap((r) => r.points);
  const b = boundsOf(all);
  if (!b) return { x: 0, y: 0 };
  const maxT = Math.max(0, ...project.rooms.flatMap((r) => r.walls.map((w) => w.thickness)));
  return { x: Math.ceil((b.maxX + 2 * maxT + gap) / 100) * 100, y: Math.round(b.minY / 100) * 100 };
}

export function newProject(name = 'Untitled project'): Project {
  const now = new Date().toISOString();
  return {
    version: 1,
    id: uid('proj'),
    name,
    rooms: [],
    settings: { defaultWallThickness: DEFAULT_WALL_THICKNESS, defaultWallHeight: DEFAULT_WALL_HEIGHT },
    createdAt: now,
    updatedAt: now,
  };
}

/** Validate and upgrade a parsed JSON project file. Throws with a readable message. */
export function migrateProject(data: unknown): Project {
  if (!data || typeof data !== 'object') throw new Error('Not a RoomCraft project file.');
  const d = data as Partial<Project> & { app?: string; project?: Project };
  const p = (d.project ?? d) as Partial<Project>;
  if (p.version !== 1 || !Array.isArray(p.rooms)) throw new Error('Unsupported or corrupt project file.');
  const base = newProject(p.name ?? 'Imported project');
  const rooms = p.rooms.map((r) => {
    if (!Array.isArray(r.points) || r.points.length < 3) throw new Error(`Room "${r.name}" has invalid corners.`);
    const walls = r.points.map(
      (_, i) =>
        r.walls?.[i] ?? makeWall(p.settings?.defaultWallThickness ?? DEFAULT_WALL_THICKNESS, p.settings?.defaultWallHeight ?? DEFAULT_WALL_HEIGHT),
    );
    return canonicalize({ id: r.id ?? uid('room'), name: r.name ?? 'Room', points: r.points, walls });
  });
  return { ...base, ...p, version: 1, rooms, settings: { ...base.settings, ...p.settings } } as Project;
}
