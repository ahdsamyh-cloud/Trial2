import {
  angleDeg,
  centroid,
  cleanPolygon,
  isSimplePolygon,
  offsetPolygon,
  perimeter,
  pointInPolygon,
  polygonArea,
  signedArea,
  wallQuads,
} from './geometry';
import { snapPoint, snapToAngle } from './snapping';
import { createRoom } from './room';

const square = [
  { x: 0, y: 0 },
  { x: 4000, y: 0 },
  { x: 4000, y: 3000 },
  { x: 0, y: 3000 },
];

describe('polygon basics', () => {
  it('area, perimeter, centroid', () => {
    expect(signedArea(square)).toBe(12e6);
    expect(polygonArea([...square].reverse())).toBe(12e6);
    expect(perimeter(square)).toBe(14000);
    expect(centroid(square)).toEqual({ x: 2000, y: 1500 });
  });
  it('point in polygon', () => {
    expect(pointInPolygon({ x: 10, y: 10 }, square)).toBe(true);
    expect(pointInPolygon({ x: -10, y: 10 }, square)).toBe(false);
  });
  it('angles use y-up convention', () => {
    expect(angleDeg({ x: 0, y: 0 }, { x: 10, y: 0 })).toBe(0);
    expect(angleDeg({ x: 0, y: 0 }, { x: 0, y: -10 })).toBe(90);
    expect(angleDeg({ x: 0, y: 0 }, { x: -10, y: 0 })).toBe(180);
  });
  it('cleans duplicate and collinear points', () => {
    const pts = [{ x: 0, y: 0 }, { x: 2000, y: 0 }, { x: 4000, y: 0 }, { x: 4000, y: 0 }, { x: 4000, y: 3000 }, { x: 0, y: 3000 }];
    expect(cleanPolygon(pts)).toHaveLength(4);
  });
  it('detects self-intersection', () => {
    expect(isSimplePolygon(square)).toBe(true);
    const bowtie = [{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 10, y: 0 }, { x: 0, y: 10 }];
    expect(isSimplePolygon(bowtie)).toBe(false);
  });
});

describe('wall offsetting', () => {
  it('offsets a square outward by the wall thickness', () => {
    const outer = offsetPolygon(square, [230, 230, 230, 230]);
    expect(outer[0].x).toBeCloseTo(-230);
    expect(outer[0].y).toBeCloseTo(-230);
    expect(outer[2].x).toBeCloseTo(4230);
    expect(outer[2].y).toBeCloseTo(3230);
  });
  it('handles different thickness per wall', () => {
    const outer = offsetPolygon(square, [100, 200, 300, 400]);
    // corner 0 joins wall 3 (left, 400) and wall 0 (top, 100)
    expect(outer[0].x).toBeCloseTo(-400);
    expect(outer[0].y).toBeCloseTo(-100);
  });
  it('wall quads have the room inner face as first edge', () => {
    const room = createRoom('R', square, 230, 3000);
    const quads = wallQuads(room);
    expect(quads).toHaveLength(4);
    expect(quads[0][0]).toEqual(room.points[0]);
    expect(quads[0][1]).toEqual(room.points[1]);
    expect(polygonArea(quads[0])).toBeCloseTo(230 * (4000 + 230), 0);
  });
});

describe('snapping', () => {
  it('snaps to grid', () => {
    const r = snapPoint({ x: 1234, y: 987 }, { grid: 100, snapGrid: true, snapAngle: false, snapObjects: false, tolerance: 50 });
    expect(r.point).toEqual({ x: 1200, y: 1000 });
  });
  it('locks to 45° steps from the previous point', () => {
    const r = snapToAngle({ x: 0, y: 0 }, { x: 1000, y: 60 }, 45, 10);
    expect(r.point).toEqual({ x: 1000, y: 0 });
    const d = snapToAngle({ x: 0, y: 0 }, { x: 1000, y: -950 }, 45, 10);
    expect(d.deg).toBeCloseTo(45);
    expect(d.point.x).toBeCloseTo(-d.point.y);
  });
  it('corner snap beats grid snap', () => {
    const r = snapPoint(
      { x: 1010, y: 1990 },
      { grid: 100, snapGrid: true, snapAngle: false, snapObjects: true, tolerance: 40, points: [{ x: 1023, y: 2007 }] },
    );
    expect(r.point).toEqual({ x: 1023, y: 2007 });
    expect(r.guides[0].kind).toBe('point');
  });
  it('snaps onto wall faces', () => {
    const r = snapPoint(
      { x: 500, y: 12 },
      { grid: 100, snapGrid: false, snapAngle: false, snapObjects: true, tolerance: 30, segments: [[{ x: 0, y: 0 }, { x: 1000, y: 0 }]] },
    );
    expect(r.point).toEqual({ x: 500, y: 0 });
  });
  it('keeps the locked angle when meeting a wall face', () => {
    const r = snapPoint(
      { x: 1000, y: 1990 },
      {
        grid: 100, snapGrid: true, snapAngle: true, snapObjects: true, tolerance: 30, prev: { x: 1000, y: 0 },
        segments: [[{ x: 0, y: 2013 }, { x: 3000, y: 2013 }]],
      },
    );
    expect(r.point.x).toBeCloseTo(1000);
    expect(r.point.y).toBeCloseTo(2013);
  });
  it('aligns with reference points', () => {
    const r = snapPoint(
      { x: 1007, y: 3333 },
      { grid: 100, snapGrid: false, snapAngle: false, snapObjects: true, tolerance: 20, alignTo: [{ x: 1000, y: 0 }] },
    );
    expect(r.point).toEqual({ x: 1000, y: 3333 });
  });
});
