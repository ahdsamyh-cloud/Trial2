import { useProject } from '../store/projectStore';
import { usePrefs, useUI } from '../store/uiStore';
import { deleteCorner, deleteRoom, renameRoom, setWallLengthAction, updateWall } from '../store/actions';
import { LengthInput } from './LengthInput';
import { angleDeg, perimeter, polygonArea } from '../model/geometry';
import { wallLength } from '../model/room';
import { formatArea, formatLength } from '../model/units';

/** Properties of whatever is selected (room / wall / corner). */
export function SelectionInspector() {
  const selection = useUI((s) => s.selection);
  const setUI = useUI((s) => s.set);
  const rooms = useProject((s) => s.project.rooms);
  const units = usePrefs((s) => s.units);
  if (!selection) return null;
  const room = rooms.find((r) => r.id === selection.roomId);
  if (!room) return null;

  if (selection.kind === 'room') {
    return (
      <div className="group inspector">
        <h3>Selected room</h3>
        <label className="field">
          <span>Name</span>
          <input
            key={room.id}
            defaultValue={room.name}
            onBlur={(e) => e.target.value.trim() && e.target.value !== room.name && renameRoom(room.id, e.target.value.trim())}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              e.stopPropagation();
            }}
          />
        </label>
        <dl className="stats">
          <dt>Floor area</dt>
          <dd>{formatArea(polygonArea(room.points), units)}</dd>
          <dt>Perimeter</dt>
          <dd>{formatLength(perimeter(room.points), units)}</dd>
          <dt>Walls</dt>
          <dd>{room.points.length}</dd>
        </dl>
        <div className="row">
          <button className="btn" onClick={() => setUI({ step: 'walls' })}>
            Edit walls
          </button>
          <button className="btn danger" onClick={() => deleteRoom(room.id)}>
            Delete room
          </button>
        </div>
      </div>
    );
  }

  if (selection.kind === 'wall') {
    const i = room.walls.findIndex((w) => w.id === selection.wallId);
    if (i < 0) return null;
    const wall = room.walls[i];
    const n = room.points.length;
    return (
      <div className="group inspector">
        <h3>
          Selected wall <small>{room.name} · wall {i + 1}</small>
        </h3>
        <div className="grid2">
          <LengthInput label="Length (inner)" value={wallLength(room, i)} onChange={(mm) => setWallLengthAction(room.id, i, mm)} />
          <LengthInput label="Thickness" value={wall.thickness} min={50} max={1000} onChange={(mm) => updateWall(room.id, wall.id, { thickness: mm })} />
          <LengthInput label="Height" value={wall.height} min={500} max={20000} onChange={(mm) => updateWall(room.id, wall.id, { height: mm })} />
          <label className="field">
            <span>Direction</span>
            <output>{Math.round(angleDeg(room.points[i], room.points[(i + 1) % n]))}°</output>
          </label>
        </div>
        <p className="hint">Double-click (or double-tap) the wall on the plan to add a corner.</p>
      </div>
    );
  }

  const p = room.points[selection.index];
  if (!p) return null;
  return (
    <div className="group inspector">
      <h3>
        Selected corner <small>{room.name}</small>
      </h3>
      <dl className="stats">
        <dt>Position</dt>
        <dd>
          {formatLength(p.x, units)}, {formatLength(p.y, units)}
        </dd>
      </dl>
      <button className="btn danger" onClick={() => deleteCorner(room.id, selection.index)}>
        Delete corner
      </button>
    </div>
  );
}
