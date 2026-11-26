/** Appliance library with standard sizes (mm). All sizes are editable per instance. */
export type ApplianceMount = 'floor' | 'counter' | 'inset' | 'wall' | 'built-in';

export interface ApplianceDef {
  id: string;
  name: string;
  category: 'kitchen' | 'other';
  width: number;
  height: number;
  depth: number;
  /** Default elevation (bottom above floor). 'counter'/'inset' items are recomputed to sit on the worktop. */
  elevation: number;
  mount: ApplianceMount;
  /** Countertop cut-out made by inset appliances (sink, hob). */
  cutout?: { width: number; depth: number; kind: 'sink' | 'hob'; radius?: number };
  /** Built-in appliance: replaces doors/shelves in the cabinet it sits in. */
  needsSpace?: boolean;
  color: string;
  icon: string;
}

export const APPLIANCES: ApplianceDef[] = [
  { id: 'sink-single', name: 'Sink, single bowl', category: 'kitchen', width: 600, height: 220, depth: 450, elevation: 650, mount: 'inset', cutout: { width: 560, depth: 420, kind: 'sink', radius: 20 }, color: '#c9ccce', icon: '◻' },
  { id: 'sink-double', name: 'Sink, double bowl', category: 'kitchen', width: 1000, height: 220, depth: 500, elevation: 650, mount: 'inset', cutout: { width: 960, depth: 470, kind: 'sink', radius: 20 }, color: '#c9ccce', icon: '◫' },
  { id: 'hob', name: 'Hob (4 burner)', category: 'kitchen', width: 750, height: 60, depth: 520, elevation: 840, mount: 'inset', cutout: { width: 710, depth: 480, kind: 'hob' }, color: '#222326', icon: '⁘' },
  { id: 'hood', name: 'Chimney / hood', category: 'kitchen', width: 900, height: 500, depth: 480, elevation: 1600, mount: 'wall', color: '#b8bcbf', icon: '⏢' },
  { id: 'oven', name: 'Built-in oven', category: 'kitchen', width: 595, height: 595, depth: 560, elevation: 850, mount: 'built-in', needsSpace: true, color: '#2c2d30', icon: '▣' },
  { id: 'microwave', name: 'Built-in microwave', category: 'kitchen', width: 595, height: 390, depth: 400, elevation: 1450, mount: 'built-in', needsSpace: true, color: '#2c2d30', icon: '▤' },
  { id: 'fridge', name: 'Refrigerator', category: 'kitchen', width: 700, height: 1800, depth: 700, elevation: 0, mount: 'floor', color: '#d7dadc', icon: '▯' },
  { id: 'dishwasher', name: 'Dishwasher (under counter)', category: 'kitchen', width: 600, height: 820, depth: 580, elevation: 0, mount: 'floor', color: '#cfd2d4', icon: '▦' },
  { id: 'kettle', name: 'Kettle', category: 'kitchen', width: 220, height: 250, depth: 160, elevation: 870, mount: 'counter', color: '#e7e7e7', icon: '◔' },
  { id: 'toaster', name: 'Toaster', category: 'kitchen', width: 300, height: 200, depth: 180, elevation: 870, mount: 'counter', color: '#bdbdbd', icon: '▭' },
  { id: 'mixer', name: 'Mixer grinder', category: 'kitchen', width: 400, height: 350, depth: 250, elevation: 870, mount: 'counter', color: '#f0f0f0', icon: '◍' },
  { id: 'purifier', name: 'Water purifier', category: 'kitchen', width: 300, height: 500, depth: 250, elevation: 1350, mount: 'wall', color: '#f2f4f6', icon: '◈' },
  { id: 'washer', name: 'Washing machine', category: 'other', width: 600, height: 850, depth: 600, elevation: 0, mount: 'floor', color: '#e9ebec', icon: '◎' },
  { id: 'tv', name: 'TV (55")', category: 'other', width: 1230, height: 710, depth: 60, elevation: 900, mount: 'wall', color: '#111214', icon: '▬' },
  { id: 'ac', name: 'AC indoor unit', category: 'other', width: 1000, height: 300, depth: 220, elevation: 2300, mount: 'wall', color: '#f5f6f7', icon: '▭' },
  { id: 'geyser', name: 'Geyser / water heater', category: 'other', width: 400, height: 600, depth: 400, elevation: 1900, mount: 'wall', color: '#f2f2f2', icon: '⬭' },
];

export const applianceDef = (id: string) => APPLIANCES.find((a) => a.id === id);
