import { nest } from './nesting';
import { buildCutList, edgeMetres, optimiseSheets, cutListCsv } from './cutlist';
import { estimateCost } from './cost';
import { buildCountertop } from './countertop';
import { newModule } from './furniture';
import { createRoom, newProject, templatePoints } from './room';
import type { Project } from './types';

describe('nesting', () => {
  it('fits parts without overlap and respects kerf', () => {
    const parts = Array.from({ length: 12 }, (_, i) => ({ id: `p${i}`, w: 600 + (i % 3) * 100, h: 400, canRotate: true, label: '' }));
    const r = nest(parts, 2440, 1220, { kerf: 4, trim: 10 });
    expect(r.unplaced).toHaveLength(0);
    for (const s of r.sheets) {
      for (const a of s.placements) {
        expect(a.x).toBeGreaterThanOrEqual(10);
        expect(a.x + a.w).toBeLessThanOrEqual(2430 + 0.01);
        expect(a.y + a.h).toBeLessThanOrEqual(1210 + 0.01);
        for (const b of s.placements) {
          if (a === b) continue;
          const sep = a.x + a.w + 4 <= b.x + 0.01 || b.x + b.w + 4 <= a.x + 0.01 || a.y + a.h + 4 <= b.y + 0.01 || b.y + b.h + 4 <= a.y + 0.01;
          expect(sep).toBe(true);
        }
      }
    }
    const area = parts.reduce((s, p) => s + p.w * p.h, 0);
    expect(r.sheets.length).toBe(Math.ceil(area / (2440 * 1220)));
  });
  it('does not rotate grain-locked parts', () => {
    const r = nest([{ id: 'a', w: 2000, h: 300, canRotate: false, label: '' }], 2440, 1220);
    expect(r.sheets[0].placements[0].rotated).toBe(false);
    const big = nest([{ id: 'b', w: 300, h: 2000, canRotate: false, label: '' }], 2440, 1220);
    expect(big.unplaced).toHaveLength(1);
    const ok = nest([{ id: 'b', w: 300, h: 2000, canRotate: true, label: '' }], 2440, 1220);
    expect(ok.sheets[0].placements[0].rotated).toBe(true);
  });
});

function kitchen(): Project {
  const p = newProject('K');
  p.rooms.push(createRoom('Kitchen', templatePoints('rect', { width: 3000, length: 2500 })));
  p.modules.push(newModule('base', p, { x: 0, y: 0 }));
  p.modules.push(newModule('base', p, { x: 600, y: 0, width: 600 }));
  p.modules.push(newModule('wall', p, { x: 0, y: 0, elevation: 1450 }));
  return p;
}

describe('cut list', () => {
  it('merges identical panels in a module and totals edge banding', () => {
    const p = kitchen();
    const rows = buildCutList(p);
    const sides = rows.filter((r) => r.moduleId === p.modules[0].id && r.role === 'side');
    expect(sides).toHaveLength(1);
    expect(sides[0].qty).toBe(2);
    expect(sides[0].name).toBe('Side');
    const m = edgeMetres({ length: 1000, width: 500, edges: { L1: { thickness: 2, finish: '' }, L2: null, W1: { thickness: 2, finish: '' }, W2: { thickness: 0.8, finish: '' } } });
    expect(m.get(2)).toBeCloseTo(1.5);
    expect(m.get(0.8)).toBeCloseTo(0.5);
    const csv = cutListCsv(rows);
    expect(csv.split('\n')).toHaveLength(rows.length + 1);
  });
  it('groups sheets by material / thickness / finish', () => {
    const p = kitchen();
    const groups = optimiseSheets(p);
    const keys = groups.map((g) => g.key);
    expect(new Set(keys).size).toBe(keys.length);
    const totalParts = groups.reduce((s, g) => s + g.result.sheets.reduce((n, sh) => n + sh.placements.length, 0), 0);
    expect(totalParts).toBe(buildCutList(p).reduce((s, r) => s + r.qty, 0));
  });
  it('costs add up', () => {
    const p = kitchen();
    const c = estimateCost(p);
    const lines = c.lines.reduce((s, l) => s + l.amount, 0);
    expect(c.subtotal).toBeCloseTo(lines, 3);
    expect(c.total).toBeCloseTo(c.subtotal * 1.15, 3);
    const modSum = c.modules.reduce((s, m) => s + m.total, 0);
    // module totals = everything except the countertop
    expect(modSum).toBeCloseTo(c.subtotal - c.countertop, 0);
  });
});

describe('countertop', () => {
  it('merges a straight run and makes a sink cut-out', () => {
    const p = kitchen();
    p.appliances.push({ id: 's', type: 'sink-single', name: 'Sink', x: 600, y: 50, rotation: 0, elevation: 650, width: 600, height: 220, depth: 450 });
    const pieces = buildCountertop(p);
    expect(pieces).toHaveLength(1);
    expect(pieces[0].length).toBe(1200 + 20); // free right end gets side overhang; left is against the wall
    expect(pieces[0].depth).toBe(600);
    expect(pieces[0].cutouts).toHaveLength(1);
    expect(pieces[0].cutouts[0].u).toBe(900);
  });
  it('trims the shorter leg of an L into a butt joint', () => {
    const p = newProject('L');
    p.rooms.push(createRoom('Kitchen', templatePoints('rect', { width: 3000, length: 3000 })));
    // run along the top wall (rotation 0) from the left corner, 3 units
    for (let i = 0; i < 3; i++) p.modules.push(newModule('base', p, { x: i * 600, y: 0 }));
    // run down the left wall (rotation 90: width axis points down, front faces +x)
    for (let i = 0; i < 2; i++) p.modules.push(newModule('base', p, { x: 0, y: 580 + i * 600, rotation: 90 }));
    const pieces = buildCountertop(p);
    expect(pieces).toHaveLength(2);
    const [a, b] = [...pieces].sort((x, y) => y.length - x.length);
    expect(a.joints[0]).toMatch(/Butt joint/);
    expect(b.joints[0]).toMatch(/Butts against/);
    expect(a.length + b.length).toBeLessThan(1800 + 1780 + 40);
  });
});
