import { useRef, useState } from 'react';
import { useProject } from '../store/projectStore';
import { usePrefs, useUI, type ViewMode } from '../store/uiStore';
import { downloadProject, readProjectFile } from '../store/persistence';
import { newProject } from '../model/room';
import { sampleKitchen } from '../model/sample';
import { ChecksButton } from './ChecksDrawer';
import { UNIT_LABELS } from '../model/units';
import type { LengthUnit } from '../model/types';

export function TopBar({ savedAt }: { savedAt: Date | null }) {
  const project = useProject((s) => s.project);
  const past = useProject((s) => s.past);
  const future = useProject((s) => s.future);
  const { undo, redo, apply, load } = useProject.getState();
  const view = useUI((s) => s.view);
  const setUI = useUI((s) => s.set);
  const notify = useUI((s) => s.notify);
  const { units, theme, set: setPrefs } = usePrefs();
  const fileRef = useRef<HTMLInputElement>(null);
  const [menu, setMenu] = useState(false);

  const views: { id: ViewMode; label: string; key: string }[] = [
    { id: '2d', label: '2D', key: '1' },
    { id: 'split', label: 'Split', key: '2' },
    { id: '3d', label: '3D', key: '3' },
    { id: 'elev', label: 'Elev.', key: '4' },
  ];

  return (
    <header className="topbar">
      <button className="btn icon only-mobile" aria-label="Toggle steps panel" onClick={() => setUI({ sidebarOpen: !useUI.getState().sidebarOpen })}>
        ☰
      </button>
      <div className="brand" title="RoomCraft">
        <svg viewBox="0 0 32 32" width="26" height="26" aria-hidden>
          <rect width="32" height="32" rx="7" fill="var(--accent)" />
          <path d="M7 25V11l9-5 9 5v14h-6v-8h-6v8z" fill="#fff" />
        </svg>
        <span className="hide-mobile">RoomCraft</span>
      </div>
      <input
        key={project.id + project.name}
        className="project-name"
        defaultValue={project.name}
        aria-label="Project name"
        onBlur={(e) => {
          const v = e.target.value.trim();
          if (v && v !== project.name)
            apply('Rename project', (d) => {
              d.name = v;
            });
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          e.stopPropagation();
        }}
      />

      <div className="menu-wrap">
        <button className="btn" onClick={() => setMenu(!menu)} aria-expanded={menu}>
          File ▾
        </button>
        {menu && (
          <div className="menu" onMouseLeave={() => setMenu(false)}>
            <button
              onClick={() => {
                setMenu(false);
                if (project.rooms.length && !confirm('Start a new project? Unsaved changes to the current one stay only in its .json file if you saved it.')) return;
                load(newProject());
                setUI({ selection: null, step: 'floor', fitRequest: useUI.getState().fitRequest + 1 });
              }}
            >
              New project
            </button>
            <button
              onClick={() => {
                setMenu(false);
                if (project.rooms.length && !confirm('Replace the current project with the sample kitchen? (Undo with Ctrl+Z is not available after loading.)')) return;
                load(sampleKitchen());
                setUI({ selection: null, step: 'furniture', fitRequest: useUI.getState().fitRequest + 1 });
              }}
            >
              Load sample kitchen
            </button>
            <button
              onClick={() => {
                setMenu(false);
                fileRef.current?.click();
              }}
            >
              Open .json…
            </button>
            <button
              onClick={() => {
                setMenu(false);
                downloadProject(project);
              }}
            >
              Save as .json <kbd>Ctrl S</kbd>
            </button>
            <button
              onClick={() => {
                setMenu(false);
                setUI({ tourStep: 0 });
              }}
            >
              Guided tour <kbd>?</kbd>
            </button>
            <div className="menu-settings only-mobile">
              <select value={units} onChange={(e) => setPrefs({ units: e.target.value as LengthUnit })} aria-label="Units">
                {(Object.keys(UNIT_LABELS) as LengthUnit[]).map((u) => (
                  <option key={u} value={u}>
                    {UNIT_LABELS[u]}
                  </option>
                ))}
              </select>
              <button onClick={() => setPrefs({ theme: theme === 'dark' ? 'light' : 'dark' })}>{theme === 'dark' ? '☀ Light mode' : '☾ Dark mode'}</button>
            </div>
          </div>
        )}
        <input
          ref={fileRef}
          type="file"
          accept=".json,application/json"
          hidden
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (!f) return;
            try {
              const p = await readProjectFile(f);
              load(p);
              setUI({ selection: null, fitRequest: useUI.getState().fitRequest + 1 });
              notify(`Opened "${p.name}"`);
            } catch (err) {
              notify((err as Error).message, 'error');
            }
          }}
        />
      </div>

      <div className="btn-group">
        <button className="btn icon" disabled={!past.length} onClick={undo} title={past.length ? `Undo ${past[past.length - 1].label} (Ctrl+Z)` : 'Nothing to undo'}>
          ↶
        </button>
        <button className="btn icon" disabled={!future.length} onClick={redo} title={future.length ? `Redo ${future[0].label} (Ctrl+Shift+Z)` : 'Nothing to redo'}>
          ↷
        </button>
      </div>

      <div className="spacer" />
      <ChecksButton />

      <div className="seg view-toggle" role="group" aria-label="View mode">
        {views.map((v) => (
          <button key={v.id} className={view === v.id ? 'on' : ''} onClick={() => setUI({ view: v.id, step: useUI.getState().step === 'outputs' ? 'furniture' : useUI.getState().step })} title={`${v.id === 'elev' ? 'Plan + wall elevation' : v.label + ' view'} (${v.key})`}>
            {v.label}
          </button>
        ))}
      </div>

      <select className="units hide-mobile" value={units} onChange={(e) => setPrefs({ units: e.target.value as LengthUnit })} aria-label="Units" title="Display units">
        {(Object.keys(UNIT_LABELS) as LengthUnit[]).map((u) => (
          <option key={u} value={u}>
            {u === 'ftin' ? 'ft-in' : u}
          </option>
        ))}
      </select>

      <button className="btn icon hide-mobile" onClick={() => setPrefs({ theme: theme === 'dark' ? 'light' : 'dark' })} title="Toggle dark/light mode">
        {theme === 'dark' ? '☀' : '☾'}
      </button>
      <span className="saved hide-mobile" title="Projects autosave in this browser (IndexedDB)">
        {savedAt ? `Saved ${savedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'Autosave on'}
      </span>
    </header>
  );
}
