import type { StepId } from '../store/uiStore';

export interface StepDef {
  id: StepId;
  title: string;
  short: string;
  icon: string;
  phase: number;
}

export const STEPS: StepDef[] = [
  { id: 'floor', title: 'Floor plan', short: 'Plan', icon: '▦', phase: 1 },
  { id: 'walls', title: 'Walls', short: 'Walls', icon: '▥', phase: 1 },
  { id: 'services', title: 'Services & structure', short: 'Services', icon: '⚡', phase: 2 },
  { id: 'furniture', title: 'Furniture design', short: 'Furniture', icon: '▤', phase: 3 },
  { id: 'appliances', title: 'Appliances', short: 'Appliances', icon: '◫', phase: 4 },
  { id: 'countertop', title: 'Countertop', short: 'Counter', icon: '▭', phase: 4 },
  { id: 'outputs', title: 'Cut list & outputs', short: 'Outputs', icon: '✂', phase: 5 },
];

export const CURRENT_PHASE = 1;
