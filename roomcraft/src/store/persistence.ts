import { get as idbGet, set as idbSet } from 'idb-keyval';
import type { Project } from '../model/types';
import { migrateProject } from '../model/room';
import { useProject } from './projectStore';

const KEY = 'roomcraft:autosave';

export async function loadAutosave(): Promise<Project | null> {
  try {
    const data = await idbGet(KEY);
    return data ? migrateProject(data) : null;
  } catch (e) {
    console.warn('Autosave could not be restored', e);
    return null;
  }
}

/** Subscribe to project changes and write them to IndexedDB (debounced). */
export function startAutosave(onSaved?: (at: Date) => void): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let lastRev = useProject.getState().revision;
  const unsub = useProject.subscribe((s) => {
    if (s.revision === lastRev || s.gesture) return;
    lastRev = s.revision;
    clearTimeout(timer);
    timer = setTimeout(async () => {
      try {
        await idbSet(KEY, useProject.getState().project);
        onSaved?.(new Date());
      } catch (e) {
        console.warn('Autosave failed', e);
      }
    }, 600);
  });
  return () => {
    clearTimeout(timer);
    unsub();
  };
}

export function downloadProject(project: Project) {
  const blob = new Blob([JSON.stringify({ app: 'RoomCraft', ...project }, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${project.name.replace(/[^\w\- ]+/g, '').trim() || 'roomcraft-project'}.roomcraft.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function readProjectFile(file: File): Promise<Project> {
  const text = await file.text();
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('File is not valid JSON.');
  }
  return migrateProject(data);
}
