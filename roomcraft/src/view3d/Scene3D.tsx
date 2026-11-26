import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls, Grid as DreiGrid, GizmoHelper, GizmoViewport } from '@react-three/drei';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { useProject } from '../store/projectStore';
import { useUI } from '../store/uiStore';
import { usePalette, type Palette } from '../theme';
import type { Room, Vec2 } from '../model/types';
import { boundsOf, outerPolygon, wallQuads } from '../model/geometry';

/** Plan (x, y) in mm → three.js world (metres): x → x, plan y → z, height → y. */
const MM = 0.001;

function shapeFrom(points: Vec2[]): THREE.Shape {
  // shape is built in (x, -y) so that rotating -90° about X maps plan y → +z
  const s = new THREE.Shape();
  points.forEach((p, i) => (i === 0 ? s.moveTo(p.x * MM, -p.y * MM) : s.lineTo(p.x * MM, -p.y * MM)));
  s.closePath();
  return s;
}

function WallMesh({ quad, height, color, selected, onSelect }: { quad: Vec2[]; height: number; color: string; selected: boolean; onSelect: () => void }) {
  const geom = useMemo(() => {
    const g = new THREE.ExtrudeGeometry(shapeFrom(quad), { depth: height * MM, bevelEnabled: false });
    g.computeVertexNormals();
    return g;
  }, [quad, height]);
  useEffect(() => () => geom.dispose(), [geom]);
  return (
    <mesh
      geometry={geom}
      rotation={[-Math.PI / 2, 0, 0]}
      castShadow
      receiveShadow
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
    >
      <meshStandardMaterial color={selected ? '#3fc79c' : color} roughness={0.9} metalness={0} />
    </mesh>
  );
}

function RoomMeshes({ room, palette }: { room: Room; palette: Palette }) {
  const selection = useUI((s) => s.selection);
  const setUI = useUI((s) => s.set);
  const quads = useMemo(() => wallQuads(room), [room]);
  const floorGeom = useMemo(() => new THREE.ShapeGeometry(shapeFrom(room.points)), [room.points]);
  useEffect(() => () => floorGeom.dispose(), [floorGeom]);
  const roomSelected = selection?.roomId === room.id && selection.kind !== 'wall';
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
      {quads.map((q, i) => (
        <WallMesh
          key={room.walls[i].id}
          quad={q}
          height={room.walls[i].height}
          color={palette.wall3d}
          selected={selection?.kind === 'wall' && selection.wallId === room.walls[i].id}
          onSelect={() => setUI({ selection: { kind: 'wall', roomId: room.id, wallId: room.walls[i].id } })}
        />
      ))}
    </group>
  );
}

/** Re-frames the camera on the project whenever a fit is requested (and once on mount). */
function CameraFramer({ controls }: { controls: React.RefObject<OrbitControlsImpl> }) {
  const { camera, size } = useThree();
  const fitRequest = useUI((s) => s.fitRequest);
  useEffect(() => {
    const rooms = useProject.getState().project.rooms;
    const b = boundsOf(rooms.flatMap((r) => outerPolygon(r)));
    const cx = b ? ((b.minX + b.maxX) / 2) * MM : 2.5;
    const cz = b ? ((b.minY + b.maxY) / 2) * MM : 2;
    const span = b ? Math.hypot(b.maxX - b.minX, b.maxY - b.minY) * MM : 6;
    const persp = camera as THREE.PerspectiveCamera;
    const halfFov = ((persp.fov ?? 45) * Math.PI) / 360;
    const aspect = Math.min(1, size.width / Math.max(1, size.height));
    const radius = span / 2 + 1.2;
    const d = radius / Math.sin(halfFov) / aspect;
    const dir = new THREE.Vector3(0.55, 0.85, 0.95).normalize();
    camera.position.set(cx + dir.x * d, dir.y * d, cz + dir.z * d);
    const c = controls.current;
    if (c) {
      c.target.set(cx, 0.6, cz);
      c.update();
    } else camera.lookAt(cx, 0.6, cz);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitRequest, camera, controls]);
  return null;
}

export function Scene3D() {
  const rooms = useProject((s) => s.project.rooms);
  const palette = usePalette();
  const setUI = useUI((s) => s.set);
  const controls = useRef<OrbitControlsImpl>(null);

  return (
    <div className="scene3d" style={{ background: palette.bg }}>
      <Canvas
        shadows
        dpr={[1, 2]}
        camera={{ fov: 45, near: 0.05, far: 500, position: [6, 6, 8] }}
        onPointerMissed={() => setUI({ selection: null })}
      >
        <color attach="background" args={[palette.bg]} />
        <hemisphereLight args={['#ffffff', '#8a8378', 0.7]} />
        <directionalLight
          position={[8, 14, 6]}
          intensity={1.6}
          castShadow
          shadow-mapSize={[2048, 2048]}
          shadow-camera-left={-20}
          shadow-camera-right={20}
          shadow-camera-top={20}
          shadow-camera-bottom={-20}
        />
        <ambientLight intensity={0.25} />
        {rooms.map((r) => (
          <RoomMeshes key={r.id} room={r} palette={palette} />
        ))}
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.002, 0]} receiveShadow>
          <planeGeometry args={[400, 400]} />
          <meshStandardMaterial color={palette.ground3d} roughness={1} />
        </mesh>
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
        <OrbitControls ref={controls} makeDefault enableDamping dampingFactor={0.1} maxPolarAngle={Math.PI / 2 - 0.02} />
        <CameraFramer controls={controls} />
        <GizmoHelper alignment="bottom-right" margin={[60, 60]}>
          <GizmoViewport labelColor="white" axisHeadScale={0.9} />
        </GizmoHelper>
      </Canvas>
      <div className="view-badge">3D · drag to orbit · right-drag / two fingers to pan · scroll to zoom</div>
      <div className="zoom-controls">
        <button className="btn icon" title="Frame the whole project (F)" onClick={() => setUI({ fitRequest: useUI.getState().fitRequest + 1 })}>
          ⤢
        </button>
      </div>
    </div>
  );
}
