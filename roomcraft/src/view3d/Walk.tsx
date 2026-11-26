import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import type { Vec2 } from '../model/types';

const MM = 0.001;
const EYE = 1.6;
const SPEED = 1.6; // m/s

/** Shared movement flags (keyboard + on-screen pad). */
export const walkInput = { forward: false, back: false, left: false, right: false };

/** First-person walkthrough: WASD/arrows move, drag (mouse or touch) to look around. */
export function WalkControls({ start, look }: { start: Vec2; look: Vec2 }) {
  const { camera, gl } = useThree();
  const yaw = useRef(Math.PI);
  const pitch = useRef(0);

  useEffect(() => {
    camera.position.set(start.x * MM, EYE, start.y * MM);
    // forward = (-sin yaw, -cos yaw) in the x/z plane
    yaw.current = Math.atan2(-(look.x - start.x), -(look.y - start.y));
    pitch.current = -0.25;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camera]);

  useEffect(() => {
    const keys: Record<string, keyof typeof walkInput> = {
      KeyW: 'forward',
      ArrowUp: 'forward',
      KeyS: 'back',
      ArrowDown: 'back',
      KeyA: 'left',
      ArrowLeft: 'left',
      KeyD: 'right',
      ArrowRight: 'right',
    };
    const down = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest?.('input, textarea, select')) return;
      const k = keys[e.code];
      if (k) {
        walkInput[k] = true;
        e.preventDefault();
        e.stopPropagation();
      }
    };
    const up = (e: KeyboardEvent) => {
      const k = keys[e.code];
      if (k) walkInput[k] = false;
    };
    window.addEventListener('keydown', down, true);
    window.addEventListener('keyup', up, true);
    const el = gl.domElement;
    let last: { x: number; y: number } | null = null;
    const pd = (e: PointerEvent) => {
      last = { x: e.clientX, y: e.clientY };
      el.setPointerCapture(e.pointerId);
    };
    const pm = (e: PointerEvent) => {
      if (!last) return;
      yaw.current -= (e.clientX - last.x) * 0.005;
      pitch.current = Math.max(-1.2, Math.min(1.2, pitch.current - (e.clientY - last.y) * 0.005));
      last = { x: e.clientX, y: e.clientY };
    };
    const pu = () => (last = null);
    el.addEventListener('pointerdown', pd);
    el.addEventListener('pointermove', pm);
    el.addEventListener('pointerup', pu);
    el.addEventListener('pointercancel', pu);
    return () => {
      window.removeEventListener('keydown', down, true);
      window.removeEventListener('keyup', up, true);
      el.removeEventListener('pointerdown', pd);
      el.removeEventListener('pointermove', pm);
      el.removeEventListener('pointerup', pu);
      el.removeEventListener('pointercancel', pu);
      Object.keys(walkInput).forEach((k) => (walkInput[k as keyof typeof walkInput] = false));
    };
  }, [gl]);

  const euler = useRef(new THREE.Euler(0, 0, 0, 'YXZ'));
  useFrame((_, dt) => {
    const d = Math.min(dt, 0.1) * SPEED;
    const fwd = new THREE.Vector3(-Math.sin(yaw.current), 0, -Math.cos(yaw.current));
    const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
    if (walkInput.forward) camera.position.addScaledVector(fwd, d);
    if (walkInput.back) camera.position.addScaledVector(fwd, -d);
    if (walkInput.right) camera.position.addScaledVector(right, d);
    if (walkInput.left) camera.position.addScaledVector(right, -d);
    camera.position.y = EYE;
    euler.current.set(pitch.current, yaw.current, 0);
    camera.quaternion.setFromEuler(euler.current);
  });
  return null;
}
