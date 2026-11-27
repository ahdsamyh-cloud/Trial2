import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, Grid as DreiGrid, GizmoHelper, GizmoViewport, Edges } from '@react-three/drei';
import { memo, useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { useProject } from '../store/projectStore';
import { usePrefs, useUI } from '../store/uiStore';
import { useCountertop, useClashIds } from '../store/derived';
import { usePalette, type Palette } from '../theme';
import type { ModuleInstance, Project, Room, Vec2 } from '../model/types';
import { boundsOf, centroid, outerPolygon, offsetPolygon, pointInPolygon } from '../model/geometry';
import {
  allWallFrames,
  beamPolygon,
  clampOpening,
  findWall,
  pointOnWall,
  roomStructure,
  servicePosition,
  wallPieces,
  type WallFrame,
} from '../model/structure';
import { buildModule } from '../model/furniture';
import { finishById, serviceDef, stoneById } from '../model/catalog';
import type { CounterPiece } from '../model/countertop';
import { WalkControls, walkInput } from './Walk';
import { ApplianceModel } from './Appliances3D';
import { Dimensions3D, PhotoEffects, StudioEnvironment, StudioFloor, WallTiles, presentationView } from './Presentation';
import { RenderStyleContext, SKETCH_EDGE, useRenderStyle } from './style';
import { furnishedWallIds } from '../model/annotations';

/** Plan (x, y) in mm → three.js world (metres): x → x, plan y → z, height → y. */
export const MM = 0.001;

/** Registered by the mounted canvas so the PDF export can grab a 3D snapshot. */
export const snapshot3D: { fn: null | ((type?: string) => string) } = { fn: null };

function shapeFrom(points: Vec2[], holes: Vec2[][] = []): THREE.Shape {
  // shape is built in (x, -y) so that rotating -90° about X maps plan y → +z
  const s = new THREE.Shape();
  points.forEach((p, i) => (i === 0 ? s.moveTo(p.x * MM, -p.y * MM) : s.lineTo(p.x * MM, -p.y * MM)));
  s.closePath();
  for (const h of holes) {
    const path = new THREE.Path();
    h.forEach((p, i) => (i === 0 ? path.moveTo(p.x * MM, -p.y * MM) : path.lineTo(p.x * MM, -p.y * MM)));
    path.closePath();
    s.holes.push(path);
  }
  return s;
}

function useExtrude(points: Vec2[], depth: number, holes?: Vec2[][]) {
  const geom = useMemo(() => new THREE.ExtrudeGeometry(shapeFrom(points, holes), { depth: Math.max(depth, 0.1) * MM, bevelEnabled: false }), [points, depth, holes]);
  useEffect(() => () => geom.dispose(), [geom]);
  return geom;
}

function Prism({ points, z0, z1, color, opacity = 1, onClick, emissive, matRef }: { points: Vec2[]; z0: number; z1: number; color: string; opacity?: number; onClick?: () => void | boolean; emissive?: string; matRef?: (m: THREE.MeshStandardMaterial | null) => void }) {
  const geom = useExtrude(points, z1 - z0);
  const { mode } = useRenderStyle();
  return (
    <mesh
      geometry={geom}
      rotation={[-Math.PI / 2, 0, 0]}
      position={[0, z0 * MM, 0]}
      castShadow={opacity === 1}
      receiveShadow
      onClick={
        onClick &&
        ((e) => {
          // a handler returning false lets the click pass through (e.g. faded walls)
          if (onClick() !== false) e.stopPropagation();
        })
      }
    >
      <meshStandardMaterial ref={matRef} color={color} roughness={0.85} transparent={opacity < 1} opacity={opacity} emissive={emissive ?? '#000'} emissiveIntensity={emissive ? 0.35 : 0} />
      {mode === 'sketch' && <Edges threshold={20} color={SKETCH_EDGE} />}
    </mesh>
  );
}

/* ---------------- textures ---------------- */

const texCache = new Map<string, THREE.Texture>();
function woodTexture(color: string): THREE.Texture {
  const key = `wood-${color}`;
  const hit = texCache.get(key);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 512;
  const g = c.getContext('2d')!;
  g.fillStyle = color;
  g.fillRect(0, 0, 128, 512);
  for (let i = 0; i < 46; i++) {
    const x = (i * 53) % 128;
    g.strokeStyle = `rgba(0,0,0,${0.04 + ((i * 7) % 10) / 120})`;
    g.lineWidth = 1 + (i % 3);
    g.beginPath();
    g.moveTo(x, 0);
    for (let y = 0; y <= 512; y += 32) g.lineTo(x + Math.sin((y + i * 40) / 70) * 4, y);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  texCache.set(key, t);
  return t;
}

function stoneTexture(id: string): THREE.Texture {
  const key = `stone-${id}`;
  const hit = texCache.get(key);
  if (hit) return hit;
  const st = stoneById(id);
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = st.color;
  g.fillRect(0, 0, 256, 256);
  if (st.speckle)
    for (let i = 0; i < 900; i++) {
      g.fillStyle = i % 2 ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.3)';
      g.fillRect((i * 97) % 256, (i * 57 + (i % 7) * 13) % 256, 1 + (i % 3), 1 + (i % 2));
    }
  if (st.veins) {
    g.strokeStyle = st.veins;
    g.globalAlpha = 0.6;
    for (let k = 0; k < 4; k++) {
      g.lineWidth = 0.6 + k * 0.4;
      g.beginPath();
      g.moveTo(-10, 40 + k * 60);
      g.bezierCurveTo(80, 10 + k * 50, 150, 120 + k * 30, 270, 60 + k * 50);
      g.stroke();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  texCache.set(key, t);
  return t;
}

/* ---------------- rooms ---------------- */

const RoomMeshes = memo(function RoomMeshes({ room, project, palette, showCeiling, onlyWalls, cutHeight, floorColor }: { room: Room; project: Project; palette: Palette; showCeiling: boolean; onlyWalls?: Set<string>; cutHeight?: number; floorColor?: string }) {
  const selection = useUI((s) => s.selection);
  const setUI = useUI((s) => s.set);
  const st = roomStructure(room);
  const frames = useMemo(() => {
    const o = offsetPolygon(room.points, room.walls.map((w) => w.thickness));
    return allWallFrames({ ...project, rooms: [room] }).map((f, i) => ({ ...f, oa: o[i], ob: o[(i + 1) % o.length] }));
  }, [room, project]);
  const outer = useMemo(() => outerPolygon(room), [room]);
  const floorGeom = useMemo(() => new THREE.ShapeGeometry(shapeFrom(room.points)), [room.points]);
  useEffect(() => () => floorGeom.dispose(), [floorGeom]);
  const roomSelected = selection?.kind === 'room' && selection.roomId === room.id;
  const H = Math.max(...room.walls.map((w) => w.height));
  return (
    <group>
      <mesh
        geometry={floorGeom}
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0.001, 0]}
        receiveShadow
        onClick={(e) => {
          e.stopPropagation();
          setUI({ selection: { kind: 'room', roomId: room.id } });
        }}
      >
        <meshStandardMaterial color={floorColor ?? (roomSelected ? '#9fd8c4' : palette.floor3d)} roughness={0.8} side={THREE.DoubleSide} />
      </mesh>
      {st.floorSlab > 0 && !onlyWalls && <Prism points={outer} z0={-st.floorSlab} z1={-1} color="#a19a90" />}
      {frames
        .filter((f) => !onlyWalls || onlyWalls.has(f.wall.id))
        .map((f) => (
          <WallMeshes
            key={f.wall.id}
            f={f}
            project={project}
            palette={palette}
            selected={!onlyWalls && selection?.kind === 'wall' && selection.wallId === f.wall.id}
            skirting={st.skirtingHeight > 0 ? st : null}
            cutHeight={cutHeight}
          />
        ))}
      {showCeiling && st.ceilingSlab > 0 && <Prism points={outer} z0={H} z1={H + st.ceilingSlab} color="#bdb7ad" />}
      {showCeiling && st.dropCeiling !== null && <Prism points={room.points} z0={st.dropCeiling} z1={st.dropCeiling + 12} color="#f4f2ee" />}
    </group>
  );
});

function WallMeshes({ f, project, palette, selected, skirting, cutHeight }: { f: WallFrame; project: Project; palette: Palette; selected: boolean; skirting: { skirtingHeight: number; skirtingThickness: number } | null; cutHeight?: number }) {
  const setUI = useUI((s) => s.set);
  const { mode } = useRenderStyle();
  const pieces = useMemo(
    () =>
      wallPieces(project, f)
        .map((p) => (cutHeight ? { ...p, z1: Math.min(p.z1, cutHeight) } : p))
        .filter((p) => p.z1 - p.z0 > 1),
    [project, f, cutHeight],
  );
  const openings = project.openings.filter((o) => o.wallId === f.wall.id).map((o) => clampOpening(o, f.length));
  const select = () => {
    if (lastFaded.current) return false;
    setUI({ selection: { kind: 'wall', roomId: f.room.id, wallId: f.wall.id } });
  };
  // "dollhouse" view: walls between the camera and the room fade out in orbit mode
  const mats = useRef(new Set<THREE.MeshStandardMaterial>());
  const reg = (m: THREE.MeshStandardMaterial | null) => {
    if (m) mats.current.add(m);
  };
  const mid = useMemo(() => ({ x: ((f.a.x + f.b.x) / 2) * MM, z: ((f.a.y + f.b.y) / 2) * MM }), [f]);
  const lastFaded = useRef<boolean | null>(null);
  lastFaded.current = null; // props may have been re-applied by React: refresh on the next frame
  useEffect(() => () => mats.current.clear(), [pieces]);
  useFrame(({ camera }) => {
    const { walk, present } = useUI.getState();
    const v = { x: camera.position.x - mid.x, z: camera.position.z - mid.z };
    const faded = !walk && !present && v.x * -f.inward.x + v.z * -f.inward.y > 0.2;
    if (faded === lastFaded.current) return;
    lastFaded.current = faded;
    for (const m of mats.current) {
      m.transparent = faded;
      m.opacity = faded ? 0.12 : 1;
      m.depthWrite = !faded;
      m.needsUpdate = true;
    }
  });
  // skirting strips along the inner face, interrupted by doors/openings
  const skirt = useMemo(() => {
    if (!skirting) return [];
    const gaps = openings.filter((o) => o.sill < skirting.skirtingHeight).map((o) => [o.offset, o.offset + o.width]);
    const segs: [number, number][] = [];
    let cur = 0;
    for (const [a, b] of gaps.sort((x, y) => x[0] - y[0])) {
      if (a > cur) segs.push([cur, a]);
      cur = Math.max(cur, b);
    }
    if (cur < f.length) segs.push([cur, f.length]);
    const t = skirting.skirtingThickness;
    return segs.map(([a, b]) => {
      const p0 = pointOnWall(f, a);
      const p1 = pointOnWall(f, b);
      const n = { x: f.inward.x * t, y: f.inward.y * t };
      return [p0, p1, { x: p1.x + n.x, y: p1.y + n.y }, { x: p0.x + n.x, y: p0.y + n.y }];
    });
  }, [skirting, openings, f]);
  return (
    <group>
      {pieces.map((p, i) => (
        <Prism key={i} points={p.polygon} z0={p.z0} z1={p.z1} color={selected ? '#3fc79c' : mode === 'edit' ? palette.wall3d : '#f2f1ed'} onClick={select} matRef={reg} />
      ))}
      {skirt.map((s, i) => (
        <Prism key={`sk${i}`} points={s} z0={0} z1={skirting!.skirtingHeight} color="#8b7d6b" />
      ))}
      {openings.map((o) => (
        <OpeningMesh key={o.id} f={f} o={o} reg={reg} />
      ))}
    </group>
  );
}

function OpeningMesh({ f, o, reg }: { f: WallFrame; o: ReturnType<typeof clampOpening>; reg: (m: THREE.MeshStandardMaterial | null) => void }) {
  const setUI = useUI((s) => s.set);
  const t = f.wall.thickness;
  const c = pointOnWall(f, o.offset + o.width / 2);
  const mid = { x: c.x - f.inward.x * (t / 2), y: c.y - f.inward.y * (t / 2) };
  const rotY = -Math.atan2(f.dir.y, f.dir.x);
  const click = (e: { stopPropagation: () => void }) => {
    e.stopPropagation();
    setUI({ selection: { kind: 'opening', id: o.id } });
  };
  if (o.kind === 'opening') return null;
  if (o.kind === 'window') {
    return (
      <group position={[mid.x * MM, (o.sill + o.height / 2) * MM, mid.y * MM]} rotation={[0, rotY, 0]} onClick={click}>
        <mesh>
          <boxGeometry args={[o.width * MM, o.height * MM, 8 * MM]} />
          <meshStandardMaterial color="#9fd3f0" transparent opacity={0.35} roughness={0.05} metalness={0.2} />
        </mesh>
        {[-1, 1].map((s) => (
          <mesh key={s} position={[(s * (o.width / 2 - 25)) * MM, 0, 0]}>
            <boxGeometry args={[50 * MM, o.height * MM, 60 * MM]} />
            <meshStandardMaterial ref={reg} color="#f1f1ef" />
          </mesh>
        ))}
        <mesh>
          <boxGeometry args={[o.width * MM, 40 * MM, 60 * MM]} />
          <meshStandardMaterial ref={reg} color="#f1f1ef" />
        </mesh>
      </group>
    );
  }
  // door: leaf on the hinge side, opened ~20° in the swing direction
  const hingeAt = o.hinge === 'left' ? o.offset : o.offset + o.width;
  const hp = pointOnWall(f, hingeAt);
  const leafDir = o.hinge === 'left' ? 1 : -1;
  const swingSign = (o.swing === 'in' ? 1 : -1) * leafDir;
  const open = (20 * Math.PI) / 180;
  const inset = o.swing === 'in' ? 0 : t;
  const hpp = { x: hp.x - f.inward.x * inset, y: hp.y - f.inward.y * inset };
  return (
    <group position={[hpp.x * MM, 0, hpp.y * MM]} rotation={[0, rotY - swingSign * open, 0]} onClick={click}>
      <mesh position={[(leafDir * o.width) / 2 * MM, (o.height / 2) * MM, 0]} castShadow>
        <boxGeometry args={[(o.width - 10) * MM, (o.height - 10) * MM, 35 * MM]} />
        <meshStandardMaterial ref={reg} color="#9a6a3e" roughness={0.7} />
      </mesh>
    </group>
  );
}

/* ---------------- services & structure ---------------- */

function ServicesMeshes({ project, layers }: { project: Project; layers: { electrical: boolean; plumbing: boolean } }) {
  const setUI = useUI((s) => s.set);
  return (
    <>
      {project.services.map((s) => {
        const def = serviceDef(s.kind);
        if ((def.group === 'electrical' && !layers.electrical) || (def.group === 'plumbing' && !layers.plumbing)) return null;
        const p = servicePosition(project, s);
        const f = s.wallId ? findWall(project, s.wallId) : null;
        const rotY = f ? -Math.atan2(f.dir.y, f.dir.x) : 0;
        const click = (e: { stopPropagation: () => void }) => {
          e.stopPropagation();
          setUI({ selection: { kind: 'service', id: s.id } });
        };
        if (def.mount === 'ceiling')
          return (
            <mesh key={s.id} position={[p.x * MM, (s.height - 40) * MM, p.y * MM]} onClick={click}>
              <sphereGeometry args={[0.07, 16, 12]} />
              <meshStandardMaterial color="#fff6d5" emissive="#ffe9a3" emissiveIntensity={0.8} />
            </mesh>
          );
        const isPipe = def.group === 'plumbing';
        return (
          <group key={s.id} position={[p.x * MM, s.height * MM, p.y * MM]} rotation={[0, rotY, 0]} onClick={click}>
            {isPipe ? (
              <mesh position={[0, 0, 0.05]} rotation={[Math.PI / 2, 0, 0]}>
                <cylinderGeometry args={[s.kind === 'drain' ? 0.05 : 0.016, s.kind === 'drain' ? 0.05 : 0.016, 0.1, 16]} />
                <meshStandardMaterial color={def.color} metalness={0.4} roughness={0.4} />
              </mesh>
            ) : (
              <mesh position={[0, 0, 0.006]}>
                <boxGeometry args={[s.kind === 'ac' ? 0.15 : 0.086, 0.086, 0.012]} />
                <meshStandardMaterial color="#fafafa" />
              </mesh>
            )}
            <mesh position={[0, 0, isPipe ? 0.1 : 0.014]}>
              <sphereGeometry args={[0.012, 8, 8]} />
              <meshStandardMaterial color={def.color} />
            </mesh>
          </group>
        );
      })}
    </>
  );
}

function StructureMeshes({ project }: { project: Project }) {
  const setUI = useUI((s) => s.set);
  return (
    <>
      {project.beams.map((b) => (
        <Prism key={b.id} points={beamPolygon(b)} z0={b.bottom} z1={b.bottom + b.depth} color="#c9c3e0" onClick={() => setUI({ selection: { kind: 'beam', id: b.id } })} />
      ))}
      {project.columns.map((c) => {
        const r = (c.rotation * Math.PI) / 180;
        return (
          <mesh
            key={c.id}
            position={[c.x * MM, (c.height / 2) * MM, c.y * MM]}
            rotation={[0, -r, 0]}
            castShadow
            onClick={(e) => {
              e.stopPropagation();
              setUI({ selection: { kind: 'column', id: c.id } });
            }}
          >
            <boxGeometry args={[c.width * MM, c.height * MM, c.depth * MM]} />
            <meshStandardMaterial color="#d6d1c8" roughness={0.9} />
          </mesh>
        );
      })}
    </>
  );
}

/* ---------------- furniture ---------------- */

function useFinishMaterial(finishId: string, selected: boolean, clash: boolean) {
  return useMemo(() => {
    const f = finishById(finishId);
    const mat = new THREE.MeshStandardMaterial({
      color: f.grain ? '#ffffff' : f.color,
      map: f.grain ? woodTexture(f.color) : null,
      roughness: f.gloss ? 0.25 : 0.65,
      emissive: new THREE.Color(clash ? '#ff2a1a' : selected ? '#2fd39f' : '#000000'),
      emissiveIntensity: clash ? 0.35 : selected ? 0.45 : 0,
    });
    return mat;
  }, [finishId, selected, clash]);
}

function PanelMesh({ box, finish, selected, clash, offset, onClick }: { box: { x: number; y: number; z: number; dx: number; dy: number; dz: number }; finish: string; selected: boolean; clash: boolean; offset: [number, number, number]; onClick: () => void }) {
  const { mode } = useRenderStyle();
  const sketch = mode === 'sketch';
  const mat = useFinishMaterial(finish, selected && mode === 'edit', clash && mode === 'edit');
  useEffect(() => () => mat.dispose(), [mat]);
  return (
    <mesh
      position={[(box.x + box.dx / 2) * MM + offset[0], (box.z + box.dz / 2) * MM + offset[1], (box.y + box.dy / 2) * MM + offset[2]]}
      material={mat}
      castShadow
      receiveShadow
      onClick={(e) => {
        if (mode !== 'edit') return;
        e.stopPropagation();
        onClick();
      }}
    >
      <boxGeometry args={[Math.max(box.dx, 0.5) * MM, Math.max(box.dz, 0.5) * MM, Math.max(box.dy, 0.5) * MM]} />
      {sketch && <Edges threshold={20} color={SKETCH_EDGE} />}
    </mesh>
  );
}

const ModuleMesh = memo(function ModuleMesh({ m, project, selectedPanel, selected, clash, exploded }: { m: ModuleInstance; project: Project; selectedPanel?: string; selected: boolean; clash: boolean; exploded: boolean }) {
  const setUI = useUI((s) => s.set);
  const b = buildModule(m, project);
  const cx = m.width / 2;
  const cz = m.height / 2;
  const cy = m.depth / 2;
  return (
    <group position={[m.x * MM, m.elevation * MM, m.y * MM]} rotation={[0, (-m.rotation * Math.PI) / 180, 0]}>
      {b.panels.map((p) => {
        const off: [number, number, number] = exploded
          ? [(p.box.x + p.box.dx / 2 - cx) * MM * 0.7, (p.box.z + p.box.dz / 2 - cz) * MM * 0.5, (p.box.y + p.box.dy / 2 - cy) * MM * 1.4 + (p.isFront ? 0.25 : 0)]
          : [0, 0, 0];
        return (
          <PanelMesh
            key={p.key}
            box={p.box}
            finish={p.finish}
            selected={selected && (!selectedPanel || selectedPanel === p.key)}
            clash={clash}
            offset={off}
            onClick={() => setUI({ selection: { kind: 'module', id: m.id, ids: [m.id], panelKey: p.key } })}
          />
        );
      })}
      {!exploded &&
        b.handles.map((h, i) => (
          <mesh key={i} position={[h.x * MM, h.z * MM, (h.y + 12) * MM]}>
            <boxGeometry args={m.handle === 'knob' ? [0.025, 0.025, 0.025] : h.orient === 'h' ? [h.length * MM, m.handle === 'profile' ? 0.02 : 0.012, 0.014] : [0.012, h.length * MM, 0.014]} />
            <meshStandardMaterial color="#c3c6c9" metalness={0.35} roughness={0.35} />
          </mesh>
        ))}
    </group>
  );
});

function CountertopMesh({ p, stone }: { p: CounterPiece; stone: string }) {
  const sketch = useRenderStyle().mode === 'sketch';
  const holes = useMemo(
    () =>
      p.cutouts.map((c) => [
        { x: c.u - c.w / 2, y: c.v - c.d / 2 },
        { x: c.u + c.w / 2, y: c.v - c.d / 2 },
        { x: c.u + c.w / 2, y: c.v + c.d / 2 },
        { x: c.u - c.w / 2, y: c.v + c.d / 2 },
      ]),
    [p],
  );
  const outline = useMemo(
    () => [
      { x: 0, y: 0 },
      { x: p.length, y: 0 },
      { x: p.length, y: p.depth },
      { x: 0, y: p.depth },
    ],
    [p],
  );
  const geom = useExtrude(outline, p.thickness, holes);
  const mat = useMemo(() => {
    const t = stoneTexture(stone).clone();
    t.needsUpdate = true;
    t.repeat.set(1.2, 1.2);
    return new THREE.MeshStandardMaterial({ map: t, roughness: stoneById(stone).family === 'granite' ? 0.2 : 0.35 });
  }, [stone]);
  return (
    <group position={[p.x * MM, p.z * MM, p.y * MM]} rotation={[0, (-p.rotation * Math.PI) / 180, 0]}>
      <mesh geometry={geom} rotation={[-Math.PI / 2, 0, 0]} material={mat} castShadow receiveShadow>
        {sketch && <Edges threshold={20} color={SKETCH_EDGE} />}
      </mesh>
      {p.backsplash && p.backsplash.length > 0 && (
        <mesh position={[(p.backsplash.length / 2) * MM, (p.thickness + p.backsplash.height / 2) * MM, 0.008]} material={mat}>
          <boxGeometry args={[p.backsplash.length * MM, p.backsplash.height * MM, 0.016]} />
        </mesh>
      )}
    </group>
  );
}

/* ---------------- camera ---------------- */

function CameraFramer({ controls }: { controls: React.RefObject<OrbitControlsImpl> }) {
  const { camera, size } = useThree();
  const fitRequest = useUI((s) => s.fitRequest);
  const walk = useUI((s) => s.walk);
  const present = useUI((s) => s.present);
  useEffect(() => {
    if (walk) return;
    const persp0 = camera as THREE.PerspectiveCamera;
    {
      // look into the furniture (catalogue angle); the editing view uses a wider lens
      const aspect = size.width > 50 && size.height > 50 ? size.width / size.height : 1.4;
      const v = presentationView(useProject.getState().project, aspect, present ? 32 : 50);
      if (v) {
        persp0.fov = v.fov;
        persp0.updateProjectionMatrix();
        camera.position.copy(v.pos);
        if (controls.current) {
          controls.current.target.copy(v.target);
          controls.current.update();
        } else camera.lookAt(v.target);
        return;
      }
    }
    if (persp0.fov !== 50) {
      persp0.fov = 50;
      persp0.updateProjectionMatrix();
    }
    const rooms = useProject.getState().project.rooms;
    const b = boundsOf(rooms.flatMap((r) => outerPolygon(r)));
    const cx = b ? ((b.minX + b.maxX) / 2) * MM : 2.5;
    const cz = b ? ((b.minY + b.maxY) / 2) * MM : 2;
    const span = b ? Math.hypot(b.maxX - b.minX, b.maxY - b.minY) * MM : 6;
    const persp = camera as THREE.PerspectiveCamera;
    const halfFov = ((persp.fov ?? 45) * Math.PI) / 360;
    const aspect = Math.min(1, size.width / Math.max(1, size.height));
    const radius = span / 2 + 0.4;
    const d = (0.85 * radius) / Math.sin(halfFov) / aspect;
    const dir = new THREE.Vector3(0.55, 0.85, 0.95).normalize();
    camera.position.set(cx + dir.x * d, dir.y * d, cz + dir.z * d);
    const c = controls.current;
    if (c) {
      c.target.set(cx, 0.6, cz);
      c.update();
    } else camera.lookAt(cx, 0.6, cz);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitRequest, camera, controls, walk, present, Math.round((size.width / Math.max(1, size.height)) * 8)]);
  return null;
}

function SnapshotRegistrar() {
  const { gl, scene, camera } = useThree();
  useEffect(() => {
    snapshot3D.fn = (type = 'image/jpeg') => {
      // presentation frames come from the effect composer: read the last composed frame as-is
      if (!useUI.getState().present) gl.render(scene, camera);
      return gl.domElement.toDataURL(type, 0.92);
    };
    return () => {
      snapshot3D.fn = null;
    };
  }, [gl, scene, camera]);
  return null;
}

/* ---------------- scene ---------------- */

export function Scene3D() {
  const project = useProject((s) => s.project);
  const palette = usePalette();
  const setUI = useUI((s) => s.set);
  const selection = useUI((s) => s.selection);
  const exploded = useUI((s) => s.exploded);
  const walk = useUI((s) => s.walk);
  const present = useUI((s) => s.present);
  const presentDims = useUI((s) => s.presentDims);
  const layers = usePrefs((s) => s.layers);
  const units = usePrefs((s) => s.units);
  const pieces = useCountertop();
  const clashIds = useClashIds();
  const controls = useRef<OrbitControlsImpl>(null);
  const selIds = selection?.kind === 'module' ? new Set(selection.ids.length ? selection.ids : [selection.id]) : new Set<string>();
  const mode = present ?? 'edit';
  const editing = mode === 'edit';
  const studio = mode === 'photo' ? '#f3f2ef' : '#ffffff';
  const bg = editing ? palette.bg : studio;

  // presentation: only the walls the furniture stands against, cut just above the tallest unit
  const presentWalls = useMemo(() => (present ? furnishedWallIds(project) : undefined), [present, project]);
  const cutHeight = useMemo(() => {
    if (!present) return undefined;
    const tops = [...project.modules, ...project.appliances].filter((i) => i.type !== 'hood').map((i) => i.elevation + i.height);
    return tops.length ? Math.max(...tops) + 260 : undefined;
  }, [present, project]);
  const wallTop = project.rooms[0]?.walls[0]?.height ?? 3000;

  // walkthrough starts in the room, stepped back from the furniture and facing it
  const walkStart = useMemo(() => {
    const r = project.rooms[0];
    const c = r ? centroid(r.points) : { x: 2000, y: 1500 };
    const items = [...project.modules, ...project.appliances];
    if (!items.length) return { pos: c, look: { x: c.x, y: c.y - 1000 } };
    const f = items.reduce((acc, it) => ({ x: acc.x + it.x / items.length, y: acc.y + it.y / items.length }), { x: 0, y: 0 });
    const dx = c.x - f.x;
    const dy = c.y - f.y;
    const L = Math.hypot(dx, dy) || 1;
    const pos = { x: c.x + (dx / L) * 600, y: c.y + (dy / L) * 600 };
    return { pos: r && !pointInPolygon(pos, r.points) ? c : pos, look: f };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.rooms, walk]);

  const saveImage = () => {
    const url = snapshot3D.fn?.('image/png');
    if (!url) return;
    const a = document.createElement('a');
    a.href = url;
    a.download = `${project.name.replace(/[^\w\- ]+/g, '').trim() || 'roomcraft'} - ${present ?? '3d'}.png`;
    a.click();
  };

  return (
    <div className="scene3d" style={{ background: bg }}>
      <RenderStyleContext.Provider value={{ mode }}>
        <Canvas
          shadows="soft"
          dpr={[1, 2]}
          gl={{ preserveDrawingBuffer: true, antialias: true }}
          camera={{ fov: 50, near: 0.05, far: 500, position: [6, 6, 8] }}
          onPointerMissed={() => editing && !walk && setUI({ selection: null })}
        >
          <color attach="background" args={[bg]} />
          <StudioEnvironment intensity={editing ? 0.55 : mode === 'photo' ? 0.9 : 0.6} />
          <hemisphereLight args={['#ffffff', '#8a8378', editing ? 0.55 : mode === 'sketch' ? 1.1 : 0.35]} />
          <directionalLight
            position={[6, 12, 9]}
            intensity={editing ? 1.3 : mode === 'photo' ? 1.6 : 0.7}
            castShadow={mode !== 'sketch'}
            shadow-mapSize={[2048, 2048]}
            shadow-bias={-0.0004}
            shadow-normalBias={0.02}
            shadow-camera-left={-12}
            shadow-camera-right={12}
            shadow-camera-top={12}
            shadow-camera-bottom={-12}
          />
          <ambientLight intensity={walk ? 0.45 : editing ? 0.15 : mode === 'sketch' ? 0.5 : 0.08} />
          {project.rooms.map((r) => (
            <RoomMeshes
              key={r.id}
              room={r}
              project={project}
              palette={palette}
              showCeiling={editing && (walk || layers.ceiling)}
              onlyWalls={presentWalls}
              cutHeight={cutHeight}
              floorColor={editing ? undefined : mode === 'photo' ? '#e7e3dc' : '#fbfbfb'}
            />
          ))}
          {editing && <ServicesMeshes project={project} layers={layers} />}
          {editing && layers.structure && <StructureMeshes project={project} />}
          {layers.furniture &&
            project.modules.map((m) => (
              <ModuleMesh
                key={m.id}
                m={m}
                project={project}
                selected={editing && selIds.has(m.id)}
                selectedPanel={selection?.kind === 'module' && selection.id === m.id ? selection.panelKey : undefined}
                clash={editing && clashIds.has(m.id)}
                exploded={editing && exploded && (selIds.size === 0 || selIds.has(m.id))}
              />
            ))}
          {layers.furniture &&
            project.appliances.map((a) => (
              <ApplianceModel key={a.id} a={a} wallTop={cutHeight ? Math.min(cutHeight, wallTop) : wallTop} selected={selection?.kind === 'appliance' && selection.id === a.id} clash={clashIds.has(a.id)} />
            ))}
          {layers.furniture && !(editing && exploded) && pieces.map((p) => <CountertopMesh key={p.id} p={p} stone={project.countertop.stone} />)}
          {layers.furniture && !(editing && exploded) && <WallTiles project={project} pieces={pieces} />}
          {present && presentDims && <Dimensions3D project={project} units={units} />}
          {editing ? (
            <>
              <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.002, 0]} receiveShadow>
                <planeGeometry args={[400, 400]} />
                <meshStandardMaterial color={palette.ground3d} roughness={1} />
              </mesh>
              {!walk && (
                <DreiGrid
                  position={[0, -0.001, 0]}
                  args={[100, 100]}
                  cellSize={0.1}
                  sectionSize={1}
                  cellColor={palette.textMuted}
                  sectionColor={palette.textMuted}
                  fadeDistance={40}
                  infiniteGrid
                  cellThickness={0.5}
                  sectionThickness={0.8}
                />
              )}
            </>
          ) : (
            <StudioFloor color={studio} />
          )}
          {walk ? <WalkControls start={walkStart.pos} look={walkStart.look} /> : <OrbitControls ref={controls} makeDefault enableDamping dampingFactor={0.1} maxPolarAngle={Math.PI / 2 - 0.02} />}
          <CameraFramer controls={controls} />
          <SnapshotRegistrar />
          {mode === 'photo' && <PhotoEffects />}
          {editing && !walk && (
            <GizmoHelper alignment="bottom-right" margin={[60, 60]}>
              <GizmoViewport labelColor="white" axisHeadScale={0.9} />
            </GizmoHelper>
          )}
        </Canvas>
      </RenderStyleContext.Provider>
      {editing && (
        <div className="view-badge">{walk ? 'Walkthrough · WASD / arrows to move · drag to look' : '3D · drag to orbit · right-drag / two fingers to pan · click a panel to edit it'}</div>
      )}
      <div className="scene-tools">
        {present ? (
          <>
            <div className="seg">
              <button className={present === 'photo' ? 'on' : ''} onClick={() => setUI({ present: 'photo', presentDims: false })} title="Photo-style render">
                Photo
              </button>
              <button className={present === 'sketch' ? 'on' : ''} onClick={() => setUI({ present: 'sketch', presentDims: true })} title="Line sketch with dimensions">
                Sketch
              </button>
            </div>
            <button className={`btn small${presentDims ? ' primary' : ''}`} onClick={() => setUI({ presentDims: !presentDims })} title="Show dimensions">
              ↔ Dims
            </button>
            <button className="btn small" onClick={saveImage} title="Download this view as a PNG image">
              ⤓ Image
            </button>
            <button className="btn small" onClick={() => setUI({ fitRequest: useUI.getState().fitRequest + 1 })} title="Reset the presentation camera">
              ⤢
            </button>
            <button className="btn small" onClick={() => setUI({ present: null, fitRequest: useUI.getState().fitRequest + 1 })}>
              ✕ Exit
            </button>
          </>
        ) : (
          <>
            <button className="btn small primary" onClick={() => setUI({ present: 'photo', presentDims: false, walk: false, exploded: false, selection: null })} title="Presentation render: studio light, ambient occlusion, dimensions">
              📷 Present
            </button>
            <button className={`btn small${walk ? ' primary' : ''}`} onClick={() => setUI({ walk: !walk })} title="First-person walkthrough">
              {walk ? '✕ Exit walk' : '🚶 Walk'}
            </button>
            <button className={`btn small${exploded ? ' primary' : ''}`} onClick={() => setUI({ exploded: !exploded })} title="Exploded view of the selected module (or all)">
              ✣ Explode
            </button>
            {!walk && (
              <button className="btn small" title="Frame the whole project (F)" onClick={() => setUI({ fitRequest: useUI.getState().fitRequest + 1 })}>
                ⤢ Fit
              </button>
            )}
          </>
        )}
      </div>
      {walk && (
        <div className="walk-pad">
          {(
            [
              ['forward', '▲'],
              ['left', '◀'],
              ['back', '▼'],
              ['right', '▶'],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              className={`btn icon walk-${k}`}
              onPointerDown={() => (walkInput[k] = true)}
              onPointerUp={() => (walkInput[k] = false)}
              onPointerLeave={() => (walkInput[k] = false)}
            >
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
