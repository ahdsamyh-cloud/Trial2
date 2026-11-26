import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { LengthUnit } from '../model/types';

export type StepId = 'floor' | 'walls' | 'services' | 'furniture' | 'appliances' | 'countertop' | 'outputs';
export type ViewMode = '2d' | '3d' | 'split';
export type Tool = 'select' | 'draw' | 'pan';

export type Selection =
  | { kind: 'room'; roomId: string }
  | { kind: 'wall'; roomId: string; wallId: string }
  | { kind: 'corner'; roomId: string; index: number }
  | null;

export interface Layers {
  dimensions: boolean;
  structure: boolean;
  furniture: boolean;
  electrical: boolean;
  plumbing: boolean;
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
      layers: { dimensions: true, structure: true, furniture: true, electrical: true, plumbing: true },
      set: (p) => set(p),
      toggleLayer: (k) => set((s) => ({ layers: { ...s.layers, [k]: !s.layers[k] } })),
    }),
    { name: 'roomcraft:prefs' },
  ),
);

/** Transient UI state (not persisted). */
interface UIState {
  step: StepId;
  view: ViewMode;
  tool: Tool;
  selection: Selection;
  sidebarOpen: boolean;
  toast: { msg: string; kind: 'info' | 'error' } | null;
  /** Request the 2D view to fit content (incremented). */
  fitRequest: number;
  set: (p: Partial<Omit<UIState, 'set' | 'notify'>>) => void;
  notify: (msg: string, kind?: 'info' | 'error') => void;
}

export const isPhone = () => typeof window !== 'undefined' && window.innerWidth <= 800;

/** On phones the steps panel covers the plan: close it after actions that need the canvas. */
export function closePanelOnPhone() {
  if (isPhone()) useUI.getState().set({ sidebarOpen: false });
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;

export const useUI = create<UIState>((set) => ({
  step: 'floor',
  view: typeof window !== 'undefined' && window.innerWidth >= 1100 ? 'split' : '2d',
  tool: 'select',
  selection: null,
  sidebarOpen: typeof window !== 'undefined' ? window.innerWidth >= 800 : true,
  toast: null,
  fitRequest: 0,
  set: (p) => set(p),
  notify: (msg, kind = 'info') => {
    clearTimeout(toastTimer);
    set({ toast: { msg, kind } });
    toastTimer = setTimeout(() => set({ toast: null }), 3500);
  },
}));
