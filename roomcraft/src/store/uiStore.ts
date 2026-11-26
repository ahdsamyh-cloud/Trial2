import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { LengthUnit, OpeningKind, ServiceKind, Vec2 } from '../model/types';

export type StepId = 'floor' | 'walls' | 'services' | 'furniture' | 'appliances' | 'countertop' | 'outputs';
export type ViewMode = '2d' | '3d' | 'split' | 'elev';
export type Tool = 'select' | 'draw' | 'pan' | 'place' | 'measure';

export type Selection =
  | { kind: 'room'; roomId: string }
  | { kind: 'wall'; roomId: string; wallId: string }
  | { kind: 'corner'; roomId: string; index: number }
  | { kind: 'opening'; id: string }
  | { kind: 'service'; id: string }
  | { kind: 'beam'; id: string }
  | { kind: 'column'; id: string }
  | { kind: 'module'; id: string; ids: string[]; panelKey?: string }
  | { kind: 'appliance'; id: string }
  | null;

export type PlaceSpec =
  | { cat: 'opening'; kind: OpeningKind }
  | { cat: 'service'; kind: ServiceKind }
  | { cat: 'column' }
  | { cat: 'beam' }
  | { cat: 'module'; type: string }
  | { cat: 'appliance'; type: string };

export const selRoomId = (s: Selection): string | undefined =>
  s && (s.kind === 'room' || s.kind === 'wall' || s.kind === 'corner') ? s.roomId : undefined;

export interface Layers {
  dimensions: boolean;
  structure: boolean;
  furniture: boolean;
  electrical: boolean;
  plumbing: boolean;
  ceiling: boolean;
}

/** Persisted user preferences. */
interface PrefsState {
  units: LengthUnit;
  theme: 'light' | 'dark';
  gridSize: number;
  snapGrid: boolean;
  snapAngle: boolean;
  snapObjects: boolean;
  layers: Layers;
  tourDone: boolean;
  set: (p: Partial<Omit<PrefsState, 'set' | 'toggleLayer'>>) => void;
  toggleLayer: (k: keyof Layers) => void;
}

const prefersDark = typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches;

export const usePrefs = create<PrefsState>()(
  persist(
    (set) => ({
      units: 'mm',
      theme: prefersDark ? 'dark' : 'light',
      gridSize: 100,
      snapGrid: true,
      snapAngle: true,
      snapObjects: true,
      layers: { dimensions: true, structure: true, furniture: true, electrical: true, plumbing: true, ceiling: false },
      tourDone: false,
      set: (p) => set(p),
      toggleLayer: (k) => set((s) => ({ layers: { ...s.layers, [k]: !s.layers[k] } })),
    }),
    {
      name: 'roomcraft:prefs',
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<PrefsState>;
        return { ...current, ...p, layers: { ...current.layers, ...p.layers } };
      },
    },
  ),
);

export interface Measurement {
  a: Vec2;
  b: Vec2;
}

/** Transient UI state (not persisted). */
interface UIState {
  step: StepId;
  view: ViewMode;
  tool: Tool;
  placing: PlaceSpec | null;
  selection: Selection;
  sidebarOpen: boolean;
  toast: { msg: string; kind: 'info' | 'error' } | null;
  /** Request the views to fit content (incremented). */
  fitRequest: number;
  exploded: boolean;
  walk: boolean;
  elevationWallId: string | null;
  measurements: Measurement[];
  checksOpen: boolean;
  tourStep: number | null;
  busy: string | null;
  set: (p: Partial<Omit<UIState, 'set' | 'notify'>>) => void;
  notify: (msg: string, kind?: 'info' | 'error') => void;
}

export const isPhone = () => typeof window !== 'undefined' && window.innerWidth <= 800;

let toastTimer: ReturnType<typeof setTimeout> | undefined;

export const useUI = create<UIState>((set) => ({
  step: 'floor',
  view: typeof window !== 'undefined' && window.innerWidth >= 1100 ? 'split' : '2d',
  tool: 'select',
  placing: null,
  selection: null,
  sidebarOpen: typeof window !== 'undefined' ? window.innerWidth >= 800 : true,
  toast: null,
  fitRequest: 0,
  exploded: false,
  walk: false,
  elevationWallId: null,
  measurements: [],
  checksOpen: false,
  tourStep: null,
  busy: null,
  set: (p) => set(p),
  notify: (msg, kind = 'info') => {
    clearTimeout(toastTimer);
    set({ toast: { msg, kind } });
    toastTimer = setTimeout(() => set({ toast: null }), 3500);
  },
}));

/** On phones the steps panel covers the plan: close it after actions that need the canvas. */
export function closePanelOnPhone() {
  if (isPhone()) useUI.getState().set({ sidebarOpen: false });
}

export function startPlacing(spec: PlaceSpec) {
  useUI.getState().set({ tool: 'place', placing: spec, selection: null });
  closePanelOnPhone();
}
