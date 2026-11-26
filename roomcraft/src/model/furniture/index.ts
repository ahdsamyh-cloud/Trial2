import type { ModuleInstance, Project } from '../types';
import { generateModule, type ModuleBuild } from './engine';
import { moduleDef } from './modules';
import { uid } from '../ids';

export * from './engine';
export { MODULES, moduleDef, WARDROBE_SECTIONS } from './modules';

const cache = new WeakMap<ModuleInstance, { apps: unknown; settings: unknown; build: ModuleBuild }>();

const EMPTY: ModuleBuild = { panels: [], hardware: [], handles: [], notes: ['Unknown module type'] };

/** Generate (memoised) panels + hardware for a module instance. */
export function buildModule(m: ModuleInstance, project: Project): ModuleBuild {
  const c = cache.get(m);
  if (c && c.apps === project.appliances && c.settings === project.settings) return c.build;
  const def = moduleDef(m.type);
  const build = def ? generateModule(m, def, project) : EMPTY;
  cache.set(m, { apps: project.appliances, settings: project.settings, build });
  return build;
}

/** Create a new module instance from its definition defaults. */
export function newModule(type: string, project: Project, at: Partial<ModuleInstance> = {}): ModuleInstance {
  const def = moduleDef(type);
  if (!def) throw new Error(`Unknown module type ${type}`);
  const params: ModuleInstance['params'] = {};
  for (const p of def.params) params[p.key] = Array.isArray(p.default) ? [...p.default] : p.default;
  const count = project.modules.filter((m) => m.type === type).length;
  return {
    id: uid('mod'),
    type,
    name: `${def.name} ${count + 1}`,
    x: 0,
    y: 0,
    rotation: 0,
    elevation: def.size.elevation,
    width: def.size.width,
    height: def.size.height,
    depth: def.size.depth,
    params,
    board: def.material ? { material: def.material } : undefined,
    handle: project.settings.handle,
    panelOverrides: {},
    runId: null,
    mirrored: false,
    ...at,
  };
}

/** Clamp a module's size to its definition limits. */
export function clampModuleSize(m: ModuleInstance): ModuleInstance {
  const def = moduleDef(m.type);
  if (!def) return m;
  const L = def.limits;
  const c = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
  return { ...m, width: c(m.width, L.minW, L.maxW), height: c(m.height, L.minH, L.maxH), depth: c(m.depth, L.minD, L.maxD) };
}
