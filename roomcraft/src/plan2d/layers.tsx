import { Circle, Group, Line, Rect, Text } from 'react-konva';
import type { KonvaEventObject } from 'konva/lib/Node';
import type { Palette } from '../theme';
import type { ApplianceInstance, LengthUnit, ModuleInstance, Project, Vec2 } from '../model/types';
import { add, dist, scale as vscale, sub, norm, angleDeg } from '../model/geometry';
import {
  beamPolygon,
  clampOpening,
  clipAlong,
  columnPolygon,
  findWall,
  footprint,
  localToPlan,
  pointOnWall,
  servicePosition,
  type WallFrame,
} from '../model/structure';
import { finishById, serviceDef } from '../model/catalog';
import { applianceDef } from '../model/appliances';
import { moduleDef } from '../model/furniture';
import { asPlaced, type CounterPiece } from '../model/countertop';
import { stoneById } from '../model/catalog';
import { formatLength } from '../model/units';
import type { Selection } from '../store/uiStore';

export type ItemTarget =
  | { kind: 'item'; cat: 'module' | 'appliance'; id: string }
  | { kind: 'opening'; id: string }
  | { kind: 'service'; id: string }
  | { kind: 'column'; id: string }
  | { kind: 'beam'; id: string };

type Down = (evt: PointerEvent, t: ItemTarget) => void;
const flat = (pts: Vec2[]) => pts.flatMap((p) => [p.x, p.y]);
const stop = (fn: Down, t: ItemTarget) => (e: KonvaEventObject<PointerEvent>) => {
  e.cancelBubble = true;
  fn(e.evt, t);
};

/* ---------------- openings ---------------- */

export function openingSymbol(f: WallFrame, o: { offset: number; width: number; kind: string; hinge: 'left' | 'right'; swing: 'in' | 'out' }) {
  const a = pointOnWall(f, o.offset);
  const b = pointOnWall(f, o.offset + o.width);
  const gap = clipAlong([f.a, f.b, f.ob, f.oa], f.a, f.dir, o.offset, o.offset + o.width);
  const lines: Vec2[][] = [];
  if (o.kind === 'door') {
    const H = o.hinge === 'left' ? a : b;
    const closed = norm(sub(o.hinge === 'left' ? b : a, H));
    const open = o.swing === 'in' ? f.inward : vscale(f.inward, -1);
    const tip = add(H, vscale(open, o.width));
    lines.push([H, tip]);
    const arc: Vec2[] = [];
    for (let i = 0; i <= 16; i++) {
      const th = (i / 16) * (Math.PI / 2);
      arc.push(add(H, vscale(add(vscale(closed, Math.cos(th)), vscale(open, Math.sin(th))), o.width)));
    }
    lines.push(arc);
  } else if (o.kind === 'window') {
    const t = f.wall.thickness;
    for (const k of [0.35, 0.65]) {
      const off = vscale(f.inward, -t * k);
      lines.push([add(a, off), add(b, off)]);
    }
  }
  return { gap, lines, a, b };
}

export function OpeningsLayer({ project, palette, px, selection, onDown }: { project: Project; palette: Palette; px: number; selection: Selection; onDown: Down }) {
  return (
    <>
      {project.openings.map((o0) => {
        const f = findWall(project, o0.wallId);
        if (!f) return null;
        const o = clampOpening(o0, f.length);
        const sym = openingSymbol(f, o);
        const sel = selection?.kind === 'opening' && selection.id === o.id;
        const stroke = sel ? palette.wallSelected : palette.wallStroke;
        return (
          <Group key={o.id} onPointerDown={stop(onDown, { kind: 'opening', id: o.id })}>
            <Line points={flat(sym.gap)} closed fill={o.kind === 'window' ? palette.windowFill : palette.floor} stroke={stroke} strokeWidth={1.2 * px} />
            {sym.lines.map((l, i) => (
              <Line key={i} points={flat(l)} stroke={sel ? palette.wallSelected : palette.text} strokeWidth={(i === 0 && o.kind === 'door' ? 2 : 1) * px} dash={o.kind === 'door' && i === 1 ? [6 * px, 4 * px] : undefined} />
            ))}
            {/* fat invisible hit area along the opening */}
            <Line points={flat([sym.a, sym.b])} stroke="transparent" strokeWidth={Math.max(f.wall.thickness, 20 * px)} />
          </Group>
        );
      })}
    </>
  );
}

/* ---------------- services ---------------- */

export function ServicesLayer({ project, palette, px, selection, layers, onDown }: { project: Project; palette: Palette; px: number; selection: Selection; layers: { electrical: boolean; plumbing: boolean }; onDown: Down }) {
  return (
    <>
      {project.services.map((s) => {
        const def = serviceDef(s.kind);
        if (def.group === 'electrical' && !layers.electrical) return null;
        if (def.group === 'plumbing' && !layers.plumbing) return null;
        let p = servicePosition(project, s);
        if (s.wallId) {
          const f = findWall(project, s.wallId);
          if (f) p = add(p, vscale(f.inward, 11 * px));
        }
        const sel = selection?.kind === 'service' && selection.id === s.id;
        const r = 9 * px;
        return (
          <Group key={s.id} x={p.x} y={p.y} onPointerDown={stop(onDown, { kind: 'service', id: s.id })}>
            {def.mount === 'ceiling' ? (
              <>
                <Circle radius={r} fill={palette.bg} stroke={def.color} strokeWidth={2 * px} />
                <Line points={[-r * 0.7, -r * 0.7, r * 0.7, r * 0.7]} stroke={def.color} strokeWidth={1.5 * px} />
                <Line points={[-r * 0.7, r * 0.7, r * 0.7, -r * 0.7]} stroke={def.color} strokeWidth={1.5 * px} />
              </>
            ) : (
              <Circle radius={r} fill={def.color} stroke={sel ? palette.wallSelected : palette.bg} strokeWidth={(sel ? 3 : 1.5) * px} />
            )}
            {def.mount !== 'ceiling' && (
              <Text text={def.symbol} fontSize={(def.symbol.length > 1 ? 8 : 10) * px} fill="#fff" fontStyle="bold" width={2 * r} height={2 * r} offsetX={r} offsetY={r} align="center" verticalAlign="middle" listening={false} />
            )}
            {sel && <Circle radius={r + 4 * px} stroke={palette.wallSelected} strokeWidth={2 * px} listening={false} />}
          </Group>
        );
      })}
    </>
  );
}

/* ---------------- structure ---------------- */

export function StructureLayer({ project, palette, px, selection, units, onDown }: { project: Project; palette: Palette; px: number; selection: Selection; units: LengthUnit; onDown: Down }) {
  return (
    <>
      {project.columns.map((c) => {
        const sel = selection?.kind === 'column' && selection.id === c.id;
        const poly = columnPolygon(c);
        return (
          <Group key={c.id} onPointerDown={stop(onDown, { kind: 'column', id: c.id })}>
            <Line points={flat(poly)} closed fill={palette.column} stroke={sel ? palette.wallSelected : palette.wallStroke} strokeWidth={(sel ? 3 : 1) * px} />
            <Line points={flat([poly[0], poly[2]])} stroke={palette.bg} strokeWidth={1 * px} listening={false} />
            <Line points={flat([poly[1], poly[3]])} stroke={palette.bg} strokeWidth={1 * px} listening={false} />
          </Group>
        );
      })}
      {project.beams.map((b) => {
        const sel = selection?.kind === 'beam' && selection.id === b.id;
        const poly = beamPolygon(b);
        const mid = { x: (b.a.x + b.b.x) / 2, y: (b.a.y + b.b.y) / 2 };
        let rot = -angleDeg(b.a, b.b);
        if (rot < -90 && rot >= -270) rot += 180;
        return (
          <Group key={b.id} onPointerDown={stop(onDown, { kind: 'beam', id: b.id })}>
            <Line points={flat(poly)} closed fill={sel ? 'rgba(52,209,161,0.18)' : palette.beamFill} stroke={sel ? palette.wallSelected : palette.beam} strokeWidth={1.5 * px} dash={[10 * px, 6 * px]} />
            <Text
              x={mid.x}
              y={mid.y}
              rotation={rot}
              text={`Beam ${Math.round(b.width)}×${Math.round(b.depth)} · ${formatLength(b.bottom, units)} AFF`}
              fontSize={10 * px}
              fill={palette.beam}
              width={260 * px}
              offsetX={130 * px}
              offsetY={5 * px}
              align="center"
              listening={false}
            />
          </Group>
        );
      })}
    </>
  );
}

/* ---------------- furniture & appliances ---------------- */

export function FurnitureLayer({
  project,
  palette,
  px,
  selection,
  clashIds,
  units,
  onDown,
}: {
  project: Project;
  palette: Palette;
  px: number;
  selection: Selection;
  clashIds: Set<string>;
  units: LengthUnit;
  onDown: Down;
}) {
  const selIds = new Set(selection?.kind === 'module' ? (selection.ids.length ? selection.ids : [selection.id]) : selection?.kind === 'appliance' ? [selection.id] : []);
  const mods = [...project.modules].sort((a, b) => (moduleDef(a.type)?.kind === 'wall' ? 1 : 0) - (moduleDef(b.type)?.kind === 'wall' ? 1 : 0));
  return (
    <>
      {mods.map((m) => (
        <ModuleShape key={m.id} m={m} palette={palette} px={px} selected={selIds.has(m.id)} clash={clashIds.has(m.id)} units={units} onDown={onDown} />
      ))}
      {project.appliances.map((a) => (
        <ApplianceShape key={a.id} a={a} palette={palette} px={px} selected={selIds.has(a.id)} clash={clashIds.has(a.id)} onDown={onDown} />
      ))}
    </>
  );
}

export function ModuleShape({ m, palette, px, selected, clash, units, onDown, ghost }: { m: ModuleInstance; palette: Palette; px: number; selected: boolean; clash: boolean; units: LengthUnit; onDown?: Down; ghost?: boolean }) {
  const def = moduleDef(m.type);
  const fp = footprint(m);
  const wall = def?.kind === 'wall';
  const col = finishById(m.frontFinish ?? 'lam-oak').color;
  const frontL = localToPlan(m, 0, m.depth);
  const frontR = localToPlan(m, m.width, m.depth);
  const c = localToPlan(m, m.width / 2, m.depth / 2);
  let rot = m.rotation;
  if (rot > 90 && rot <= 270) rot -= 180;
  const stroke = clash ? palette.danger : selected ? palette.wallSelected : palette.furnitureStroke;
  return (
    <Group opacity={ghost ? 0.6 : 1} listening={!ghost} onPointerDown={onDown ? stop(onDown, { kind: 'item', cat: 'module', id: m.id }) : undefined}>
      <Line
        points={flat(fp)}
        closed
        fill={wall ? 'rgba(120,140,160,0.12)' : col}
        opacity={wall ? 1 : 0.85}
        stroke={stroke}
        strokeWidth={(selected || clash ? 2.5 : 1.2) * px}
        dash={wall ? [8 * px, 5 * px] : undefined}
      />
      {!wall && <Line points={flat([frontL, frontR])} stroke={stroke} strokeWidth={3 * px} listening={false} />}
      {m.runId && <Line points={flat([localToPlan(m, 4 * px, 4 * px), localToPlan(m, m.width - 4 * px, 4 * px)])} stroke={palette.accent} strokeWidth={2 * px} dash={[3 * px, 3 * px]} listening={false} />}
      <Text
        x={c.x}
        y={c.y}
        rotation={rot}
        text={`${def?.icon ?? ''} ${m.name}\n${formatLength(m.width, units)}`}
        fontSize={10 * px}
        lineHeight={1.25}
        fill={wall ? palette.textMuted : '#1d1f22'}
        width={Math.max(60 * px, m.width)}
        offsetX={Math.max(60 * px, m.width) / 2}
        offsetY={wall ? -m.depth / 2 + 26 * px : 12 * px}
        align="center"
        listening={false}
        ellipsis
        wrap="none"
      />
    </Group>
  );
}

export function ApplianceShape({ a, palette, px, selected, clash, onDown, ghost }: { a: ApplianceInstance; palette: Palette; px: number; selected: boolean; clash: boolean; onDown?: Down; ghost?: boolean }) {
  const def = applianceDef(a.type);
  const fp = footprint(a);
  const stroke = clash ? palette.danger : selected ? palette.wallSelected : palette.applianceStroke;
  const inner: Vec2[][] = [];
  const circles: { c: Vec2; r: number }[] = [];
  if (def?.cutout?.kind === 'sink') {
    const bowls = a.type === 'sink-double' ? 2 : 1;
    const bw = (a.width - 60 - (bowls - 1) * 40) / bowls;
    for (let i = 0; i < bowls; i++) {
      const u0 = 30 + i * (bw + 40);
      inner.push([localToPlan(a, u0, 40), localToPlan(a, u0 + bw, 40), localToPlan(a, u0 + bw, a.depth - 30), localToPlan(a, u0, a.depth - 30)]);
      circles.push({ c: localToPlan(a, u0 + bw / 2, a.depth / 2), r: 22 });
    }
  } else if (a.type === 'hob') {
    for (const [u, v, r] of [[0.27, 0.3, 70], [0.73, 0.3, 55], [0.27, 0.72, 55], [0.73, 0.72, 80]])
      circles.push({ c: localToPlan(a, a.width * u, a.depth * v), r });
  }
  const c = localToPlan(a, a.width / 2, a.depth / 2);
  let rot = a.rotation;
  if (rot > 90 && rot <= 270) rot -= 180;
  return (
    <Group opacity={ghost ? 0.6 : 1} listening={!ghost} onPointerDown={onDown ? stop(onDown, { kind: 'item', cat: 'appliance', id: a.id }) : undefined}>
      <Line points={flat(fp)} closed fill={def?.color ?? '#ccc'} opacity={0.92} stroke={stroke} strokeWidth={(selected || clash ? 2.5 : 1.2) * px} dash={def?.mount === 'wall' ? [6 * px, 4 * px] : undefined} />
      {inner.map((p, i) => (
        <Line key={i} points={flat(p)} closed stroke="#7d8286" strokeWidth={1 * px} fill="#b4b8bb" listening={false} />
      ))}
      {circles.map((ci, i) => (
        <Circle key={`c${i}`} x={ci.c.x} y={ci.c.y} radius={ci.r} stroke={a.type === 'hob' ? '#9a9da1' : '#6c7074'} strokeWidth={1.5 * px} listening={false} />
      ))}
      {!inner.length && a.type !== 'hob' && (
        <Text x={c.x} y={c.y} rotation={rot} text={a.name} fontSize={9 * px} fill={isDark(def?.color) ? '#eee' : '#222'} width={Math.max(a.width, 60 * px)} offsetX={Math.max(a.width, 60 * px) / 2} offsetY={5 * px} align="center" listening={false} wrap="none" ellipsis />
      )}
    </Group>
  );
}

const isDark = (hex?: string) => {
  if (!hex) return false;
  const n = parseInt(hex.slice(1), 16);
  return ((n >> 16) & 255) * 0.3 + ((n >> 8) & 255) * 0.59 + (n & 255) * 0.11 < 110;
};

/* ---------------- countertop ---------------- */

export function CountertopLayer({ pieces, stoneId, px, palette }: { pieces: CounterPiece[]; stoneId: string; px: number; palette: Palette }) {
  const st = stoneById(stoneId);
  return (
    <Group listening={false}>
      {pieces.map((p) => {
        const pl = asPlaced(p);
        return (
          <Group key={p.id}>
            <Line points={flat(footprint(pl))} closed fill={st.color} opacity={0.3} />
            <Line points={flat(footprint(pl))} closed stroke={palette.counterStroke} strokeWidth={1.5 * px} dash={[10 * px, 4 * px]} />
            {p.cutouts.map((c, i) => (
              <Line
                key={i}
                points={flat([localToPlan(pl, c.u - c.w / 2, c.v - c.d / 2), localToPlan(pl, c.u + c.w / 2, c.v - c.d / 2), localToPlan(pl, c.u + c.w / 2, c.v + c.d / 2), localToPlan(pl, c.u - c.w / 2, c.v + c.d / 2)])}
                closed
                stroke={palette.counterStroke}
                strokeWidth={1 * px}
                dash={[4 * px, 3 * px]}
              />
            ))}
          </Group>
        );
      })}
    </Group>
  );
}

/* ---------------- measurements ---------------- */

export function MeasureLine({ a, b, px, palette, units }: { a: Vec2; b: Vec2; px: number; palette: Palette; units: LengthUnit }) {
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const text = formatLength(dist(a, b), units);
  const w = (text.length * 6.8 + 12) * px;
  const tick = 6 * px;
  const n = norm({ x: -(b.y - a.y), y: b.x - a.x });
  return (
    <Group listening={false}>
      <Line points={[a.x, a.y, b.x, b.y]} stroke={palette.measure} strokeWidth={1.5 * px} />
      {[a, b].map((p, i) => (
        <Line key={i} points={[p.x - n.x * tick, p.y - n.y * tick, p.x + n.x * tick, p.y + n.y * tick]} stroke={palette.measure} strokeWidth={1.5 * px} />
      ))}
      <Rect x={mid.x - w / 2} y={mid.y - 9 * px} width={w} height={18 * px} cornerRadius={4 * px} fill={palette.measure} />
      <Text x={mid.x - w / 2} y={mid.y - 9 * px} width={w} height={18 * px} text={text} align="center" verticalAlign="middle" fontSize={11.5 * px} fill="#fff" fontStyle="bold" />
    </Group>
  );
}
