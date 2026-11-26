import { create } from 'zustand';
import { produce, type Draft } from 'immer';
import type { Project } from '../model/types';
import { newProject } from '../model/room';

/**
 * Command history. Every change goes through `apply(label, recipe)` which records the
 * project as it was before the change. Continuous gestures (dragging a corner) call
 * `beginGesture` → many `applyTransient` → `endGesture`, which collapses into one command.
 * Snapshots are cheap because immer shares unchanged structure.
 */
interface HistoryEntry {
  label: string;
  project: Project;
}

const MAX_HISTORY = 200;

interface ProjectState {
  project: Project;
  past: HistoryEntry[];
  future: HistoryEntry[];
  gesture: { label: string; before: Project } | null;
  /** Bumped on every change; used by autosave. */
  revision: number;

  apply: (label: string, recipe: (draft: Draft<Project>) => void) => void;
  beginGesture: (label: string) => void;
  applyTransient: (recipe: (draft: Draft<Project>) => void) => void;
  endGesture: () => void;
  cancelGesture: () => void;
  undo: () => void;
  redo: () => void;
  load: (project: Project, opts?: { keepHistory?: boolean }) => void;
}

const touch = (p: Project): Project => ({ ...p, updatedAt: new Date().toISOString() });

export const useProject = create<ProjectState>((set, get) => ({
  project: newProject(),
  past: [],
  future: [],
  gesture: null,
  revision: 0,

  apply: (label, recipe) => {
    const { project, past } = get();
    const next = produce(project, recipe);
    if (next === project) return;
    set({
      project: touch(next),
      past: [...past, { label, project }].slice(-MAX_HISTORY),
      future: [],
      revision: get().revision + 1,
    });
  },

  beginGesture: (label) => {
    if (get().gesture) return;
    set({ gesture: { label, before: get().project } });
  },

  applyTransient: (recipe) => {
    const next = produce(get().project, recipe);
    if (next !== get().project) set({ project: next });
  },

  endGesture: () => {
    const { gesture, project, past } = get();
    if (!gesture) return;
    if (gesture.before === project) {
      set({ gesture: null });
      return;
    }
    set({
      gesture: null,
      project: touch(project),
      past: [...past, { label: gesture.label, project: gesture.before }].slice(-MAX_HISTORY),
      future: [],
      revision: get().revision + 1,
    });
  },

  cancelGesture: () => {
    const { gesture } = get();
    if (gesture) set({ project: gesture.before, gesture: null });
  },

  undo: () => {
    const { past, future, project, gesture } = get();
    if (gesture || !past.length) return;
    const entry = past[past.length - 1];
    set({
      project: entry.project,
      past: past.slice(0, -1),
      future: [{ label: entry.label, project }, ...future],
      revision: get().revision + 1,
    });
  },

  redo: () => {
    const { past, future, project, gesture } = get();
    if (gesture || !future.length) return;
    const entry = future[0];
    set({
      project: entry.project,
      future: future.slice(1),
      past: [...past, { label: entry.label, project }],
      revision: get().revision + 1,
    });
  },

  load: (project, opts) => {
    set({
      project,
      past: opts?.keepHistory ? get().past : [],
      future: opts?.keepHistory ? get().future : [],
      gesture: null,
      revision: get().revision + 1,
    });
  },
}));
