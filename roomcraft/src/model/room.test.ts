import { polygonArea, signedArea } from './geometry';
import {
  canonicalize,
  createRoom,
  insertCorner,
  migrateProject,
  newProject,
  removeCorner,
  setWallLength,
  templatePoints,
  wallLength,
} from './room';

describe('room creation', () => {
  it('canonicalises clockwise input and keeps walls paired with edges', () => {
    const ccw = [{ x: 0, y: 0 }, { x: 0, y: 3000 }, { x: 4000, y: 3000 }, { x: 4000, y: 0 }];
    const r = createRoom('R', ccw);
    expect(signedArea(r.points)).toBeGreaterThan(0);
    expect(r.walls).toHaveLength(4);
  });
  it('reversal maps each wall to the same physical edge', () => {
    const pts = [{ x: 0, y: 0 }, { x: 0, y: 3000 }, { x: 4000, y: 3000 }, { x: 4000, y: 0 }];
    const walls = pts.map((_, i) => ({ id: `w${i}`, thickness: 100 + i, height: 3000 }));
    // edge w0 is the left side (x=0) from (0,0) to (0,3000)
    const c = canonicalize({ id: 'r', name: 'r', points: pts, walls });
    const k = c.walls.findIndex((w) => w.id === 'w0');
    const a = c.points[k];
    const b = c.points[(k + 1) % 4];
    expect(a.x).toBe(0);
    expect(b.x).toBe(0);
  });
  it('builds L and U templates with correct areas', () => {
    expect(polygonArea(templatePoints('rect', { width: 4000, length: 3000 }))).toBe(12e6);
    expect(polygonArea(templatePoints('L', { width: 4000, length: 3000, cutWidth: 1000, cutLength: 1000 }))).toBe(11e6);
    expect(polygonArea(templatePoints('U', { width: 6000, length: 4000, cutWidth: 2000, cutLength: 2000 }))).toBe(20e6);
  });
});

describe('editing', () => {
  it('setWallLength keeps a rectangle rectangular', () => {
    const r = createRoom('R', templatePoints('rect', { width: 4000, length: 3000 }));
    const i = r.points.findIndex((_, k) => Math.round(wallLength(r, k)) === 4000);
    const r2 = setWallLength(r, i, 4500);
    expect(wallLength(r2, i)).toBeCloseTo(4500);
    expect(polygonArea(r2.points)).toBeCloseTo(4500 * 3000);
    const lengths = r2.points.map((_, k) => Math.round(wallLength(r2, k))).sort();
    expect(lengths).toEqual([3000, 3000, 4500, 4500]);
  });
  it('insert and remove corners keep walls in sync', () => {
    const r = createRoom('R', templatePoints('rect', { width: 4000, length: 3000 }));
    const r2 = insertCorner(r, 0, 0.25);
    expect(r2.points).toHaveLength(5);
    expect(r2.walls).toHaveLength(5);
    expect(wallLength(r2, 0) + wallLength(r2, 1)).toBeCloseTo(wallLength(r, 0));
    const r3 = removeCorner(r2, 1);
    expect(r3.points).toHaveLength(4);
    expect(r3.walls.map((w) => w.id)).toEqual(r.walls.map((w) => w.id));
    expect(removeCorner(createRoom('T', [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 10 }]), 0).points).toHaveLength(3);
  });
});

describe('project files', () => {
  it('round-trips through JSON', () => {
    const p = newProject('Test');
    p.rooms.push(createRoom('Kitchen', templatePoints('L', { width: 4000, length: 3000 })));
    const back = migrateProject(JSON.parse(JSON.stringify(p)));
    expect(back.rooms[0].points).toEqual(p.rooms[0].points);
    expect(back.name).toBe('Test');
  });
  it('rejects invalid files', () => {
    expect(() => migrateProject({ foo: 1 })).toThrow();
    expect(() => migrateProject(null)).toThrow();
  });
});
