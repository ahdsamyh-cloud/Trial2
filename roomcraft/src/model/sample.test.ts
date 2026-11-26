import { sampleKitchen } from './sample';
import { detectClashes } from './checks';
import { buildCountertop } from './countertop';
import { elevationFor, interestingWalls } from './elevation';
import { estimateCost } from './cost';
import { migrateProject } from './room';

describe('sample kitchen (integration)', () => {
  const p = sampleKitchen();
  it('has no clash errors', () => {
    expect(detectClashes(p).filter((i) => i.severity === 'error')).toEqual([]);
  });
  it('builds an L-shaped countertop with sink and hob cut-outs', () => {
    const pieces = buildCountertop(p);
    expect(pieces).toHaveLength(2);
    const kinds = pieces.flatMap((x) => x.cutouts.map((c) => c.kind)).sort();
    expect(kinds).toEqual(['hob', 'sink']);
    expect(pieces.some((x) => x.joints.length)).toBe(true);
  });
  it('produces elevations for the furnished walls', () => {
    const walls = interestingWalls(p);
    expect(walls.length).toBeGreaterThanOrEqual(3);
    const e = elevationFor(p, walls[0], buildCountertop(p))!;
    expect(e.rects.some((r) => r.kind === 'front')).toBe(true);
    expect(e.chain[0]).toBe(0);
  });
  it('estimates a positive cost and survives a JSON round-trip', () => {
    const c = estimateCost(p);
    expect(c.sheetCount).toBeGreaterThan(3);
    expect(c.total).toBeGreaterThan(c.subtotal);
    const back = migrateProject(JSON.parse(JSON.stringify(p)));
    expect(estimateCost(back).total).toBeCloseTo(c.total, 6);
  });
});
