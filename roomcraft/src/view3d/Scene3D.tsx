import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, Grid as DreiGrid, GizmoHelper, GizmoViewport } from '@react-three/drei';
import { memo, useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { useProject } from '../store/projectStore';
import { usePrefs, useUI } from '../store/uiStore';
import { useCountertop, useClashIds } from '../store/derived';
import { usePalette, type Palette } from '../theme';
import type { ApplianceInstance, ModuleInstance, Project, Room, Vec2 } from '../model/types';
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
import { applianceDef } from '../model/appliances';
import type { CounterPiece } from '../model/countertop';
import { WalkControls, walkInput } from './Walk';

/** Plan (x, y) in mm → three.js world (metres): x → x, plan y → z, height → y. */
export const MM = 0.001;

/** Registered by the mounted canvas so the PDF export can grab a 3D snapshot. */
export const snapshot3D: { fn: null | (() => string) } = { fn: null };

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

const RoomMeshes = memo(function RoomMeshes({ room, project, palette, showCeiling }: { room: Room; project: Project; palette: Palette; showCeiling: boolean }) {
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
        <meshStandardMaterial color={roomSelected ? '#9fd8c4' : palette.floor3d} roughness={0.8} side={THREE.DoubleSide} />
      </mesh>
      {st.floorSlab > 0 && <Prism points={outer} z0={-st.floorSlab} z1={-1} color="#a19a90" />}
      {frames.map((f) => (
        <WallMeshes key={f.wall.id} f={f} project={project} palette={palette} selected={selection?.kind === 'wall' && selection.wallId === f.wall.id} skirting={st.skirtingHeight > 0 ? st : null} />
      ))}
      {showCeiling && st.ceilingSlab > 0 && <Prism points={outer} z0={H} z1={H + st.ceilingSlab} color="#bdb7ad" />}
      {showCeiling && st.dropCeiling !== null && <Prism points={room.points} z0={st.dropCeiling} z1={st.dropCeiling + 12} color="#f4f2ee" />}
    </group>
  );
});

function WallMeshes({ f, project, palette, selected, skirting }: { f: WallFrame; project: Project; palette: Palette; selected: boolean; skirting: { skirtingHeight: number; skirtingThickness: number } | null }) {
  const setUI = useUI((s) => s.set);
  const pieces = useMemo(() => wallPieces(project, f), [project, f]);
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
    const walk = useUI.getState().walk;
    const v = { x: camera.position.x - mid.x, z: camera.position.z - mid.z };
    const faded = !walk && v.x * -f.inward.x + v.z * -f.inward.y > 0.2;
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
        <Prism key={i} points={p.polygon} z0={p.z0} z1={p.z1} color={selected ? '#3fc79c' : palette.wall3d} onClick={select} matRef={reg} />
      ))}
      {skirt.map((s, i) => (
        <Prism key={`sk${i}`} points={s} z0={0} z1={skirting!.skirtingHeight} color="#8b7d6b" />
      ))}
      {openings.map((o) => (
        <OpeningMesh key={o.id} f={f} o={o} />
      ))}
    </group>
  );
}

function OpeningMesh({ f, o }: { f: WallFrame; o: ReturnType<typeof clampOpening> }) {
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
            <meshStandardMaterial color="#f1f1ef" />
          </mesh>
        ))}
        <mesh>
          <boxGeometry args={[o.width * MM, 40 * MM, 60 * MM]} />
          <meshStandardMaterial color="#f1f1ef" />
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
        <meshStandardMaterial color="#9a6a3e" roughness={0.7} />
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
  const mat = useFinishMaterial(finish, selected, clash);
  useEffect(() => () => mat.dispose(), [mat]);
  return (
    <mesh
      position={[(box.x + box.dx / 2) * MM + offset[0], (box.z + box.dz / 2) * MM + offset[1], (box.y + box.dy / 2) * MM + offset[2]]}
      material={mat}
      castShadow
      receiveShadow
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      <boxGeometry args={[Math.max(box.dx, 0.5) * MM, Math.max(box.dz, 0.5) * MM, Math.max(box.dy, 0.5) * MM]} />
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

function ApplianceMesh({ a, selected, clash }: { a: ApplianceInstance; selected: boolean; clash: boolean }) {
  const setUI = useUI((s) => s.set);
  const def = applianceDef(a.type);
  const color = def?.color ?? '#cccccc';
  const W = a.width * MM;
  const H = a.height * MM;
  const D = a.depth * MM;
  const em = clash ? '#ff2a1a' : selected ? '#2fd39f' : '#000';
  const click = (e: { stopPropagation: () => void }) => {
    e.stopPropagation();
    setUI({ selection: { kind: 'appliance', id: a.id } });
  };
  const body =
    def?.cutout?.kind === 'sink' ? (
      <>
        {/* rim on the worktop and a recessed bowl */}
        <mesh position={[W / 2, H - 0.002, D / 2]}>
          <boxGeometry args={[W, 0.004, D]} />
          <meshStandardMaterial color="#d4d7da" metalness={0.8} roughness={0.25} emissive={em} emissiveIntensity={selected || clash ? 0.4 : 0} />
        </mesh>
        <mesh position={[W / 2, H / 2, D / 2]}>
          <boxGeometry args={[W - 0.06, H - 0.01, D - 0.07]} />
          <meshStandardMaterial color="#9fa4a8" metalness={0.7} roughness={0.35} side={THREE.BackSide} />
        </mesh>
        <mesh position={[W / 2, H + 0.12, 0.05]}>
          <cylinderGeometry args={[0.012, 0.012, 0.24, 12]} />
          <meshStandardMaterial color="#c8cbcd" metalness={0.9} roughness={0.2} />
        </mesh>
      </>
    ) : (
      <mesh position={[W / 2, H / 2, D / 2]} castShadow>
        <boxGeometry args={[W, H, D]} />
        <meshStandardMaterial color={color} roughness={a.type === 'tv' || a.type === 'hob' ? 0.15 : 0.5} metalness={a.type === 'hood' ? 0.6 : 0.1} emissive={em} emissiveIntensity={selected || clash ? 0.35 : 0} />
      </mesh>
    );
  return (
    <group position={[a.x * MM, a.elevation * MM, a.y * MM]} rotation={[0, (-a.rotation * Math.PI) / 180, 0]} onClick={click}>
      {body}
      {a.type === 'hob' &&
        [
          [0.27, 0.3],
          [0.73, 0.3],
          [0.27, 0.72],
          [0.73, 0.72],
        ].map(([u, v], i) => (
          <mesh key={i} position={[W * u, H + 0.004, D * v]} rotation={[-Math.PI / 2, 0, 0]}>
            <ringGeometry args={[0.035, 0.06, 24]} />
            <meshStandardMaterial color="#5c5f63" metalness={0.6} />
          </mesh>
        ))}
      {(a.type === 'oven' || a.type === 'microwave') && (
        <mesh position={[W / 2, H * 0.45, D + 0.002]}>
          <planeGeometry args={[W * 0.8, H * 0.5]} />
          <meshStandardMaterial color="#111" roughness={0.05} metalness={0.4} />
        </mesh>
      )}
      {a.type === 'tv' && (
        <mesh position={[W / 2, H / 2, D + 0.001]}>
          <planeGeometry args={[W * 0.97, H * 0.95]} />
          <meshStandardMaterial color="#1c2a3a" roughness={0.1} emissive="#0b1622" />
        </mesh>
      )}
    </group>
  );
}

function CountertopMesh({ p, stone }: { p: CounterPiece; stone: string }) {
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
      <mesh geometry={geom} rotation={[-Math.PI / 2, 0, 0]} material={mat} castShadow receiveShadow />
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
  useEffect(() => {
    if (walk) return;
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
  }, [fitRequest, camera, controls, walk]);
  return null;
}

function SnapshotRegistrar() {
  const { gl, scene, camera } = useThree();
  useEffect(() => {
    snapshot3D.fn = () => {
      gl.render(scene, camera);
      return gl.domElement.toDataURL('image/jpeg', 0.9);
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
  const layers = usePrefs((s) => s.layers);
  const pieces = useCountertop();
  const clashIds = useClashIds();
  const controls = useRef<OrbitControlsImpl>(null);
  const selIds = selection?.kind === 'module' ? new Set(selection.ids.length ? selection.ids : [selection.id]) : new Set<string>();

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

  return (
    <div className="scene3d" style={{ background: palette.bg }}>
      <Canvas
        shadows
        dpr={[1, 2]}
        gl={{ preserveDrawingBuffer: true, antialias: true }}
        camera={{ fov: 50, near: 0.05, far: 500, position: [6, 6, 8] }}
        onPointerMissed={() => !walk && setUI({ selection: null })}
      >
        <color attach="background" args={[palette.bg]} />
        <hemisphereLight args={['#ffffff', '#8a8378', 0.75]} />
        <directionalLight
          position={[8, 14, 6]}
          intensity={1.5}
          castShadow
          shadow-mapSize={[2048, 2048]}
          shadow-camera-left={-20}
          shadow-camera-right={20}
          shadow-camera-top={20}
          shadow-camera-bottom={-20}
        />
        <ambientLight intensity={walk ? 0.55 : 0.25} />
        {project.rooms.map((r) => (
          <RoomMeshes key={r.id} room={r} project={project} palette={palette} showCeiling={walk || layers.ceiling} />
        ))}
        <ServicesMeshes project={project} layers={layers} />
        {layers.structure && <StructureMeshes project={project} />}
        {layers.furniture &&
          project.modules.map((m) => (
            <ModuleMesh
              key={m.id}
              m={m}
              project={project}
              selected={selIds.has(m.id)}
              selectedPanel={selection?.kind === 'module' && selection.id === m.id ? selection.panelKey : undefined}
              clash={clashIds.has(m.id)}
              exploded={exploded && (selIds.size === 0 || selIds.has(m.id))}
            />
          ))}
        {layers.furniture && project.appliances.map((a) => <ApplianceMesh key={a.id} a={a} selected={selection?.kind === 'appliance' && selection.id === a.id} clash={clashIds.has(a.id)} />)}
        {layers.furniture && !exploded && pieces.map((p) => <CountertopMesh key={p.id} p={p} stone={project.countertop.stone} />)}
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
        {walk ? <WalkControls start={walkStart.pos} look={walkStart.look} /> : <OrbitControls ref={controls} makeDefault enableDamping dampingFactor={0.1} maxPolarAngle={Math.PI / 2 - 0.02} />}
        <CameraFramer controls={controls} />
        <SnapshotRegistrar />
        {!walk && (
          <GizmoHelper alignment="bottom-right" margin={[60, 60]}>
            <GizmoViewport labelColor="white" axisHeadScale={0.9} />
          </GizmoHelper>
        )}
      </Canvas>
      <div className="view-badge">{walk ? 'Walkthrough · WASD / arrows to move · drag to look' : '3D · drag to orbit · right-drag / two fingers to pan · click a panel to edit it'}</div>
      <div className="scene-tools">
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

