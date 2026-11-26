import { createRoom, newProject, templatePoints } from './room';
import { newModule } from './furniture';
import { localToPlan } from './structure';
import { uid } from './ids';
import type { ApplianceInstance, ModuleInstance, Project, ServiceKind } from './types';
import { applianceDef } from './appliances';

/** A ready-made L-shaped kitchen that exercises every feature. */
export function sampleKitchen(): Project {
  const p = newProject('Sample L-kitchen');
  const room = createRoom('Kitchen', templatePoints('rect', { width: 3600, length: 3000 }));
  p.rooms.push(room);
  const wallAt = (pred: (a: { x: number; y: number }, b: { x: number; y: number }) => boolean) => {
    const n = room.points.length;
    const i = room.points.findIndex((a, k) => pred(a, room.points[(k + 1) % n]));
    return room.walls[i].id;
  };
  const top = wallAt((a, b) => a.y === 0 && b.y === 0);
  const right = wallAt((a, b) => a.x === 3600 && b.x === 3600);
  const bottom = wallAt((a, b) => a.y === 3000 && b.y === 3000);
  const left = wallAt((a, b) => a.x === 0 && b.x === 0);

  const mod = (type: string, at: Partial<ModuleInstance>) => {
    const m = newModule(type, p, at);
    p.modules.push(m);
    return m;
  };
  const app = (type: string, host: { x: number; y: number; rotation: number }, u: number, v: number, extra: Partial<ApplianceInstance> = {}) => {
    const d = applianceDef(type)!;
    const o = localToPlan({ ...host, width: 0, depth: 0, height: 0, elevation: 0 }, u, v);
    const a: ApplianceInstance = { id: uid('app'), type, name: d.name, x: o.x, y: o.y, rotation: host.rotation, elevation: d.elevation, width: d.width, height: d.height, depth: d.depth, ...extra };
    p.appliances.push(a);
    return a;
  };

  // top wall (rotation 0): fridge | tall (oven) | drawers | sink | blind corner
  app('fridge', { x: 0, y: 0, rotation: 0 }, 0, 0);
  const tall = mod('tall', { x: 700, y: 0, name: 'Oven tower' });
  tall.params.split = 0;
  mod('drawer-unit', { x: 1300, y: 0 });
  const sinkU = mod('sink-unit', { x: 1900, y: 0, width: 700 });
  mod('corner', { x: 2600, y: 0, mirrored: true });
  app('oven', tall, 2.5, 20, { elevation: 850 });
  app('sink-single', sinkU, 50, 60, { elevation: 650 });
  mod('wall', { x: 1300, y: 0, elevation: 1450, width: 500, name: 'Wall cabinet 1' });
  mod('open-shelf', { x: 2700, y: 0, elevation: 1550, width: 900, name: 'Open shelf' });

  // right wall (rotation 90): hob drawers | base, wall cabinets + hood above
  const R = { x: 3600, y: 0, rotation: 90 };
  const at = (u: number) => localToPlan({ ...R, width: 0, depth: 0, height: 0, elevation: 0 }, u, 0);
  const hobU = mod('drawer-unit', { ...at(600), rotation: 90, name: 'Hob drawers' });
  mod('base', { ...at(1200), rotation: 90 });
  mod('base', { ...at(1800), rotation: 90, width: 450 });
  app('hob', hobU, 0, 40, { width: 600, elevation: 830 });
  app('hood', R, 600, 0, { width: 600, elevation: 1600 });
  mod('wall', { ...at(1200), rotation: 90, elevation: 1450 });
  mod('wall', { ...at(1800), rotation: 90, elevation: 1450, width: 450, params: { doors: 1, shelves: 2, liftUp: true, backThickness: '6' } });
  app('kettle', hobU, 0, 0, {});
  p.appliances.pop(); // keep the worktop clear in the sample

  // openings
  p.openings.push({ id: uid('op'), wallId: top, kind: 'window', offset: 1800, width: 900, height: 1100, sill: 1050, hinge: 'left', swing: 'in' });
  p.openings.push({ id: uid('op'), wallId: bottom, kind: 'door', offset: 1300, width: 900, height: 2100, sill: 0, hinge: 'left', swing: 'in' });

  // services
  const svc = (kind: ServiceKind, wallId: string | null, offset: number, height: number, x = 0, y = 0) =>
    p.services.push({ id: uid('svc'), kind, wallId, offset, x, y, height });
  svc('water-cold', top, 2150, 450);
  svc('water-hot', top, 2350, 450);
  svc('drain', top, 2250, 150);
  svc('gas', right, 900, 600);
  svc('socket', top, 1600, 1100);
  svc('socket', right, 1500, 1100);
  svc('socket', top, 350, 300);
  svc('socket', right, 900, 2100);
  svc('switch', bottom, 1100, 1200);
  svc('light', null, 0, 3000, 1800, 1500);
  svc('ac', left, 1500, 2400);

  p.beams.push({ id: uid('beam'), a: { x: 0, y: 1500 }, b: { x: 3600, y: 1500 }, width: 230, depth: 400, bottom: 2600 });
  p.columns.push({ id: uid('col'), x: 150, y: 2850, width: 300, depth: 300, rotation: 0, height: 3000 });
  return p;
}
