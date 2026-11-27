/** All lengths are in millimetres. Plan coordinates: x → right, y → down (screen-like). */
export interface Vec2 {
  x: number;
  y: number;
}

export interface Wall {
  /** Stable id: openings, services and furniture attach to walls by id. */
  id: string;
  thickness: number;
  height: number;
}

export interface RoomStructure {
  floorSlab: number; // thickness below floor level
  ceilingSlab: number; // thickness above wall height
  skirtingHeight: number; // 0 = no skirting
  skirtingThickness: number;
  /** Height of a drop (false) ceiling above the floor; null = none. */
  dropCeiling: number | null;
}

/**
 * A room is a closed polygon of the walls' INNER faces (clear/finished dimensions).
 * walls[i] runs from points[i] to points[(i+1) % n]. Points are kept in positive
 * shoelace orientation so the outward normal of an edge (dx,dy) is (dy,-dx).
 */
export interface Room {
  id: string;
  name: string;
  points: Vec2[];
  walls: Wall[];
  structure?: RoomStructure;
}

/* ---------- Phase 2: openings, services, structure ---------- */

export type OpeningKind = 'door' | 'window' | 'opening';

export interface Opening {
  id: string;
  wallId: string;
  kind: OpeningKind;
  /** Distance from the wall's start corner (inner face) to the opening's near edge. */
  offset: number;
  width: number;
  height: number;
  /** Bottom of the opening above the floor (0 for doors). */
  sill: number;
  /** Hinge side seen from inside the room. */
  hinge: 'left' | 'right';
  /** Door swings into the room or out of it. */
  swing: 'in' | 'out';
}

export type ServiceKind =
  | 'socket'
  | 'switch'
  | 'light'
  | 'ac'
  | 'water-cold'
  | 'water-hot'
  | 'drain'
  | 'gas';

export interface ServicePoint {
  id: string;
  kind: ServiceKind;
  /** Wall-mounted items follow their wall; ceiling/floor items use x,y. */
  wallId: string | null;
  offset: number; // along wall from its start (wall-mounted)
  x: number;
  y: number;
  height: number; // above floor
  label?: string;
}

export interface Beam {
  id: string;
  a: Vec2; // centre line start
  b: Vec2;
  width: number;
  depth: number;
  /** Height from floor to the underside of the beam. */
  bottom: number;
}

export interface Column {
  id: string;
  x: number; // centre
  y: number;
  width: number;
  depth: number;
  rotation: number; // degrees
  height: number;
}

/* ---------- Phase 3: furniture ---------- */

export type BoardMaterialId = 'ply' | 'bwp' | 'mdf' | 'particle' | 'hdhmr';

export interface BoardSpec {
  material: BoardMaterialId;
  thickness: number;
  /** Finish (laminate/veneer) id from the swatch library. */
  finish: string;
}

export interface EdgeBand {
  thickness: number; // 0.8, 1, 2 …
  finish: string; // colour/finish id
}

/** Edge banding for a panel: L1/L2 = the two long edges, W1/W2 = the two short edges. */
export interface PanelEdges {
  L1: EdgeBand | null;
  L2: EdgeBand | null;
  W1: EdgeBand | null;
  W2: EdgeBand | null;
}

export interface PanelOverride {
  thickness?: number;
  material?: BoardMaterialId;
  finish?: string;
  edges?: Partial<PanelEdges>;
  grain?: 'length' | 'width' | 'none';
}

export type HandleStyle = 'bar' | 'knob' | 'profile' | 'gola' | 'push';

export type ParamValue = number | string | boolean | string[];

export interface ModuleInstance {
  id: string;
  type: string; // ModuleDef id
  name: string;
  /** Plan position of the module's back-left-bottom corner. */
  x: number;
  y: number;
  /** Direction of the module's width axis in plan, degrees (screen convention: y down). */
  rotation: number;
  /** Height of the module's bottom above the floor. */
  elevation: number;
  width: number;
  height: number;
  depth: number;
  params: Record<string, ParamValue>;
  /** Module-level board (carcass) override; falls back to project default. */
  board?: Partial<BoardSpec>;
  /** Finish for doors/drawer fronts. */
  frontFinish?: string;
  handle: HandleStyle;
  panelOverrides: Record<string, PanelOverride>;
  /** Modules sharing a runId move together. */
  runId?: string | null;
  /** Mirror handedness (hinges, corner side). */
  mirrored?: boolean;
}

/* ---------- Phase 4: appliances & countertop ---------- */

export interface ApplianceInstance {
  id: string;
  type: string; // ApplianceDef id
  name: string;
  x: number; // back-left corner like modules
  y: number;
  rotation: number;
  elevation: number;
  width: number;
  height: number;
  depth: number;
  variant?: string;
}

export interface CountertopSettings {
  enabled: boolean;
  stone: string; // stone id
  thickness: number;
  frontOverhang: number;
  sideOverhang: number;
  backsplashHeight: number;
  slabLength: number;
  slabWidth: number;
  /** Wall tiles between the worktop and the wall cabinets. */
  wallTiles?: 'none' | 'subway-white' | 'subway-grey' | 'square-white' | 'hex-green';
}

/* ---------- Phase 5: outputs ---------- */

export interface SheetSettings {
  length: number;
  width: number;
  kerf: number;
  trim: number; // edge trim on each side
}

export interface PriceList {
  currency: string;
  /** price per sheet, keyed `${material}-${thickness}` */
  boards: Record<string, number>;
  /** price per sq ft of finished face, keyed by finish kind (laminate/veneer/paint/none) */
  finishPerSqft: Record<string, number>;
  /** price per metre keyed by edge band thickness, e.g. "0.8" */
  edgeBandPerM: Record<string, number>;
  hardware: Record<string, number>;
  /** stone price per sq ft keyed by stone id */
  stonePerSqft: Record<string, number>;
  labourPercent: number;
}

export interface ProjectSettings {
  defaultWallThickness: number;
  defaultWallHeight: number;
  board: BoardSpec;
  frontFinish: string;
  carcassEdge: EdgeBand;
  frontEdge: EdgeBand;
  handle: HandleStyle;
  sheet: SheetSettings;
}

export interface Project {
  version: 1;
  id: string;
  name: string;
  rooms: Room[];
  openings: Opening[];
  services: ServicePoint[];
  beams: Beam[];
  columns: Column[];
  modules: ModuleInstance[];
  appliances: ApplianceInstance[];
  countertop: CountertopSettings;
  prices: PriceList;
  settings: ProjectSettings;
  createdAt: string;
  updatedAt: string;
}

export type LengthUnit = 'mm' | 'cm' | 'm' | 'ftin';
