/**
 * Parametric furniture engine.
 *
 * A module definition (see modules.ts) declares its size limits, editable parameters
 * and a `build` recipe that adds panels via the helper context below. The engine turns
 * those into plain-JSON `Panel` records (sizes, material, finish, edge banding, grain)
 * plus an auto-counted hardware list. Adding a new furniture type = adding one definition.
 *
 * Module-local coordinates (mm):  x → across the width (left→right seen from the front),
 *                                 y → depth (0 = back, D = front face of the doors),
 *                                 z → up from the module's bottom.
 */
import type {
  ApplianceInstance,
  BoardMaterialId,
  EdgeBand,
  HandleStyle,
  ModuleInstance,
  PanelEdges,
  ParamValue,
  Project,
} from '../types';
import { finishById, HANDLE_STYLES } from '../catalog';
import { applianceDef } from '../appliances';
import { convexOverlap, footprint, planToLocal } from '../structure';

export type Axis = 'x' | 'y' | 'z';
export type Side = 'left' | 'right' | 'back' | 'front' | 'bottom' | 'top';

export type PanelRole =
  | 'side'
  | 'bottom'
  | 'top'
  | 'rail'
  | 'back'
  | 'shelf'
  | 'partition'
  | 'plinth'
  | 'door'
  | 'drawer-front'
  | 'drawer-side'
  | 'drawer-back'
  | 'drawer-bottom'
  | 'filler'
  | 'worktop'
  | 'deck';

export interface Box {
  x: number;
  y: number;
  z: number;
  dx: number;
  dy: number;
  dz: number;
}

export interface Panel {
  key: string;
  name: string;
  role: PanelRole;
  box: Box;
  thicknessAxis: Axis;
  /** Finished sizes: length runs along the grain (or the longer side when there is no grain). */
  length: number;
  width: number;
  thickness: number;
  /** Cut sizes = finished size minus edge band thickness on banded edges. */
  cutLength: number;
  cutWidth: number;
  material: BoardMaterialId;
  finish: string;
  grain: 'length' | 'none';
  edges: PanelEdges;
  isFront: boolean;
  hinge?: 'left' | 'right' | 'top' | 'bottom';
  note?: string;
}

export interface HardwareLine {
  id: string;
  qty: number;
  note?: string;
}

export interface HandleMark {
  /** module-local centre of the handle on the front face */
  x: number;
  z: number;
  y: number;
  orient: 'h' | 'v';
  length: number;
}

export interface ModuleBuild {
  panels: Panel[];
  hardware: HardwareLine[];
  handles: HandleMark[];
  notes: string[];
}

export type ParamSpec =
  | { key: string; label: string; type: 'int'; min: number; max: number; default: number; help?: string }
  | { key: string; label: string; type: 'length'; min: number; max: number; default: number; help?: string }
  | { key: string; label: string; type: 'bool'; default: boolean; help?: string }
  | { key: string; label: string; type: 'select'; options: { value: string; label: string }[]; default: string; help?: string }
  | { key: string; label: string; type: 'sections'; options: { value: string; label: string }[]; default: string[]; help?: string };

export type ModuleKind = 'base' | 'wall' | 'tall' | 'free';

export interface ModuleDef {
  id: string;
  name: string;
  category: 'kitchen' | 'wardrobe' | 'room';
  kind: ModuleKind;
  icon: string;
  size: { width: number; height: number; depth: number; elevation: number };
  limits: { minW: number; maxW: number; minH: number; maxH: number; minD: number; maxD: number };
  params: ParamSpec[];
  /** Optional default board material (e.g. BWP for wet areas). */
  material?: BoardMaterialId;
  build: (c: BuildCtx) => void;
}

/* ====================================================================== */

export interface PanelSpec {
  key: string;
  name: string;
  role: PanelRole;
  box: Box;
  /** axis of the board's thickness */
  axis: Axis;
  /** axis the grain should run along (defaults: vertical for upright panels, x for horizontal) */
  grainAxis?: Axis;
  /** which edges get banding */
  band?: Side[] | 'all';
  hinge?: Panel['hinge'];
  note?: string;
}

export interface BuildCtx {
  W: number;
  H: number;
  D: number;
  p: Record<string, ParamValue>;
  mirrored: boolean;
  handle: HandleStyle;
  /** thickness for a panel key (respects per-panel → per-module → project overrides) */
  t: (key?: string) => number;
  /** thin back/bottom thickness */
  tb: (key?: string) => number;
  panel: (s: PanelSpec) => void;
  hw: (id: string, qty: number, note?: string) => void;
  note: (s: string) => void;
  num: (k: string) => number;
  bool: (k: string) => boolean;
  str: (k: string) => string;
  list: (k: string) => string[];
}

const DOOR_GAP = 3; // between/around fronts
const SIDE_ORDER: Axis[] = ['x', 'y', 'z'];

export function hingesForDoor(height: number): number {
  if (height <= 900) return 2;
  if (height <= 1600) return 3;
  if (height <= 2000) return 4;
  return 5;
}

const dimOf = (b: Box, a: Axis) => (a === 'x' ? b.dx : a === 'y' ? b.dy : b.dz);
const sideAxis = (s: Side): Axis => (s === 'left' || s === 'right' ? 'x' : s === 'back' || s === 'front' ? 'y' : 'z');
const sideIsMax = (s: Side) => s === 'right' || s === 'front' || s === 'top';

/**
 * Map physical sides to cut-list edges. L edges run along the length axis (L1 at the max
 * side of the width axis, L2 at the min side); W edges run along the width axis.
 */
export function mapEdges(lengthAxis: Axis, widthAxis: Axis, banded: Side[], carcass: EdgeBand, front: EdgeBand | null): PanelEdges {
  const e: PanelEdges = { L1: null, L2: null, W1: null, W2: null };
  for (const s of banded) {
    const ax = sideAxis(s);
    const band = front ?? carcass;
    if (ax === widthAxis) e[sideIsMax(s) ? 'L1' : 'L2'] = band;
    else if (ax === lengthAxis) e[sideIsMax(s) ? 'W1' : 'W2'] = band;
  }
  return e;
}

/** Find appliances that sit inside a module and return their module-local regions. */
export function applianceRegions(m: ModuleInstance, appliances: ApplianceInstance[]) {
  const fp = footprint(m);
  const out: { app: ApplianceInstance; kind: 'space' | 'sink' | 'hob'; x0: number; x1: number; z0: number; z1: number }[] = [];
  for (const a of appliances) {
    const def = applianceDef(a.type);
    if (!def) continue;
    if (!def.needsSpace && !def.cutout) continue;
    if (!convexOverlap(fp, footprint(a), 20)) continue;
    const c1 = planToLocal(m, { x: a.x, y: a.y });
    const c2 = planToLocal(m, footprint(a)[2]);
    const x0 = Math.max(0, Math.min(c1.u, c2.u));
    const x1 = Math.min(m.width, Math.max(c1.u, c2.u));
    const z0 = a.elevation - m.elevation;
    const z1 = z0 + a.height;
    if (def.needsSpace) {
      if (z1 <= 0 || z0 >= m.height) continue;
      out.push({ app: a, kind: 'space', x0, x1, z0: Math.max(0, z0), z1: Math.min(m.height, z1) });
    } else if (def.cutout && m.elevation < 1200) {
      out.push({ app: a, kind: def.cutout.kind, x0, x1, z0, z1 });
    }
  }
  return out;
}

/* ====================================================================== */

export function generateModule(m: ModuleInstance, def: ModuleDef, project: Project): ModuleBuild {
  const s = project.settings;
  const panels: Panel[] = [];
  const hwMap = new Map<string, HardwareLine>();
  const notes: string[] = [];
  const handles: HandleMark[] = [];

  const params: Record<string, ParamValue> = {};
  for (const ps of def.params) params[ps.key] = m.params[ps.key] ?? ps.default;

  const moduleThickness = m.board?.thickness ?? s.board.thickness;
  const t = (key?: string) => (key && m.panelOverrides[key]?.thickness) || moduleThickness;
  const tb = (key?: string) => (key && m.panelOverrides[key]?.thickness) || Number(params.backThickness ?? 6) || 6;

  const handleDef = HANDLE_STYLES.find((h) => h.id === m.handle);

  const ctx: BuildCtx = {
    W: m.width,
    H: m.height,
    D: m.depth,
    p: params,
    mirrored: !!m.mirrored,
    handle: m.handle,
    t,
    tb,
    num: (k) => Number(params[k]),
    bool: (k) => !!params[k],
    str: (k) => String(params[k]),
    list: (k) => (Array.isArray(params[k]) ? (params[k] as string[]) : []),
    note: (n) => notes.push(n),
    hw: (id, qty, note) => {
      if (!qty) return;
      const cur = hwMap.get(id);
      if (cur) cur.qty += qty;
      else hwMap.set(id, { id, qty, note });
    },
    panel: (ps) => {
      const ov = m.panelOverrides[ps.key] ?? {};
      const isFront = ps.role === 'door' || ps.role === 'drawer-front';
      const finish = ov.finish ?? (isFront ? m.frontFinish ?? s.frontFinish : m.board?.finish ?? s.board.finish);
      const material = ov.material ?? m.board?.material ?? def.material ?? s.board.material;
      const thickness = dimOf(ps.box, ps.axis);
      const inPlane = SIDE_ORDER.filter((a) => a !== ps.axis);
      const f = finishById(finish);
      let grain: Panel['grain'] = f.grain ? 'length' : 'none';
      if (ov.grain === 'none') grain = 'none';
      let lengthAxis: Axis;
      if (grain === 'length') {
        const ga = ps.grainAxis && ps.grainAxis !== ps.axis ? ps.grainAxis : inPlane.includes('z') ? 'z' : 'x';
        lengthAxis = ov.grain === 'width' ? inPlane.find((a) => a !== ga)! : ga;
      } else {
        lengthAxis = dimOf(ps.box, inPlane[0]) >= dimOf(ps.box, inPlane[1]) ? inPlane[0] : inPlane[1];
      }
      const widthAxis = inPlane.find((a) => a !== lengthAxis)!;
      const banded: Side[] =
        ps.band === 'all'
          ? (['left', 'right', 'back', 'front', 'bottom', 'top'] as Side[]).filter((sd) => sideAxis(sd) !== ps.axis)
          : ps.band ?? [];
      const frontBand = isFront ? { ...s.frontEdge, finish } : null;
      const edges = mapEdges(lengthAxis, widthAxis, banded, { ...s.carcassEdge, finish }, frontBand);
      if (ov.edges) Object.assign(edges, ov.edges);
      const length = dimOf(ps.box, lengthAxis);
      const width = dimOf(ps.box, widthAxis);
      const bt = (e: EdgeBand | null) => (e && e.thickness >= 1 ? e.thickness : 0); // thin tapes are not deducted
      panels.push({
        key: ps.key,
        name: ps.name,
        role: ps.role,
        box: ps.box,
        thicknessAxis: ps.axis,
        length: round1(length),
        width: round1(width),
        thickness,
        cutLength: round1(length - bt(edges.W1) - bt(edges.W2)),
        cutWidth: round1(width - bt(edges.L1) - bt(edges.L2)),
        material,
        finish,
        grain,
        edges,
        isFront,
        hinge: ps.hinge,
        note: ps.note,
      });
    },
  };

  def.build(ctx);

  /* ---- appliance spaces & cut-outs ---- */
  const regions = applianceRegions(m, project.appliances);
  for (const r of regions) {
    if (r.kind === 'space') {
      const hits = (p: Panel) =>
        ['door', 'drawer-front', 'drawer-side', 'drawer-back', 'drawer-bottom', 'shelf'].includes(p.role) &&
        p.box.z < r.z1 - 5 &&
        p.box.z + p.box.dz > r.z0 + 5 &&
        p.box.x < r.x1 - 5 &&
        p.box.x + p.box.dx > r.x0 + 5;
      const removed = panels.filter(hits);
      for (const p of removed) panels.splice(panels.indexOf(p), 1);
      const drawersRemoved = removed.filter((p) => p.role === 'drawer-front');
      if (drawersRemoved.length) ctx.hw('slide-tandem', -drawersRemoved.length);
      const shelvesRemoved = removed.filter((p) => p.role === 'shelf' && p.note !== 'Fixed').length;
      if (shelvesRemoved) ctx.hw('shelf-support', -4 * shelvesRemoved);
      const T = t('appliance-shelf');
      const zShelf = Math.max(T, r.z0 - T);
      ctx.panel({
        key: `appliance-shelf-${r.app.id.slice(-4)}`,
        name: `Shelf under ${r.app.name}`,
        role: 'shelf',
        box: { x: T, y: tb(), z: zShelf, dx: m.width - 2 * T, dy: m.depth - t() - tb(), dz: T },
        axis: 'z',
        band: ['front'],
        note: 'Fixed shelf (appliance support)',
      });
      notes.push(`Opening for ${r.app.name} (${Math.round(r.z1 - r.z0)} mm high)`);
    } else if (r.kind === 'sink') {
      const shelves = panels.filter((p) => p.role === 'shelf');
      for (const p of shelves) panels.splice(panels.indexOf(p), 1);
      ctx.hw('shelf-support', -4 * shelves.filter((p) => p.note !== 'Fixed').length);
      notes.push('Sink above: shelves removed for plumbing; keep base in BWP/waterproof board');
    } else if (r.kind === 'hob') {
      notes.push('Hob above: keep 50 mm clear under the worktop for the burner body');
    }
  }

  /* ---- fronts: hinges, handles ---- */
  const fronts = panels.filter((p) => p.isFront);
  for (const f of fronts) {
    if (f.role === 'door' && f.hinge !== 'bottom') {
      if (!(params.doorType === 'sliding')) {
        ctx.hw('hinge-soft', f.hinge === 'top' ? 2 : hingesForDoor(f.box.dz));
      }
    }
    if (handleDef?.hardware) ctx.hw(handleDef.hardware, 1);
    const b = f.box;
    const y = b.y + b.dy;
    if (m.handle === 'push' || m.handle === 'gola') continue;
    const high = m.elevation > 1200; // wall units: grip at the bottom edge
    if (m.handle === 'profile') {
      // aluminium profile along the opening edge
      const zz = f.hinge === 'top' || high ? b.z + 12 : b.z + b.dz - 12;
      handles.push({ x: b.x + b.dx / 2, z: zz, y, orient: 'h', length: Math.max(40, b.dx - 30) });
      continue;
    }
    const len = m.handle === 'knob' ? 30 : Math.min(160, Math.max(60, b.dx * 0.4));
    if (f.role === 'drawer-front' || f.hinge === 'top' || f.hinge === 'bottom') {
      const zz = f.hinge === 'top' ? b.z + 40 : f.hinge === 'bottom' ? b.z + b.dz - 40 : b.z + b.dz / 2 + Math.min(b.dz / 2 - 30, 40);
      handles.push({ x: b.x + b.dx / 2, z: zz, y, orient: 'h', length: len });
    } else {
      const x = f.hinge === 'left' ? b.x + b.dx - 40 : b.x + 40;
      const target = high ? b.z + 60 + len / 2 : b.dz > 1200 ? 1050 - m.elevation : b.z + b.dz - 60 - len / 2;
      const z = Math.max(b.z + len / 2 + 20, Math.min(b.z + b.dz - len / 2 - 20, target));
      handles.push({ x, z, y, orient: 'v', length: m.handle === 'knob' ? 30 : len });
    }
  }

  const hardware = [...hwMap.values()].filter((h) => h.qty > 0);
  return { panels, hardware, handles, notes };
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/* ====================================================================== */
/*  Reusable construction helpers (used by module definitions)            */
/* ====================================================================== */

export interface CarcassOpts {
  plinth?: number;
  top?: 'full' | 'rails' | 'none';
  bottom?: boolean;
  back?: boolean;
  /** depth reserved in front of the carcass for doors (defaults to door thickness) */
  frontDepth?: number;
}

export interface Interior {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  y0: number; // behind (front of back panel)
  y1: number; // front of carcass
  /** outer front area for overlay doors */
  fx0: number;
  fx1: number;
  fz0: number;
  fz1: number;
}

/** Standard box: two sides, bottom, top (or rails), back, optional plinth. */
export function carcass(c: BuildCtx, o: CarcassOpts = {}): Interior {
  const { W, H, D } = c;
  const plinth = o.plinth ?? 0;
  const front = o.frontDepth ?? c.t('door');
  const back = o.back !== false;
  const TB = back ? c.tb('back') : 0;
  const Dc = D - front; // carcass depth incl. back
  const z0 = plinth;
  const ts = c.t('side-l');
  const tr = c.t('side-r');
  c.panel({ key: 'side-l', name: 'Left side', role: 'side', box: { x: 0, y: TB, z: z0, dx: ts, dy: Dc - TB, dz: H - z0 }, axis: 'x', band: ['front'] });
  c.panel({ key: 'side-r', name: 'Right side', role: 'side', box: { x: W - tr, y: TB, z: z0, dx: tr, dy: Dc - TB, dz: H - z0 }, axis: 'x', band: ['front'] });
  let zb = z0;
  if (o.bottom !== false) {
    const tbt = c.t('bottom');
    c.panel({ key: 'bottom', name: 'Bottom', role: 'bottom', box: { x: ts, y: TB, z: z0, dx: W - ts - tr, dy: Dc - TB, dz: tbt }, axis: 'z', band: ['front'] });
    zb = z0 + tbt;
  }
  let zt = H;
  const top = o.top ?? 'full';
  if (top === 'full') {
    const tt = c.t('top');
    c.panel({ key: 'top', name: 'Top', role: 'top', box: { x: ts, y: TB, z: H - tt, dx: W - ts - tr, dy: Dc - TB, dz: tt }, axis: 'z', band: ['front'] });
    zt = H - tt;
  } else if (top === 'rails') {
    const tt = c.t('rail-f');
    c.panel({ key: 'rail-f', name: 'Top rail (front)', role: 'rail', box: { x: ts, y: Dc - 100, z: H - tt, dx: W - ts - tr, dy: 100, dz: tt }, axis: 'z', band: ['front'] });
    c.panel({ key: 'rail-b', name: 'Top rail (back)', role: 'rail', box: { x: ts, y: TB, z: H - tt, dx: W - ts - tr, dy: 100, dz: tt }, axis: 'z' });
    zt = H - tt;
  }
  if (back) {
    c.panel({ key: 'back', name: 'Back', role: 'back', box: { x: 0, y: 0, z: z0, dx: W, dy: TB, dz: H - z0 }, axis: 'y' });
  }
  if (plinth > 0) {
    const tp = c.t('plinth');
    c.panel({ key: 'plinth', name: 'Plinth (kick board)', role: 'plinth', box: { x: 0, y: Dc - 50 - tp, z: 0, dx: W, dy: tp, dz: plinth - 3 }, axis: 'y', grainAxis: 'x', band: ['top'] });
    c.hw('leg', W >= 900 ? 6 : 4);
  }
  return { x0: ts, x1: W - tr, z0: zb, z1: zt, y0: TB, y1: Dc, fx0: 0, fx1: W, fz0: z0, fz1: H };
}

/** Overlay doors filling a front area. hinge: 'auto' alternates outer hinges; 'top' = lift-up flap. */
export function doors(
  c: BuildCtx,
  area: { x0: number; x1: number; z0: number; z1: number; y: number },
  count: number,
  opts: { keyPrefix?: string; name?: string; hinge?: 'auto' | 'top' | 'bottom'; sliding?: boolean } = {},
) {
  const pre = opts.keyPrefix ?? 'door';
  const n = Math.max(1, count);
  const totalW = area.x1 - area.x0 - DOOR_GAP * (n + 1) + (opts.sliding ? 40 * (n - 1) : 0);
  const w = totalW / n;
  const h = area.z1 - area.z0 - 2 * DOOR_GAP;
  for (let i = 0; i < n; i++) {
    const key = `${pre}-${i + 1}`;
    const T = c.t(key);
    let hinge: Panel['hinge'];
    if (opts.hinge === 'top' || opts.hinge === 'bottom') hinge = opts.hinge;
    else if (n === 1) hinge = c.mirrored ? 'right' : 'left';
    else hinge = i < n / 2 ? 'left' : 'right';
    if (n % 2 === 1 && n > 1 && i === (n - 1) / 2) hinge = c.mirrored ? 'right' : 'left';
    const x = area.x0 + DOOR_GAP + i * (w + DOOR_GAP - (opts.sliding ? 40 : 0));
    const yOff = opts.sliding ? (i % 2 === 0 ? 0 : -T - 10) : 0;
    c.panel({
      key,
      name: `${opts.name ?? 'Door'} ${n > 1 ? i + 1 : ''}`.trim(),
      role: 'door',
      box: { x, y: area.y + yOff, z: area.z0 + DOOR_GAP, dx: w, dy: T, dz: h },
      axis: 'y',
      band: 'all',
      hinge: opts.sliding ? undefined : hinge,
    });
    if (opts.sliding) c.hw('sliding-track', 1);
  }
}

/** Drawer stack: fronts (overlay) + boxes on soft-close slides. */
export function drawers(
  c: BuildCtx,
  inner: Interior,
  area: { z0: number; z1: number },
  count: number,
  opts: { keyPrefix?: string; front?: { x0: number; x1: number }; ratios?: number[] } = {},
) {
  const pre = opts.keyPrefix ?? 'drawer';
  const n = Math.max(1, count);
  const ratios = opts.ratios && opts.ratios.length === n ? opts.ratios : Array(n).fill(1);
  const sum = ratios.reduce((a, b) => a + b, 0);
  const fx0 = opts.front?.x0 ?? inner.fx0;
  const fx1 = opts.front?.x1 ?? inner.fx1;
  const totalH = area.z1 - area.z0;
  let z = area.z0;
  const T = c.t();
  const TB = c.tb('drawer-bottom');
  const slide = Math.max(250, Math.floor((inner.y1 - inner.y0 - 30) / 50) * 50);
  const boxW = inner.x1 - inner.x0 - 26; // 13 mm slide clearance per side
  for (let i = 0; i < n; i++) {
    const fh = (totalH * ratios[i]) / sum;
    const k = `${pre}-${i + 1}`;
    const tf = c.t(`${k}-front`);
    c.panel({
      key: `${k}-front`,
      name: `Drawer ${i + 1} front`,
      role: 'drawer-front',
      box: { x: fx0 + DOOR_GAP, y: inner.y1, z: z + DOOR_GAP / 2, dx: fx1 - fx0 - 2 * DOOR_GAP, dy: tf, dz: fh - DOOR_GAP },
      axis: 'y',
      grainAxis: 'x',
      band: 'all',
    });
    const bh = Math.max(80, Math.min(fh - 60, 250));
    const bz = Math.max(inner.z0 + 5, z + 20);
    const by = inner.y1 - slide;
    const bx = inner.x0 + 13;
    c.panel({ key: `${k}-side-l`, name: `Drawer ${i + 1} side L`, role: 'drawer-side', box: { x: bx, y: by, z: bz, dx: T, dy: slide, dz: bh }, axis: 'x', grainAxis: 'y', band: ['top'] });
    c.panel({ key: `${k}-side-r`, name: `Drawer ${i + 1} side R`, role: 'drawer-side', box: { x: bx + boxW - T, y: by, z: bz, dx: T, dy: slide, dz: bh }, axis: 'x', grainAxis: 'y', band: ['top'] });
    c.panel({ key: `${k}-back`, name: `Drawer ${i + 1} back`, role: 'drawer-back', box: { x: bx + T, y: by, z: bz + TB, dx: boxW - 2 * T, dy: T, dz: bh - TB }, axis: 'y', grainAxis: 'x', band: ['top'] });
    c.panel({ key: `${k}-inner-front`, name: `Drawer ${i + 1} inner front`, role: 'drawer-back', box: { x: bx + T, y: by + slide - T, z: bz + TB, dx: boxW - 2 * T, dy: T, dz: bh - TB - 20 }, axis: 'y', grainAxis: 'x', band: ['top'] });
    c.panel({ key: `${k}-bottom`, name: `Drawer ${i + 1} bottom`, role: 'drawer-bottom', box: { x: bx, y: by, z: bz, dx: boxW, dy: slide, dz: TB }, axis: 'z' });
    c.hw('slide-tandem', 1, `${slide} mm`);
    z += fh;
  }
}

/** Adjustable shelves evenly spaced in a region. */
export function shelves(c: BuildCtx, inner: Interior, count: number, opts: { keyPrefix?: string; z0?: number; z1?: number; x0?: number; x1?: number; fixed?: boolean; setback?: number } = {}) {
  const pre = opts.keyPrefix ?? 'shelf';
  const z0 = opts.z0 ?? inner.z0;
  const z1 = opts.z1 ?? inner.z1;
  const x0 = opts.x0 ?? inner.x0;
  const x1 = opts.x1 ?? inner.x1;
  const setback = opts.setback ?? 20;
  for (let i = 0; i < count; i++) {
    const key = `${pre}-${i + 1}`;
    const T = c.t(key);
    const z = z0 + ((z1 - z0) * (i + 1)) / (count + 1) - T / 2;
    c.panel({
      key,
      name: `Shelf ${count > 1 ? i + 1 : ''}`.trim(),
      role: 'shelf',
      box: { x: x0 + (opts.fixed ? 0 : 1), y: inner.y0, z, dx: x1 - x0 - (opts.fixed ? 0 : 2), dy: inner.y1 - inner.y0 - setback, dz: T },
      axis: 'z',
      grainAxis: 'x',
      band: ['front'],
      note: opts.fixed ? 'Fixed' : 'Adjustable',
    });
    if (!opts.fixed) c.hw('shelf-support', 4);
  }
}

/** Vertical partition between sections. */
export function partition(c: BuildCtx, inner: Interior, x: number, key: string, z0?: number, z1?: number) {
  const T = c.t(key);
  c.panel({
    key,
    name: 'Partition',
    role: 'partition',
    box: { x: x - T / 2, y: inner.y0, z: z0 ?? inner.z0, dx: T, dy: inner.y1 - inner.y0, dz: (z1 ?? inner.z1) - (z0 ?? inner.z0) },
    axis: 'x',
    band: ['front'],
  });
}

/** Horizontal fixed divider spanning the full inner width. */
export function divider(c: BuildCtx, inner: Interior, z: number, key: string, name = 'Fixed shelf') {
  const T = c.t(key);
  c.panel({ key, name, role: 'shelf', box: { x: inner.x0, y: inner.y0, z, dx: inner.x1 - inner.x0, dy: inner.y1 - inner.y0, dz: T }, axis: 'z', grainAxis: 'x', band: ['front'], note: 'Fixed' });
}
