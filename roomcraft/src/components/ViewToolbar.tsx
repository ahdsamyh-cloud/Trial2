import { useState } from 'react';
import { usePrefs, useUI, type Layers, type Tool } from '../store/uiStore';

const LAYER_LABELS: Record<keyof Layers, string> = {
  furniture: 'Furniture & appliances',
  electrical: 'Electrical',
  plumbing: 'Plumbing & gas',
  structure: 'Beams & columns',
  dimensions: 'Dimensions',
  ceiling: 'Ceilings (3D)',
};

/** Floating tool + layer bar on the plan. */
export function ViewToolbar() {
  const tool = useUI((s) => s.tool);
  const setUI = useUI((s) => s.set);
  const layers = usePrefs((s) => s.layers);
  const toggle = usePrefs((s) => s.toggleLayer);
  const [open, setOpen] = useState(false);
  const tools: { id: Tool; icon: string; label: string; key: string }[] = [
    { id: 'select', icon: '➤', label: 'Select / move', key: 'V' },
    { id: 'draw', icon: '✎', label: 'Draw room', key: 'D' },
    { id: 'measure', icon: '📏', label: 'Measure', key: 'M' },
    { id: 'pan', icon: '✋', label: 'Pan', key: 'H' },
  ];
  return (
    <div className="view-toolbar" data-tour="tools">
      {tools.map((t) => (
        <button key={t.id} className={`btn icon${tool === t.id ? ' on' : ''}`} title={`${t.label} (${t.key})`} onClick={() => setUI({ tool: t.id, placing: null })}>
          {t.icon}
        </button>
      ))}
      <div className="menu-wrap">
        <button className={`btn icon${open ? ' on' : ''}`} title="Layers" onClick={() => setOpen(!open)} data-tour="layers">
          ☰
        </button>
        {open && (
          <div className="menu layers-menu" onMouseLeave={() => setOpen(false)}>
            {(Object.keys(LAYER_LABELS) as (keyof Layers)[]).map((k) => (
              <label key={k} className="check">
                <input type="checkbox" checked={layers[k]} onChange={() => toggle(k)} /> {LAYER_LABELS[k]}
              </label>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
