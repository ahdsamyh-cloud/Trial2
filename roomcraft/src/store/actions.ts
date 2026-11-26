import type { Draft } from 'immer';
import type {
  ApplianceInstance,
  Beam,
  Column,
  CountertopSettings,
  ModuleInstance,
  Opening,
  OpeningKind,
  PriceList,
  Project,
  ProjectSettings,
  Room,
  RoomStructure,
  ServiceKind,
  ServicePoint,
  Vec2,
} from '../model/types';
import { uid } from '../model/ids';
import { serviceDef } from '../model/catalog';
import { applianceDef } from '../model/appliances';
import { clampModuleSize, newModule } from '../model/furniture';
import { localToPlan, planToLocal, type Placed } from '../model/structure';
import type { SuggestionAction } from '../model/checks';
import { OPENING_DEFAULTS } from '../plan2d/placement';
import {
  createRoom,
  insertCorner,
  moveCorner,
  nextRoomOrigin,
  removeCorner,
  setWallLength,
  templatePoints,
  translateRoom,
  type TemplateKind,
  type TemplateParams,
} from '../model/room';
import { isSimplePolygon } from '../model/geometry';
import { useProject } from './projectStore';
import { closePanelOnPhone, useUI } from './uiStore';

const ps = () => useProject.getState();

function findRoom(draft: Draft<Project> | Project, roomId: string) {
  return draft.rooms.findIndex((r) => r.id === roomId);
}

function replaceRoom(draft: Draft<Project>, room: Room) {
  const i = findRoom(draft, room.id);
  if (i >= 0) draft.rooms[i] = room as Draft<Room>;
}

function getRoom(roomId: string): Room | undefined {
  return ps().project.rooms.find((r) => r.id === roomId);
}

const roomName = (p: Project) => `Room ${p.rooms.length + 1}`;

export function addRoomFromPoints(points: Vec2[], name?: string): Room | null {
  const p = ps().project;
  if (points.length < 3 || !isSimplePolygon(points)) {
    useUI.getState().notify('That outline crosses itself — room not created.', 'error');
    return null;
  }
  const room = createRoom(name ?? roomName(p), points, p.settings.defaultWallThickness, p.settings.defaultWallHeight);
  if (room.points.length < 3) return null;
  ps().apply(`Add ${room.name}`, (d) => {
    d.rooms.push(room);
  });
  useUI.getState().set({ selection: { kind: 'room', roomId: room.id } });
  return room;
}

export function addTemplateRoom(kind: TemplateKind, params: TemplateParams, name?: string): Room | null {
  const origin = nextRoomOrigin(ps().project);
  const room = addRoomFromPoints(templatePoints(kind, params, origin), name);
  if (room) {
    useUI.getState().set({ fitRequest: useUI.getState().fitRequest + 1 });
    closePanelOnPhone();
  }
  return room;
}

export function deleteRoom(roomId: string) {
  const r = getRoom(roomId);
  if (!r) return;
  const wallIds = new Set(r.walls.map((w) => w.id));
  ps().apply(`Delete ${r.name}`, (d) => {
    d.rooms = d.rooms.filter((x) => x.id !== roomId);
    d.openings = d.openings.filter((o) => !wallIds.has(o.wallId));
    d.services = d.services.filter((s) => !s.wallId || !wallIds.has(s.wallId));
  });
  useUI.getState().set({ selection: null });
}

export function renameRoom(roomId: string, name: string) {
  ps().apply('Rename room', (d) => {
    const i = findRoom(d, roomId);
    if (i >= 0) d.rooms[i].name = name;
  });
}

export function setWallLengthAction(roomId: string, wallIndex: number, mm: number) {
  const r = getRoom(roomId);
  if (!r || !(mm > 0)) return;
  const next = setWallLength(r, wallIndex, mm);
  if (!isSimplePolygon(next.points)) {
    useUI.getState().notify('That length would make the walls cross.', 'error');
    return;
  }
  ps().apply('Change wall length', (d) => replaceRoom(d, next));
}

export function updateWall(roomId: string, wallId: string, patch: { thickness?: number; height?: number }) {
  ps().apply('Edit wall', (d) => {
    const i = findRoom(d, roomId);
    const w = i >= 0 ? d.rooms[i].walls.find((x) => x.id === wallId) : undefined;
    if (w) Object.assign(w, patch);
  });
}

/** Apply thickness/height to every wall in the project (or one room) and update defaults. */
export function updateAllWalls(patch: { thickness?: number; height?: number }, roomId?: string) {
  ps().apply('Edit all walls', (d) => {
    for (const r of d.rooms) {
      if (roomId && r.id !== roomId) continue;
      for (const w of r.walls) Object.assign(w, patch);
    }
    if (!roomId) {
      if (patch.thickness) d.settings.defaultWallThickness = patch.thickness;
      if (patch.height) d.settings.defaultWallHeight = patch.height;
    }
  });
}

export function setDefaults(patch: Partial<Project['settings']>) {
  ps().apply('Change defaults', (d) => {
    Object.assign(d.settings, patch);
  });
}

/* ---- gestures ---- */

export function dragCorner(roomId: string, index: number, to: Vec2) {
  const r = getRoom(roomId);
  if (!r) return;
  ps().applyTransient((d) => replaceRoom(d, moveCorner(r, index, to)));
}

export function dragRoom(original: Room, delta: Vec2) {
  ps().applyTransient((d) => replaceRoom(d, translateRoom(original, delta)));
}

/** End a corner drag: reject (cancel) if the polygon became self-intersecting. */
export function finishGesture(roomId?: string) {
  if (roomId) {
    const r = getRoom(roomId);
    if (r && !isSimplePolygon(r.points)) {
      ps().cancelGesture();
      useUI.getState().notify('Walls cannot cross — move reverted.', 'error');
      return;
    }
  }
  ps().endGesture();
}

export function addCorner(roomId: string, wallIndex: number, t: number) {
  const r = getRoom(roomId);
  if (!r) return;
  ps().apply('Add corner', (d) => replaceRoom(d, insertCorner(r, wallIndex, t)));
  useUI.getState().set({ selection: { kind: 'corner', roomId, index: wallIndex + 1 } });
}

export function deleteCorner(roomId: string, index: number) {
  const r = getRoom(roomId);
  if (!r) return;
  if (r.points.length <= 3) {
    useUI.getState().notify('A room needs at least 3 corners.', 'error');
    return;
  }
  ps().apply('Delete corner', (d) => replaceRoom(d, removeCorner(r, index)));
  useUI.getState().set({ selection: { kind: 'room', roomId } });
}

export function deleteSelection() {
  const sel = useUI.getState().selection;
  if (!sel) return;
  if (sel.kind === 'room') deleteRoom(sel.roomId);
  else if (sel.kind === 'corner') deleteCorner(sel.roomId, sel.index);
  else if (sel.kind === 'wall') useUI.getState().notify('Walls belong to a room: select the room to delete it, or delete a corner.');
  else if (sel.kind === 'module') deleteModules(sel.ids.length ? sel.ids : [sel.id]);
  else {
    const label = { opening: 'opening', service: 'service point', beam: 'beam', column: 'column', appliance: 'appliance' }[sel.kind];
    ps().apply(`Delete ${label}`, (d) => {
      if (sel.kind === 'opening') d.openings = d.openings.filter((x) => x.id !== sel.id);
      if (sel.kind === 'service') d.services = d.services.filter((x) => x.id !== sel.id);
      if (sel.kind === 'beam') d.beams = d.beams.filter((x) => x.id !== sel.id);
      if (sel.kind === 'column') d.columns = d.columns.filter((x) => x.id !== sel.id);
      if (sel.kind === 'appliance') d.appliances = d.appliances.filter((x) => x.id !== sel.id);
    });
    useUI.getState().set({ selection: null });
  }
}

/* ====================== structure & services ====================== */

export function updateRoomStructure(roomId: string, patch: Partial<RoomStructure>) {
  ps().apply('Edit slabs / ceiling', (d) => {
    const r = d.rooms.find((x) => x.id === roomId);
    if (r) r.structure = { ...(r.structure ?? {}), ...patch } as RoomStructure;
  });
}

export function addOpening(kind: OpeningKind, wallId: string, offset: number, width?: number) {
  const def = OPENING_DEFAULTS[kind];
  const o: Opening = { id: uid('op'), wallId, kind, offset, width: width ?? def.width, height: def.height, sill: def.sill, hinge: 'left', swing: 'in' };
  ps().apply(`Add ${kind}`, (d) => {
    d.openings.push(o);
  });
  useUI.getState().set({ selection: { kind: 'opening', id: o.id } });
  return o;
}

export function updateOpening(id: string, patch: Partial<Opening>, label = 'Edit opening') {
  ps().apply(label, (d) => {
    const o = d.openings.find((x) => x.id === id);
    if (o) Object.assign(o, patch);
  });
}

export function addService(kind: ServiceKind, at: { wallId: string | null; offset: number; x: number; y: number }) {
  const def = serviceDef(kind);
  const p = ps().project;
  const room = p.rooms.find((r) => r.walls.some((w) => w.id === at.wallId)) ?? p.rooms[0];
  const height = def.mount === 'ceiling' ? room?.structure?.dropCeiling ?? room?.walls[0]?.height ?? 3000 : def.mount === 'floor' ? 0 : def.defaultHeight;
  const s: ServicePoint = { id: uid('svc'), kind, ...at, height };
  ps().apply(`Add ${def.name.toLowerCase()}`, (d) => {
    d.services.push(s);
  });
  useUI.getState().set({ selection: { kind: 'service', id: s.id } });
  return s;
}

export function updateService(id: string, patch: Partial<ServicePoint>) {
  ps().apply('Edit service point', (d) => {
    const o = d.services.find((x) => x.id === id);
    if (o) Object.assign(o, patch);
  });
}

export function addBeam(a: Vec2, b: Vec2) {
  const beam: Beam = { id: uid('beam'), a, b, width: 230, depth: 450, bottom: 2550 };
  const wallH = ps().project.rooms[0]?.walls[0]?.height ?? 3000;
  beam.bottom = wallH - beam.depth;
  ps().apply('Add beam', (d) => {
    d.beams.push(beam);
  });
  useUI.getState().set({ selection: { kind: 'beam', id: beam.id } });
}

export function updateBeam(id: string, patch: Partial<Beam>) {
  ps().apply('Edit beam', (d) => {
    const o = d.beams.find((x) => x.id === id);
    if (o) Object.assign(o, patch);
  });
}

export function addColumn(at: { x: number; y: number; rotation: number }) {
  const wallH = ps().project.rooms[0]?.walls[0]?.height ?? 3000;
  const c: Column = { id: uid('col'), ...at, width: 300, depth: 300, height: wallH };
  ps().apply('Add column', (d) => {
    d.columns.push(c);
  });
  useUI.getState().set({ selection: { kind: 'column', id: c.id } });
}

export function updateColumn(id: string, patch: Partial<Column>) {
  ps().apply('Edit column', (d) => {
    const o = d.columns.find((x) => x.id === id);
    if (o) Object.assign(o, patch);
  });
}

/* ====================== furniture ====================== */

export function addModule(type: string, placed: Partial<Placed>): ModuleInstance {
  const m = newModule(type, ps().project, placed as Partial<ModuleInstance>);
  ps().apply(`Add ${m.name}`, (d) => {
    d.modules.push(m);
  });
  useUI.getState().set({ selection: { kind: 'module', id: m.id, ids: [m.id] } });
  return m;
}

export function updateModule(id: string, recipe: (m: ModuleInstance) => void, label = 'Edit module') {
  ps().apply(label, (d) => {
    const i = d.modules.findIndex((x) => x.id === id);
    if (i < 0) return;
    const copy = JSON.parse(JSON.stringify(d.modules[i])) as ModuleInstance;
    recipe(copy);
    d.modules[i] = clampModuleSize(copy);
  });
}

export function deleteModules(ids: string[]) {
  ps().apply(ids.length > 1 ? `Delete ${ids.length} modules` : 'Delete module', (d) => {
    d.modules = d.modules.filter((m) => !ids.includes(m.id));
  });
  useUI.getState().set({ selection: null });
}

let clipboard: ModuleInstance[] = [];

export function copySelection() {
  const sel = useUI.getState().selection;
  if (sel?.kind !== 'module') return;
  const ids = sel.ids.length ? sel.ids : [sel.id];
  clipboard = ps().project.modules.filter((m) => ids.includes(m.id)).map((m) => JSON.parse(JSON.stringify(m)));
  useUI.getState().notify(`Copied ${clipboard.length} module${clipboard.length > 1 ? 's' : ''}`);
}

/** Paste copies right next to the originals (along their width axis). */
export function pasteClipboard() {
  if (!clipboard.length) return;
  const first = clipboard[0];
  const span = Math.max(...clipboard.map((m) => planToLocal(first, { x: m.x, y: m.y }).u + m.width)) - Math.min(...clipboard.map((m) => planToLocal(first, { x: m.x, y: m.y }).u));
  const runMap = new Map<string, string>();
  const copies = clipboard.map((m) => {
    const o = localToPlan(m, span, 0);
    const runId = m.runId ? runMap.get(m.runId) ?? runMap.set(m.runId, uid('run')).get(m.runId)! : null;
    return { ...JSON.parse(JSON.stringify(m)), id: uid('mod'), name: `${m.name} copy`, x: o.x, y: o.y, runId } as ModuleInstance;
  });
  ps().apply(`Paste ${copies.length} module${copies.length > 1 ? 's' : ''}`, (d) => {
    d.modules.push(...copies);
  });
  clipboard = copies.map((m) => JSON.parse(JSON.stringify(m)));
  useUI.getState().set({ selection: { kind: 'module', id: copies[0].id, ids: copies.map((c) => c.id) } });
}

export function duplicateSelection() {
  copySelection();
  pasteClipboard();
}

/** Mirror handedness (hinges / corner side) of the selected modules. */
export function mirrorSelection() {
  const sel = useUI.getState().selection;
  if (sel?.kind !== 'module') return;
  const ids = sel.ids.length ? sel.ids : [sel.id];
  const mods = ps().project.modules.filter((m) => ids.includes(m.id));
  if (!mods.length) return;
  const ref = mods[0];
  const us = mods.map((m) => planToLocal(ref, { x: m.x, y: m.y }).u);
  const min = Math.min(...us);
  const max = Math.max(...mods.map((m, i) => us[i] + m.width));
  ps().apply('Mirror', (d) => {
    for (const m of d.modules) {
      if (!ids.includes(m.id)) continue;
      m.mirrored = !m.mirrored;
      if (mods.length > 1) {
        const u = planToLocal(ref, { x: m.x, y: m.y }).u;
        const v = planToLocal(ref, { x: m.x, y: m.y }).v;
        const nu = min + max - (u + m.width);
        const o = localToPlan(ref, nu, v);
        m.x = o.x;
        m.y = o.y;
      }
    }
  });
}

export function groupRun(ids: string[]) {
  if (ids.length < 2) return useUI.getState().notify('Shift-click two or more modules to group them into a run.');
  const runId = uid('run');
  ps().apply('Group into run', (d) => {
    for (const m of d.modules) if (ids.includes(m.id)) m.runId = runId;
  });
  useUI.getState().notify(`Grouped ${ids.length} modules into a run — they now move together.`);
}

export function ungroupRun(ids: string[]) {
  ps().apply('Ungroup run', (d) => {
    for (const m of d.modules) if (ids.includes(m.id)) m.runId = null;
  });
}

export function runMembers(project: Project, id: string): ModuleInstance[] {
  const m = project.modules.find((x) => x.id === id);
  if (!m) return [];
  if (!m.runId) return [m];
  return project.modules.filter((x) => x.runId === m.runId);
}

/** Rotate the selected module(s)/appliance by `deg` about the selection's centre. */
export function rotateSelection(deg = 90) {
  const sel = useUI.getState().selection;
  if (sel?.kind !== 'module' && sel?.kind !== 'appliance') return;
  const p = ps().project;
  const items: (Placed & { id: string })[] =
    sel.kind === 'appliance'
      ? (p.appliances.filter((a) => a.id === sel.id) as never)
      : (p.modules.filter((m) => (sel.ids.length ? sel.ids : [sel.id]).includes(m.id)).flatMap((m) => runMembers(p, m.id)) as never);
  if (!items.length) return;
  const cs = items.map((it) => localToPlan(it, it.width / 2, it.depth / 2));
  const c = { x: cs.reduce((s, q) => s + q.x, 0) / cs.length, y: cs.reduce((s, q) => s + q.y, 0) / cs.length };
  const r = (deg * Math.PI) / 180;
  const rot = (q: Vec2) => ({ x: c.x + (q.x - c.x) * Math.cos(r) - (q.y - c.y) * Math.sin(r), y: c.y + (q.x - c.x) * Math.sin(r) + (q.y - c.y) * Math.cos(r) });
  const ids = new Set(items.map((i) => i.id));
  ps().apply('Rotate', (d) => {
    for (const list of [d.modules, d.appliances] as Placed[][]) {
      for (const it of list as (Placed & { id: string })[]) {
        if (!ids.has(it.id)) continue;
        const o = rot({ x: it.x, y: it.y });
        it.x = Math.round(o.x * 10) / 10;
        it.y = Math.round(o.y * 10) / 10;
        it.rotation = (((it.rotation + deg) % 360) + 360) % 360;
      }
    }
  });
}

/** Nudge selection by a plan delta. */
export function nudgeSelection(dx: number, dy: number) {
  const sel = useUI.getState().selection;
  const p = ps().project;
  if (!sel) return;
  ps().apply('Nudge', (d) => {
    if (sel.kind === 'module') {
      const ids = new Set((sel.ids.length ? sel.ids : [sel.id]).flatMap((id) => runMembers(p, id).map((m) => m.id)));
      for (const m of d.modules) if (ids.has(m.id)) Object.assign(m, { x: m.x + dx, y: m.y + dy });
    } else if (sel.kind === 'appliance') {
      const a = d.appliances.find((x) => x.id === sel.id);
      if (a) Object.assign(a, { x: a.x + dx, y: a.y + dy });
    } else if (sel.kind === 'column') {
      const c = d.columns.find((x) => x.id === sel.id);
      if (c) Object.assign(c, { x: c.x + dx, y: c.y + dy });
    }
  });
}

/* ====================== appliances ====================== */

export function addAppliance(type: string, placed: Placed): ApplianceInstance | null {
  const def = applianceDef(type);
  if (!def) return null;
  const n = ps().project.appliances.filter((a) => a.type === type).length;
  const a: ApplianceInstance = { id: uid('app'), type, name: `${def.name}${n ? ` ${n + 1}` : ''}`, ...placed };
  ps().apply(`Add ${def.name}`, (d) => {
    d.appliances.push(a);
  });
  useUI.getState().set({ selection: { kind: 'appliance', id: a.id } });
  return a;
}

export function updateAppliance(id: string, patch: Partial<ApplianceInstance>) {
  ps().apply('Edit appliance', (d) => {
    const o = d.appliances.find((x) => x.id === id);
    if (o) Object.assign(o, patch);
  });
}

/* ====================== project-wide settings ====================== */

export function setCountertop(patch: Partial<CountertopSettings>) {
  ps().apply('Edit countertop', (d) => {
    Object.assign(d.countertop, patch);
  });
}

export function setSettings(recipe: (s: ProjectSettings) => void, label = 'Change settings') {
  ps().apply(label, (d) => recipe(d.settings as ProjectSettings));
}

export function setPrices(recipe: (p: PriceList) => void) {
  ps().apply('Edit prices', (d) => recipe(d.prices as PriceList));
}

export function applySuggestion(a: SuggestionAction) {
  switch (a.type) {
    case 'move-module': {
      const p = ps().project;
      const m = p.modules.find((x) => x.id === a.id);
      if (!m) return;
      ps().apply('Apply suggestion', (d) => {
        const t = d.modules.find((x) => x.id === a.id);
        if (t) Object.assign(t, { x: a.to.x, y: a.to.y, rotation: a.to.rotation });
      });
      break;
    }
    case 'move-appliance':
      ps().apply('Apply suggestion', (d) => {
        const t = d.appliances.find((x) => x.id === a.id);
        if (t) Object.assign(t, { x: a.to.x, y: a.to.y, rotation: a.to.rotation });
      });
      break;
    case 'add-appliance':
      addAppliance(a.applianceType, a.at);
      break;
    case 'add-module':
      addModule(a.moduleType, a.at);
      break;
  }
}

/** Transient move of modules/appliances during a drag (call inside a gesture). */
export function dragItems(moves: { kind: 'module' | 'appliance'; id: string; to: Placed }[]) {
  ps().applyTransient((d) => {
    for (const mv of moves) {
      const list = mv.kind === 'module' ? d.modules : d.appliances;
      const t = (list as (Placed & { id: string })[]).find((x) => x.id === mv.id);
      if (t) Object.assign(t, { x: mv.to.x, y: mv.to.y, rotation: mv.to.rotation, elevation: mv.to.elevation });
    }
  });
}

export function dragStructure(kind: 'opening' | 'service' | 'column', id: string, patch: Record<string, unknown>) {
  ps().applyTransient((d) => {
    const list = kind === 'opening' ? d.openings : kind === 'service' ? d.services : d.columns;
    const t = (list as { id: string }[]).find((x) => x.id === id);
    if (t) Object.assign(t, patch);
  });
}
