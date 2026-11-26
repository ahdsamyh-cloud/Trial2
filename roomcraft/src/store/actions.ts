import type { Draft } from 'immer';
import type { Project, Room, Vec2 } from '../model/types';
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
  ps().apply(`Delete ${r.name}`, (d) => {
    d.rooms = d.rooms.filter((x) => x.id !== roomId);
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
}
