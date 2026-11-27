import { useMemo } from 'react';
import * as THREE from 'three';
import { ContactShadows, Environment, Lightformer, Line } from '@react-three/drei';
import { EffectComposer, N8AO, SMAA } from '@react-three/postprocessing';
import type { Project } from '../model/types';
import { dimensionLines } from '../model/annotations';
import { formatLength } from '../model/units';
import type { LengthUnit } from '../model/types';
import { axes, footprint, localToPlan } from '../model/structure';
import { dot } from '../model/geometry';
import { moduleDef } from '../model/furniture';
import type { CounterPiece } from '../model/countertop';

const MM = 0.001;

/* ---------------- lighting ---------------- */

/** Soft studio lighting baked into an environment map (no network fetch needed). */
export function StudioEnvironment({ intensity = 1 }: { intensity?: number }) {
  return (
    <Environment resolution={256} frames={1} environmentIntensity={intensity}>
      <Lightformer form="rect" intensity={2.2} position={[0, 8, 0]} rotation-x={Math.PI / 2} scale={[14, 14, 1]} />
      <Lightformer form="rect" intensity={1.1} position={[-8, 3, 4]} rotation-y={Math.PI / 2} scale={[10, 5, 1]} />
      <Lightformer form="rect" intensity={0.8} position={[8, 3, -4]} rotation-y={-Math.PI / 2} scale={[10, 5, 1]} />
      <Lightformer form="rect" intensity={0.9} position={[0, 3, 10]} scale={[14, 5, 1]} />
      <Lightformer form="ring" intensity={1.5} position={[3, 6, 6]} scale={2} />
    </Environment>
  );
}

export function PhotoEffects() {
  return (
    <EffectComposer multisampling={0}>
      <N8AO aoRadius={0.35} distanceFalloff={0.6} intensity={2.4} quality="medium" halfRes />
      <SMAA />
    </EffectComposer>
  );
}

export function StudioFloor({ color }: { color: string }) {
  return (
    <>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.003, 0]} receiveShadow>
        <planeGeometry args={[400, 400]} />
        <meshStandardMaterial color={color} roughness={1} />
      </mesh>
      <ContactShadows position={[0, 0.002, 0]} scale={40} resolution={1024} blur={2.4} opacity={0.45} far={3} frames={1} />
    </>
  );
}

/* ---------------- camera ---------------- */

/** 3/4 catalogue view looking into the furniture, framed on its bounding box. */
export function presentationView(project: Project, aspect: number, fovDeg = 32) {
  const items = [...project.modules, ...project.appliances];
  if (!items.length) return null;
  const pts = items.flatMap((it) => footprint(it));
  const minX = Math.min(...pts.map((p) => p.x));
  const maxX = Math.max(...pts.map((p) => p.x));
  const minY = Math.min(...pts.map((p) => p.y));
  const maxY = Math.max(...pts.map((p) => p.y));
  const top = Math.max(...items.map((it) => it.elevation + it.height), 900);
  // average front direction, weighted by width
  let fx = 0;
  let fy = 0;
  for (const it of items) {
    const { uy } = axes(it.rotation);
    fx += uy.x * it.width;
    fy += uy.y * it.width;
  }
  let L = Math.hypot(fx, fy);
  if (L < 1e-3) {
    fx = 0.6;
    fy = 0.8;
    L = 1;
  }
  const dir = { x: fx / L, y: fy / L };
  // tilt slightly sideways so a straight run still reads in 3D
  const side = { x: -dir.y, y: dir.x };
  const view = { x: dir.x * 0.94 + side.x * 0.34, y: dir.y * 0.94 + side.y * 0.34 };
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const radius = 0.5 * Math.hypot(maxX - minX, maxY - minY, top) * MM * 1.08;
  const half = (fovDeg * Math.PI) / 360;
  const dist = radius / Math.sin(half) / Math.min(1, aspect * 0.95);
  const target = new THREE.Vector3(cx * MM, top * MM * 0.46, cy * MM);
  const vl = Math.hypot(view.x, view.y);
  const pos = new THREE.Vector3(target.x + (view.x / vl) * dist * 0.86, target.y + dist * 0.42, target.z + (view.y / vl) * dist * 0.86);
  return { pos, target, fov: fovDeg };
}

/* ---------------- dimensions ---------------- */

const labelCache = new Map<string, { tex: THREE.Texture; aspect: number }>();

function labelTexture(text: string, color: string) {
  const key = `${text}|${color}`;
  const hit = labelCache.get(key);
  if (hit) return hit;
  const c = document.createElement('canvas');
  const g = c.getContext('2d')!;
  const fs = 72;
  g.font = `italic 600 ${fs}px "Segoe Print", "Comic Sans MS", system-ui, sans-serif`;
  const w = Math.ceil(g.measureText(text).width) + 24;
  c.width = w;
  c.height = fs + 24;
  g.font = `italic 600 ${fs}px "Segoe Print", "Comic Sans MS", system-ui, sans-serif`;
  g.fillStyle = 'rgba(255,255,255,0.86)';
  g.beginPath();
  g.roundRect?.(0, 4, w, fs + 16, 14);
  g.fill();
  g.fillStyle = color;
  g.textBaseline = 'middle';
  g.fillText(text, 12, c.height / 2 + 2);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const v = { tex, aspect: w / c.height };
  labelCache.set(key, v);
  return v;
}

function Label({ position, text, color, size = 0.075 }: { position: [number, number, number]; text: string; color: string; size?: number }) {
  const { tex, aspect } = useMemo(() => labelTexture(text, color), [text, color]);
  return (
    <sprite position={position} scale={[size * aspect, size, 1]} renderOrder={10}>
      <spriteMaterial map={tex} depthTest={false} transparent />
    </sprite>
  );
}

export function Dimensions3D({ project, units, color = '#c0392b' }: { project: Project; units: LengthUnit; color?: string }) {
  const dims = useMemo(() => dimensionLines(project), [project]);
  return (
    <group>
      {dims.map((d, i) => {
        const a = new THREE.Vector3(d.a.x * MM, d.a.z * MM, d.a.y * MM);
        const b = new THREE.Vector3(d.b.x * MM, d.b.z * MM, d.b.y * MM);
        const vertical = d.kind === 'height';
        const along = b.clone().sub(a).normalize();
        const tick = vertical ? new THREE.Vector3(-along.z || 1, 0, along.x).normalize().multiplyScalar(0.04) : new THREE.Vector3(0, 0.04, 0);
        const ticks: [THREE.Vector3, THREE.Vector3][] = [a, b].map((p) => [p.clone().sub(tick), p.clone().add(tick)]);
        const mid = a.clone().add(b).multiplyScalar(0.5).add(vertical ? new THREE.Vector3(0, 0, 0) : new THREE.Vector3(0, 0.06, 0));
        return (
          <group key={i}>
            <Line points={[a, b]} color={color} lineWidth={1.6} depthTest={false} renderOrder={9} />
            {ticks.map((t, k) => (
              <Line key={k} points={t} color={color} lineWidth={1.6} depthTest={false} renderOrder={9} />
            ))}
            <Label position={[mid.x, mid.y, mid.z]} text={formatLength(d.value, units)} color={color} size={d.kind === 'overall' ? 0.15 : 0.11} />
          </group>
        );
      })}
    </group>
  );
}

/* ---------------- wall tiles ---------------- */

const tileCache = new Map<string, THREE.Texture>();

/** Canvas tile texture; one texture tile covers `tileMm` millimetres. */
function tileTexture(style: string): { tex: THREE.Texture; w: number; h: number } {
  const spec: Record<string, { tile: string; grout: string; w: number; h: number; brick: boolean }> = {
    'subway-white': { tile: '#f7f7f5', grout: '#d2d0cb', w: 150, h: 75, brick: true },
    'subway-grey': { tile: '#b9bcbf', grout: '#8d9094', w: 150, h: 75, brick: true },
    'square-white': { tile: '#f4f4f1', grout: '#cfcdc8', w: 100, h: 100, brick: false },
    'hex-green': { tile: '#6f9c86', grout: '#e8e6df', w: 100, h: 100, brick: false },
  };
  const s = spec[style] ?? spec['subway-white'];
  let tex = tileCache.get(style);
  if (!tex) {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = s.brick ? 256 : 256;
    const g = c.getContext('2d')!;
    g.fillStyle = s.grout;
    g.fillRect(0, 0, 256, 256);
    const rows = 2;
    const cols = s.brick ? 2 : 2;
    const tw = 256 / cols;
    const th = 256 / rows;
    for (let r = 0; r < rows; r++)
      for (let k = -1; k <= cols; k++) {
        const off = s.brick && r % 2 ? tw / 2 : 0;
        const x = k * tw + off + 3;
        const y = r * th + 3;
        const grad = g.createLinearGradient(x, y, x, y + th);
        grad.addColorStop(0, s.tile);
        grad.addColorStop(1, shade(s.tile, -8));
        g.fillStyle = grad;
        g.fillRect(x, y, tw - 6, th - 6);
        g.fillStyle = 'rgba(255,255,255,0.25)';
        g.fillRect(x, y, tw - 6, 4);
      }
    tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.anisotropy = 8;
    tileCache.set(style, tex);
  }
  return { tex, w: s.w * 2, h: s.h * 2 };
}

function shade(hex: string, amt: number) {
  const n = parseInt(hex.slice(1), 16);
  const c = (v: number) => Math.max(0, Math.min(255, v + amt));
  return `rgb(${c((n >> 16) & 255)},${c((n >> 8) & 255)},${c(n & 255)})`;
}

/** Tiles on the wall between each worktop piece and the wall units above it. */
export function WallTiles({ project, pieces }: { project: Project; pieces: CounterPiece[] }) {
  const style = project.countertop.wallTiles ?? 'none';
  const tiles = useMemo(() => {
    if (style === 'none') return [];
    return pieces.map((p) => {
      const { uy } = axes(p.rotation);
      const line = dot({ x: p.x, y: p.y }, uy);
      const wallUnits = project.modules.filter((m) => moduleDef(m.type)?.kind === 'wall' && Math.abs((((m.rotation - p.rotation) % 360) + 360) % 360) < 0.5 && Math.abs(dot({ x: m.x, y: m.y }, uy) - line) < 60);
      const z0 = p.z + p.thickness + (p.backsplash?.height ?? 0);
      const z1 = wallUnits.length ? Math.min(...wallUnits.map((m) => m.elevation)) : Math.max(z0 + 300, 1450);
      return { p, z0, z1 };
    });
  }, [project, pieces, style]);
  if (style === 'none') return null;
  const { tex, w, h } = tileTexture(style);
  return (
    <>
      {tiles.map(({ p, z0, z1 }) => {
        const len = p.length;
        const hh = z1 - z0;
        if (hh <= 10) return null;
        const t = tex.clone();
        t.needsUpdate = true;
        t.repeat.set(len / w, hh / h);
        const o = localToPlan({ x: p.x, y: p.y, rotation: p.rotation, width: 0, depth: 0, height: 0, elevation: 0 }, 0, 1);
        return (
          <group key={p.id} position={[o.x * MM, 0, o.y * MM]} rotation={[0, (-p.rotation * Math.PI) / 180, 0]}>
            <mesh position={[(len / 2) * MM, ((z0 + z1) / 2) * MM, 0]} receiveShadow>
              <planeGeometry args={[len * MM, hh * MM]} />
              <meshStandardMaterial map={t} roughness={0.35} />
            </mesh>
          </group>
        );
      })}
    </>
  );
}
