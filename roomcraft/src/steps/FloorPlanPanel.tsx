import { useState } from 'react';
import { useProject } from '../store/projectStore';
import { closePanelOnPhone, usePrefs, useUI, type Tool } from '../store/uiStore';
import { addTemplateRoom } from '../store/actions';
import { LengthInput } from '../components/LengthInput';
import { SelectionInspector } from '../components/SelectionInspector';
import type { TemplateKind } from '../model/room';
import { formatArea } from '../model/units';
import { polygonArea } from '../model/geometry';

const TEMPLATE_ICONS: Record<TemplateKind, string> = {
  rect: 'M4 4h40v28H4z',
  L: 'M4 4h24v12h16v16H4z',
  U: 'M4 4h12v14h16V4h12v28H4z',
};

export function FloorPlanPanel() {
  const tool = useUI((s) => s.tool);
  const setUI = useUI((s) => s.set);
  const rooms = useProject((s) => s.project.rooms);
  const selection = useUI((s) => s.selection);
  const prefs = usePrefs();

  const [kind, setKind] = useState<TemplateKind>('rect');
  const [w, setW] = useState(4000);
  const [l, setL] = useState(3000);
  const [cw, setCw] = useState(1500);
  const [cl, setCl] = useState(1500);
  const [name, setName] = useState('');

  const tools: { id: Tool; label: string; key: string; hint: string }[] = [
    { id: 'select', label: 'Select', key: 'V', hint: 'Select and move rooms, walls and corners' },
    { id: 'draw', label: 'Draw room', key: 'D', hint: 'Click corners to draw a room outline' },
    { id: 'pan', label: 'Pan', key: 'H', hint: 'Drag to move the view' },
  ];

  return (
    <div className="stack">
      <div className="group">
        <h3>Tools</h3>
        <div className="seg">
          {tools.map((t) => (
            <button key={t.id} className={tool === t.id ? 'on' : ''} onClick={() => {
                setUI({ tool: t.id });
                if (t.id !== 'select') closePanelOnPhone();
              }} title={`${t.hint} (${t.key})`}>
              {t.label}
            </button>
          ))}
        </div>
        {tool === 'draw' && (
          <p className="hint">
            Click to place corners. Snaps to grid, 45°/90° and existing walls. Type a number to set the next wall's length.
            Close the room on the first corner or press <kbd>Enter</kbd>. <kbd>Backspace</kbd> removes the last point.
          </p>
        )}
      </div>

      <div className="group">
        <h3>New room</h3>
        <div className="templates">
          {(['rect', 'L', 'U'] as TemplateKind[]).map((k) => (
            <button key={k} className={`template${kind === k ? ' on' : ''}`} onClick={() => setKind(k)} title={`${k === 'rect' ? 'Rectangle' : k + '-shape'} template`}>
              <svg viewBox="0 0 48 36" aria-hidden>
                <path d={TEMPLATE_ICONS[k]} />
              </svg>
              <span>{k === 'rect' ? 'Rectangle' : `${k}-shape`}</span>
            </button>
          ))}
        </div>
        <div className="grid2">
          <LengthInput label="Width (x)" value={w} onChange={setW} min={300} />
          <LengthInput label="Length (y)" value={l} onChange={setL} min={300} />
          {kind !== 'rect' && (
            <>
              <LengthInput label={kind === 'L' ? 'Cut-out width' : 'Notch width'} value={cw} onChange={setCw} min={100} />
              <LengthInput label={kind === 'L' ? 'Cut-out length' : 'Notch depth'} value={cl} onChange={setCl} min={100} />
            </>
          )}
        </div>
        <label className="field">
          <span>Name</span>
          <input value={name} placeholder={`Room ${rooms.length + 1}`} onChange={(e) => setName(e.target.value)} />
        </label>
        <button
          className="btn primary block"
          onClick={() => {
            if (kind !== 'rect' && (cw >= w || cl >= l)) {
              useUI.getState().notify('The cut-out must be smaller than the room.', 'error');
              return;
            }
            addTemplateRoom(kind, { width: w, length: l, cutWidth: cw, cutLength: cl }, name.trim() || undefined);
            setName('');
          }}
        >
          Add room
        </button>
      </div>

      <SelectionInspector />

      <div className="group">
        <h3>Rooms ({rooms.length})</h3>
        {rooms.length === 0 && <p className="hint">No rooms yet — add one above or draw it on the plan.</p>}
        <ul className="list">
          {rooms.map((r) => (
            <li key={r.id}>
              <button
                className={selection?.roomId === r.id ? 'on' : ''}
                onClick={() => setUI({ selection: { kind: 'room', roomId: r.id } })}
              >
                <span>{r.name}</span>
                <em>{formatArea(polygonArea(r.points), prefs.units)}</em>
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div className="group">
        <h3>Snapping</h3>
        <label className="check">
          <input type="checkbox" checked={prefs.snapGrid} onChange={(e) => prefs.set({ snapGrid: e.target.checked })} /> Grid
        </label>
        <label className="check">
          <input type="checkbox" checked={prefs.snapAngle} onChange={(e) => prefs.set({ snapAngle: e.target.checked })} /> Angles (45° / 90°)
        </label>
        <label className="check">
          <input type="checkbox" checked={prefs.snapObjects} onChange={(e) => prefs.set({ snapObjects: e.target.checked })} /> Walls &amp; corners
        </label>
        <LengthInput label="Grid size" value={prefs.gridSize} onChange={(g) => prefs.set({ gridSize: g })} min={5} max={5000} />
      </div>
    </div>
  );
}
