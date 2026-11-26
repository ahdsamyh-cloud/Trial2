import { useMemo, useState } from 'react';
import { useProject } from '../store/projectStore';
import { usePrefs, useUI } from '../store/uiStore';
import { setPrices, setSettings } from '../store/actions';
import { buildCutList, groupLabel, hardwareList } from '../model/cutlist';
import { estimateCost, money } from '../model/cost';
import { BOARD_MATERIALS, BOARD_THICKNESSES, HARDWARE, STONES, finishById, materialName } from '../model/catalog';
import { SheetDiagram } from './SheetDiagram';
import { LengthInput } from './LengthInput';
import { formatLength } from '../model/units';

type Tab = 'cut' | 'sheets' | 'hardware' | 'cost';

function Num({ value, onChange, step = 1, width = 80 }: { value: number; onChange: (n: number) => void; step?: number; width?: number }) {
  return (
    <input
      className="num"
      type="number"
      step={step}
      min={0}
      style={{ width }}
      value={Number.isFinite(value) ? value : 0}
      onChange={(e) => onChange(Math.max(0, Number(e.target.value) || 0))}
      onKeyDown={(e) => e.stopPropagation()}
    />
  );
}

export function ReportsView() {
  const project = useProject((s) => s.project);
  const units = usePrefs((s) => s.units);
  const setUI = useUI((s) => s.set);
  const [tab, setTab] = useState<Tab>('cut');
  const [filter, setFilter] = useState('');
  const rows = useMemo(() => buildCutList(project), [project]);
  const cost = useMemo(() => estimateCost(project), [project]);
  const hw = useMemo(() => hardwareList(project), [project]);
  const S = project.settings.sheet;
  const P = project.prices;
  const shown = rows.filter((r) => !filter || `${r.module} ${r.name} ${r.material}`.toLowerCase().includes(filter.toLowerCase()));
  const usedBoards = new Set(cost.sheets.map((g) => `${g.material}-${g.thickness}`));

  if (!project.modules.length)
    return (
      <div className="reports empty">
        <h2>No furniture yet</h2>
        <p>Add modules in the Furniture step to generate the cut list, sheet layouts, hardware list and cost estimate.</p>
        <button className="btn primary" onClick={() => setUI({ step: 'furniture' })}>
          Go to Furniture
        </button>
      </div>
    );

  return (
    <div className="reports">
      <div className="report-tabs seg">
        {(
          [
            ['cut', `Cut list (${rows.reduce((s, r) => s + r.qty, 0)})`],
            ['sheets', `Sheets (${cost.sheetCount})`],
            ['hardware', `Hardware (${hw.length})`],
            ['cost', `Cost ${money(cost.total, cost.currency)}`],
          ] as [Tab, string][]
        ).map(([id, label]) => (
          <button key={id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'cut' && (
        <section>
          <div className="row report-tools">
            <input placeholder="Filter by module, panel or material…" value={filter} onChange={(e) => setFilter(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
            <span className="muted">Finished = size after edge banding; Cut = size to cut on the panel saw (≥1 mm banding deducted).</span>
          </div>
          <div className="table-wrap">
            <table className="table cut">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Module</th>
                  <th>Panel</th>
                  <th>Finished L × W</th>
                  <th>T</th>
                  <th>Cut L × W</th>
                  <th>Material</th>
                  <th>Finish</th>
                  <th>Edge banding</th>
                  <th>Grain</th>
                  <th>Qty</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r, i) => (
                  <tr key={r.id} onClick={() => setUI({ selection: { kind: 'module', id: r.moduleId, ids: [r.moduleId], panelKey: r.panelKeys[0] } })} title={r.notes}>
                    <td>{i + 1}</td>
                    <td>{r.module}</td>
                    <td>{r.name}</td>
                    <td>
                      {r.length} × {r.width}
                    </td>
                    <td>{r.thickness}</td>
                    <td>
                      <b>
                        {r.cutLength} × {r.cutWidth}
                      </b>
                    </td>
                    <td>{materialName(r.material)}</td>
                    <td>
                      <i className="chip" style={{ background: finishById(r.finish).color }} /> {finishById(r.finish).name}
                    </td>
                    <td>{r.edgeText}</td>
                    <td>{r.grain === 'length' ? '↕ L' : '—'}</td>
                    <td>{r.qty}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {tab === 'sheets' && (
        <section>
          <div className="row report-tools">
            <LengthInput label="Sheet length" value={S.length} min={500} max={5000} onChange={(v) => setSettings((s) => (s.sheet.length = v), 'Sheet size')} />
            <LengthInput label="Sheet width" value={S.width} min={300} max={3000} onChange={(v) => setSettings((s) => (s.sheet.width = v), 'Sheet size')} />
            <LengthInput label="Saw kerf" value={S.kerf} min={0} max={10} onChange={(v) => setSettings((s) => (s.sheet.kerf = v), 'Kerf')} />
            <LengthInput label="Edge trim" value={S.trim} min={0} max={50} onChange={(v) => setSettings((s) => (s.sheet.trim = v), 'Trim')} />
          </div>
          {cost.sheets.map((g) => (
            <div key={g.key} className="sheet-group">
              <h3>
                {groupLabel(g)} — {g.result.sheets.length} sheet{g.result.sheets.length === 1 ? '' : 's'} · {Math.round(g.result.efficiency * 100)}% yield
                {g.grain && <small> · wood grain: parts not rotated</small>}
              </h3>
              {g.result.unplaced.length > 0 && <p className="danger">{g.result.unplaced.length} panel(s) larger than the sheet: {g.result.unplaced.map((u) => u.label).join(', ')}</p>}
              <div className="sheets">
                {g.result.sheets.map((sh, i) => (
                  <SheetDiagram key={i} sheet={sh} w={S.length} h={S.width} grain={g.grain} title={`Sheet ${i + 1}`} />
                ))}
              </div>
            </div>
          ))}
        </section>
      )}

      {tab === 'hardware' && (
        <section className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Item</th>
                <th>Qty</th>
                <th>Unit</th>
                <th>Unit price</th>
                <th>Amount</th>
                <th>Used in</th>
              </tr>
            </thead>
            <tbody>
              {hw.map((h) => (
                <tr key={h.id}>
                  <td>{h.name}</td>
                  <td>{h.qty}</td>
                  <td>{h.unit}</td>
                  <td>
                    <Num value={P.hardware[h.id] ?? 0} onChange={(n) => setPrices((p) => (p.hardware[h.id] = n))} />
                  </td>
                  <td>{money(h.qty * (P.hardware[h.id] ?? 0), P.currency)}</td>
                  <td className="muted">{h.modules.join(', ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {tab === 'cost' && (
        <section className="cost-grid">
          <div>
            <h3>Estimate</h3>
            <table className="table">
              <tbody>
                {cost.lines.map((l) => (
                  <tr key={l.label}>
                    <td>{l.label}</td>
                    <td className="muted">{l.qty}</td>
                    <td className="r">{money(l.amount, cost.currency)}</td>
                  </tr>
                ))}
                <tr className="sum">
                  <td>Subtotal</td>
                  <td />
                  <td className="r">{money(cost.subtotal, cost.currency)}</td>
                </tr>
                <tr>
                  <td>
                    Labour &amp; installation <Num value={P.labourPercent} width={56} onChange={(n) => setPrices((p) => (p.labourPercent = n))} /> %
                  </td>
                  <td />
                  <td className="r">{money(cost.labour, cost.currency)}</td>
                </tr>
                <tr className="total">
                  <td>Total</td>
                  <td />
                  <td className="r">{money(cost.total, cost.currency)}</td>
                </tr>
              </tbody>
            </table>
            <h3>Per module</h3>
            <table className="table">
              <thead>
                <tr>
                  <th>Module</th>
                  <th className="r">Boards</th>
                  <th className="r">Finish</th>
                  <th className="r">Edge</th>
                  <th className="r">Hardware</th>
                  <th className="r">Total</th>
                </tr>
              </thead>
              <tbody>
                {cost.modules.map((m) => (
                  <tr key={m.moduleId}>
                    <td>{m.name}</td>
                    {[m.board, m.finish, m.edge, m.hardware, m.total].map((v, i) => (
                      <td key={i} className="r">
                        {money(v, cost.currency)}
                      </td>
                    ))}
                  </tr>
                ))}
                {cost.countertop > 0 && (
                  <tr>
                    <td>Countertop</td>
                    <td colSpan={4} />
                    <td className="r">{money(cost.countertop, cost.currency)}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="price-list">
            <h3>Price list</h3>
            <label className="field inline">
              <span>Currency symbol</span>
              <input value={P.currency} onChange={(e) => setPrices((p) => (p.currency = e.target.value.slice(0, 4)))} onKeyDown={(e) => e.stopPropagation()} style={{ width: 60 }} />
            </label>
            <h4>Boards (per {S.length}×{S.width} sheet)</h4>
            <table className="table compact">
              <thead>
                <tr>
                  <th />
                  {BOARD_THICKNESSES.map((t) => (
                    <th key={t}>{t}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {BOARD_MATERIALS.map((m) => (
                  <tr key={m.id}>
                    <td>{m.short}</td>
                    {BOARD_THICKNESSES.map((t) => {
                      const k = `${m.id}-${t}`;
                      return (
                        <td key={t} className={usedBoards.has(k) ? 'used' : ''}>
                          <Num width={64} value={P.boards[k] ?? 0} onChange={(n) => setPrices((p) => (p.boards[k] = n))} />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
            <h4>Finish (per sq ft of face)</h4>
            <div className="row">
              {Object.keys(P.finishPerSqft).map((k) => (
                <label key={k} className="field inline">
                  <span>{k}</span>
                  <Num value={P.finishPerSqft[k]} onChange={(n) => setPrices((p) => (p.finishPerSqft[k] = n))} />
                </label>
              ))}
            </div>
            <h4>Edge band (per metre)</h4>
            <div className="row">
              {Object.keys(P.edgeBandPerM).map((k) => (
                <label key={k} className="field inline">
                  <span>{k} mm</span>
                  <Num value={P.edgeBandPerM[k]} onChange={(n) => setPrices((p) => (p.edgeBandPerM[k] = n))} />
                </label>
              ))}
            </div>
            <h4>Stone (per sq ft)</h4>
            <div className="row">
              {STONES.map((s) => (
                <label key={s.id} className={`field inline${s.id === project.countertop.stone ? ' used' : ''}`}>
                  <span>{s.name}</span>
                  <Num value={P.stonePerSqft[s.id] ?? 0} onChange={(n) => setPrices((p) => (p.stonePerSqft[s.id] = n))} />
                </label>
              ))}
            </div>
            <details>
              <summary>
                <h4 style={{ display: 'inline' }}>Hardware (per item)</h4>
              </summary>
              <div className="row">
                {HARDWARE.map((h) => (
                  <label key={h.id} className="field inline">
                    <span>{h.name}</span>
                    <Num value={P.hardware[h.id] ?? 0} onChange={(n) => setPrices((p) => (p.hardware[h.id] = n))} />
                  </label>
                ))}
              </div>
            </details>
            <p className="hint">Board cost uses the real number of sheets after nesting; each module carries an area share. Edge band includes 10% waste. Sizes shown in {formatLength(1000, units).includes('"') ? 'inches' : 'mm'}.</p>
          </div>
        </section>
      )}
    </div>
  );
}
