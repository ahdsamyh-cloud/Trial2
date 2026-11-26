import { useEffect, useState } from 'react';
import { TopBar } from './components/TopBar';
import { Sidebar } from './components/Sidebar';
import { PlanEditor } from './plan2d/PlanEditor';
import { Scene3D } from './view3d/Scene3D';
import { usePrefs, useUI } from './store/uiStore';
import { useProject } from './store/projectStore';
import { loadAutosave, startAutosave, downloadProject } from './store/persistence';
import { deleteSelection } from './store/actions';

function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el?.closest?.('input, textarea, select, [contenteditable]')) return;
      const mod = e.ctrlKey || e.metaKey;
      const ui = useUI.getState();
      const ps = useProject.getState();
      const k = e.key.toLowerCase();
      if (mod && k === 'z' && !e.shiftKey) {
        e.preventDefault();
        ps.undo();
      } else if (mod && ((k === 'z' && e.shiftKey) || k === 'y')) {
        e.preventDefault();
        ps.redo();
      } else if (mod && k === 's') {
        e.preventDefault();
        downloadProject(ps.project);
      } else if (mod) {
        return;
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        deleteSelection();
      } else if (e.key === 'Escape') {
        ui.set({ selection: null, tool: 'select' });
      } else if (k === 'v') ui.set({ tool: 'select' });
      else if (k === 'd') ui.set({ tool: 'draw', step: ui.step === 'floor' ? ui.step : 'floor' });
      else if (k === 'h') ui.set({ tool: 'pan' });
      else if (k === 'f') ui.set({ fitRequest: ui.fitRequest + 1 });
      else if (k === '1') ui.set({ view: '2d' });
      else if (k === '2') ui.set({ view: 'split' });
      else if (k === '3') ui.set({ view: '3d' });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

export default function App() {
  const view = useUI((s) => s.view);
  const sidebarOpen = useUI((s) => s.sidebarOpen);
  const toast = useUI((s) => s.toast);
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
    });
    return () => stop?.();
  }, []);

  if (!ready) return <div className="loading">Loading RoomCraft…</div>;

  return (
    <div className={`app view-${view}${sidebarOpen ? ' sidebar-open' : ''}`}>
      <TopBar savedAt={savedAt} />
      <div className="workspace">
        <Sidebar />
        {sidebarOpen && <div className="scrim only-mobile" onClick={() => setUI({ sidebarOpen: false })} />}
        <main className="views">
          {view !== '3d' && (
            <section className="view-pane">
              <PlanEditor />
            </section>
          )}
          {view !== '2d' && (
            <section className="view-pane">
              <Scene3D />
            </section>
          )}
        </main>
      </div>
      {toast && <div className={`toast ${toast.kind}`} role="status">{toast.msg}</div>}
    </div>
  );
}
