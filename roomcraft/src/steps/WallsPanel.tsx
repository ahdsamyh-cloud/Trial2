import { useProject } from '../store/projectStore';
import { selRoomId, usePrefs, useUI } from '../store/uiStore';
import { setDefaults, updateAllWalls, updateWall } from '../store/actions';
import { LengthInput } from '../components/LengthInput';
import { SelectionInspector } from '../components/SelectionInspector';
import { wallLength } from '../model/room';
import { formatLength } from '../model/units';

export function WallsPanel() {
  const project = useProject((s) => s.project);
  const selection = useUI((s) => s.selection);
  const setUI = useUI((s) => s.set);
  const units = usePrefs((s) => s.units);
  const { defaultWallThickness: t, defaultWallHeight: h } = project.settings;
  const room = project.rooms.find((r) => r.id === selRoomId(selection)) ?? project.rooms[0];

  return (
    <div className="stack">
      <div className="group">
        <h3>Defaults for new walls</h3>
        <div className="grid2">
          <LengthInput label="Thickness" value={t} min={50} max={1000} onChange={(mm) => setDefaults({ defaultWallThickness: mm })} />
          <LengthInput label="Height" value={h} min={500} max={20000} onChange={(mm) => setDefaults({ defaultWallHeight: mm })} />
        </div>
        <button className="btn block" disabled={!project.rooms.length} onClick={() => updateAllWalls({ thickness: t, height: h })}>
          Apply to all existing walls
        </button>
      </div>

      <SelectionInspector />

      {room && (
        <div className="group">
          <h3>
            Walls of {room.name}
            {project.rooms.length > 1 && (
              <select
                className="inline-select"
                value={room.id}
                onChange={(e) => setUI({ selection: { kind: 'room', roomId: e.target.value } })}
              >
                {project.rooms.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            )}
          </h3>
          <table className="table">
            <thead>
              <tr>
                <th>#</th>
                <th>Length</th>
                <th>Thick.</th>
                <th>Height</th>
              </tr>
            </thead>
            <tbody>
              {room.walls.map((w, i) => (
                <tr
                  key={w.id}
                  className={selection?.kind === 'wall' && selection.wallId === w.id ? 'on' : ''}
                  onClick={() => setUI({ selection: { kind: 'wall', roomId: room.id, wallId: w.id } })}
                >
                  <td>{i + 1}</td>
                  <td>{formatLength(wallLength(room, i), units)}</td>
                  <td>
                    <LengthInput value={w.thickness} min={50} max={1000} onChange={(mm) => updateWall(room.id, w.id, { thickness: mm })} />
                  </td>
                  <td>
                    <LengthInput value={w.height} min={500} max={20000} onChange={(mm) => updateWall(room.id, w.id, { height: mm })} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <button className="btn block" onClick={() => updateAllWalls({ thickness: t, height: h }, room.id)}>
            Reset this room to defaults
          </button>
        </div>
      )}
      <p className="hint">Doors, windows, columns and beams are in the next step (Services &amp; structure).</p>
    </div>
  );
}
