import { applianceDef } from './appliances';
import { moduleDef } from './furniture/modules';
import { serviceDef } from './catalog';
import { dist, dot, pointInPolygon } from './geometry';
import {
  axes,
  beamPolygon,
  clampOpening,
  columnPolygon,
  convexOverlap,
  findWall,
  footprint,
  localToPlan,
  planToLocal,
  pointOnWall,
  servicePosition,
  snapToWall,
  type Placed,
} from './structure';
import type { ApplianceInstance, ModuleInstance, Project, Vec2 } from './types';

export type TargetRef = { kind: 'module' | 'appliance' | 'service' | 'beam' | 'column' | 'opening'; id: string };

export interface Issue {
  id: string;
  severity: 'error' | 'warning' | 'info';
  message: string;
  targets: TargetRef[];
  at?: Vec2;
}

const zOverlap = (a0: number, a1: number, b0: number, b1: number, tol = 1) => a0 < b1 - tol && b0 < a1 - tol;

function openingZones(project: Project) {
  const out: { id: string; kind: 'door' | 'window' | 'opening'; poly: Vec2[]; z0: number; z1: number; label: string }[] = [];
  for (const o0 of project.openings) {
    const f = findWall(project, o0.wallId);
    if (!f) continue;
    const o = clampOpening(o0, f.length);
    const a = pointOnWall(f, o.offset);
    const b = pointOnWall(f, o.offset + o.width);
    if (o.kind === 'window') {
      const d = 150;
      out.push({ id: o.id, kind: 'window', poly: [a, b, add(b, f.inward, d), add(a, f.inward, d)], z0: o.sill, z1: o.sill + o.height, label: 'window' });
    } else {
      if (o.kind === 'door' && o.swing === 'out') {
        out.push({ id: o.id, kind: 'opening', poly: [a, b, add(b, f.inward, 300), add(a, f.inward, 300)], z0: 0, z1: o.height, label: 'doorway' });
        continue;
      }
      const d = o.kind === 'door' ? o.width : 600;
      out.push({ id: o.id, kind: o.kind, poly: [a, b, add(b, f.inward, d), add(a, f.inward, d)], z0: 0, z1: o.height, label: o.kind === 'door' ? 'door swing' : 'opening' });
    }
  }
  return out;
}

const add = (p: Vec2, d: Vec2, s: number) => ({ x: p.x + d.x * s, y: p.y + d.y * s });

export function detectClashes(project: Project): Issue[] {
  const issues: Issue[] = [];
  const push = (i: Omit<Issue, 'id'>) => issues.push({ ...i, id: `${i.targets.map((t) => t.id).join('-')}-${issues.length}` });
  const zones = openingZones(project);
  const rooms = project.rooms;

  const items: { kind: 'module' | 'appliance'; obj: ModuleInstance | ApplianceInstance; fp: Vec2[]; z0: number; z1: number; name: string }[] = [
    ...project.modules.map((m) => ({ kind: 'module' as const, obj: m, fp: footprint(m), z0: m.elevation, z1: m.elevation + m.height, name: m.name })),
    ...project.appliances.map((a) => ({ kind: 'appliance' as const, obj: a, fp: footprint(a), z0: a.elevation, z1: a.elevation + a.height, name: a.name })),
  ];

  for (const it of items) {
    const ref: TargetRef = { kind: it.kind, id: it.obj.id };
    const centre = localToPlan(it.obj, it.obj.width / 2, it.obj.depth / 2);
    const mdef = it.kind === 'module' ? moduleDef((it.obj as ModuleInstance).type) : null;
    const adef = it.kind === 'appliance' ? applianceDef((it.obj as ApplianceInstance).type) : null;
    const isWet = mdef?.id === 'sink-unit' || mdef?.id === 'vanity' || adef?.cutout?.kind === 'sink' || adef?.id === 'washer' || adef?.id === 'dishwasher' || adef?.id === 'purifier';

    // services covered
    for (const s of project.services) {
      const def = serviceDef(s.kind);
      if (def.mount === 'ceiling') continue;
      const p = servicePosition(project, s);
      const l = planToLocal(it.obj, p);
      if (l.u < -10 || l.u > it.obj.width + 10 || l.v < -80 || l.v > it.obj.depth + 10) continue;
      if (s.height < it.z0 - 10 || s.height > it.z1 + 10) continue;
      if (def.group === 'plumbing') {
        if (isWet && s.kind !== 'gas') continue;
        if (s.kind === 'gas' && (mdef?.kind === 'base' || adef?.cutout?.kind === 'hob')) continue;
        push({ severity: 'warning', message: `${it.name} blocks the ${def.name.toLowerCase()}`, targets: [ref, { kind: 'service', id: s.id }], at: p });
      } else {
        if (adef && (s.kind === 'socket' || s.kind === 'ac')) continue; // appliances plug in there
        push({ severity: 'warning', message: `${it.name} covers a ${def.name.toLowerCase()} at ${Math.round(s.height)} mm`, targets: [ref, { kind: 'service', id: s.id }], at: p });
      }
    }

    // beams
    for (const b of project.beams) {
      if (it.z1 <= b.bottom + 1) continue;
      if (convexOverlap(it.fp, beamPolygon(b), 1))
        push({ severity: 'error', message: `${it.name} hits a beam (beam underside ${Math.round(b.bottom)} mm, top of item ${Math.round(it.z1)} mm)`, targets: [ref, { kind: 'beam', id: b.id }], at: centre });
    }
    // columns
    for (const c of project.columns) {
      if (convexOverlap(it.fp, columnPolygon(c), 1)) push({ severity: 'error', message: `${it.name} overlaps a column`, targets: [ref, { kind: 'column', id: c.id }], at: centre });
    }
    // door swings / windows
    for (const z of zones) {
      if (!zOverlap(it.z0, it.z1, z.z0, z.z1)) continue;
      if (!convexOverlap(it.fp, z.poly, 1)) continue;
      push({ severity: z.kind === 'window' ? 'warning' : 'error', message: `${it.name} blocks the ${z.label}`, targets: [ref, { kind: 'opening', id: z.id }], at: centre });
    }
    // outside rooms / into walls
    if (rooms.length) {
      const inner = footprint(it.obj, -3);
      const inside = rooms.some((r) => inner.every((p) => pointInPolygon(p, r.points)));
      if (!inside) push({ severity: 'warning', message: `${it.name} sticks into a wall or outside the room`, targets: [ref], at: centre });
    }
  }

  // item vs item
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const A = items[i];
      const B = items[j];
      if (!zOverlap(A.z0, A.z1, B.z0, B.z1, 2)) continue;
      if (!convexOverlap(A.fp, B.fp, 2)) continue;
      // built-in / inset appliances are meant to sit inside cabinets
      const app = A.kind === 'appliance' ? A : B.kind === 'appliance' ? B : null;
      const other = app === A ? B : A;
      if (app && other.kind === 'module') {
        const d = applianceDef((app.obj as ApplianceInstance).type);
        if (d && (d.needsSpace || d.cutout || d.mount === 'counter')) continue;
      }
      if (app && other.kind === 'appliance') {
        const d1 = applianceDef((A.obj as ApplianceInstance).type);
        const d2 = applianceDef((B.obj as ApplianceInstance).type);
        if (d1?.mount === 'counter' || d2?.mount === 'counter') continue;
      }
      push({
        severity: 'error',
        message: `${A.name} overlaps ${B.name}`,
        targets: [
          { kind: A.kind, id: A.obj.id },
          { kind: B.kind, id: B.obj.id },
        ],
        at: localToPlan(A.obj, A.obj.width / 2, A.obj.depth / 2),
      });
    }
  }
  return issues;
}

/* ====================================================================== */
/*  Suggestions                                                           */
/* ====================================================================== */

export type SuggestionAction =
  | { type: 'move-module'; id: string; to: Placed }
  | { type: 'move-appliance'; id: string; to: Placed }
  | { type: 'add-appliance'; applianceType: string; at: Placed }
  | { type: 'add-module'; moduleType: string; at: Placed };

export interface Suggestion {
  id: string;
  message: string;
  action?: SuggestionAction;
  actionLabel?: string;
  targets: TargetRef[];
}

function sameRun(a: Placed, b: Placed) {
  if (Math.abs((((a.rotation - b.rotation) % 360) + 360) % 360) > 0.5) return false;
  const { uy } = axes(a.rotation);
  return Math.abs(dot({ x: a.x, y: a.y }, uy) - dot({ x: b.x, y: b.y }, uy)) < 30;
}

export function suggest(project: Project): Suggestion[] {
  const out: Suggestion[] = [];
  const water = project.services.filter((s) => s.kind === 'water-cold' || s.kind === 'water-hot' || s.kind === 'drain');
  const sinkUnits = project.modules.filter((m) => m.type === 'sink-unit');
  const sinks = project.appliances.filter((a) => applianceDef(a.type)?.cutout?.kind === 'sink');
  const hobs = project.appliances.filter((a) => a.type === 'hob');
  const hoods = project.appliances.filter((a) => a.type === 'hood');
  const centreOf = (p: Placed) => localToPlan(p, p.width / 2, p.depth / 2);

  // sink near water/drain
  for (const su of [...sinkUnits, ...sinks]) {
    if (!water.length) {
      out.push({ id: `nowater-${su.id}`, message: `Add water inlet and drain points near ${su.name} (Services step).`, targets: [] });
      continue;
    }
    const c = centreOf(su);
    let best = water[0];
    let bd = Infinity;
    for (const w of water) {
      const d = dist(servicePosition(project, w), c);
      if (d < bd) {
        bd = d;
        best = w;
      }
    }
    if (bd > 1200) {
      const target = snapToWall(project, su, servicePosition(project, best), 2000);
      const isModule = 'params' in su;
      out.push({
        id: `sinkfar-${su.id}`,
        message: `${su.name} is ${(bd / 1000).toFixed(1)} m from the nearest water/drain point — move it closer.`,
        action: target ? { type: isModule ? 'move-module' : 'move-appliance', id: su.id, to: target.placed } : undefined,
        actionLabel: 'Move to water point',
        targets: [{ kind: isModule ? 'module' : 'appliance', id: su.id }],
      });
    }
  }
  if (water.length && !sinkUnits.length && !sinks.length && project.modules.some((m) => moduleDef(m.type)?.category === 'kitchen')) {
    const w = water[0];
    const t = snapToWall(project, { x: 0, y: 0, rotation: 0, width: 900, depth: 580, height: 850, elevation: 0 }, servicePosition(project, w), 2000);
    out.push({
      id: 'addsink',
      message: 'There is a water point but no sink unit — place a sink unit there.',
      action: t ? { type: 'add-module', moduleType: 'sink-unit', at: t.placed } : undefined,
      actionLabel: 'Add sink unit',
      targets: [],
    });
  }

  // hood above hob
  for (const h of hobs) {
    const hc = centreOf(h);
    const hood = hoods.find((x) => dist(centreOf(x), hc) < x.width);
    const hoodW = 900;
    if (!hood) {
      const { ux } = axes(h.rotation);
      const back = localToPlan(h, h.width / 2, 0);
      const pos = localToPlan({ ...h, x: back.x, y: back.y }, -hoodW / 2, 0);
      const wallBack = snapToWall(project, { x: pos.x, y: pos.y, rotation: h.rotation, width: hoodW, depth: 480, height: 500, elevation: h.elevation + 750 }, back, 800);
      const at: Placed = wallBack?.placed ?? { x: back.x - ux.x * (hoodW / 2), y: back.y - ux.y * (hoodW / 2), rotation: h.rotation, width: hoodW, depth: 480, height: 500, elevation: h.elevation + 750 };
      out.push({ id: `hood-${h.id}`, message: `${h.name} has no chimney/hood above it.`, action: { type: 'add-appliance', applianceType: 'hood', at }, actionLabel: 'Add hood', targets: [{ kind: 'appliance', id: h.id }] });
    } else {
      const off = planToLocal(hood, hc).u - hood.width / 2;
      if (Math.abs(off) > 40) {
        const { ux } = axes(hood.rotation);
        out.push({
          id: `hoodalign-${hood.id}`,
          message: `${hood.name} is ${Math.round(Math.abs(off))} mm off-centre from ${h.name}.`,
          action: { type: 'move-appliance', id: hood.id, to: { ...hood, x: hood.x + ux.x * off, y: hood.y + ux.y * off } },
          actionLabel: 'Centre over hob',
          targets: [{ kind: 'appliance', id: hood.id }],
        });
      }
    }
    // gas near hob
    const gas = project.services.filter((s) => s.kind === 'gas');
    if (gas.length && Math.min(...gas.map((g) => dist(servicePosition(project, g), hc))) > 1500)
      out.push({ id: `gas-${h.id}`, message: `${h.name} is more than 1.5 m from the gas line.`, targets: [{ kind: 'appliance', id: h.id }] });
    // wall cabinet right above the hob
    for (const m of project.modules) {
      if (moduleDef(m.type)?.kind !== 'wall') continue;
      if (convexOverlap(footprint(m), footprint(h), 50) && m.elevation - h.elevation < 650)
        out.push({ id: `cab-hob-${m.id}`, message: `${m.name} is less than 650 mm above ${h.name} — leave room for the hood.`, targets: [{ kind: 'module', id: m.id }] });
    }
  }

  // tall units at the ends of a run
  const base = project.modules.filter((m) => ['base', 'tall'].includes(moduleDef(m.type)?.kind ?? '') && m.elevation < 300);
  for (const t of base.filter((m) => moduleDef(m.type)?.kind === 'tall')) {
    const run = base.filter((m) => m !== t && sameRun(m, t));
    const tu = planToLocal(t, { x: t.x, y: t.y }).u;
    const left = run.some((m) => Math.abs(planToLocal(t, { x: m.x, y: m.y }).u + m.width - tu) < 30);
    const right = run.some((m) => Math.abs(planToLocal(t, { x: m.x, y: m.y }).u - (tu + t.width)) < 30);
    if (left && right) out.push({ id: `tall-${t.id}`, message: `${t.name} interrupts the worktop — tall units work best at the ends of a run.`, targets: [{ kind: 'module', id: t.id }] });
  }

  // sockets above counter
  if (base.length && !project.services.some((s) => s.kind === 'socket' && s.height > 900 && s.height < 1400))
    out.push({ id: 'sockets', message: 'No sockets above the worktop (1000–1200 mm) — add a few for small appliances.', targets: [] });

  // fridge next to hob
  for (const f of project.appliances.filter((a) => a.type === 'fridge'))
    for (const h of hobs)
      if (dist(centreOf(f), centreOf(h)) < (f.width + h.width) / 2 + 150)
        out.push({ id: `fridge-${f.id}`, message: `${f.name} is right next to ${h.name}; keep at least one cabinet between them.`, targets: [{ kind: 'appliance', id: f.id }] });

  return out;
}
