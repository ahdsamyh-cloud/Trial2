import { useProject } from '../store/projectStore';
import { selRoomId, useUI } from '../store/uiStore';
import { SelectionInspector } from '../components/SelectionInspector';
import { Tile, TileGrid } from '../components/Library';
import { LengthInput } from '../components/LengthInput';
import { SERVICES } from '../model/catalog';
import { roomStructure } from '../model/structure';
import { updateRoomStructure } from '../store/actions';

export function ServicesPanel() {
  const project = useProject((s) => s.project);
  const selection = useUI((s) => s.selection);
  const room = project.rooms.find((r) => r.id === selRoomId(selection)) ?? project.rooms[0];
  const st = room ? roomStructure(room) : null;
  const count = (k: string) => project.services.filter((s) => s.kind === k).length;

  return (
    <div className="stack">
      <SelectionInspector />
      <div className="group">
        <h3>Doors &amp; windows</h3>
        <TileGrid>
          <Tile spec={{ cat: 'opening', kind: 'door' }} icon="🚪" label="Door" sub="900 × 2100" />
          <Tile spec={{ cat: 'opening', kind: 'window' }} icon="⊞" label="Window" sub="1200 × 1200" />
          <Tile spec={{ cat: 'opening', kind: 'opening' }} icon="⊓" label="Opening" sub="no shutter" />
        </TileGrid>
      </div>
      {(['electrical', 'plumbing'] as const).map((g) => (
        <div className="group" key={g}>
          <h3>{g === 'electrical' ? 'Electrical' : 'Plumbing & gas'}</h3>
          <TileGrid>
            {SERVICES.filter((s) => s.group === g).map((s) => (
              <Tile
                key={s.kind}
                spec={{ cat: 'service', kind: s.kind }}
                icon={<b className="sym" style={{ background: s.color }}>{s.symbol}</b>}
                label={s.name}
                sub={`${s.mount === 'ceiling' ? 'ceiling' : `${s.defaultHeight} mm`}${count(s.kind) ? ` · ${count(s.kind)} placed` : ''}`}
              />
            ))}
          </TileGrid>
        </div>
      ))}
      <div className="group">
        <h3>Structure</h3>
        <TileGrid>
          <Tile spec={{ cat: 'column' }} icon="■" label="Column" sub="300 × 300" />
          <Tile spec={{ cat: 'beam' }} icon="═" label="Beam" sub="click 2 points" />
        </TileGrid>
      </div>
      {room && st && (
        <div className="group">
          <h3>
            Slabs, skirting &amp; ceiling <small>{room.name}</small>
          </h3>
          <div className="grid2">
            <LengthInput label="Floor slab" value={st.floorSlab} min={0} max={500} onChange={(v) => updateRoomStructure(room.id, { floorSlab: v })} />
            <LengthInput label="Ceiling slab" value={st.ceilingSlab} min={0} max={500} onChange={(v) => updateRoomStructure(room.id, { ceilingSlab: v })} />
            <LengthInput label="Skirting height" value={st.skirtingHeight} min={0} max={300} onChange={(v) => updateRoomStructure(room.id, { skirtingHeight: v })} />
            <LengthInput label="Skirting thickness" value={st.skirtingThickness} min={1} max={40} onChange={(v) => updateRoomStructure(room.id, { skirtingThickness: v })} />
          </div>
          <label className="check">
            <input type="checkbox" checked={st.dropCeiling !== null} onChange={(e) => updateRoomStructure(room.id, { dropCeiling: e.target.checked ? (room.walls[0]?.height ?? 3000) - 300 : null })} /> Drop (false) ceiling
          </label>
          {st.dropCeiling !== null && <LengthInput label="Drop ceiling height from floor" value={st.dropCeiling} min={1800} max={6000} onChange={(v) => updateRoomStructure(room.id, { dropCeiling: v })} />}
          <p className="hint">Ceilings show in the 3D walkthrough, or turn on the "Ceiling" layer.</p>
        </div>
      )}
    </div>
  );
}
