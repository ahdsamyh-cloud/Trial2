import { usePrefs } from './store/uiStore';

export interface Palette {
  bg: string;
  gridMinor: string;
  gridMajor: string;
  axis: string;
  floor: string;
  floorSelected: string;
  wall: string;
  wallStroke: string;
  wallSelected: string;
  dim: string;
  dimBg: string;
  text: string;
  textMuted: string;
  accent: string;
  guide: string;
  handle: string;
  handleStroke: string;
  wall3d: string;
  floor3d: string;
  ground3d: string;
}

export const LIGHT: Palette = {
  bg: '#f6f5f1',
  gridMinor: 'rgba(40,50,60,0.07)',
  gridMajor: 'rgba(40,50,60,0.16)',
  axis: 'rgba(31,111,92,0.35)',
  floor: '#ece6d9',
  floorSelected: '#dcefe8',
  wall: '#5b6168',
  wallStroke: '#3b4046',
  wallSelected: '#1f9e7a',
  dim: '#2d4f8a',
  dimBg: 'rgba(255,255,255,0.88)',
  text: '#23272b',
  textMuted: '#6b737b',
  accent: '#1f6f5c',
  guide: '#e0663a',
  handle: '#ffffff',
  handleStroke: '#1f6f5c',
  wall3d: '#eeeae3',
  floor3d: '#c9b79c',
  ground3d: '#dedcd6',
};

export const DARK: Palette = {
  bg: '#16191d',
  gridMinor: 'rgba(220,230,240,0.05)',
  gridMajor: 'rgba(220,230,240,0.12)',
  axis: 'rgba(80,200,160,0.35)',
  floor: '#2a2d31',
  floorSelected: '#1f3a33',
  wall: '#a3abb4',
  wallStroke: '#c9d0d7',
  wallSelected: '#34d1a1',
  dim: '#8fb6ff',
  dimBg: 'rgba(22,25,29,0.88)',
  text: '#e8ebee',
  textMuted: '#9aa3ab',
  accent: '#34d1a1',
  guide: '#ff8a5c',
  handle: '#16191d',
  handleStroke: '#34d1a1',
  wall3d: '#d9d5ce',
  floor3d: '#8d7b63',
  ground3d: '#2b2f34',
};

export function usePalette(): Palette {
  return usePrefs((s) => (s.theme === 'dark' ? DARK : LIGHT));
}
