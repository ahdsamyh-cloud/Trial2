import { useMemo } from 'react';
import { useProject } from '../store/projectStore';
import { usePrefs, useUI } from '../store/uiStore';
import { estimateCost, money } from '../model/cost';
import { buildCutList } from '../model/cutlist';
import { exportCutListCsv, exportExcel, exportPdf } from '../export/exports';
import { snapshot3D } from '../view3d/Scene3D';
import { useClashes } from '../store/derived';

/**
 * Make sure a 3D canvas is mounted (switching to the 3D view if needed) and grab
 * presentation renders: a photo-style image and a dimensioned sketch.
 */
export async function grab3D(): Promise<{ photo: string | null; sketch: string | null }> {
  const ui = useUI.getState();
  const prev = { view: ui.view, step: ui.step, walk: ui.walk, exploded: ui.exploded, present: ui.present, presentDims: ui.presentDims };
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const shot = async (mode: 'photo' | 'sketch', dims: boolean) => {
    useUI.getState().set({ view: '3d', step: 'furniture', walk: false, exploded: false, present: mode, presentDims: dims, fitRequest: useUI.getState().fitRequest + 1 });
    for (let i = 0; i < 30 && !snapshot3D.fn; i++) await wait(100);
    await wait(1400);
    try {
      return snapshot3D.fn?.() ?? null;
    } catch {
      return null;
    }
  };
  const photo = await shot('photo', false);
  const sketch = await shot('sketch', true);
  useUI.getState().set({ ...prev, fitRequest: useUI.getState().fitRequest + 1 });
  return { photo, sketch };
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
        <button className="btn primary block" disabled={!!busy || !project.rooms.length} onClick={() => run('PDF', async () => {
              const shots = await grab3D();
              exportPdf(project, { units, snapshot: shots.photo, sketch: shots.sketch });
            })}>
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
