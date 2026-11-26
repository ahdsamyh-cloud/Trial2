import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Circle, Group, Layer, Line, Rect, Stage, Text } from 'react-konva';
import type { KonvaEventObject } from 'konva/lib/Node';
import { useProject } from '../store/projectStore';
import { usePrefs, useUI } from '../store/uiStore';
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
  addCorner,
  addRoomFromPoints,
  dragCorner,
  dragRoom,
  finishGesture,
  setWallLengthAction,
} from '../store/actions';

type Target =
  | { kind: 'bg' }
  | { kind: 'room'; roomId: string }
  | { kind: 'wall'; roomId: string; wallId: string }
  | { kind: 'corner'; roomId: string; index: number };

type Drag =
  | { kind: 'pan'; start: Vec2; startView: ViewTransform; moved: boolean; tapDeselect: boolean }
  | { kind: 'corner'; roomId: string; index: number; moved: boolean; start: Vec2 }
  | { kind: 'room'; roomId: string; original: Room; startWorld: Vec2; start: Vec2; moved: boolean }
  | { kind: 'draw'; start: Vec2; pointerType: string }
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

  const rooms = useProject((s) => s.project.rooms);
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
  }, [tool]);

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
    }
  };

  const handleMove = (evt: PointerEvent) => {
    if (!containerRef.current) return;
    const sp = screenPoint(evt);
    if (pointers.current.has(evt.pointerId)) pointers.current.set(evt.pointerId, sp);
    const d = dragRef.current;

    if (!d) {
      if (tool === 'draw' && evt.pointerType === 'mouse') setCursor(snapDraw(toWorld(viewRef.current, sp)));
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
  const activeRoomId = selection?.roomId;
  const cursorStyle = tool === 'draw' ? 'crosshair' : tool === 'pan' ? 'grab' : 'default';

  return (
    <div
      ref={containerRef}
      className="plan-editor"
      style={{ cursor: cursorStyle, background: palette.bg }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <Stage
        width={size.w}
        height={size.h}
        onWheel={onWheel}
        onPointerDown={(e) => {
          if (e.target === e.target.getStage() || tool === 'draw') handleDown(e.evt, { kind: 'bg' });
        }}
      >
        <Layer listening={false}>
          <Grid view={view} width={size.w} height={size.h} gridSize={prefs.gridSize} palette={palette} />
        </Layer>
        <Layer listening={tool !== 'draw'}>
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
        ) : (
          <span className="muted">
            {selection?.kind === 'room'
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
