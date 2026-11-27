import { useMemo } from 'react';
import * as THREE from 'three';
import { Edges } from '@react-three/drei';
import type { ApplianceInstance } from '../model/types';
import { applianceDef } from '../model/appliances';
import { useUI } from '../store/uiStore';
import { SKETCH_EDGE, useRenderStyle } from './style';

const MM = 0.001;

const STEEL = { color: '#d4d7da', metalness: 0.65, roughness: 0.3 };
const DARK_STEEL = { color: '#3a3c40', metalness: 0.6, roughness: 0.35 };
const GLASS_BLACK = { color: '#0c0d0f', metalness: 0.3, roughness: 0.06 };

type V3 = [number, number, number];

/** Box helper in metres with optional sketch edges. */
function B({ p, s, mat, edges = true }: { p: V3; s: V3; mat: THREE.MeshStandardMaterialParameters; edges?: boolean }) {
  const { mode } = useRenderStyle();
  return (
    <mesh position={p} castShadow receiveShadow>
      <boxGeometry args={s} />
      <meshStandardMaterial {...mat} />
      {mode === 'sketch' && edges && <Edges threshold={20} color={SKETCH_EDGE} />}
    </mesh>
  );
}

/** Box whose top face is scaled (for chimney hoods). */
function taperedGeometry(w: number, h: number, d: number, topW: number, topD: number) {
  const g = new THREE.BoxGeometry(w, h, d);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    if (pos.getY(i) > 0) {
      pos.setX(i, (pos.getX(i) / w) * topW);
      // keep the back face against the wall: z ∈ [-d/2, d/2] → top spans [-d/2, -d/2 + topD]
      const z = pos.getZ(i);
      pos.setZ(i, -d / 2 + ((z + d / 2) / d) * topD);
    }
  }
  g.computeVertexNormals();
  return g;
}

function Hood({ W, H, D, wallTop }: { W: number; H: number; D: number; wallTop: number }) {
  const { mode } = useRenderStyle();
  const canopyH = Math.min(0.12, H * 0.25);
  const taperH = Math.min(0.28, H * 0.5);
  const ductW = Math.min(0.3, W * 0.4);
  const ductD = Math.min(0.26, D * 0.55);
  const taper = useMemo(() => taperedGeometry(W, taperH, D, ductW + 0.04, ductD + 0.02), [W, taperH, D, ductW, ductD]);
  const ductH = Math.max(0.2, wallTop - canopyH - taperH);
  return (
    <>
      <B p={[W / 2, canopyH / 2, D / 2]} s={[W, canopyH, D]} mat={STEEL} />
      <mesh geometry={taper} position={[W / 2, canopyH + taperH / 2, D / 2]} castShadow>
        <meshStandardMaterial {...STEEL} />
        {mode === 'sketch' && <Edges threshold={20} color={SKETCH_EDGE} />}
      </mesh>
      <B p={[W / 2, canopyH + taperH + ductH / 2, ductD / 2 + 0.01]} s={[ductW, ductH, ductD]} mat={STEEL} />
      {/* filter grille + light */}
      <B p={[W / 2, 0.002, D / 2]} s={[W * 0.86, 0.004, D * 0.7]} mat={DARK_STEEL} edges={false} />
    </>
  );
}

function Hob({ W, H, D }: { W: number; H: number; D: number }) {
  const burners: [number, number, number][] = [
    [0.27, 0.3, 0.05],
    [0.73, 0.3, 0.04],
    [0.27, 0.72, 0.04],
    [0.73, 0.72, 0.06],
  ];
  return (
    <>
      <B p={[W / 2, H - 0.004, D / 2]} s={[W, 0.008, D]} mat={GLASS_BLACK} />
      {burners.map(([u, v, r], i) => (
        <group key={i} position={[W * u, H + 0.004, D * v]}>
          <mesh rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[r + 0.03, 0.005, 6, 24]} />
            <meshStandardMaterial {...DARK_STEEL} />
          </mesh>
          {/* pan support bars */}
          <mesh position={[0, 0.012, 0]}>
            <boxGeometry args={[(r + 0.04) * 2, 0.008, 0.008]} />
            <meshStandardMaterial color="#1b1b1c" roughness={0.6} />
          </mesh>
          <mesh position={[0, 0.012, 0]}>
            <boxGeometry args={[0.008, 0.008, (r + 0.04) * 2]} />
            <meshStandardMaterial color="#1b1b1c" roughness={0.6} />
          </mesh>
          <mesh position={[0, 0.006, 0]}>
            <cylinderGeometry args={[r * 0.55, r * 0.6, 0.012, 20]} />
            <meshStandardMaterial color="#2b2b2d" metalness={0.5} roughness={0.4} />
          </mesh>
        </group>
      ))}
      {/* knobs on the front edge */}
      {[0.2, 0.4, 0.6, 0.8].map((u) => (
        <mesh key={u} position={[W * u, H + 0.008, D - 0.03]}>
          <cylinderGeometry args={[0.014, 0.016, 0.018, 16]} />
          <meshStandardMaterial {...STEEL} />
        </mesh>
      ))}
    </>
  );
}

function Sink({ W, H, D, double }: { W: number; H: number; D: number; double: boolean }) {
  const rim = 0.03;
  const bowls = double ? 2 : 1;
  const bw = (W - 2 * rim - (bowls - 1) * 0.04) / bowls;
  const faucet = useMemo(() => {
    const curve = new THREE.CubicBezierCurve3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0.32, 0), new THREE.Vector3(0, 0.36, 0.2), new THREE.Vector3(0, 0.2, 0.22));
    return new THREE.TubeGeometry(curve, 24, 0.012, 10, false);
  }, []);
  return (
    <>
      {/* rim strips (leave the bowls open) */}
      <B p={[W / 2, H - 0.003, rim / 2]} s={[W, 0.006, rim]} mat={STEEL} />
      <B p={[W / 2, H - 0.003, D - rim / 2]} s={[W, 0.006, rim]} mat={STEEL} />
      <B p={[rim / 2, H - 0.003, D / 2]} s={[rim, 0.006, D]} mat={STEEL} />
      <B p={[W - rim / 2, H - 0.003, D / 2]} s={[rim, 0.006, D]} mat={STEEL} />
      {double && <B p={[W / 2, H - 0.003, D / 2]} s={[0.04, 0.006, D]} mat={STEEL} />}
      {Array.from({ length: bowls }, (_, i) => {
        const x = rim + i * (bw + 0.04) + bw / 2;
        return (
          <group key={i}>
            <mesh position={[x, H / 2, D / 2]}>
              <boxGeometry args={[bw, H - 0.008, D - 2 * rim]} />
              <meshStandardMaterial color="#aeb2b6" metalness={0.8} roughness={0.35} side={THREE.BackSide} />
            </mesh>
            <mesh position={[x, 0.006, D / 2]} rotation={[-Math.PI / 2, 0, 0]}>
              <circleGeometry args={[0.035, 20]} />
              <meshStandardMaterial {...DARK_STEEL} />
            </mesh>
          </group>
        );
      })}
      <group position={[W / 2, H, 0.045]}>
        <mesh position={[0, 0.02, 0]}>
          <cylinderGeometry args={[0.025, 0.028, 0.04, 16]} />
          <meshStandardMaterial {...STEEL} />
        </mesh>
        <mesh geometry={faucet}>
          <meshStandardMaterial {...STEEL} />
        </mesh>
      </group>
    </>
  );
}

function OvenFront({ W, H, D, micro }: { W: number; H: number; D: number; micro?: boolean }) {
  const strip = micro ? 0 : Math.min(0.09, H * 0.16);
  const doorH = H - strip - 0.01;
  return (
    <>
      <B p={[W / 2, H / 2, D / 2 - 0.01]} s={[W, H, D - 0.02]} mat={DARK_STEEL} />
      {!micro && <B p={[W / 2, H - strip / 2, D - 0.006]} s={[W - 0.01, strip, 0.012]} mat={STEEL} />}
      {/* door glass */}
      <B p={[micro ? W * 0.38 : W / 2, doorH / 2 + 0.005, D - 0.006]} s={[micro ? W * 0.68 : W - 0.012, doorH - 0.01, 0.012]} mat={GLASS_BLACK} />
      {micro && <B p={[W * 0.86, H / 2, D - 0.006]} s={[W * 0.24, H - 0.02, 0.012]} mat={STEEL} />}
      {/* handle */}
      {!micro && <B p={[W / 2, doorH - 0.04, D + 0.02]} s={[W * 0.75, 0.016, 0.016]} mat={STEEL} />}
      {!micro && [0.2, 0.8].map((u) => <B key={u} p={[W * u, H - strip / 2, D + 0.006]} s={[0.03, 0.03, 0.012]} mat={DARK_STEEL} edges={false} />)}
    </>
  );
}

function Fridge({ W, H, D, color }: { W: number; H: number; D: number; color: string }) {
  const split = H * 0.68;
  const mat = { color, metalness: 0.5, roughness: 0.3 };
  return (
    <>
      <B p={[W / 2, split / 2, D / 2]} s={[W, split - 0.004, D]} mat={mat} />
      <B p={[W / 2, split + (H - split) / 2, D / 2]} s={[W, H - split - 0.004, D]} mat={mat} />
      <B p={[W - 0.05, split - 0.35, D + 0.025]} s={[0.02, 0.5, 0.02]} mat={STEEL} />
      <B p={[W - 0.05, split + 0.2, D + 0.025]} s={[0.02, 0.3, 0.02]} mat={STEEL} />
    </>
  );
}

export function ApplianceModel({ a, wallTop, selected, clash }: { a: ApplianceInstance; wallTop: number; selected: boolean; clash: boolean }) {
  const setUI = useUI((s) => s.set);
  const { mode } = useRenderStyle();
  const def = applianceDef(a.type);
  const W = a.width * MM;
  const H = a.height * MM;
  const D = a.depth * MM;
  const highlight = mode === 'edit' && (selected || clash);
  const body = (() => {
    switch (true) {
      case def?.cutout?.kind === 'sink':
        return <Sink W={W} H={H} D={D} double={a.type === 'sink-double'} />;
      case a.type === 'hob':
        return <Hob W={W} H={H} D={D} />;
      case a.type === 'hood':
        return <Hood W={W} H={H} D={D} wallTop={Math.max(H, (wallTop - a.elevation) * MM)} />;
      case a.type === 'oven':
        return <OvenFront W={W} H={H} D={D} />;
      case a.type === 'microwave':
        return <OvenFront W={W} H={H} D={D} micro />;
      case a.type === 'fridge':
        return <Fridge W={W} H={H} D={D} color={def?.color ?? '#ddd'} />;
      case a.type === 'dishwasher' || a.type === 'washer':
        return (
          <>
            <B p={[W / 2, H / 2, D / 2]} s={[W, H, D]} mat={{ color: def?.color, metalness: 0.4, roughness: 0.35 }} />
            {a.type === 'washer' ? (
              <mesh position={[W / 2, H * 0.45, D + 0.005]}>
                <torusGeometry args={[W * 0.3, 0.02, 10, 32]} />
                <meshStandardMaterial {...STEEL} />
              </mesh>
            ) : (
              <B p={[W / 2, H - 0.06, D + 0.015]} s={[W * 0.6, 0.016, 0.016]} mat={STEEL} />
            )}
          </>
        );
      case a.type === 'tv':
        return (
          <>
            <B p={[W / 2, H / 2, D / 2]} s={[W, H, D]} mat={{ color: '#151618', roughness: 0.3 }} />
            <mesh position={[W / 2, H / 2, D + 0.001]}>
              <planeGeometry args={[W * 0.97, H * 0.95]} />
              <meshStandardMaterial color="#1b2633" roughness={0.08} metalness={0.2} emissive="#0b1622" />
            </mesh>
          </>
        );
      default:
        return <B p={[W / 2, H / 2, D / 2]} s={[W, H, D]} mat={{ color: def?.color ?? '#cccccc', roughness: 0.45, metalness: 0.1 }} />;
    }
  })();
  return (
    <group
      position={[a.x * MM, a.elevation * MM, a.y * MM]}
      rotation={[0, (-a.rotation * Math.PI) / 180, 0]}
      onClick={(e) => {
        if (mode !== 'edit') return;
        e.stopPropagation();
        setUI({ selection: { kind: 'appliance', id: a.id } });
      }}
    >
      {body}
      {highlight && (
        <mesh position={[W / 2, H / 2, D / 2]}>
          <boxGeometry args={[W + 0.01, H + 0.01, D + 0.01]} />
          <meshBasicMaterial color={clash ? '#ff3b2a' : '#2fd39f'} transparent opacity={0.22} depthWrite={false} />
        </mesh>
      )}
    </group>
  );
}
