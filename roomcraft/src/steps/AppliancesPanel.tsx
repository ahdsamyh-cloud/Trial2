import { useProject } from '../store/projectStore';
import { useUI } from '../store/uiStore';
import { SelectionInspector } from '../components/SelectionInspector';
import { Tile, TileGrid } from '../components/Library';
import { APPLIANCES } from '../model/appliances';

export function AppliancesPanel() {
  const apps = useProject((s) => s.project.appliances);
  const selection = useUI((s) => s.selection);
  const setUI = useUI((s) => s.set);
  return (
    <div className="stack">
      <SelectionInspector />
      {(['kitchen', 'other'] as const).map((c) => (
        <div className="group" key={c}>
          <h3>{c === 'kitchen' ? 'Kitchen appliances' : 'Other appliances'}</h3>
          <TileGrid>
            {APPLIANCES.filter((a) => a.category === c).map((a) => (
              <Tile key={a.id} spec={{ cat: 'appliance', type: a.id }} icon={a.icon} label={a.name} sub={`${a.width}×${a.height}×${a.depth}`} color={a.color === '#f5f6f7' || a.color.startsWith('#f') ? undefined : a.color} />
            ))}
          </TileGrid>
        </div>
      ))}
      <p className="hint">
        Sinks and hobs dropped on a base unit cut the countertop automatically. Ovens and microwaves dropped on a tall or base unit replace its doors/shelves with an opening and a support shelf.
      </p>
      <div className="group">
        <h3>Placed ({apps.length})</h3>
        <ul className="list">
          {apps.map((a) => (
            <li key={a.id}>
              <button className={selection?.kind === 'appliance' && selection.id === a.id ? 'on' : ''} onClick={() => setUI({ selection: { kind: 'appliance', id: a.id } })}>
                <span>{a.name}</span>
                <em>
                  {a.width}×{a.height}×{a.depth}
                </em>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
