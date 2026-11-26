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
}

export interface ProjectSettings {
  defaultWallThickness: number;
  defaultWallHeight: number;
}

export interface Project {
  version: 1;
  id: string;
  name: string;
  rooms: Room[];
  settings: ProjectSettings;
  createdAt: string;
  updatedAt: string;
}

export type LengthUnit = 'mm' | 'cm' | 'm' | 'ftin';
