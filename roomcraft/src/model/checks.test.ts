import { detectClashes, suggest } from './checks';
import { newModule } from './furniture';
import { createRoom, newProject, templatePoints } from './room';

function room() {
  const p = newProject('C');
  p.rooms.push(createRoom('Kitchen', templatePoints('rect', { width: 4000, length: 3000 })));
  return p;
}
const topWall = (p: ReturnType<typeof room>) => p.rooms[0].walls[p.rooms[0].points.findIndex((q, i) => q.y === 0 && p.rooms[0].points[(i + 1) % 4].y === 0)];

describe('clash detection', () => {
  it('flags a cabinet covering a socket and a door swing, but not a sink unit over water', () => {
    const p = room();
    const w = topWall(p);
    p.modules.push(newModule('base', p, { x: 0, y: 0 }));
    p.services.push({ id: 's1', kind: 'socket', wallId: w.id, offset: 300, x: 0, y: 0, height: 300 });
    p.services.push({ id: 'w1', kind: 'water-cold', wallId: w.id, offset: 2300, x: 0, y: 0, height: 450 });
    p.modules.push(newModule('sink-unit', p, { x: 2000, y: 0 }));
    p.openings.push({ id: 'd1', wallId: w.id, kind: 'door', offset: 3000, width: 800, height: 2100, sill: 0, hinge: 'left', swing: 'in' });
    p.modules.push(newModule('base', p, { x: 3200, y: 0, width: 600 }));
    const msgs = detectClashes(p).map((i) => i.message);
    expect(msgs.some((m) => /covers a socket/.test(m))).toBe(true);
    expect(msgs.some((m) => /water/.test(m))).toBe(false);
    expect(msgs.some((m) => /door swing/.test(m))).toBe(true);
  });
  it('flags beams, columns and overlaps', () => {
    const p = room();
    p.modules.push(newModule('tall', p, { x: 0, y: 0 }));
    p.beams.push({ id: 'b', a: { x: 0, y: 300 }, b: { x: 4000, y: 300 }, width: 230, depth: 450, bottom: 2000 });
    p.columns.push({ id: 'c', x: 2000, y: 200, width: 300, depth: 300, rotation: 0, height: 3000 });
    p.modules.push(newModule('base', p, { x: 1800, y: 0 }));
    p.modules.push(newModule('base', p, { x: 2100, y: 0 }));
    const msgs = detectClashes(p).map((i) => i.message);
    expect(msgs.some((m) => /hits a beam/.test(m))).toBe(true);
    expect(msgs.some((m) => /column/.test(m))).toBe(true);
    expect(msgs.some((m) => /overlaps Base/.test(m))).toBe(true);
  });
});

describe('suggestions', () => {
  it('suggests a hood above a hob and moving a far-away sink', () => {
    const p = room();
    const w = topWall(p);
    p.modules.push(newModule('sink-unit', p, { x: 3000, y: 0 }));
    p.services.push({ id: 'w1', kind: 'water-cold', wallId: w.id, offset: 300, x: 0, y: 0, height: 450 });
    p.appliances.push({ id: 'h', type: 'hob', name: 'Hob', x: 1000, y: 30, rotation: 0, elevation: 840, width: 750, height: 60, depth: 520 });
    const s = suggest(p);
    const hood = s.find((x) => x.action?.type === 'add-appliance');
    expect(hood).toBeTruthy();
    const move = s.find((x) => x.action?.type === 'move-module');
    expect(move).toBeTruthy();
    if (move?.action?.type === 'move-module') expect(move.action.to.x).toBeLessThan(800);
  });
});
