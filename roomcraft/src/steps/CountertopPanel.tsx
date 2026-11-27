import { useMemo } from 'react';
import { useProject } from '../store/projectStore';
import { usePrefs } from '../store/uiStore';
import { setCountertop } from '../store/actions';
import { useCountertop } from '../store/derived';
import { LengthInput } from '../components/LengthInput';
import { SheetDiagram } from '../components/SheetDiagram';
import { STONES } from '../model/catalog';
import { countertopLayout } from '../model/countertop';
import { formatLength } from '../model/units';

const FAMILIES = [
  { id: 'marble', name: 'Marble' },
  { id: 'granite', name: 'Granite' },
  { id: 'quartz', name: 'Quartz' },
  { id: 'solid-surface', name: 'Solid surface' },
] as const;

export function StoneSwatch({ color, veins, speckle }: { color: string; veins?: string; speckle?: boolean }) {
  return (
    <svg viewBox="0 0 40 40" className="stone-swatch" aria-hidden>
      <rect width="40" height="40" fill={color} />
      {veins && <path d="M-2 12 C10 8, 18 22, 42 14 M4 42 C12 30, 26 34, 30 -2" stroke={veins} strokeWidth="1.2" fill="none" opacity="0.8" />}
      {speckle &&
        Array.from({ length: 30 }, (_, i) => (
          <circle key={i} cx={(i * 37) % 40} cy={(i * 23 + (i % 3) * 7) % 40} r={0.8 + (i % 3) * 0.4} fill={i % 2 ? '#ffffff' : '#000000'} opacity="0.35" />
        ))}
    </svg>
  );
}

export function CountertopPanel() {
  const project = useProject((s) => s.project);
  const ct = project.countertop;
  const units = usePrefs((s) => s.units);
  const pieces = useCountertop();
  const layout = useMemo(() => countertopLayout(project, pieces), [project, pieces]);

  return (
    <div className="stack">
      <div className="group">
        <label className="check">
          <input type="checkbox" checked={ct.enabled} onChange={(e) => setCountertop({ enabled: e.target.checked })} /> Countertop over kitchen base units
        </label>
      </div>
      <div className="group">
        <h3>Stone</h3>
        {FAMILIES.map((f) => (
          <div key={f.id}>
            <span className="field-label">{f.name}</span>
            <div className="stones">
              {STONES.filter((s) => s.family === f.id).map((s) => (
                <button key={s.id} className={`stone${ct.stone === s.id ? ' on' : ''}`} onClick={() => setCountertop({ stone: s.id })} title={s.name}>
                  <StoneSwatch color={s.color} veins={s.veins} speckle={s.speckle} />
                  <span>{s.name}</span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="group">
        <h3>Wall tiles (between worktop and wall units)</h3>
        <div className="tile-styles">
          {(
            [
              ['none', 'None', 'transparent'],
              ['subway-white', 'White subway', '#f7f7f5'],
              ['subway-grey', 'Grey subway', '#b9bcbf'],
              ['square-white', 'White square', '#f4f4f1'],
              ['hex-green', 'Sage square', '#6f9c86'],
            ] as const
          ).map(([id, label, c]) => (
            <button key={id} className={`stone${(ct.wallTiles ?? 'none') === id ? ' on' : ''}`} onClick={() => setCountertop({ wallTiles: id })}>
              <span className={`tile-sw ${id}`} style={{ background: c }} />
              <span>{label}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="group">
        <h3>Dimensions</h3>
        <div className="grid2">
          <LengthInput label="Thickness" value={ct.thickness} min={10} max={60} onChange={(v) => setCountertop({ thickness: v })} />
          <LengthInput label="Front overhang" value={ct.frontOverhang} min={0} max={100} onChange={(v) => setCountertop({ frontOverhang: v })} />
          <LengthInput label="Side overhang (free ends)" value={ct.sideOverhang} min={0} max={100} onChange={(v) => setCountertop({ sideOverhang: v })} />
          <LengthInput label="Backsplash height" value={ct.backsplashHeight} min={0} max={900} onChange={(v) => setCountertop({ backsplashHeight: v })} />
          <LengthInput label="Slab length" value={ct.slabLength} min={1000} max={4000} onChange={(v) => setCountertop({ slabLength: v })} />
          <LengthInput label="Slab width" value={ct.slabWidth} min={500} max={2000} onChange={(v) => setCountertop({ slabWidth: v })} />
        </div>
      </div>
      <div className="group">
        <h3>Pieces ({pieces.length})</h3>
        {!pieces.length && <p className="hint">Place kitchen base units (Furniture step) to generate the countertop.</p>}
        <ul className="plain pieces">
          {pieces.map((p) => (
            <li key={p.id}>
              <b>{p.label}</b>: {formatLength(p.length, units)} × {formatLength(p.depth, units)} × {p.thickness} mm
              {p.backsplash && p.backsplash.length > 0 && <div className="muted">Backsplash {formatLength(p.backsplash.length, units)} × {formatLength(p.backsplash.height, units)}</div>}
              {p.cutouts.map((c, i) => (
                <div key={i} className="muted">
                  {c.kind === 'sink' ? 'Sink' : 'Hob'} cut-out {c.w}×{c.d} mm, centre {c.u} mm from left end, {c.v} mm from back
                </div>
              ))}
              {p.joints.map((j) => (
                <div key={j} className="muted">
                  {j}
                </div>
              ))}
            </li>
          ))}
        </ul>
        {pieces.length > 0 && (
          <>
            <p className="hint">
              {layout.sheets.length} slab{layout.sheets.length === 1 ? '' : 's'} of {ct.slabLength}×{ct.slabWidth} mm · {layout.areaSqft.toFixed(1)} sq ft of stone
              {layout.unplaced.length > 0 && <b className="danger"> · {layout.unplaced.length} piece(s) longer than a slab — needs a joint</b>}
            </p>
            {layout.sheets.map((sh, i) => (
              <SheetDiagram key={i} sheet={sh} w={ct.slabLength} h={ct.slabWidth} title={`Slab ${i + 1}`} colorKey={(l) => l.split(' ')[1]} />
            ))}
          </>
        )}
      </div>
    </div>
  );
}
