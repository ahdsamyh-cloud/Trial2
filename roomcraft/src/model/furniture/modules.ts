import { carcass, divider, doors, drawers, partition, shelves, type ModuleDef, type ParamSpec } from './engine';

const BACK_T: ParamSpec = {
  key: 'backThickness',
  label: 'Back panel thickness',
  type: 'select',
  options: ['6', '9', '12', '18'].map((v) => ({ value: v, label: `${v} mm` })),
  default: '6',
};
const PLINTH = (d = 100): ParamSpec => ({ key: 'plinth', label: 'Plinth / kick height', type: 'length', min: 0, max: 200, default: d });
const DOORS = (d: number, max = 4): ParamSpec => ({ key: 'doors', label: 'Doors', type: 'int', min: 0, max, default: d });
const SHELVES = (d: number, max = 8): ParamSpec => ({ key: 'shelves', label: 'Shelves', type: 'int', min: 0, max, default: d });

const autoDoors = (W: number, n: number) => (n > 0 ? n : W > 600 ? 2 : 1);

export const WARDROBE_SECTIONS = [
  { value: 'hanging', label: 'Long hanging' },
  { value: 'double-hang', label: 'Double hanging' },
  { value: 'shelves', label: 'Shelves' },
  { value: 'drawers', label: 'Drawers + shelves' },
];

export const MODULES: ModuleDef[] = [
  /* -------------------------- Kitchen -------------------------- */
  {
    id: 'base',
    name: 'Base cabinet',
    category: 'kitchen',
    kind: 'base',
    icon: '▭',
    size: { width: 600, height: 850, depth: 580, elevation: 0 },
    limits: { minW: 150, maxW: 1200, minH: 500, maxH: 1000, minD: 300, maxD: 700 },
    params: [DOORS(0, 2), SHELVES(1, 3), PLINTH(), BACK_T],
    build(c) {
      const i = carcass(c, { plinth: c.num('plinth'), top: 'rails' });
      shelves(c, i, c.num('shelves'));
      doors(c, { x0: i.fx0, x1: i.fx1, z0: i.fz0, z1: i.fz1, y: i.y1 }, autoDoors(c.W, c.num('doors')));
    },
  },
  {
    id: 'wall',
    name: 'Wall cabinet',
    category: 'kitchen',
    kind: 'wall',
    icon: '▔',
    size: { width: 600, height: 720, depth: 350, elevation: 1450 },
    limits: { minW: 200, maxW: 1200, minH: 300, maxH: 1200, minD: 250, maxD: 450 },
    params: [DOORS(0, 2), SHELVES(2, 4), { key: 'liftUp', label: 'Lift-up flap door (gas lift)', type: 'bool', default: false }, BACK_T],
    build(c) {
      const i = carcass(c, { top: 'full' });
      shelves(c, i, c.num('shelves'));
      if (c.bool('liftUp')) {
        doors(c, { x0: i.fx0, x1: i.fx1, z0: i.fz0, z1: i.fz1, y: i.y1 }, 1, { hinge: 'top', name: 'Flap door' });
        c.hw('gas-lift', 2);
      } else doors(c, { x0: i.fx0, x1: i.fx1, z0: i.fz0, z1: i.fz1, y: i.y1 }, autoDoors(c.W, c.num('doors')));
      c.hw('wall-bracket', 2);
    },
  },
  {
    id: 'tall',
    name: 'Tall / pantry unit',
    category: 'kitchen',
    kind: 'tall',
    icon: '▯',
    size: { width: 600, height: 2150, depth: 580, elevation: 0 },
    limits: { minW: 300, maxW: 1200, minH: 1500, maxH: 2600, minD: 300, maxD: 700 },
    params: [
      DOORS(0, 2),
      SHELVES(4, 8),
      { key: 'split', label: 'Split doors at height', type: 'length', min: 0, max: 2000, default: 1400, help: '0 = full-height doors' },
      { key: 'drawers', label: 'Bottom drawers', type: 'int', min: 0, max: 3, default: 0 },
      PLINTH(),
      BACK_T,
    ],
    build(c) {
      const i = carcass(c, { plinth: c.num('plinth'), top: 'full' });
      const nd = autoDoors(c.W, c.num('doors'));
      const dr = c.num('drawers');
      const drawerTop = dr ? i.fz0 + dr * 220 : i.fz0;
      if (dr) {
        drawers(c, i, { z0: i.fz0, z1: drawerTop }, dr);
        divider(c, i, drawerTop - c.t(), 'drawer-divider', 'Divider above drawers');
      }
      shelves(c, i, c.num('shelves'), { z0: drawerTop });
      const split = c.num('split');
      if (split > drawerTop + 300 && split < i.fz1 - 300) {
        divider(c, i, split - c.t() / 2, 'split-shelf');
        doors(c, { x0: i.fx0, x1: i.fx1, z0: drawerTop, z1: split, y: i.y1 }, nd, { keyPrefix: 'door-low' });
        doors(c, { x0: i.fx0, x1: i.fx1, z0: split, z1: i.fz1, y: i.y1 }, nd, { keyPrefix: 'door-up' });
      } else doors(c, { x0: i.fx0, x1: i.fx1, z0: drawerTop, z1: i.fz1, y: i.y1 }, nd);
    },
  },
  {
    id: 'corner',
    name: 'Corner unit (blind)',
    category: 'kitchen',
    kind: 'base',
    icon: '◰',
    size: { width: 1000, height: 850, depth: 580, elevation: 0 },
    limits: { minW: 800, maxW: 1300, minH: 500, maxH: 1000, minD: 450, maxD: 700 },
    params: [
      { key: 'blind', label: 'Blind (hidden) width', type: 'length', min: 300, max: 700, default: 550, help: 'Part tucked behind the perpendicular run' },
      { key: 'carousel', label: 'Corner carousel / magic corner', type: 'bool', default: true },
      SHELVES(1, 2),
      PLINTH(),
      BACK_T,
    ],
    build(c) {
      const i = carcass(c, { plinth: c.num('plinth'), top: 'rails' });
      const blind = Math.min(c.num('blind'), c.W - 300);
      // fixed blind panel on the hidden side, door on the open side
      const bx0 = c.mirrored ? c.W - blind : 0;
      const T = c.t('blind-panel');
      c.panel({
        key: 'blind-panel',
        name: 'Blind panel',
        role: 'filler',
        box: { x: bx0, y: i.y1, z: i.fz0 + 3, dx: blind, dy: T, dz: i.fz1 - i.fz0 - 6 },
        axis: 'y',
        band: 'all',
      });
      const open = c.mirrored ? { x0: 0, x1: c.W - blind } : { x0: blind, x1: c.W };
      doors(c, { ...open, z0: i.fz0, z1: i.fz1, y: i.y1 }, 1);
      if (c.bool('carousel')) c.hw('corner-carousel', 1);
      else shelves(c, i, c.num('shelves'));
      c.note('Fit against the perpendicular run; blind side goes into the corner');
    },
  },
  {
    id: 'drawer-unit',
    name: 'Drawer unit',
    category: 'kitchen',
    kind: 'base',
    icon: '☰',
    size: { width: 600, height: 850, depth: 580, elevation: 0 },
    limits: { minW: 300, maxW: 1200, minH: 500, maxH: 1000, minD: 400, maxD: 700 },
    params: [
      { key: 'drawers', label: 'Drawers', type: 'int', min: 1, max: 6, default: 3 },
      { key: 'layout', label: 'Front heights', type: 'select', options: [{ value: 'equal', label: 'Equal' }, { value: 'graded', label: 'Small top, deep bottom (1:2:2)' }], default: 'graded' },
      PLINTH(),
      BACK_T,
    ],
    build(c) {
      const i = carcass(c, { plinth: c.num('plinth'), top: 'rails' });
      const n = c.num('drawers');
      const ratios = c.str('layout') === 'graded' && n === 3 ? [1, 2, 2] : undefined;
      drawers(c, i, { z0: i.fz0, z1: i.fz1 }, n, { ratios });
    },
  },
  {
    id: 'sink-unit',
    name: 'Sink unit',
    category: 'kitchen',
    kind: 'base',
    icon: '◡',
    material: 'bwp',
    size: { width: 900, height: 850, depth: 580, elevation: 0 },
    limits: { minW: 600, maxW: 1200, minH: 500, maxH: 1000, minD: 450, maxD: 700 },
    params: [DOORS(2, 2), PLINTH(), BACK_T],
    build(c) {
      const i = carcass(c, { plinth: c.num('plinth'), top: 'rails' });
      doors(c, { x0: i.fx0, x1: i.fx1, z0: i.fz0, z1: i.fz1, y: i.y1 }, Math.max(1, c.num('doors')));
      c.note('Cut back panel for water inlet / drain after site check');
    },
  },
  {
    id: 'open-shelf',
    name: 'Open shelf unit',
    category: 'kitchen',
    kind: 'wall',
    icon: '⊟',
    size: { width: 600, height: 400, depth: 300, elevation: 1500 },
    limits: { minW: 200, maxW: 1800, minH: 150, maxH: 1200, minD: 150, maxD: 450 },
    params: [SHELVES(1, 5), { key: 'back', label: 'Back panel', type: 'bool', default: true }, BACK_T],
    build(c) {
      const i = carcass(c, { top: 'full', back: c.bool('back'), frontDepth: 0 });
      shelves(c, i, c.num('shelves'), { setback: 0, fixed: true });
      c.hw('wall-bracket', 2);
    },
  },

  /* -------------------------- Wardrobe -------------------------- */
  {
    id: 'wardrobe',
    name: 'Wardrobe',
    category: 'wardrobe',
    kind: 'tall',
    icon: '▥',
    size: { width: 1800, height: 2700, depth: 600, elevation: 0 },
    limits: { minW: 600, maxW: 3600, minH: 1500, maxH: 3200, minD: 450, maxD: 750 },
    params: [
      { key: 'doorType', label: 'Doors', type: 'select', options: [{ value: 'hinged', label: 'Hinged' }, { value: 'sliding', label: 'Sliding' }], default: 'hinged' },
      DOORS(3, 8),
      { key: 'sections', label: 'Interior sections (left → right)', type: 'sections', options: WARDROBE_SECTIONS, default: ['hanging', 'shelves', 'drawers'] },
      { key: 'loft', label: 'Loft height (0 = none)', type: 'length', min: 0, max: 900, default: 600 },
      PLINTH(75),
      BACK_T,
    ],
    build(c) {
      const sliding = c.str('doorType') === 'sliding';
      const tf = sliding ? 2 * c.t('door') + 60 : c.t('door');
      const i = carcass(c, { plinth: c.num('plinth'), top: 'full', frontDepth: tf });
      const loft = c.num('loft');
      const loftZ = loft > 0 ? c.H - loft : i.fz1;
      if (loft > 0) divider(c, i, loftZ - c.t() / 2, 'loft-floor', 'Loft divider');
      const mainTop = loft > 0 ? loftZ - c.t() / 2 : i.z1;
      const secs = c.list('sections').length ? c.list('sections') : ['hanging'];
      const sw = (i.x1 - i.x0) / secs.length;
      secs.forEach((sec, k) => {
        const x0 = i.x0 + k * sw + (k > 0 ? c.t() / 2 : 0);
        const x1 = i.x0 + (k + 1) * sw - (k < secs.length - 1 ? c.t() / 2 : 0);
        if (k > 0) partition(c, i, i.x0 + k * sw, `partition-${k}`, i.z0, mainTop);
        const pre = `s${k + 1}`;
        if (sec === 'hanging') {
          shelves(c, i, 1, { keyPrefix: `${pre}-shelf`, x0, x1, z0: mainTop - 600, z1: mainTop, fixed: true });
          c.hw('wardrobe-rod', 1);
        } else if (sec === 'double-hang') {
          const mid = (i.z0 + mainTop) / 2;
          shelves(c, i, 1, { keyPrefix: `${pre}-shelf`, x0, x1, z0: mid - 60, z1: mid + 60, fixed: true });
          shelves(c, i, 1, { keyPrefix: `${pre}-top`, x0, x1, z0: mainTop - 600, z1: mainTop, fixed: true });
          c.hw('wardrobe-rod', 2);
        } else if (sec === 'shelves') {
          shelves(c, i, 5, { keyPrefix: `${pre}-shelf`, x0, x1, z0: i.z0, z1: mainTop });
        } else if (sec === 'drawers') {
          const top = i.z0 + 3 * 200;
          drawers(c, { ...i, x0, x1 }, { z0: i.z0, z1: top }, 3, { keyPrefix: `${pre}-drawer`, front: { x0: x0 + 2, x1: x1 - 2 } });
          shelves(c, i, 1, { keyPrefix: `${pre}-drawer-top`, x0, x1, z0: top - 10, z1: top + 10, fixed: true });
          shelves(c, i, 3, { keyPrefix: `${pre}-shelf`, x0, x1, z0: top, z1: mainTop });
        }
      });
      const fy = c.D - c.t('door');
      const n = Math.max(1, c.num('doors'));
      if (sliding) {
        doors(c, { x0: i.fx0, x1: i.fx1, z0: i.fz0, z1: loftZ, y: fy }, Math.max(2, Math.min(4, n)), { sliding: true, name: 'Sliding door' });
        c.note('Sliding doors: drawers must sit behind a fixed door position or use internal drawers set back 25 mm');
      } else {
        doors(c, { x0: i.fx0, x1: i.fx1, z0: i.fz0, z1: loftZ, y: fy }, n);
      }
      if (loft > 0) doors(c, { x0: i.fx0, x1: i.fx1, z0: loftZ, z1: i.fz1, y: fy }, Math.max(1, n), { keyPrefix: 'loft-door', name: 'Loft door' });
    },
  },

  /* -------------------------- Room furniture -------------------------- */
  {
    id: 'bed',
    name: 'Bed',
    category: 'room',
    kind: 'free',
    icon: '▬',
    size: { width: 1600, height: 450, depth: 2100, elevation: 0 },
    limits: { minW: 900, maxW: 2100, minH: 250, maxH: 600, minD: 1900, maxD: 2300 },
    params: [
      { key: 'storage', label: 'Hydraulic storage', type: 'bool', default: true },
      { key: 'headboard', label: 'Headboard height (from floor)', type: 'length', min: 0, max: 1500, default: 1000 },
    ],
    build(c) {
      const T = c.t();
      const hb = c.num('headboard');
      const y0 = hb > 0 ? T : 0;
      if (hb > 0) c.panel({ key: 'headboard', name: 'Headboard', role: 'side', box: { x: 0, y: 0, z: 0, dx: c.W, dy: T, dz: hb }, axis: 'y', grainAxis: 'x', band: ['top', 'left', 'right'] });
      c.panel({ key: 'side-l', name: 'Side rail L', role: 'side', box: { x: 0, y: y0, z: 0, dx: T, dy: c.D - y0, dz: c.H - T }, axis: 'x', grainAxis: 'y', band: ['top', 'front'] });
      c.panel({ key: 'side-r', name: 'Side rail R', role: 'side', box: { x: c.W - T, y: y0, z: 0, dx: T, dy: c.D - y0, dz: c.H - T }, axis: 'x', grainAxis: 'y', band: ['top', 'front'] });
      c.panel({ key: 'foot', name: 'Foot rail', role: 'side', box: { x: T, y: c.D - T, z: 0, dx: c.W - 2 * T, dy: T, dz: c.H - T }, axis: 'y', grainAxis: 'x', band: ['top'] });
      c.panel({ key: 'mid', name: 'Centre support', role: 'partition', box: { x: c.W / 2 - T / 2, y: y0, z: 0, dx: T, dy: c.D - y0 - T, dz: c.H - T }, axis: 'x', grainAxis: 'y' });
      const deckW = (c.W - T) / 2;
      if (c.bool('storage')) {
        c.panel({ key: 'deck-l', name: 'Lid L', role: 'deck', box: { x: 0, y: y0, z: c.H - T, dx: deckW, dy: c.D - y0, dz: T }, axis: 'z', grainAxis: 'y', band: 'all' });
        c.panel({ key: 'deck-r', name: 'Lid R', role: 'deck', box: { x: deckW + T, y: y0, z: c.H - T, dx: deckW, dy: c.D - y0, dz: T }, axis: 'z', grainAxis: 'y', band: 'all' });
        c.panel({ key: 'deck-c', name: 'Centre strip', role: 'deck', box: { x: deckW, y: y0, z: c.H - T, dx: T, dy: c.D - y0, dz: T }, axis: 'z', grainAxis: 'y' });
        c.panel({ key: 'base', name: 'Storage base', role: 'bottom', box: { x: T, y: y0, z: 60, dx: c.W - 2 * T, dy: c.D - y0 - T, dz: T }, axis: 'z', grainAxis: 'y' });
        c.hw('bed-lift', 2);
      } else {
        c.panel({ key: 'deck', name: 'Bed deck', role: 'deck', box: { x: 0, y: y0, z: c.H - T, dx: c.W, dy: c.D - y0, dz: T }, axis: 'z', grainAxis: 'y', band: 'all' });
      }
    },
  },
  {
    id: 'tv-unit',
    name: 'TV unit',
    category: 'room',
    kind: 'free',
    icon: '▃',
    size: { width: 1800, height: 450, depth: 400, elevation: 250 },
    limits: { minW: 900, maxW: 3000, minH: 250, maxH: 900, minD: 300, maxD: 550 },
    params: [
      { key: 'flaps', label: 'Drop-down flaps', type: 'int', min: 0, max: 4, default: 2 },
      { key: 'drawers', label: 'Drawer bays', type: 'int', min: 0, max: 2, default: 1 },
      BACK_T,
    ],
    build(c) {
      const i = carcass(c, { top: 'full' });
      const bays = Math.max(1, c.num('flaps') + c.num('drawers'));
      const bw = c.W / bays;
      for (let k = 1; k < bays; k++) partition(c, i, k * bw, `partition-${k}`);
      for (let k = 0; k < bays; k++) {
        const x0 = k * bw;
        const x1 = (k + 1) * bw;
        if (k < c.num('drawers')) drawers(c, { ...i, x0: x0 + (k ? c.t() / 2 : i.x0), x1: x1 - c.t() / 2 }, { z0: i.fz0, z1: i.fz1 }, 1, { keyPrefix: `bay${k + 1}-drawer`, front: { x0, x1 } });
        else doors(c, { x0, x1, z0: i.fz0, z1: i.fz1, y: i.y1 }, 1, { keyPrefix: `bay${k + 1}-flap`, hinge: 'bottom', name: 'Flap' });
      }
      c.hw('wall-bracket', 3);
      c.hw('gas-lift', c.num('flaps'));
    },
  },
  {
    id: 'bookshelf',
    name: 'Bookshelf',
    category: 'room',
    kind: 'tall',
    icon: '▤',
    size: { width: 900, height: 2000, depth: 320, elevation: 0 },
    limits: { minW: 300, maxW: 1800, minH: 600, maxH: 2700, minD: 200, maxD: 450 },
    params: [SHELVES(4, 10), { key: 'lowerDoors', label: 'Doors on lower part', type: 'bool', default: true }, PLINTH(60), BACK_T],
    build(c) {
      const lower = c.bool('lowerDoors');
      const i = carcass(c, { plinth: c.num('plinth'), top: 'full', frontDepth: lower ? c.t('door') : 0 });
      const split = lower ? Math.min(800, (i.z1 - i.z0) / 2) + i.z0 : i.z0;
      if (lower) {
        divider(c, i, split - c.t(), 'split-shelf');
        doors(c, { x0: i.fx0, x1: i.fx1, z0: i.fz0, z1: split, y: i.y1 }, autoDoors(c.W, 0));
      }
      shelves(c, i, c.num('shelves'), { z0: split, setback: 0 });
    },
  },
  {
    id: 'study',
    name: 'Study table',
    category: 'room',
    kind: 'free',
    icon: '⊓',
    size: { width: 1200, height: 750, depth: 600, elevation: 0 },
    limits: { minW: 700, maxW: 2400, minH: 650, maxH: 800, minD: 450, maxD: 800 },
    params: [{ key: 'pedestal', label: 'Drawer pedestal (right)', type: 'bool', default: true }, { key: 'drawers', label: 'Pedestal drawers', type: 'int', min: 1, max: 4, default: 3 }],
    build(c) {
      const T = c.t();
      c.panel({ key: 'top', name: 'Table top', role: 'worktop', box: { x: 0, y: 0, z: c.H - T, dx: c.W, dy: c.D, dz: T }, axis: 'z', grainAxis: 'x', band: 'all' });
      c.panel({ key: 'side-l', name: 'Left leg panel', role: 'side', box: { x: 0, y: 0, z: 0, dx: T, dy: c.D, dz: c.H - T }, axis: 'x', band: ['front', 'back'] });
      c.panel({ key: 'side-r', name: 'Right leg panel', role: 'side', box: { x: c.W - T, y: 0, z: 0, dx: T, dy: c.D, dz: c.H - T }, axis: 'x', band: ['front', 'back'] });
      c.panel({ key: 'modesty', name: 'Modesty panel', role: 'back', box: { x: T, y: 50, z: c.H - T - 350, dx: c.W - 2 * T, dy: T, dz: 350 }, axis: 'y', grainAxis: 'x', band: ['bottom'] });
      if (c.bool('pedestal')) {
        const pw = 420;
        const px = c.W - T - pw;
        c.panel({ key: 'ped-side', name: 'Pedestal side', role: 'partition', box: { x: px - T, y: 50 + T, z: 0, dx: T, dy: c.D - 50 - T - T, dz: c.H - T }, axis: 'x', band: ['front'] });
        drawers(c, { x0: px, x1: c.W - T, z0: 0, z1: c.H - T, y0: 50 + T, y1: c.D - T, fx0: px - T, fx1: c.W - T, fz0: 0, fz1: c.H - T }, { z0: 40, z1: c.H - T }, c.num('drawers'), { front: { x0: px - T, x1: c.W - T } });
      }
    },
  },
  {
    id: 'shoe-rack',
    name: 'Shoe rack',
    category: 'room',
    kind: 'free',
    icon: '▦',
    size: { width: 800, height: 1000, depth: 350, elevation: 0 },
    limits: { minW: 400, maxW: 1800, minH: 400, maxH: 2100, minD: 250, maxD: 450 },
    params: [SHELVES(4, 8), DOORS(2, 4), PLINTH(50), BACK_T],
    build(c) {
      const i = carcass(c, { plinth: c.num('plinth'), top: 'full' });
      shelves(c, i, c.num('shelves'));
      if (c.num('doors') > 0) doors(c, { x0: i.fx0, x1: i.fx1, z0: i.fz0, z1: i.fz1, y: i.y1 }, c.num('doors'));
      c.note('Drill ventilation holes in the back panel');
    },
  },
  {
    id: 'dressing',
    name: 'Dressing table',
    category: 'room',
    kind: 'free',
    icon: '⊼',
    size: { width: 900, height: 750, depth: 450, elevation: 0 },
    limits: { minW: 600, maxW: 1500, minH: 650, maxH: 850, minD: 350, maxD: 550 },
    params: [
      { key: 'drawers', label: 'Drawers under top', type: 'int', min: 0, max: 3, default: 2 },
      { key: 'mirror', label: 'Mirror backing height', type: 'length', min: 0, max: 1200, default: 900 },
    ],
    build(c) {
      const T = c.t();
      c.panel({ key: 'top', name: 'Top', role: 'worktop', box: { x: 0, y: 0, z: c.H - T, dx: c.W, dy: c.D, dz: T }, axis: 'z', grainAxis: 'x', band: 'all' });
      c.panel({ key: 'side-l', name: 'Left side', role: 'side', box: { x: 0, y: 0, z: 0, dx: T, dy: c.D, dz: c.H - T }, axis: 'x', band: ['front'] });
      c.panel({ key: 'side-r', name: 'Right side', role: 'side', box: { x: c.W - T, y: 0, z: 0, dx: T, dy: c.D, dz: c.H - T }, axis: 'x', band: ['front'] });
      const nd = c.num('drawers');
      if (nd > 0) {
        const z0 = c.H - T - 180;
        c.panel({ key: 'drawer-base', name: 'Drawer base', role: 'bottom', box: { x: T, y: 0, z: z0 - T, dx: c.W - 2 * T, dy: c.D - T, dz: T }, axis: 'z', grainAxis: 'x', band: ['front'] });
        const dw = (c.W - 2 * T) / nd;
        for (let k = 0; k < nd; k++) {
          const x0 = T + k * dw;
          drawers(c, { x0, x1: x0 + dw, z0, z1: c.H - T, y0: 0, y1: c.D - T, fx0: x0, fx1: x0 + dw, fz0: z0, fz1: c.H - T }, { z0, z1: c.H - T }, 1, { keyPrefix: `drawer${k + 1}` });
        }
      }
      const mh = c.num('mirror');
      if (mh > 0) {
        c.panel({ key: 'mirror-back', name: 'Mirror backing', role: 'back', box: { x: 0, y: 0, z: c.H, dx: c.W, dy: T, dz: mh }, axis: 'y', band: 'all', note: 'Mount mirror' });
        c.note(`Mirror ${c.W - 100} × ${mh - 100} mm (glass, supplied separately)`);
      }
    },
  },
  {
    id: 'vanity',
    name: 'Vanity (bathroom)',
    category: 'room',
    kind: 'base',
    icon: '◡',
    material: 'bwp',
    size: { width: 800, height: 500, depth: 480, elevation: 350 },
    limits: { minW: 400, maxW: 1500, minH: 300, maxH: 900, minD: 350, maxD: 600 },
    params: [DOORS(2, 2), SHELVES(0, 2), BACK_T],
    build(c) {
      const i = carcass(c, { top: 'rails' });
      shelves(c, i, c.num('shelves'));
      doors(c, { x0: i.fx0, x1: i.fx1, z0: i.fz0, z1: i.fz1, y: i.y1 }, Math.max(1, c.num('doors')));
      c.hw('wall-bracket', 2);
      c.note('Wet area: BWP plywood with waterproof edge banding');
    },
  },
];

export const moduleDef = (id: string) => MODULES.find((m) => m.id === id);
