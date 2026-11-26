import type { BoardMaterialId, HandleStyle, PriceList, ServiceKind } from './types';

/* ---------- Boards ---------- */

export const BOARD_THICKNESSES = [6, 9, 12, 16, 18, 25] as const;

export const BOARD_MATERIALS: { id: BoardMaterialId; name: string; short: string; color: string }[] = [
  { id: 'ply', name: 'Plywood (MR)', short: 'Ply MR', color: '#d9b98a' },
  { id: 'bwp', name: 'Plywood (BWP, waterproof)', short: 'Ply BWP', color: '#caa574' },
  { id: 'mdf', name: 'MDF', short: 'MDF', color: '#b89a74' },
  { id: 'particle', name: 'Particle board', short: 'PB', color: '#cdb795' },
  { id: 'hdhmr', name: 'HDHMR', short: 'HDHMR', color: '#8f8a7e' },
];

export const materialName = (id: string) => BOARD_MATERIALS.find((m) => m.id === id)?.short ?? id;

/* ---------- Finishes (laminate / veneer swatches) ---------- */

export type FinishKind = 'laminate' | 'veneer' | 'paint' | 'none';

export interface Finish {
  id: string;
  name: string;
  kind: FinishKind;
  color: string;
  /** Wood-grain texture (affects grain direction in the cut list and the 3D texture). */
  grain: boolean;
  gloss?: boolean;
}

export const FINISHES: Finish[] = [
  { id: 'lam-white', name: 'Frosty White (matt)', kind: 'laminate', color: '#f3f2ee', grain: false },
  { id: 'lam-ivory', name: 'Ivory', kind: 'laminate', color: '#ece3cf', grain: false },
  { id: 'lam-grey', name: 'Stone Grey', kind: 'laminate', color: '#9ea2a3', grain: false },
  { id: 'lam-charcoal', name: 'Charcoal', kind: 'laminate', color: '#3c3f42', grain: false },
  { id: 'lam-sage', name: 'Sage Green', kind: 'laminate', color: '#9bae96', grain: false },
  { id: 'lam-navy', name: 'Navy Blue', kind: 'laminate', color: '#2e3f5c', grain: false },
  { id: 'lam-terracotta', name: 'Terracotta', kind: 'laminate', color: '#b86a4b', grain: false },
  { id: 'lam-red-gloss', name: 'Cherry Red (gloss)', kind: 'laminate', color: '#a52a2a', grain: false, gloss: true },
  { id: 'lam-oak', name: 'Natural Oak', kind: 'laminate', color: '#c9a273', grain: true },
  { id: 'lam-walnut', name: 'Walnut', kind: 'laminate', color: '#6f4b32', grain: true },
  { id: 'lam-teak', name: 'Teak', kind: 'laminate', color: '#9a6a3e', grain: true },
  { id: 'lam-ash', name: 'Grey Ash', kind: 'laminate', color: '#a9a196', grain: true },
  { id: 'ven-oak', name: 'Oak veneer', kind: 'veneer', color: '#d0aa78', grain: true },
  { id: 'ven-walnut', name: 'Walnut veneer', kind: 'veneer', color: '#5e3d27', grain: true },
  { id: 'ven-teak', name: 'Teak veneer', kind: 'veneer', color: '#a4713f', grain: true },
  { id: 'paint-white', name: 'PU paint white', kind: 'paint', color: '#fafafa', grain: false, gloss: true },
  { id: 'none', name: 'Unfinished', kind: 'none', color: '#d9c4a0', grain: false },
];

export const finishById = (id: string | undefined): Finish => FINISHES.find((f) => f.id === id) ?? FINISHES[0];

export const EDGE_THICKNESSES = [0.45, 0.8, 1, 2] as const;

/* ---------- Handles ---------- */

export const HANDLE_STYLES: { id: HandleStyle; name: string; hardware: string | null }[] = [
  { id: 'bar', name: 'Bar handle', hardware: 'handle-bar' },
  { id: 'knob', name: 'Knob', hardware: 'handle-knob' },
  { id: 'profile', name: 'Profile handle (aluminium)', hardware: 'handle-profile' },
  { id: 'gola', name: 'Gola / J-channel (handleless)', hardware: 'gola-profile' },
  { id: 'push', name: 'Push-to-open (handleless)', hardware: 'push-latch' },
];

/* ---------- Hardware ---------- */

export interface HardwareDef {
  id: string;
  name: string;
  unit: string;
  price: number;
}

export const HARDWARE: HardwareDef[] = [
  { id: 'hinge-soft', name: 'Concealed hinge, soft-close', unit: 'pc', price: 180 },
  { id: 'hinge-corner', name: 'Corner/blind hinge (165°)', unit: 'pc', price: 320 },
  { id: 'slide-tandem', name: 'Drawer slide, soft-close (pair)', unit: 'pair', price: 1250 },
  { id: 'slide-telescopic', name: 'Telescopic slide (pair)', unit: 'pair', price: 420 },
  { id: 'gas-lift', name: 'Gas lift / lift-up stay', unit: 'pc', price: 380 },
  { id: 'wardrobe-rod', name: 'Wardrobe rod with brackets', unit: 'set', price: 450 },
  { id: 'sliding-track', name: 'Sliding door track set (per door)', unit: 'set', price: 2400 },
  { id: 'handle-bar', name: 'Bar handle', unit: 'pc', price: 220 },
  { id: 'handle-knob', name: 'Knob', unit: 'pc', price: 120 },
  { id: 'handle-profile', name: 'Profile handle (per front)', unit: 'pc', price: 350 },
  { id: 'gola-profile', name: 'Gola profile (per front)', unit: 'pc', price: 600 },
  { id: 'push-latch', name: 'Push-to-open latch', unit: 'pc', price: 260 },
  { id: 'leg', name: 'Cabinet leg (adjustable)', unit: 'pc', price: 60 },
  { id: 'shelf-support', name: 'Shelf support stud', unit: 'pc', price: 4 },
  { id: 'wall-bracket', name: 'Wall-hanging bracket', unit: 'pc', price: 90 },
  { id: 'corner-carousel', name: 'Corner carousel / magic corner', unit: 'set', price: 6500 },
  { id: 'bed-lift', name: 'Bed hydraulic lift (pair)', unit: 'pair', price: 3800 },
  { id: 'tv-bracket', name: 'Concealed fixing bracket', unit: 'pc', price: 150 },
];

export const hardwareById = (id: string) => HARDWARE.find((h) => h.id === id);

/* ---------- Services ---------- */

export interface ServiceDef {
  kind: ServiceKind;
  name: string;
  group: 'electrical' | 'plumbing';
  mount: 'wall' | 'ceiling' | 'floor';
  defaultHeight: number;
  symbol: string;
  color: string;
}

export const SERVICES: ServiceDef[] = [
  { kind: 'socket', name: 'Socket', group: 'electrical', mount: 'wall', defaultHeight: 300, symbol: 'S', color: '#d98b1c' },
  { kind: 'switch', name: 'Switch', group: 'electrical', mount: 'wall', defaultHeight: 1200, symbol: 'SW', color: '#d98b1c' },
  { kind: 'light', name: 'Light point', group: 'electrical', mount: 'ceiling', defaultHeight: 3000, symbol: 'L', color: '#e2b007' },
  { kind: 'ac', name: 'AC point', group: 'electrical', mount: 'wall', defaultHeight: 2400, symbol: 'AC', color: '#3d8fd1' },
  { kind: 'water-cold', name: 'Water inlet (cold)', group: 'plumbing', mount: 'wall', defaultHeight: 450, symbol: 'C', color: '#2a7de1' },
  { kind: 'water-hot', name: 'Water inlet (hot)', group: 'plumbing', mount: 'wall', defaultHeight: 450, symbol: 'H', color: '#d8432f' },
  { kind: 'drain', name: 'Drain / waste pipe', group: 'plumbing', mount: 'wall', defaultHeight: 150, symbol: 'D', color: '#6b6f73' },
  { kind: 'gas', name: 'Gas line', group: 'plumbing', mount: 'wall', defaultHeight: 600, symbol: 'G', color: '#d6a500' },
];

export const serviceDef = (k: ServiceKind) => SERVICES.find((s) => s.kind === k)!;

/* ---------- Stone ---------- */

export interface Stone {
  id: string;
  name: string;
  family: 'marble' | 'granite' | 'quartz' | 'solid-surface';
  color: string;
  veins?: string;
  speckle?: boolean;
}

export const STONES: Stone[] = [
  { id: 'marble-carrara', name: 'Carrara white', family: 'marble', color: '#eeeeea', veins: '#9a9ea3' },
  { id: 'marble-statuario', name: 'Statuario', family: 'marble', color: '#f5f4f0', veins: '#7d7f82' },
  { id: 'marble-emperador', name: 'Emperador dark', family: 'marble', color: '#4d3a2c', veins: '#c9b39a' },
  { id: 'granite-black', name: 'Black Galaxy', family: 'granite', color: '#1d1d1f', speckle: true },
  { id: 'granite-tan', name: 'Tan Brown', family: 'granite', color: '#4a3027', speckle: true },
  { id: 'granite-white', name: 'Kashmir White', family: 'granite', color: '#d9d3cb', speckle: true },
  { id: 'quartz-white', name: 'Pure white quartz', family: 'quartz', color: '#f7f7f5' },
  { id: 'quartz-grey', name: 'Concrete grey quartz', family: 'quartz', color: '#9c9c98', speckle: true },
  { id: 'quartz-calacatta', name: 'Calacatta quartz', family: 'quartz', color: '#f2efe8', veins: '#b29d77' },
  { id: 'solid-white', name: 'Solid surface white', family: 'solid-surface', color: '#fbfbfb' },
  { id: 'solid-beige', name: 'Solid surface beige', family: 'solid-surface', color: '#e6dccb' },
];

export const stoneById = (id: string) => STONES.find((s) => s.id === id) ?? STONES[0];

/* ---------- Default price list (editable per project) ---------- */

export function defaultPrices(): PriceList {
  const boards: Record<string, number> = {};
  // indicative price per sq ft at 18 mm; thinner/thicker boards scale with thickness
  const perSqft18: Record<BoardMaterialId, number> = { ply: 95, bwp: 125, mdf: 55, particle: 40, hdhmr: 80 };
  for (const m of BOARD_MATERIALS)
    for (const t of BOARD_THICKNESSES) boards[`${m.id}-${t}`] = Math.round((perSqft18[m.id] * Math.max(0.4, t / 18) * 32) / 10) * 10; // per 8×4 sheet
  return {
    currency: '₹',
    boards,
    finishPerSqft: { laminate: 45, veneer: 120, paint: 160, none: 0 },
    edgeBandPerM: { '0.45': 8, '0.8': 14, '1': 18, '2': 32 },
    hardware: Object.fromEntries(HARDWARE.map((h) => [h.id, h.price])),
    stonePerSqft: {
      'marble-carrara': 650,
      'marble-statuario': 1400,
      'marble-emperador': 900,
      'granite-black': 320,
      'granite-tan': 220,
      'granite-white': 260,
      'quartz-white': 750,
      'quartz-grey': 800,
      'quartz-calacatta': 1100,
      'solid-white': 900,
      'solid-beige': 900,
    },
    labourPercent: 15,
  };
}
