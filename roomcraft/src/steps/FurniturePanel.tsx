import { useProject } from '../store/projectStore';
import { SelectionInspector, Seg } from '../components/SelectionInspector';
import { Tile, TileGrid } from '../components/Library';
import { Swatches } from '../components/ModuleInspector';
import { MODULES } from '../model/furniture';
import { BOARD_MATERIALS, BOARD_THICKNESSES, EDGE_THICKNESSES, HANDLE_STYLES } from '../model/catalog';
import { setSettings } from '../store/actions';
import type { BoardMaterialId, HandleStyle } from '../model/types';
import { useState } from 'react';

export function FurniturePanel() {
  const project = useProject((s) => s.project);
  const S = project.settings;
  const [cat, setCat] = useState<'kitchen' | 'wardrobe' | 'room'>('kitchen');
  return (
    <div className="stack">
      <SelectionInspector />
      <div className="group">
        <h3>Module library</h3>
        <Seg
          value={cat}
          options={[
            { value: 'kitchen', label: 'Kitchen' },
            { value: 'wardrobe', label: 'Wardrobe' },
            { value: 'room', label: 'Rooms' },
          ]}
          onChange={setCat}
        />
        <TileGrid>
          {MODULES.filter((m) => m.category === cat).map((m) => (
            <Tile key={m.id} spec={{ cat: 'module', type: m.id }} icon={m.icon} label={m.name} sub={`${m.size.width}×${m.size.height}×${m.size.depth}`} />
          ))}
        </TileGrid>
        <p className="hint">Drop modules near a wall: they turn to face the room, sit against the wall and snap to their neighbours. Shift-click several to group them into a run.</p>
      </div>
      <div className="group">
        <h3>Project defaults (all modules)</h3>
        <div className="grid2">
          <label className="field">
            <span>Board material</span>
            <select value={S.board.material} onChange={(e) => setSettings((s) => (s.board.material = e.target.value as BoardMaterialId), 'Default material')}>
              {BOARD_MATERIALS.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Board thickness</span>
            <select value={S.board.thickness} onChange={(e) => setSettings((s) => (s.board.thickness = Number(e.target.value)), 'Default thickness')}>
              {BOARD_THICKNESSES.map((t) => (
                <option key={t} value={t}>
                  {t} mm
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Carcass edge band</span>
            <select value={S.carcassEdge.thickness} onChange={(e) => setSettings((s) => (s.carcassEdge.thickness = Number(e.target.value)), 'Edge band')}>
              {EDGE_THICKNESSES.map((t) => (
                <option key={t} value={t}>
                  {t} mm
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Front edge band</span>
            <select value={S.frontEdge.thickness} onChange={(e) => setSettings((s) => (s.frontEdge.thickness = Number(e.target.value)), 'Edge band')}>
              {EDGE_THICKNESSES.map((t) => (
                <option key={t} value={t}>
                  {t} mm
                </option>
              ))}
            </select>
          </label>
        </div>
        <span className="field-label">Carcass finish</span>
        <Swatches value={S.board.finish} onChange={(f) => f && setSettings((s) => (s.board.finish = f), 'Default finish')} />
        <span className="field-label">Door / front finish</span>
        <Swatches value={S.frontFinish} onChange={(f) => f && setSettings((s) => (s.frontFinish = f), 'Default front finish')} />
        <label className="field">
          <span>Default handle for new modules</span>
          <select value={S.handle} onChange={(e) => setSettings((s) => (s.handle = e.target.value as HandleStyle), 'Default handle')}>
            {HANDLE_STYLES.map((h) => (
              <option key={h.id} value={h.id}>
                {h.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="group">
        <h3>Modules ({project.modules.length})</h3>
        <ModuleList />
      </div>
    </div>
  );
}

import { useUI } from '../store/uiStore';
function ModuleList() {
  const mods = useProject((s) => s.project.modules);
  const selection = useUI((s) => s.selection);
  const setUI = useUI((s) => s.set);
  if (!mods.length) return <p className="hint">No modules yet.</p>;
  return (
    <ul className="list">
      {mods.map((m) => (
        <li key={m.id}>
          <button className={selection?.kind === 'module' && selection.ids.includes(m.id) ? 'on' : ''} onClick={() => setUI({ selection: { kind: 'module', id: m.id, ids: [m.id] } })}>
            <span>{m.name}</span>
            <em>
              {m.width}×{m.height}×{m.depth}
            </em>
          </button>
        </li>
      ))}
    </ul>
  );
}
