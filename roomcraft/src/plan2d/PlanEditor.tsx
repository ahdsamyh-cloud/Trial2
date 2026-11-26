import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Circle, Group, Layer, Line, Rect, Stage, Text } from 'react-konva';
import type { KonvaEventObject } from 'konva/lib/Node';
import { useProject } from '../store/projectStore';
import { selRoomId, usePrefs, useUI, type PlaceSpec } from '../store/uiStore';
import { useClashIds, useCountertop } from '../store/derived';
import {
  ApplianceShape,
  CountertopLayer,
  FurnitureLayer,
  MeasureLine,
  ModuleShape,
  OpeningsLayer,
  ServicesLayer,
  StructureLayer,
  openingSymbol,
  type ItemTarget,
} from './layers';
import { placeBox, placeColumn, placeOpening, placeService, OPENING_DEFAULTS } from './placement';
import { applianceDef } from '../model/appliances';
import { moduleDef, newModule } from '../model/furniture';
import { serviceDef } from '../model/catalog';
import { columnPolygon, findWall, localToPlan, planToLocal, pointOnWall, type Placed } from '../model/structure';
import type { ApplianceInstance, ModuleInstance } from '../model/types';
import { usePalette, type Palette } from '../theme';
import type { Room, Vec2 } from '../model/types';
import {
  add,
  angleDeg,
  boundsOf,
  centroid,
  closestOnSegment,
  dist,
  norm,
  outerPolygon,
  outwardNormal,
  polygonArea,
  scale as vscale,
  sub,
  wallQuads,
} from '../model/geometry';
import { snapPoint, type SnapGuide, type SnapResult } from '../model/snapping';
import { formatArea, formatLength, parseLength } from '../model/units';
import { fitBounds, toScreen, toWorld, zoomAt, type ViewTransform } from './view';
import { Grid } from './Grid';
import {
  addAppliance,
  addBeam,
  addColumn,
  addCorner,
  addModule,
  addOpening,
  addRoomFromPoints,
  addService,
  dragCorner,
  dragItems,
  dragRoom,
  dragStructure,
  finishGesture,
  runMembers,
  setWallLengthAction,
} from '../store/actions';

type Target =
  | { kind: 'bg' }
  | { kind: 'room'; roomId: string }
  | { kind: 'wall'; roomId: string; wallId: string }
  | { kind: 'corner'; roomId: string; index: number }
  | ItemTarget;

type Ghost =
  | { cat: 'opening'; poly: Vec2[]; lines: Vec2[][] }
  | { cat: 'service'; at: Vec2; color: string }
  | { cat: 'column'; poly: Vec2[] }
  | { cat: 'beam'; a: Vec2; b: Vec2 }
  | { cat: 'module'; m: ModuleInstance }
  | { cat: 'appliance'; a: ApplianceInstance }
  | { cat: 'measure'; a: Vec2; b: Vec2 };

interface MoveMember {
  kind: 'module' | 'appliance';
  id: string;
  orig: Placed;
  u: number;
  v: number;
  dr: number;
}

type Drag =
  | { kind: 'pan'; start: Vec2; startView: ViewTransform; moved: boolean; tapDeselect: boolean }
  | { kind: 'corner'; roomId: string; index: number; moved: boolean; start: Vec2 }
  | { kind: 'room'; roomId: string; original: Room; startWorld: Vec2; start: Vec2; moved: boolean }
  | { kind: 'draw'; start: Vec2; pointerType: string }
  | { kind: 'tool'; start: Vec2; pointerType: string }
  | { kind: 'item'; primary: MoveMember; members: MoveMember[]; grab: Vec2; start: Vec2; moved: boolean }
  | { kind: 'struct'; target: 'opening' | 'service' | 'column'; id: string; start: Vec2; moved: boolean }
  | { kind: 'pinch'; startDist: number; startMid: Vec2; startView: ViewTransform };

const TAP_PX = 6;
const SNAP_PX = 12;

interface DimEdit {
  roomId: string;
  index: number;
  at: Vec2; // screen
  value: string;
}

export function PlanEditor() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [view, setView] = useState<ViewTransform>({ scale: 0.12, x: 80, y: 80 });
  const viewRef = useRef(view);
  viewRef.current = view;

  const project = useProject((s) => s.project);
  const rooms = project.rooms;
  const placing = useUI((s) => s.placing);
  const measurements = useUI((s) => s.measurements);
  const clashIds = useClashIds();
  const counterPieces = useCountertop();
  const [ghost, setGhost] = useState<Ghost | null>(null);
  const [pending, setPending] = useState<Vec2 | null>(null); // first point of a beam / measurement
  const selection = useUI((s) => s.selection);
  const tool = useUI((s) => s.tool);
  const fitRequest = useUI((s) => s.fitRequest);
  const setUI = useUI((s) => s.set);
  const prefs = usePrefs();
  const palette = usePalette();

  const [draft, setDraft] = useState<Vec2[]>([]);
  const [cursor, setCursor] = useState<SnapResult | null>(null);
  const [dimEdit, setDimEdit] = useState<DimEdit | null>(null);
  const [typedLen, setTypedLen] = useState('');
  const dragRef = useRef<Drag | null>(null);
  const pointers = useRef(new Map<number, Vec2>());
  const spaceDown = useRef(false);

  /* ---------- sizing & fitting ---------- */
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  const fit = useCallback(() => {
    const rs = useProject.getState().project.rooms;
    const b = boundsOf(rs.flatMap((r) => outerPolygon(r)));
    const el = containerRef.current;
    if (el) setView(fitBounds(b, el.clientWidth || 800, el.clientHeight || 600));
  }, []);

  const didInitialFit = useRef(false);
  useEffect(() => {
    if (size.w > 0 && size.h > 0 && !didInitialFit.current) {
      didInitialFit.current = true;
      fit();
    }
  }, [size, fit]);
  useEffect(() => {
    if (fitRequest) fit();
  }, [fitRequest, fit]);

  // leaving draw mode discards the draft
  useEffect(() => {
    if (tool !== 'draw') {
      setDraft([]);
      setCursor(null);
    }
    if (tool !== 'place' && tool !== 'measure') {
      setGhost(null);
      setPending(null);
    }
  }, [tool]);
  useEffect(() => {
    setPending(null);
    setGhost(null);
  }, [placing]);

  /* ---------- snapping ---------- */
  const snapTargets = useMemo(() => {
    return rooms.map((r) => {
      const outer = outerPolygon(r);
      const n = r.points.length;
      const segs: [Vec2, Vec2][] = [];
      for (let i = 0; i < n; i++) {
        segs.push([r.points[i], r.points[(i + 1) % n]]);
        segs.push([outer[i], outer[(i + 1) % n]]);
      }
      return { roomId: r.id, points: [...r.points, ...outer], segs };
    });
  }, [rooms]);

  const snap = useCallback(
    (raw: Vec2, opts: { prev?: Vec2; excludeRoom?: string; extraPoints?: Vec2[]; alignTo?: Vec2[] }) => {
      const tgt = snapTargets.filter((t) => t.roomId !== opts.excludeRoom);
      return snapPoint(raw, {
        grid: prefs.gridSize,
        snapGrid: prefs.snapGrid,
        snapAngle: prefs.snapAngle,
        snapObjects: prefs.snapObjects,
        tolerance: SNAP_PX / viewRef.current.scale,
        prev: opts.prev,
        points: [...tgt.flatMap((t) => t.points), ...(opts.extraPoints ?? [])],
        segments: tgt.flatMap((t) => t.segs),
        alignTo: [...(opts.alignTo ?? []), ...tgt.flatMap((t) => t.points)],
      });
    },
    [snapTargets, prefs.gridSize, prefs.snapGrid, prefs.snapAngle, prefs.snapObjects],
  );

  const snapDraw = useCallback(
    (raw: Vec2) =>
      snap(raw, {
        prev: draft[draft.length - 1],
        extraPoints: draft,
        alignTo: draft.length ? [draft[0], draft[draft.length - 1]] : [],
      }),
    [snap, draft],
  );

  /* ---------- drawing ---------- */
  const finishDraft = useCallback(
    (pts: Vec2[]) => {
      if (pts.length >= 3) {
        const room = addRoomFromPoints(pts);
        if (room) setUI({ tool: 'select' });
      }
      setDraft([]);
      setCursor(null);
      setTypedLen('');
    },
    [setUI],
  );

  const placeDraftPoint = useCallback(
    (p: Vec2) => {
      const tol = SNAP_PX / viewRef.current.scale;
      if (draft.length >= 3 && dist(p, draft[0]) < tol) return finishDraft(draft);
      if (draft.length >= 3 && dist(p, draft[draft.length - 1]) < tol) return finishDraft(draft);
      if (draft.length && dist(p, draft[draft.length - 1]) < 1) return;
      setDraft([...draft, p]);
    },
    [draft, finishDraft],
  );

  const placeTypedLength = () => {
    const mm = parseLength(typedLen, prefs.units);
    if (!mm || mm <= 0 || !draft.length) return;
    const last = draft[draft.length - 1];
    let dir = cursor ? norm(sub(cursor.point, last)) : { x: 1, y: 0 };
    if (!dir.x && !dir.y) dir = { x: 1, y: 0 };
    const p = add(last, vscale(dir, mm));
    setDraft([...draft, { x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10 }]);
    setTypedLen('');
  };

  /* ---------- placing library items ---------- */
  const tolMm = () => SNAP_PX / viewRef.current.scale;

  /** Compute where a library item would go; returns a ghost and a commit function. */
  const resolvePlace = (spec: PlaceSpec, w: Vec2): { ghost: Ghost | null; commit: () => void } | null => {
    const p = useProject.getState().project;
    switch (spec.cat) {
      case 'opening': {
        const r = placeOpening(p, w, OPENING_DEFAULTS[spec.kind].width, tolMm() * 3);
        if (!r) return null;
        const sym = openingSymbol(r.frame, { offset: r.offset, width: r.width, kind: spec.kind, hinge: 'left', swing: 'in' });
        return { ghost: { cat: 'opening', poly: sym.gap, lines: sym.lines }, commit: () => addOpening(spec.kind, r.wallId, r.offset, r.width) };
      }
      case 'service': {
        const r = placeService(p, spec.kind, w, prefs.gridSize);
        const f = r.wallId ? findWall(p, r.wallId) : null;
        const at = f ? pointOnWall(f, r.offset) : { x: r.x, y: r.y };
        return { ghost: { cat: 'service', at, color: serviceDef(spec.kind).color }, commit: () => addService(spec.kind, r) };
      }
      case 'column': {
        const r = placeColumn(p, w, { width: 300, depth: 300 }, prefs.gridSize);
        return { ghost: { cat: 'column', poly: columnPolygon({ ...r, width: 300, depth: 300 }) }, commit: () => addColumn(r) };
      }
      case 'beam': {
        const s = snap(w, { prev: pending ?? undefined });
        if (!pending) return { ghost: { cat: 'beam', a: s.point, b: s.point }, commit: () => setPending(s.point) };
        return {
          ghost: { cat: 'beam', a: pending, b: s.point },
          commit: () => {
            if (dist(pending, s.point) > 100) addBeam(pending, s.point);
            setPending(null);
            setUI({ tool: 'select', placing: null });
          },
        };
      }
      case 'module': {
        const def = moduleDef(spec.type);
        if (!def) return null;
        const size: Placed = { x: 0, y: 0, rotation: 0, ...def.size };
        const r = placeBox(p, 'module', spec.type, size, w, tolMm() * 4, new Set());
        const m = newModule(spec.type, p, r.placed as Partial<ModuleInstance>);
        return { ghost: { cat: 'module', m }, commit: () => addModule(spec.type, r.placed) };
      }
      case 'appliance': {
        const def = applianceDef(spec.type);
        if (!def) return null;
        const size: Placed = { x: 0, y: 0, rotation: 0, width: def.width, depth: def.depth, height: def.height, elevation: def.elevation };
        const r = placeBox(p, 'appliance', spec.type, size, w, tolMm() * 4, new Set());
        const a = { id: 'ghost', type: spec.type, name: def.name, ...r.placed } as ApplianceInstance;
        return { ghost: { cat: 'appliance', a }, commit: () => addAppliance(spec.type, r.placed) };
      }
    }
  };

  const hoverTool = (w: Vec2) => {
    if (tool === 'place' && placing) setGhost(resolvePlace(placing, w)?.ghost ?? null);
    if (tool === 'measure') {
      const s = snap(w, { prev: pending ?? undefined });
      setGhost(pending ? { cat: 'measure', a: pending, b: s.point } : null);
      setCursor(s);
    }
  };

  const tapTool = (w: Vec2) => {
    if (tool === 'place' && placing) {
      const r = resolvePlace(placing, w);
      if (!r) {
        useUI.getState().notify(placing.cat === 'opening' ? 'Click on a wall to place it.' : 'Cannot place here.', 'error');
        return;
      }
      r.commit();
      if (placing.cat !== 'beam') {
        setGhost(null);
        setUI({ tool: 'select', placing: null });
      }
    } else if (tool === 'measure') {
      const s = snap(w, { prev: pending ?? undefined });
      if (!pending) setPending(s.point);
      else {
        setUI({ measurements: [...useUI.getState().measurements, { a: pending, b: s.point }] });
        setPending(null);
        setGhost(null);
      }
    }
  };

  /** Drop from the library (HTML5 drag-and-drop). */
  const onDrop = (e: React.DragEvent) => {
    const raw = e.dataTransfer.getData('application/x-roomcraft');
    if (!raw) return;
    e.preventDefault();
    const spec = JSON.parse(raw) as PlaceSpec;
    const w = toWorld(viewRef.current, screenPoint(e));
    if (spec.cat === 'beam') {
      setUI({ tool: 'place', placing: spec });
      return;
    }
    const r = resolvePlace(spec, w);
    if (r) r.commit();
    else useUI.getState().notify(spec.cat === 'opening' ? 'Drop doors and windows onto a wall.' : 'Cannot place here.', 'error');
  };

  /* ---------- moving placed items ---------- */
  const memberOf = (kind: 'module' | 'appliance', it: Placed & { id: string }, primary: Placed): MoveMember => {
    const l = planToLocal(primary, { x: it.x, y: it.y });
    return { kind, id: it.id, orig: { ...it }, u: l.u, v: l.v, dr: it.rotation - primary.rotation };
  };

  const moveItem = (d: Extract<Drag, { kind: 'item' }>, w: Vec2) => {
    const p = useProject.getState().project;
    const pr = d.primary;
    const target = { x: w.x - d.grab.x, y: w.y - d.grab.y }; // desired centre
    const ignore = new Set(d.members.map((m) => m.id));
    let placed: Placed;
    if (d.members.length > 1) {
      // runs: snap the group's primary to walls, keep relative layout
      const r = placeBox(p, pr.kind, '', pr.orig, target, tolMm() * 4, ignore);
      placed = { ...r.placed, elevation: pr.orig.elevation };
    } else {
      const type = pr.kind === 'module' ? p.modules.find((m) => m.id === pr.id)?.type ?? '' : p.appliances.find((a) => a.id === pr.id)?.type ?? '';
      const r = placeBox(p, pr.kind, type, pr.orig, target, tolMm() * 4, ignore);
      const keepElev = pr.kind === 'module' || !(applianceDef(type)?.mount === 'inset' || applianceDef(type)?.mount === 'counter' || r.host);
      placed = { ...r.placed, elevation: keepElev ? pr.orig.elevation : r.placed.elevation };
    }
    const moves = d.members.map((m) => {
      if (m === pr) return { kind: m.kind, id: m.id, to: placed };
      const o = localToPlan(placed, m.u, m.v);
      return { kind: m.kind, id: m.id, to: { ...m.orig, x: o.x, y: o.y, rotation: placed.rotation + m.dr } };
    });
    dragItems(moves);
  };

  const moveStruct = (d: Extract<Drag, { kind: 'struct' }>, w: Vec2) => {
    const p = useProject.getState().project;
    if (d.target === 'opening') {
      const o = p.openings.find((x) => x.id === d.id);
      if (!o) return;
      const r = placeOpening(p, w, o.width, tolMm() * 3);
      if (r) dragStructure('opening', d.id, { wallId: r.wallId, offset: r.offset });
    } else if (d.target === 'service') {
      const s = p.services.find((x) => x.id === d.id);
      if (!s) return;
      const r = placeService(p, s.kind, w, prefs.gridSize);
      dragStructure('service', d.id, r);
    } else {
      const c = p.columns.find((x) => x.id === d.id);
      if (!c) return;
      dragStructure('column', d.id, placeColumn(p, w, c, prefs.gridSize));
    }
  };

  /* ---------- pointer handling ---------- */
  const screenPoint = (evt: { clientX: number; clientY: number }): Vec2 => {
    const r = containerRef.current!.getBoundingClientRect();
    return { x: evt.clientX - r.left, y: evt.clientY - r.top };
  };

  const startPinch = () => {
    const [a, b] = [...pointers.current.values()];
    const d = dragRef.current;
    if (d?.kind === 'corner' || d?.kind === 'room') useProject.getState().cancelGesture();
    dragRef.current = {
      kind: 'pinch',
      startDist: Math.max(dist(a, b), 1),
      startMid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      startView: viewRef.current,
    };
  };

  const handleDown = (evt: PointerEvent, target: Target) => {
    if (dimEdit) setDimEdit(null);
    const sp = screenPoint(evt);
    pointers.current.set(evt.pointerId, sp);
    if (pointers.current.size === 2) return startPinch();
    if (pointers.current.size > 2) return;

    const wantsPan = evt.button === 1 || evt.button === 2 || spaceDown.current || tool === 'pan';
    if (wantsPan) {
      dragRef.current = { kind: 'pan', start: sp, startView: viewRef.current, moved: false, tapDeselect: false };
      return;
    }
    if (evt.button !== 0 && evt.pointerType === 'mouse') return;

    if (tool === 'draw') {
      dragRef.current = { kind: 'draw', start: sp, pointerType: evt.pointerType };
      setCursor(snapDraw(toWorld(viewRef.current, sp)));
      return;
    }
    if (tool === 'place' || tool === 'measure') {
      dragRef.current = { kind: 'tool', start: sp, pointerType: evt.pointerType };
      hoverTool(toWorld(viewRef.current, sp));
      return;
    }

    switch (target.kind) {
      case 'bg':
        dragRef.current = { kind: 'pan', start: sp, startView: viewRef.current, moved: false, tapDeselect: true };
        break;
      case 'room': {
        const room = rooms.find((r) => r.id === target.roomId)!;
        const already = selection?.kind === 'room' && selection.roomId === target.roomId;
        setUI({ selection: { kind: 'room', roomId: target.roomId } });
        if (already) {
          useProject.getState().beginGesture(`Move ${room.name}`);
          dragRef.current = {
            kind: 'room',
            roomId: room.id,
            original: room,
            startWorld: toWorld(viewRef.current, sp),
            start: sp,
            moved: false,
          };
        } else {
          dragRef.current = { kind: 'pan', start: sp, startView: viewRef.current, moved: false, tapDeselect: false };
        }
        break;
      }
      case 'wall':
        setUI({ selection: { kind: 'wall', roomId: target.roomId, wallId: target.wallId } });
        dragRef.current = { kind: 'pan', start: sp, startView: viewRef.current, moved: false, tapDeselect: false };
        break;
      case 'corner':
        setUI({ selection: { kind: 'corner', roomId: target.roomId, index: target.index } });
        useProject.getState().beginGesture('Move corner');
        dragRef.current = { kind: 'corner', roomId: target.roomId, index: target.index, moved: false, start: sp };
        break;
      case 'item': {
        const p = useProject.getState().project;
        const w = toWorld(viewRef.current, sp);
        if (target.cat === 'module') {
          const cur = useUI.getState().selection;
          if (evt.shiftKey && cur?.kind === 'module') {
            const ids = cur.ids.includes(target.id) ? cur.ids.filter((i) => i !== target.id) : [...cur.ids, target.id];
            setUI({ selection: ids.length ? { kind: 'module', id: ids[ids.length - 1], ids } : null });
            return;
          }
          const keep = cur?.kind === 'module' && cur.ids.includes(target.id) && cur.ids.length > 1;
          if (!keep) setUI({ selection: { kind: 'module', id: target.id, ids: [target.id] } });
        } else setUI({ selection: { kind: 'appliance', id: target.id } });
        const prim = target.cat === 'module' ? p.modules.find((m) => m.id === target.id) : p.appliances.find((a) => a.id === target.id);
        if (!prim) return;
        let group: MoveMember[];
        if (target.cat === 'module') {
          const cur = useUI.getState().selection;
          const ids = new Set(cur?.kind === 'module' ? cur.ids : [target.id]);
          const all = new Map<string, ModuleInstance>();
          for (const id of ids) for (const m of runMembers(p, id)) all.set(m.id, m);
          group = [...all.values()].map((m) => memberOf('module', m, prim));
        } else group = [memberOf('appliance', prim, prim)];
        const centre = localToPlan(prim, prim.width / 2, prim.depth / 2);
        useProject.getState().beginGesture(`Move ${prim.name}`);
        dragRef.current = { kind: 'item', primary: group.find((g) => g.id === prim.id)!, members: group, grab: { x: w.x - centre.x, y: w.y - centre.y }, start: sp, moved: false };
        break;
      }
      case 'opening':
      case 'service':
      case 'column':
        setUI({ selection: { kind: target.kind, id: target.id } });
        useProject.getState().beginGesture(`Move ${target.kind}`);
        dragRef.current = { kind: 'struct', target: target.kind, id: target.id, start: sp, moved: false };
        break;
      case 'beam':
        setUI({ selection: { kind: 'beam', id: target.id } });
        dragRef.current = { kind: 'pan', start: sp, startView: viewRef.current, moved: false, tapDeselect: false };
        break;
    }
  };

  const handleMove = (evt: PointerEvent) => {
    if (!containerRef.current) return;
    const sp = screenPoint(evt);
    if (pointers.current.has(evt.pointerId)) pointers.current.set(evt.pointerId, sp);
    const d = dragRef.current;

    if (!d) {
      if (evt.pointerType !== 'mouse') return;
      const overCanvas = (evt.target as HTMLElement)?.tagName === 'CANVAS';
      if (tool === 'draw') setCursor(snapDraw(toWorld(viewRef.current, sp)));
      else if ((tool === 'place' || tool === 'measure') && overCanvas) hoverTool(toWorld(viewRef.current, sp));
      return;
    }
    switch (d.kind) {
      case 'pinch': {
        if (pointers.current.size < 2) return;
        const [a, b] = [...pointers.current.values()];
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        const f = dist(a, b) / d.startDist;
        const v0 = zoomAt(d.startView, d.startMid, f);
        setView({ ...v0, x: v0.x + mid.x - d.startMid.x, y: v0.y + mid.y - d.startMid.y });
        break;
      }
      case 'pan': {
        if (!d.moved && dist(sp, d.start) < TAP_PX) return;
        d.moved = true;
        setView({ ...d.startView, x: d.startView.x + sp.x - d.start.x, y: d.startView.y + sp.y - d.start.y });
        break;
      }
      case 'draw':
        setCursor(snapDraw(toWorld(viewRef.current, sp)));
        break;
      case 'tool':
        hoverTool(toWorld(viewRef.current, sp));
        break;
      case 'item':
        if (!d.moved && dist(sp, d.start) < TAP_PX) return;
        d.moved = true;
        moveItem(d, toWorld(viewRef.current, sp));
        break;
      case 'struct':
        if (!d.moved && dist(sp, d.start) < TAP_PX) return;
        d.moved = true;
        moveStruct(d, toWorld(viewRef.current, sp));
        break;
      case 'corner': {
        if (!d.moved && dist(sp, d.start) < TAP_PX / 2) return;
        d.moved = true;
        const room = useProject.getState().project.rooms.find((r) => r.id === d.roomId);
        if (!room) return;
        const n = room.points.length;
        const neighbours = [room.points[(d.index - 1 + n) % n], room.points[(d.index + 1) % n]];
        const r = snap(toWorld(viewRef.current, sp), { excludeRoom: d.roomId, alignTo: neighbours });
        setCursor({ point: r.point, guides: r.guides });
        dragCorner(d.roomId, d.index, r.point);
        break;
      }
      case 'room': {
        if (!d.moved && dist(sp, d.start) < TAP_PX) return;
        d.moved = true;
        const w = toWorld(viewRef.current, sp);
        let delta = sub(w, d.startWorld);
        if (prefs.snapGrid) {
          const g = prefs.gridSize;
          delta = { x: Math.round(delta.x / g) * g, y: Math.round(delta.y / g) * g };
        }
        const guides: SnapGuide[] = [];
        if (prefs.snapObjects) {
          // butt walls together: snap any corner (inner or outer) of the moved room to any corner of another room
          const tol = SNAP_PX / viewRef.current.scale;
          const raw = sub(w, d.startWorld);
          const mine = [...d.original.points, ...outerPolygon(d.original)];
          const others = snapTargets.filter((t) => t.roomId !== d.roomId).flatMap((t) => t.points);
          let best: { delta: Vec2; d: number; at: Vec2 } | null = null;
          for (const m of mine) {
            const moved = add(m, raw);
            for (const o of others) {
              const dd = dist(moved, o);
              if (dd < tol && (!best || dd < best.d)) best = { delta: sub(o, m), d: dd, at: o };
            }
          }
          if (best) {
            delta = best.delta;
            guides.push({ kind: 'point', at: best.at });
          }
        }
        setCursor(guides.length ? { point: w, guides } : null);
        dragRoom(d.original, delta);
        break;
      }
    }
  };

  const handleUp = (evt: PointerEvent) => {
    const had = pointers.current.delete(evt.pointerId);
    const d = dragRef.current;
    if (!d || !had) return;
    if (d.kind === 'pinch') {
      if (pointers.current.size === 0) dragRef.current = null;
      return;
    }
    if (pointers.current.size > 0) return;
    dragRef.current = null;
    const sp = screenPoint(evt);
    switch (d.kind) {
      case 'pan':
        if (!d.moved && d.tapDeselect) setUI({ selection: null });
        break;
      case 'draw': {
        const r = snapDraw(toWorld(viewRef.current, sp));
        placeDraftPoint(r.point);
        if (d.pointerType !== 'mouse') setCursor(null);
        break;
      }
      case 'corner':
        setCursor(null);
        finishGesture(d.roomId);
        break;
      case 'room':
        setCursor(null);
        finishGesture();
        break;
      case 'tool':
        tapTool(toWorld(viewRef.current, sp));
        if (d.pointerType !== 'mouse' && tool === 'place') setGhost(null);
        break;
      case 'item':
      case 'struct':
        finishGesture();
        break;
    }
  };

  // Window-level listeners so drags continue outside the canvas.
  const handlers = useRef({ handleMove, handleUp });
  handlers.current = { handleMove, handleUp };
  useEffect(() => {
    const mv = (e: PointerEvent) => handlers.current.handleMove(e);
    const up = (e: PointerEvent) => handlers.current.handleUp(e);
    window.addEventListener('pointermove', mv);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => {
      window.removeEventListener('pointermove', mv);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
  }, []);

  const onWheel = (e: KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault();
    const sp = screenPoint(e.evt);
    const k = e.evt.ctrlKey ? 0.01 : 0.0015;
    setView((v) => zoomAt(v, sp, Math.exp(-e.evt.deltaY * k)));
  };

  /* ---------- keyboard (capture phase: runs before global shortcuts) ---------- */
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement)?.closest?.('input, textarea, select');
      if (e.code === 'Space' && !typing) {
        spaceDown.current = true;
        if (e.target === document.body) e.preventDefault();
      }
      if ((tool === 'place' || tool === 'measure') && e.key === 'Escape' && !typing) {
        setPending(null);
        setGhost(null);
        setCursor(null);
        setUI({ tool: 'select', placing: null });
        e.stopPropagation();
        return;
      }
      if (tool !== 'draw' || typing) return;
      if (e.key === 'Escape') {
        if (draft.length) setDraft([]);
        else setUI({ tool: 'select' });
        e.stopPropagation();
      } else if (e.key === 'Enter' && draft.length >= 3) {
        finishDraft(draft);
        e.stopPropagation();
      } else if (e.key === 'Backspace' && draft.length) {
        setDraft(draft.slice(0, -1));
        e.preventDefault();
        e.stopPropagation();
      } else if (/^[0-9.]$/.test(e.key) && draft.length && !e.ctrlKey && !e.metaKey) {
        // start typing a length
        const input = document.getElementById('rc-typed-length') as HTMLInputElement | null;
        if (input) {
          input.focus();
        }
      }
    };
    const upk = (e: KeyboardEvent) => {
      if (e.code === 'Space') spaceDown.current = false;
    };
    window.addEventListener('keydown', down, true);
    window.addEventListener('keyup', upk, true);
    return () => {
      window.removeEventListener('keydown', down, true);
      window.removeEventListener('keyup', upk, true);
    };
  }, [tool, draft, finishDraft, setUI]);

  /* ---------- dimension editing ---------- */
  const commitDim = () => {
    if (!dimEdit) return;
    const mm = parseLength(dimEdit.value, prefs.units);
    if (mm && mm > 0) setWallLengthAction(dimEdit.roomId, dimEdit.index, mm);
    else useUI.getState().notify(`Couldn't read "${dimEdit.value}" as a length.`, 'error');
    setDimEdit(null);
  };

  const openDimEdit = (room: Room, index: number, labelWorld: Vec2) => {
    const n = room.points.length;
    const L = dist(room.points[index], room.points[(index + 1) % n]);
    setDimEdit({
      roomId: room.id,
      index,
      at: toScreen(viewRef.current, labelWorld),
      value: formatLength(L, prefs.units, { suffix: prefs.units === 'ftin' }),
    });
  };

  /* ---------- render ---------- */
  const px = 1 / view.scale; // one screen pixel in mm
  const activeRoomId = selRoomId(selection);
  const cursorStyle = tool === 'draw' || tool === 'place' || tool === 'measure' ? 'crosshair' : tool === 'pan' ? 'grab' : 'default';
  const L = prefs.layers;

  return (
    <div
      ref={containerRef}
      className="plan-editor"
      style={{ cursor: cursorStyle, background: palette.bg }}
      onContextMenu={(e) => e.preventDefault()}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('application/x-roomcraft')) e.preventDefault();
      }}
      onDrop={onDrop}
    >
      <Stage
        width={size.w}
        height={size.h}
        onWheel={onWheel}
        onPointerDown={(e) => {
          if (e.target === e.target.getStage() || tool === 'draw' || tool === 'place' || tool === 'measure') handleDown(e.evt, { kind: 'bg' });
        }}
      >
        <Layer listening={false}>
          <Grid view={view} width={size.w} height={size.h} gridSize={prefs.gridSize} palette={palette} />
        </Layer>
        <Layer listening={tool === 'select' || tool === 'pan'}>
          <Group x={view.x} y={view.y} scaleX={view.scale} scaleY={view.scale}>
            {rooms.map((room) => (
              <RoomShape
                key={room.id}
                room={room}
                px={px}
                palette={palette}
                selected={selection?.kind === 'room' && selection.roomId === room.id}
                selectedWallId={selection?.kind === 'wall' && selection.roomId === room.id ? selection.wallId : undefined}
                showDims={prefs.layers.dimensions}
                units={prefs.units}
                onDown={handleDown}
                onDimClick={openDimEdit}
                onWallDbl={(i, w) => {
                  const n = room.points.length;
                  const c = closestOnSegment(w, room.points[i], room.points[(i + 1) % n]);
                  if (c.t > 0.02 && c.t < 0.98) addCorner(room.id, i, c.t);
                }}
              />
            ))}
            <OpeningsLayer project={project} palette={palette} px={px} selection={selection} onDown={handleDown} />
            {L.structure && <StructureLayer project={project} palette={palette} px={px} selection={selection} units={prefs.units} onDown={handleDown} />}
            {L.furniture && <FurnitureLayer project={project} palette={palette} px={px} selection={selection} clashIds={clashIds} units={prefs.units} onDown={handleDown} />}
            {L.furniture && <CountertopLayer pieces={counterPieces} stoneId={project.countertop.stone} px={px} palette={palette} />}
            <ServicesLayer project={project} palette={palette} px={px} selection={selection} layers={L} onDown={handleDown} />
            {/* corner handles for the active room */}
            {tool === 'select' &&
              rooms
                .filter((r) => r.id === activeRoomId)
                .map((r) =>
                  r.points.map((p, i) => {
                    const sel = selection?.kind === 'corner' && selection.index === i;
                    return (
                      <Circle
                        key={`${r.id}-h${i}`}
                        x={p.x}
                        y={p.y}
                        radius={(sel ? 8 : 6.5) * px}
                        hitStrokeWidth={14 * px}
                        fill={sel ? palette.handleStroke : palette.handle}
                        stroke={palette.handleStroke}
                        strokeWidth={2 * px}
                        onPointerDown={(e) => {
                          e.cancelBubble = true;
                          handleDown(e.evt, { kind: 'corner', roomId: r.id, index: i });
                        }}
                        onMouseEnter={(e) => (e.target.getStage()!.container().style.cursor = 'move')}
                        onMouseLeave={(e) => (e.target.getStage()!.container().style.cursor = cursorStyle)}
                      />
                    );
                  }),
                )}
          </Group>
        </Layer>
        <Layer listening={false}>
          <Group x={view.x} y={view.y} scaleX={view.scale} scaleY={view.scale}>
            {tool === 'draw' && <DraftShape draft={draft} cursor={cursor} px={px} palette={palette} units={prefs.units} />}
            {tool !== 'draw' && cursor && <Guides guides={cursor.guides} px={px} palette={palette} />}
            {measurements.map((m, i) => (
              <MeasureLine key={i} a={m.a} b={m.b} px={px} palette={palette} units={prefs.units} />
            ))}
            {ghost && <GhostShape ghost={ghost} px={px} palette={palette} units={prefs.units} />}
            {pending && <Circle x={pending.x} y={pending.y} radius={5 * px} fill={palette.guide} />}
          </Group>
        </Layer>
      </Stage>

      {dimEdit && (
        <input
          className="dim-input"
          autoFocus
          style={{ left: dimEdit.at.x, top: dimEdit.at.y }}
          value={dimEdit.value}
          onChange={(e) => setDimEdit({ ...dimEdit, value: e.target.value })}
          onFocus={(e) => e.target.select()}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitDim();
            if (e.key === 'Escape') setDimEdit(null);
            e.stopPropagation();
          }}
          onBlur={() => setDimEdit(null)}
        />
      )}

      <div className="plan-hud">
        {tool === 'draw' ? (
          <>
            <span>
              {draft.length === 0
                ? 'Click/tap to place the first corner'
                : draft.length < 3
                  ? 'Place the next corner — or type a length'
                  : 'Click the first corner or press Enter to close the room'}
            </span>
            {draft.length > 0 && (
              <form
                className="typed-length"
                onSubmit={(e) => {
                  e.preventDefault();
                  placeTypedLength();
                }}
              >
                <input
                  id="rc-typed-length"
                  placeholder="Length"
                  inputMode="decimal"
                  value={typedLen}
                  onChange={(e) => setTypedLen(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') (e.target as HTMLInputElement).blur();
                    e.stopPropagation();
                  }}
                />
                <button type="submit" className="btn small">
                  Add
                </button>
                <button type="button" className="btn small" onClick={() => setDraft(draft.slice(0, -1))}>
                  Undo pt
                </button>
                {draft.length >= 3 && (
                  <button type="button" className="btn small primary" onClick={() => finishDraft(draft)}>
                    Close room
                  </button>
                )}
              </form>
            )}
          </>
        ) : tool === 'place' && placing ? (
          <span>
            {placing.cat === 'beam'
              ? pending
                ? 'Click the beam end point'
                : 'Click the beam start point'
              : placing.cat === 'opening'
                ? 'Click on a wall to place it'
                : 'Click to place · snaps to walls and neighbours'}{' '}
            · <kbd>Esc</kbd> cancel
          </span>
        ) : tool === 'measure' ? (
          <span>
            {pending ? 'Click the second point' : 'Click two points to measure'} ·{' '}
            <button className="link" onClick={() => setUI({ measurements: [] })}>
              clear ({measurements.length})
            </button>
          </span>
        ) : (
          <span className="muted">
            {selection?.kind === 'module' || selection?.kind === 'appliance'
              ? 'Drag to move (snaps to walls & neighbours) · R rotate · Ctrl+D duplicate · Shift-click to multi-select'
              : selection?.kind === 'room'
              ? 'Drag the room to move it · drag corners to reshape · tap a dimension to edit'
              : selection?.kind === 'wall'
                ? 'Double-click a wall to add a corner · tap its dimension to change length'
                : 'Drag to pan · scroll/pinch to zoom · select a room to edit'}
          </span>
        )}
      </div>

      <div className="zoom-controls">
        <button className="btn icon" title="Zoom in" onClick={() => setView((v) => zoomAt(v, { x: size.w / 2, y: size.h / 2 }, 1.25))}>
          +
        </button>
        <button className="btn icon" title="Zoom out" onClick={() => setView((v) => zoomAt(v, { x: size.w / 2, y: size.h / 2 }, 0.8))}>
          −
        </button>
        <button className="btn icon" title="Fit to content (F)" onClick={fit}>
          ⤢
        </button>
        <span className="scale-label">{formatLength(100 / view.scale, prefs.units)} / 100px</span>
      </div>
    </div>
  );
}

/* ====================================================================== */

interface RoomShapeProps {
  room: Room;
  px: number;
  palette: Palette;
  selected: boolean;
  selectedWallId?: string;
  showDims: boolean;
  units: ReturnType<typeof usePrefs.getState>['units'];
  onDown: (evt: PointerEvent, t: Target) => void;
  onDimClick: (room: Room, index: number, labelWorld: Vec2) => void;
  onWallDbl: (index: number, world: Vec2) => void;
}

function RoomShape({ room, px, palette, selected, selectedWallId, showDims, units, onDown, onDimClick, onWallDbl }: RoomShapeProps) {
  const quads = useMemo(() => wallQuads(room), [room]);
  const c = useMemo(() => centroid(room.points), [room]);
  const area = polygonArea(room.points);
  const flat = room.points.flatMap((p) => [p.x, p.y]);
  const n = room.points.length;
  const highlight = selected || !!selectedWallId;

  return (
    <Group>
      <Line
        points={flat}
        closed
        fill={highlight ? palette.floorSelected : palette.floor}
        onPointerDown={(e) => {
          e.cancelBubble = true;
          onDown(e.evt, { kind: 'room', roomId: room.id });
        }}
      />
      {quads.map((q, i) => {
        const wall = room.walls[i];
        const isSel = wall.id === selectedWallId;
        return (
          <Line
            key={wall.id}
            points={q.flatMap((p) => [p.x, p.y])}
            closed
            fill={isSel ? palette.wallSelected : palette.wall}
            stroke={highlight ? palette.wallSelected : palette.wallStroke}
            strokeWidth={1}
            strokeScaleEnabled={false}
            onPointerDown={(e) => {
              e.cancelBubble = true;
              onDown(e.evt, { kind: 'wall', roomId: room.id, wallId: wall.id });
            }}
            onDblClick={(e) => {
              const st = e.target.getStage()!;
              const pos = st.getPointerPosition()!;
              const g = e.target.getParent()!.getParent()!; // world group
              const w = g.getAbsoluteTransform().copy().invert().point(pos);
              onWallDbl(i, w);
            }}
            onDblTap={(e) => {
              const st = e.target.getStage()!;
              const pos = st.getPointerPosition()!;
              const g = e.target.getParent()!.getParent()!;
              onWallDbl(i, g.getAbsoluteTransform().copy().invert().point(pos));
            }}
          />
        );
      })}
      <Text
        x={c.x}
        y={c.y}
        text={`${room.name}\n${formatArea(area, units)}`}
        fontSize={13 * px}
        lineHeight={1.3}
        align="center"
        fill={palette.text}
        width={220 * px}
        offsetX={110 * px}
        offsetY={14 * px}
        listening={false}
        fontStyle="600"
      />
      {showDims &&
        room.points.map((a, i) => {
          const b = room.points[(i + 1) % n];
          const L = dist(a, b);
          if (L < 1) return null;
          const inward = vscale(outwardNormal(a, b), -1);
          const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
          const pos = add(mid, vscale(inward, 16 * px));
          let rot = -angleDeg(a, b);
          if (rot < -90 && rot >= -270) rot += 180;
          const label = formatLength(L, units);
          const w = (label.length * 6.6 + 10) * px;
          const h = 16 * px;
          return (
            <Group
              key={`d${i}`}
              x={pos.x}
              y={pos.y}
              rotation={rot}
              onPointerDown={(e) => {
                e.cancelBubble = true;
              }}
              onClick={() => onDimClick(room, i, pos)}
              onTap={() => onDimClick(room, i, pos)}
              onMouseEnter={(e) => (e.target.getStage()!.container().style.cursor = 'text')}
              onMouseLeave={(e) => (e.target.getStage()!.container().style.cursor = '')}
            >
              <Rect x={-w / 2} y={-h / 2} width={w} height={h} cornerRadius={3 * px} fill={palette.dimBg} stroke={palette.dim} strokeWidth={0.75 * px} />
              <Text
                x={-w / 2}
                y={-h / 2}
                width={w}
                height={h}
                text={label}
                fontSize={11 * px}
                align="center"
                verticalAlign="middle"
                fill={palette.dim}
                listening={false}
              />
            </Group>
          );
        })}
    </Group>
  );
}

function DraftShape({ draft, cursor, px, palette, units }: { draft: Vec2[]; cursor: SnapResult | null; px: number; palette: Palette; units: RoomShapeProps['units'] }) {
  const pts = cursor ? [...draft, cursor.point] : draft;
  const last = draft[draft.length - 1];
  const closing = cursor && draft.length >= 3 && dist(cursor.point, draft[0]) < 0.5;
  return (
    <Group>
      {pts.length > 1 && <Line points={pts.flatMap((p) => [p.x, p.y])} stroke={palette.accent} strokeWidth={2.5 * px} lineJoin="round" />}
      {draft.length >= 2 && cursor && (
        <Line points={[cursor.point.x, cursor.point.y, draft[0].x, draft[0].y]} stroke={palette.accent} strokeWidth={1 * px} dash={[6 * px, 5 * px]} opacity={0.6} />
      )}
      {draft.map((p, i) => (
        <Circle key={i} x={p.x} y={p.y} radius={(i === 0 ? 6 : 4) * px} fill={i === 0 ? palette.accent : palette.handle} stroke={palette.accent} strokeWidth={1.5 * px} />
      ))}
      {/* finished-segment lengths */}
      {draft.slice(1).map((p, i) => (
        <SegLabel key={`s${i}`} a={draft[i]} b={p} px={px} palette={palette} units={units} />
      ))}
      {cursor && <Guides guides={cursor.guides} px={px} palette={palette} />}
      {cursor && (
        <Circle x={cursor.point.x} y={cursor.point.y} radius={(closing ? 9 : 4) * px} stroke={palette.guide} strokeWidth={1.5 * px} />
      )}
      {cursor && last && dist(last, cursor.point) > 1 && (
        <Group>
          <SegLabel a={last} b={cursor.point} px={px} palette={palette} units={units} live />
        </Group>
      )}
    </Group>
  );
}

function SegLabel({ a, b, px, palette, units, live }: { a: Vec2; b: Vec2; px: number; palette: Palette; units: RoomShapeProps['units']; live?: boolean }) {
  const L = dist(a, b);
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const nrm = outwardNormal(a, b);
  const pos = add(mid, vscale(nrm, 18 * px));
  const text = live ? `${formatLength(L, units)}  ${Math.round(angleDeg(a, b) * 10) / 10}°` : formatLength(L, units);
  const w = (text.length * 6.8 + 10) * px;
  return (
    <Group x={pos.x} y={pos.y}>
      <Rect x={-w / 2} y={-9 * px} width={w} height={18 * px} cornerRadius={4 * px} fill={live ? palette.accent : palette.dimBg} />
      <Text x={-w / 2} y={-9 * px} width={w} height={18 * px} text={text} align="center" verticalAlign="middle" fontSize={11.5 * px} fill={live ? '#fff' : palette.dim} fontStyle={live ? 'bold' : 'normal'} />
    </Group>
  );
}

function Guides({ guides, px, palette }: { guides: SnapGuide[]; px: number; palette: Palette }) {
  return (
    <>
      {guides.map((g, i) => {
        switch (g.kind) {
          case 'point':
            return <Rect key={i} x={g.at.x - 6 * px} y={g.at.y - 6 * px} width={12 * px} height={12 * px} stroke={palette.guide} strokeWidth={1.5 * px} />;
          case 'segment':
            return <Line key={i} points={[g.a.x, g.a.y, g.b.x, g.b.y]} stroke={palette.guide} strokeWidth={2 * px} opacity={0.7} />;
          case 'alignX':
          case 'alignY':
            return <Line key={i} points={[g.from.x, g.from.y, g.to.x, g.to.y]} stroke={palette.guide} strokeWidth={1 * px} dash={[5 * px, 4 * px]} />;
          case 'angle':
            return null;
        }
      })}
    </>
  );
}

function GhostShape({ ghost, px, palette, units }: { ghost: Ghost; px: number; palette: Palette; units: RoomShapeProps['units'] }) {
  switch (ghost.cat) {
    case 'opening':
      return (
        <Group opacity={0.75}>
          <Line points={ghost.poly.flatMap((p) => [p.x, p.y])} closed fill={palette.accent} opacity={0.4} />
          {ghost.lines.map((l, i) => (
            <Line key={i} points={l.flatMap((p) => [p.x, p.y])} stroke={palette.accent} strokeWidth={1.5 * px} />
          ))}
        </Group>
      );
    case 'service':
      return <Circle x={ghost.at.x} y={ghost.at.y} radius={9 * px} fill={ghost.color} opacity={0.7} />;
    case 'column':
      return <Line points={ghost.poly.flatMap((p) => [p.x, p.y])} closed fill={palette.column} opacity={0.5} />;
    case 'beam':
      return <Line points={[ghost.a.x, ghost.a.y, ghost.b.x, ghost.b.y]} stroke={palette.beam} strokeWidth={230} opacity={0.35} />;
    case 'module':
      return <ModuleShape m={ghost.m} palette={palette} px={px} selected clash={false} units={units} ghost />;
    case 'appliance':
      return <ApplianceShape a={ghost.a} palette={palette} px={px} selected clash={false} ghost />;
    case 'measure':
      return <MeasureLine a={ghost.a} b={ghost.b} px={px} palette={palette} units={units} />;
  }
}
