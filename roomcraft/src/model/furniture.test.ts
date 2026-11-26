import { buildModule, newModule, hingesForDoor, mapEdges, MODULES } from './furniture';
import { newProject } from './room';
import type { ModuleInstance, Project } from './types';
import type { Panel } from './furniture';

const project = (): Project => newProject('T');
const byKey = (ps: Panel[], k: string) => ps.find((p) => p.key === k)!;
const band = { thickness: 0.8, finish: 'x' };

describe('edge mapping', () => {
  it('maps physical sides to L/W edges', () => {
    // side panel: thickness x, grain along z (length), width along y
    const e = mapEdges('z', 'y', ['front'], band, null);
    expect(e.L1).toEqual(band);
    expect(e.L2 || e.W1 || e.W2).toBeNull();
    const e2 = mapEdges('x', 'y', ['left', 'right'], band, null);
    expect(e2.W1 && e2.W2).toBeTruthy();
  });
});

describe('base cabinet', () => {
  const p = project();
  const m = newModule('base', p, { width: 600, height: 850, depth: 580 });
  const b = buildModule(m, p);
  it('builds a carcass sized from its parameters', () => {
    const side = byKey(b.panels, 'side-l');
    // carcass on a 100 mm plinth, 18 mm doors in front, 6 mm back
    expect(side.thickness).toBe(18);
    expect(side.box.dz).toBe(750);
    expect(side.box.dy).toBe(580 - 18 - 6);
    const bottom = byKey(b.panels, 'bottom');
    expect(bottom.box.dx).toBe(600 - 36);
    expect(byKey(b.panels, 'back').thickness).toBe(6);
  });
  it('has one overlay door with gaps and hinges by height', () => {
    const doors = b.panels.filter((x) => x.role === 'door');
    expect(doors).toHaveLength(1);
    expect(doors[0].box.dx).toBe(600 - 6);
    expect(doors[0].box.dz).toBe(750 - 6);
    expect(b.hardware.find((h) => h.id === 'hinge-soft')?.qty).toBe(2);
    expect(b.hardware.find((h) => h.id === 'leg')?.qty).toBe(4);
  });
  it('subtracts thick edge banding from cut sizes', () => {
    const door = b.panels.find((x) => x.role === 'door')!;
    expect(door.cutLength).toBe(door.length - 4);
    expect(door.cutWidth).toBe(door.width - 4);
    const side = byKey(b.panels, 'side-l');
    expect(side.cutWidth).toBe(side.width); // 0.8 mm tape is not deducted
  });
  it('wide base cabinets get two doors', () => {
    const w = buildModule(newModule('base', p, { width: 900 }), p);
    expect(w.panels.filter((x) => x.role === 'door')).toHaveLength(2);
    expect(w.hardware.find((h) => h.id === 'leg')?.qty).toBe(6);
  });
});

describe('board thickness overrides', () => {
  it('global → module → panel', () => {
    const p = project();
    p.settings.board.thickness = 16;
    const m = newModule('base', p);
    expect(byKey(buildModule(m, p).panels, 'side-l').thickness).toBe(16);
    const m2: ModuleInstance = { ...m, board: { thickness: 25 } };
    expect(byKey(buildModule(m2, p).panels, 'side-l').thickness).toBe(25);
    const m3: ModuleInstance = { ...m2, panelOverrides: { 'side-l': { thickness: 12 } } };
    const b3 = buildModule(m3, p);
    expect(byKey(b3.panels, 'side-l').thickness).toBe(12);
    expect(byKey(b3.panels, 'side-r').thickness).toBe(25);
    // the bottom shortens/lengthens to fit between sides of different thickness
    expect(byKey(b3.panels, 'bottom').box.dx).toBe(600 - 12 - 25);
  });
});

describe('drawers and wardrobe', () => {
  it('drawer unit has fronts, boxes and slides', () => {
    const p = project();
    const b = buildModule(newModule('drawer-unit', p), p);
    expect(b.panels.filter((x) => x.role === 'drawer-front')).toHaveLength(3);
    expect(b.panels.filter((x) => x.role === 'drawer-bottom')).toHaveLength(3);
    expect(b.hardware.find((h) => h.id === 'slide-tandem')?.qty).toBe(3);
    expect(b.hardware.find((h) => h.id === 'hinge-soft')).toBeUndefined();
  });
  it('wardrobe sections produce rods, partitions and loft doors', () => {
    const p = project();
    const b = buildModule(newModule('wardrobe', p), p);
    expect(b.panels.filter((x) => x.role === 'partition')).toHaveLength(2);
    expect(b.hardware.find((h) => h.id === 'wardrobe-rod')?.qty).toBe(1);
    expect(b.panels.filter((x) => x.key.startsWith('loft-door'))).toHaveLength(3);
    // 2019 mm hinged doors → 5 hinges each; 3 doors + 3 loft doors (2 each)
    expect(b.hardware.find((h) => h.id === 'hinge-soft')?.qty).toBe(3 * hingesForDoor(2100 - 75 - 6) + 3 * 2);
  });
  it('sliding wardrobe uses tracks, not hinges', () => {
    const p = project();
    const m = newModule('wardrobe', p);
    m.params.doorType = 'sliding';
    m.params.loft = 0;
    const b = buildModule(m, p);
    expect(b.hardware.find((h) => h.id === 'sliding-track')?.qty).toBe(3);
    expect(b.hardware.find((h) => h.id === 'hinge-soft')).toBeUndefined();
  });
});

describe('every module type builds valid panels', () => {
  for (const def of MODULES) {
    it(def.id, () => {
      const p = project();
      const b = buildModule(newModule(def.id, p), p);
      expect(b.panels.length).toBeGreaterThan(2);
      for (const pn of b.panels) {
        expect(pn.length).toBeGreaterThan(0);
        expect(pn.width).toBeGreaterThan(0);
        expect(pn.length >= pn.width || pn.grain === 'length').toBe(true);
        // panels stay inside the module envelope (mirror backing on dressing tables rises above)
        expect(pn.box.x).toBeGreaterThanOrEqual(-0.01);
        expect(pn.box.x + pn.box.dx).toBeLessThanOrEqual(def.size.width + 0.01);
        expect(pn.box.y + pn.box.dy).toBeLessThanOrEqual(def.size.depth + 0.01);
      }
      expect(new Set(b.panels.map((x) => x.key)).size).toBe(b.panels.length);
    });
  }
});

describe('appliance spaces', () => {
  it('an oven in a tall unit removes doors/shelves in its zone and adds a support shelf', () => {
    const p = project();
    const m = newModule('tall', p, { x: 0, y: 0 });
    m.params.split = 0;
    p.modules.push(m);
    p.appliances.push({ id: 'ov', type: 'oven', name: 'Oven', x: 2, y: 0, rotation: 0, elevation: 850, width: 595, height: 595, depth: 560 });
    const b = buildModule(m, p);
    expect(b.panels.some((x) => x.name.startsWith('Shelf under Oven'))).toBe(true);
    const shelvesInZone = b.panels.filter((x) => x.role === 'shelf' && x.note === 'Adjustable' && x.box.z > 850 && x.box.z < 850 + 595);
    expect(shelvesInZone).toHaveLength(0);
    expect(b.panels.filter((x) => x.role === 'door')).toHaveLength(0);
  });
});
