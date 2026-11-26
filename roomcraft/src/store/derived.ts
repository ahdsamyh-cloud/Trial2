import { useMemo } from 'react';
import { useProject } from './projectStore';
import { detectClashes, suggest, type Issue, type Suggestion } from '../model/checks';
import { buildCountertop, type CounterPiece } from '../model/countertop';
import type { Project } from '../model/types';

function memo1<T>(fn: (p: Project) => T): (p: Project) => T {
  let lastP: Project | null = null;
  let lastV: T;
  return (p) => {
    if (p !== lastP) {
      lastV = fn(p);
      lastP = p;
    }
    return lastV;
  };
}

export const getClashes = memo1<Issue[]>(detectClashes);
export const getSuggestions = memo1<Suggestion[]>(suggest);
export const getCountertop = memo1<CounterPiece[]>(buildCountertop);

export function useClashes() {
  const p = useProject((s) => s.project);
  return useMemo(() => getClashes(p), [p]);
}

export function useClashIds() {
  const issues = useClashes();
  return useMemo(() => {
    const s = new Set<string>();
    for (const i of issues) if (i.severity !== 'info') for (const t of i.targets) if (t.kind === 'module' || t.kind === 'appliance') s.add(t.id);
    return s;
  }, [issues]);
}

export function useSuggestions() {
  const p = useProject((s) => s.project);
  return useMemo(() => getSuggestions(p), [p]);
}

export function useCountertop() {
  const p = useProject((s) => s.project);
  return useMemo(() => getCountertop(p), [p]);
}
