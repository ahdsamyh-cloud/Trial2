import { useMemo } from 'react';
import { useProject } from '../store/projectStore';
import { usePrefs, useUI } from '../store/uiStore';
import { estimateCost, money } from '../model/cost';
import { buildCutList } from '../model/cutlist';
import { exportCutListCsv, exportExcel, exportPdf } from '../export/exports';
import { snapshot3D } from '../view3d/Scene3D';
import { useClashes } from '../store/derived';

/** Make sure a 3D canvas is mounted (briefly switching to split view if needed) and grab a frame. */
export async function grab3D(): Promise<string | null> {
  const ui = useUI.getState();
  const prev = { view: ui.view, step: ui.step, walk: ui.walk, exploded: ui.exploded };
  if (!snapshot3D.fn || ui.walk || ui.exploded) {
    ui.set({ view: 'split', step: 'furniture', walk: false, exploded: false, fitRequest: ui.fitRequest + 1 });
    for (let i = 0; i < 30 && !snapshot3D.fn; i++) await new Promise((r) => setTimeout(r, 100));
    await new Promise((r) => setTimeout(r, 900));
  }
  let img: string | null = null;
  try {
    img = snapshot3D.fn?.() ?? null;
  } catch {
    img = null;
  }
  useUI.getState().set(prev);
  return img;
}

export function OutputsPanel() {
  const project = useProject((s) => s.project);
  const units = usePrefs((s) => s.units);
  const busy = useUI((s) => s.busy);
  const setUI = useUI((s) => s.set);
  const notify = useUI((s) => s.notify);
  const cost = useMemo(() => estimateCost(project), [project]);
  const rows = useMemo(() => buildCutList(project), [project]);
  const issues = useClashes();
  const errors = issues.filter((i) => i.severity === 'error').length;

  const run = async (label: string, fn: () => Promise<void> | void) => {
    setUI({ busy: label });
    try {
      await fn();
      notify(`${label} ready`);
    } catch (e) {
      console.error(e);
      notify(`${label} failed: ${(e as Error).message}`, 'error');
    } finally {
      setUI({ busy: null });
    }
  };

  return (
    <div className="stack">
      <div className="group">
        <h3>Summary</h3>
        <dl className="stats">
          <dt>Modules</dt>
          <dd>{project.modules.length}</dd>
          <dt>Panels</dt>
          <dd>{rows.reduce((s, r) => s + r.qty, 0)}</dd>
          <dt>Board sheets</dt>
          <dd>{cost.sheetCount}</dd>
          <dt>Estimated total</dt>
          <dd>
            <b>{money(cost.total, cost.currency)}</b>
          </dd>
        </dl>
        {errors > 0 && (
          <button className="btn danger block" onClick={() => setUI({ checksOpen: true })}>
            ⚠ {errors} clash{errors === 1 ? '' : 'es'} to review before production
          </button>
        )}
      </div>
      <div className="group">
        <h3>Export</h3>
        <button className="btn primary block" disabled={!!busy || !project.rooms.length} onClick={() => run('PDF', async () => exportPdf(project, { units, snapshot: await grab3D() }))}>
          {busy === 'PDF' ? 'Preparing PDF…' : '⤓ PDF drawings & report'}
        </button>
        <button className="btn block" disabled={!!busy || !rows.length} onClick={() => run('Excel file', () => exportExcel(project))}>
          ⤓ Cut list (Excel .xlsx)
        </button>
        <button className="btn block" disabled={!!busy || !rows.length} onClick={() => run('CSV', () => exportCutListCsv(project))}>
          ⤓ Cut list (CSV)
        </button>
        <p className="hint">The PDF holds the floor plan, wall elevations with dimensions, a 3D snapshot, the cut list, sheet layouts, hardware, the countertop and the cost summary.</p>
      </div>
      <div className="group">
        <h3>Views</h3>
        <button className="btn block" onClick={() => setUI({ view: 'elev' })}>
          Wall elevations
        </button>
      </div>
    </div>
  );
}
