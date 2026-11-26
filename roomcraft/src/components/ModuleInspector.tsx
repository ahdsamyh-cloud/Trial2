import { useMemo } from 'react';
import { useProject } from '../store/projectStore';
import { usePrefs, useUI } from '../store/uiStore';
import {
  deleteSelection,
  duplicateSelection,
  groupRun,
  mirrorSelection,
  rotateSelection,
  ungroupRun,
  updateModule,
} from '../store/actions';
import { LengthInput } from './LengthInput';
import { buildModule, moduleDef, type ParamSpec } from '../model/furniture';
import {
  BOARD_MATERIALS,
  BOARD_THICKNESSES,
  EDGE_THICKNESSES,
  FINISHES,
  HANDLE_STYLES,
  finishById,
  hardwareById,
  materialName,
} from '../model/catalog';
import type { BoardMaterialId, EdgeBand, HandleStyle, ModuleInstance, PanelEdges } from '../model/types';
import { formatLength } from '../model/units';

export function Swatches({ value, onChange, allowInherit }: { value: string | undefined; onChange: (id: string | undefined) => void; allowInherit?: string }) {
  return (
    <div className="swatches">
      {allowInherit && (
        <button className={`swatch inherit${value === undefined ? ' on' : ''}`} title={`Use default (${allowInherit})`} onClick={() => onChange(undefined)}>
          ↺
        </button>
      )}
      {FINISHES.map((f) => (
        <button
          key={f.id}
          className={`swatch${value === f.id ? ' on' : ''}${f.grain ? ' grain' : ''}`}
          style={{ background: f.color }}
          title={`${f.name} (${f.kind}${f.grain ? ', wood grain' : ''})`}
          onClick={() => onChange(f.id)}
        />
      ))}
    </div>
  );
}

function ParamField({ spec, value, onChange }: { spec: ParamSpec; value: unknown; onChange: (v: unknown) => void }) {
  switch (spec.type) {
    case 'int':
      return (
        <label className="field" title={spec.help}>
          <span>{spec.label}</span>
          <span className="stepper">
            <button onClick={() => onChange(Math.max(spec.min, Number(value) - 1))}>−</button>
            <output>{Number(value) || (spec.key === 'doors' && Number(value) === 0 ? 'auto' : 0)}</output>
            <button onClick={() => onChange(Math.min(spec.max, Number(value) + 1))}>+</button>
          </span>
        </label>
      );
    case 'length':
      return <LengthInput label={spec.label} title={spec.help} value={Number(value)} min={spec.min} max={spec.max} onChange={onChange} />;
    case 'bool':
      return (
        <label className="check" title={spec.help}>
          <input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} /> {spec.label}
        </label>
      );
    case 'select':
      return (
        <label className="field" title={spec.help}>
          <span>{spec.label}</span>
          <select value={String(value)} onChange={(e) => onChange(e.target.value)}>
            {spec.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      );
    case 'sections': {
      const list = Array.isArray(value) ? (value as string[]) : [];
      return (
        <div className="field sections">
          <span>{spec.label}</span>
          {list.map((v, i) => (
            <div className="row" key={i}>
              <select value={v} onChange={(e) => onChange(list.map((x, k) => (k === i ? e.target.value : x)))}>
                {spec.options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              <button className="btn small" disabled={list.length <= 1} onClick={() => onChange(list.filter((_, k) => k !== i))} title="Remove section">
                ✕
              </button>
            </div>
          ))}
          <button className="btn small" disabled={list.length >= 6} onClick={() => onChange([...list, spec.options[0].value])}>
            + Add section
          </button>
        </div>
      );
    }
  }
}

const EDGE_KEYS: (keyof PanelEdges)[] = ['L1', 'L2', 'W1', 'W2'];

export function ModuleInspector() {
  const selection = useUI((s) => s.selection);
  const setUI = useUI((s) => s.set);
  const exploded = useUI((s) => s.exploded);
  const project = useProject((s) => s.project);
  const units = usePrefs((s) => s.units);
  const sel = selection?.kind === 'module' ? selection : null;
  const m = sel ? project.modules.find((x) => x.id === sel.id) : undefined;
  const build = useMemo(() => (m ? buildModule(m, project) : null), [m, project]);
  if (!sel || !m || !build) return null;
  const def = moduleDef(m.type);
  const S = project.settings;
  const multi = sel.ids.length > 1;
  const up = (label: string, fn: (x: ModuleInstance) => void) => updateModule(m.id, fn, label);
  const panel = sel.panelKey ? build.panels.find((p) => p.key === sel.panelKey) : undefined;
  const ov = (sel.panelKey && m.panelOverrides[sel.panelKey]) || {};

  return (
    <div className="group inspector">
      <h3>
        {multi ? `${sel.ids.length} modules selected` : 'Selected module'} <small>{def?.name}</small>
      </h3>
      {multi ? (
        <div className="row">
          <button className="btn" onClick={() => groupRun(sel.ids)} title="Grouped modules move together">
            Group into run
          </button>
          <button className="btn" onClick={() => ungroupRun(sel.ids)}>
            Ungroup
          </button>
          <button className="btn" onClick={mirrorSelection}>
            Mirror
          </button>
          <button className="btn" onClick={duplicateSelection}>
            Duplicate
          </button>
          <button className="btn danger" onClick={deleteSelection}>
            Delete
          </button>
        </div>
      ) : (
        <>
          <label className="field">
            <span>Name</span>
            <input key={m.id} defaultValue={m.name} onBlur={(e) => e.target.value.trim() && up('Rename module', (x) => (x.name = e.target.value.trim()))} onKeyDown={(e) => e.stopPropagation()} />
          </label>
          <div className="grid2">
            <LengthInput label="Width" value={m.width} min={def?.limits.minW} max={def?.limits.maxW} onChange={(v) => up('Resize module', (x) => (x.width = v))} />
            <LengthInput label="Height" value={m.height} min={def?.limits.minH} max={def?.limits.maxH} onChange={(v) => up('Resize module', (x) => (x.height = v))} />
            <LengthInput label="Depth" value={m.depth} min={def?.limits.minD} max={def?.limits.maxD} onChange={(v) => up('Resize module', (x) => (x.depth = v))} />
            <LengthInput label="From floor" value={m.elevation} min={0} max={3000} onChange={(v) => up('Move module', (x) => (x.elevation = v))} />
          </div>
          <div className="row">
            <button className="btn small" onClick={() => rotateSelection(90)} title="Rotate 90° (R)">
              ⟳ Rotate
            </button>
            <button className="btn small" onClick={mirrorSelection} title="Swap hinge side / corner side">
              ⇋ Mirror
            </button>
            <button className="btn small" onClick={duplicateSelection} title="Duplicate (Ctrl+D)">
              ⧉ Duplicate
            </button>
            <button className={`btn small${exploded ? ' primary' : ''}`} onClick={() => setUI({ exploded: !exploded })} title="Exploded 3D view">
              ✣ Explode
            </button>
            {m.runId && (
              <button className="btn small" onClick={() => ungroupRun(project.modules.filter((x) => x.runId === m.runId).map((x) => x.id))}>
                Ungroup run
              </button>
            )}
            <button className="btn small danger" onClick={deleteSelection}>
              Delete
            </button>
          </div>

          {def && def.params.length > 0 && (
            <details open className="sub">
              <summary>Configuration</summary>
              <div className="stack-sm">
                {def.params.map((ps) => (
                  <ParamField key={ps.key} spec={ps} value={m.params[ps.key] ?? ps.default} onChange={(v) => up(`Change ${ps.label.toLowerCase()}`, (x) => (x.params[ps.key] = v as never))} />
                ))}
              </div>
            </details>
          )}

          <details open className="sub">
            <summary>Board &amp; finish</summary>
            <div className="grid2">
              <label className="field">
                <span>Board material</span>
                <select value={m.board?.material ?? ''} onChange={(e) => up('Change material', (x) => (x.board = { ...x.board, material: (e.target.value || undefined) as BoardMaterialId }))}>
                  <option value="">Default ({materialName(S.board.material)})</option>
                  {BOARD_MATERIALS.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Thickness</span>
                <select value={m.board?.thickness ?? ''} onChange={(e) => up('Change thickness', (x) => (x.board = { ...x.board, thickness: e.target.value ? Number(e.target.value) : undefined }))}>
                  <option value="">Default ({S.board.thickness} mm)</option>
                  {BOARD_THICKNESSES.map((t) => (
                    <option key={t} value={t}>
                      {t} mm
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <span className="field-label">Carcass finish</span>
            <Swatches value={m.board?.finish} allowInherit={finishById(S.board.finish).name} onChange={(f) => up('Change finish', (x) => (x.board = { ...x.board, finish: f }))} />
            <span className="field-label">Door / front finish</span>
            <Swatches value={m.frontFinish} allowInherit={finishById(S.frontFinish).name} onChange={(f) => up('Change front finish', (x) => (x.frontFinish = f))} />
            <label className="field">
              <span>Handles</span>
              <select value={m.handle} onChange={(e) => up('Change handles', (x) => (x.handle = e.target.value as HandleStyle))}>
                {HANDLE_STYLES.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.name}
                  </option>
                ))}
              </select>
            </label>
          </details>

          <details className="sub" open={!!panel}>
            <summary>Panels ({build.panels.length}) — click one to edit</summary>
            <ul className="panel-list">
              {build.panels.map((p) => (
                <li key={p.key}>
                  <button className={sel.panelKey === p.key ? 'on' : ''} onClick={() => setUI({ selection: { ...sel, panelKey: sel.panelKey === p.key ? undefined : p.key } })}>
                    <span>
                      {p.name}
                      {m.panelOverrides[p.key] && <b className="dot" title="Has overrides" />}
                    </span>
                    <em>
                      {Math.round(p.length)}×{Math.round(p.width)}×{p.thickness}
                    </em>
                  </button>
                </li>
              ))}
            </ul>
            {panel && (
              <div className="panel-editor">
                <h4>
                  {panel.name} <small>{panel.key}</small>
                </h4>
                <p className="hint">
                  Finished {formatLength(panel.length, units)} × {formatLength(panel.width, units)} · cut {Math.round(panel.cutLength)} × {Math.round(panel.cutWidth)} mm
                </p>
                <div className="grid2">
                  <label className="field">
                    <span>Thickness</span>
                    <select
                      value={ov.thickness ?? ''}
                      onChange={(e) =>
                        up('Panel thickness', (x) => {
                          x.panelOverrides[panel.key] = { ...x.panelOverrides[panel.key], thickness: e.target.value ? Number(e.target.value) : undefined };
                        })
                      }
                    >
                      <option value="">Module default</option>
                      {BOARD_THICKNESSES.map((t) => (
                        <option key={t} value={t}>
                          {t} mm
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    <span>Material</span>
                    <select
                      value={ov.material ?? ''}
                      onChange={(e) =>
                        up('Panel material', (x) => {
                          x.panelOverrides[panel.key] = { ...x.panelOverrides[panel.key], material: (e.target.value || undefined) as BoardMaterialId };
                        })
                      }
                    >
                      <option value="">Module default</option>
                      {BOARD_MATERIALS.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.short}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    <span>Grain</span>
                    <select
                      value={ov.grain ?? 'length'}
                      onChange={(e) =>
                        up('Panel grain', (x) => {
                          x.panelOverrides[panel.key] = { ...x.panelOverrides[panel.key], grain: e.target.value as 'length' | 'width' | 'none' };
                        })
                      }
                    >
                      <option value="length">Along length</option>
                      <option value="width">Across (swap)</option>
                      <option value="none">Ignore grain</option>
                    </select>
                  </label>
                </div>
                <span className="field-label">Finish</span>
                <Swatches
                  value={ov.finish}
                  allowInherit="module"
                  onChange={(f) =>
                    up('Panel finish', (x) => {
                      x.panelOverrides[panel.key] = { ...x.panelOverrides[panel.key], finish: f };
                    })
                  }
                />
                <span className="field-label">Edge banding (L = long edges, W = short edges)</span>
                <div className="edges">
                  {EDGE_KEYS.map((k) => {
                    const e = panel.edges[k];
                    const setEdge = (b: EdgeBand | null) =>
                      up('Edge banding', (x) => {
                        const cur = x.panelOverrides[panel.key] ?? {};
                        x.panelOverrides[panel.key] = { ...cur, edges: { ...cur.edges, [k]: b } };
                      });
                    return (
                      <div key={k} className="edge">
                        <label className="check">
                          <input type="checkbox" checked={!!e} onChange={(ev) => setEdge(ev.target.checked ? { thickness: panel.isFront ? S.frontEdge.thickness : S.carcassEdge.thickness, finish: panel.finish } : null)} /> {k}
                        </label>
                        {e && (
                          <select value={e.thickness} onChange={(ev) => setEdge({ ...e, thickness: Number(ev.target.value) })}>
                            {EDGE_THICKNESSES.map((t) => (
                              <option key={t} value={t}>
                                {t} mm
                              </option>
                            ))}
                          </select>
                        )}
                      </div>
                    );
                  })}
                </div>
                {m.panelOverrides[panel.key] && (
                  <button
                    className="btn small"
                    onClick={() =>
                      up('Reset panel', (x) => {
                        delete x.panelOverrides[panel.key];
                      })
                    }
                  >
                    Reset panel to module defaults
                  </button>
                )}
              </div>
            )}
          </details>

          <details className="sub">
            <summary>Hardware ({build.hardware.reduce((s, h) => s + h.qty, 0)})</summary>
            <ul className="plain">
              {build.hardware.map((h) => (
                <li key={h.id}>
                  {h.qty} × {hardwareById(h.id)?.name ?? h.id}
                  {h.note ? ` (${h.note})` : ''}
                </li>
              ))}
            </ul>
          </details>
          {build.notes.length > 0 && (
            <ul className="notes">
              {build.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
