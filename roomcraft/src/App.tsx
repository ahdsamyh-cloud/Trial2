import { useEffect, useState } from 'react';
import { TopBar } from './components/TopBar';
import { Sidebar } from './components/Sidebar';
import { PlanEditor } from './plan2d/PlanEditor';
import { Scene3D } from './view3d/Scene3D';
import { ElevationView } from './components/ElevationView';
import { ReportsView } from './components/ReportsView';
import { ChecksDrawer } from './components/ChecksDrawer';
import { ViewToolbar } from './components/ViewToolbar';
import { Tour } from './components/Tour';
import { usePrefs, useUI } from './store/uiStore';
import { useProject } from './store/projectStore';
import { loadAutosave, startAutosave, downloadProject } from './store/persistence';
import { copySelection, deleteSelection, duplicateSelection, mirrorSelection, nudgeSelection, pasteClipboard, rotateSelection } from './store/actions';

function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el?.closest?.('input, textarea, select, [contenteditable]')) return;
      const mod = e.ctrlKey || e.metaKey;
      const ui = useUI.getState();
      const ps = useProject.getState();
      const k = e.key.toLowerCase();
      if (ui.walk) return;
      if (mod && k === 'z' && !e.shiftKey) {
        e.preventDefault();
        ps.undo();
      } else if (mod && ((k === 'z' && e.shiftKey) || k === 'y')) {
        e.preventDefault();
        ps.redo();
      } else if (mod && k === 's') {
        e.preventDefault();
        downloadProject(ps.project);
      } else if (mod && k === 'c') copySelection();
      else if (mod && k === 'v') pasteClipboard();
      else if (mod && k === 'd') {
        e.preventDefault();
        duplicateSelection();
      } else if (mod) {
        return;
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        deleteSelection();
      } else if (e.key === 'Escape') {
        ui.set({ selection: null, tool: 'select', placing: null, checksOpen: false, exploded: false });
      } else if (e.key.startsWith('Arrow') && ui.selection) {
        e.preventDefault();
        const step = e.shiftKey ? 100 : 10;
        const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key]!;
        nudgeSelection(d[0], d[1]);
      } else if (k === 'v') ui.set({ tool: 'select', placing: null });
      else if (k === 'd') ui.set({ tool: 'draw', placing: null, step: 'floor' });
      else if (k === 'h') ui.set({ tool: 'pan', placing: null });
      else if (k === 'm' && !e.shiftKey) ui.set({ tool: 'measure', placing: null });
      else if (k === 'r') rotateSelection(e.shiftKey ? -90 : 90);
      else if (k === 'x') mirrorSelection();
      else if (k === 'e') ui.set({ exploded: !ui.exploded });
      else if (k === 'f') ui.set({ fitRequest: ui.fitRequest + 1 });
      else if (k === '1') ui.set({ view: '2d' });
      else if (k === '2') ui.set({ view: 'split' });
      else if (k === '3') ui.set({ view: '3d' });
      else if (k === '4') ui.set({ view: 'elev' });
      else if (k === '?') ui.set({ tourStep: 0 });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

export default function App() {
  const view = useUI((s) => s.view);
  const step = useUI((s) => s.step);
  const sidebarOpen = useUI((s) => s.sidebarOpen);
  const toast = useUI((s) => s.toast);
  const busy = useUI((s) => s.busy);
  const setUI = useUI((s) => s.set);
  const theme = usePrefs((s) => s.theme);
  const [ready, setReady] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);

  useShortcuts();

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    let stop: (() => void) | undefined;
    loadAutosave().then((p) => {
      if (p) useProject.getState().load(p);
      setReady(true);
      useUI.getState().set({ fitRequest: useUI.getState().fitRequest + 1 });
      stop = startAutosave(setSavedAt);
      if (!usePrefs.getState().tourDone && !navigator.webdriver) setTimeout(() => useUI.getState().set({ tourStep: 0 }), 600);
    });
    return () => stop?.();
  }, []);

  if (!ready) return <div className="loading">Loading RoomCraft…</div>;

  const reports = step === 'outputs';
  const show2d = !reports && view !== '3d';
  const show3d = !reports && (view === '3d' || view === 'split');
  const showElev = !reports && view === 'elev';

  return (
    <div className={`app view-${reports ? 'reports' : view}${sidebarOpen ? ' sidebar-open' : ''}`}>
      <TopBar savedAt={savedAt} />
      <div className="workspace">
        <Sidebar />
        {sidebarOpen && <div className="scrim only-mobile" onClick={() => setUI({ sidebarOpen: false })} />}
        <main className="views">
          {reports && (
            <section className="view-pane scroll">
              <ReportsView />
            </section>
          )}
          {show2d && (
            <section className="view-pane">
              <PlanEditor />
              <ViewToolbar />
            </section>
          )}
          {show3d && (
            <section className="view-pane">
              <Scene3D />
            </section>
          )}
          {showElev && (
            <section className="view-pane scroll">
              <ElevationView />
            </section>
          )}
        </main>
        <ChecksDrawer />
      </div>
      {toast && (
        <div className={`toast ${toast.kind}`} role="status">
          {toast.msg}
        </div>
      )}
      {busy && <div className="busy">{busy}…</div>}
      <Tour />
    </div>
  );
}
