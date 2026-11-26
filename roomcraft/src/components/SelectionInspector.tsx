import { useProject } from '../store/projectStore';
import { selRoomId, usePrefs, useUI } from '../store/uiStore';
import {
  deleteCorner,
  deleteRoom,
  deleteSelection,
  renameRoom,
  setWallLengthAction,
  updateBeam,
  updateColumn,
  updateOpening,
  updateService,
  updateWall,
} from '../store/actions';
import { LengthInput } from './LengthInput';
import { angleDeg, dist, perimeter, polygonArea } from '../model/geometry';
import { wallLength } from '../model/room';
import { formatArea, formatLength } from '../model/units';
import { findWall } from '../model/structure';
import { SERVICES, serviceDef } from '../model/catalog';
import type { OpeningKind, ServiceKind } from '../model/types';
import { ModuleInspector } from './ModuleInspector';
import { ApplianceInspector } from './ApplianceInspector';

export function Seg<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="seg">
      {options.map((o) => (
        <button key={o.value} className={value === o.value ? 'on' : ''} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

function DeleteBtn({ label = 'Delete' }: { label?: string }) {
  return (
    <button className="btn danger" onClick={deleteSelection}>
      {label}
    </button>
  );
}

/** Properties of whatever is selected. */
export function SelectionInspector() {
  const selection = useUI((s) => s.selection);
  const setUI = useUI((s) => s.set);
  const project = useProject((s) => s.project);
  const units = usePrefs((s) => s.units);
  if (!selection) return null;

  if (selection.kind === 'module') return <ModuleInspector />;
  if (selection.kind === 'appliance') return <ApplianceInspector />;

  if (selection.kind === 'opening') {
    const o = project.openings.find((x) => x.id === selection.id);
    if (!o) return null;
    const f = findWall(project, o.wallId);
    return (
      <div className="group inspector">
        <h3>
          Selected {o.kind} <small>{f ? `${f.room.name} · wall ${f.index + 1}` : ''}</small>
        </h3>
        <Seg<OpeningKind>
          value={o.kind}
          options={[
            { value: 'door', label: 'Door' },
            { value: 'window', label: 'Window' },
            { value: 'opening', label: 'Opening' },
          ]}
          onChange={(k) => updateOpening(o.id, { kind: k, sill: k === 'window' ? 900 : 0, height: k === 'window' ? 1200 : 2100 })}
        />
        <div className="grid2">
          <LengthInput label="Width" value={o.width} min={300} max={f?.length ?? 6000} onChange={(v) => updateOpening(o.id, { width: v })} />
          <LengthInput label="Height" value={o.height} min={300} max={4000} onChange={(v) => updateOpening(o.id, { height: v })} />
          <LengthInput label="Sill height" value={o.sill} min={0} max={3000} onChange={(v) => updateOpening(o.id, { sill: v })} />
          <LengthInput label="From wall start" value={o.offset} min={0} max={(f?.length ?? 1e5) - o.width} onChange={(v) => updateOpening(o.id, { offset: v })} />
        </div>
        {o.kind === 'door' && (
          <>
            <span className="field-label">Hinge side (seen from inside)</span>
            <Seg value={o.hinge} options={[{ value: 'left', label: 'Left' }, { value: 'right', label: 'Right' }]} onChange={(v) => updateOpening(o.id, { hinge: v })} />
            <span className="field-label">Swing</span>
            <Seg value={o.swing} options={[{ value: 'in', label: 'Into room' }, { value: 'out', label: 'Outward' }]} onChange={(v) => updateOpening(o.id, { swing: v })} />
          </>
        )}
        <DeleteBtn />
      </div>
    );
  }

  if (selection.kind === 'service') {
    const s = project.services.find((x) => x.id === selection.id);
    if (!s) return null;
    const def = serviceDef(s.kind);
    return (
      <div className="group inspector">
        <h3>Selected {def.name.toLowerCase()}</h3>
        <label className="field">
          <span>Type</span>
          <select value={s.kind} onChange={(e) => updateService(s.id, { kind: e.target.value as ServiceKind })}>
            {SERVICES.map((d) => (
              <option key={d.kind} value={d.kind}>
                {d.name}
              </option>
            ))}
          </select>
        </label>
        <div className="grid2">
          <LengthInput label="Height from floor" value={s.height} min={0} max={5000} onChange={(v) => updateService(s.id, { height: v })} />
          {s.wallId && <LengthInput label="From wall start" value={s.offset} min={0} max={1e5} onChange={(v) => updateService(s.id, { offset: v })} />}
        </div>
        <label className="field">
          <span>Label / note</span>
          <input defaultValue={s.label ?? ''} key={s.id} onBlur={(e) => updateService(s.id, { label: e.target.value })} onKeyDown={(e) => e.stopPropagation()} placeholder="e.g. 16A for oven" />
        </label>
        <DeleteBtn />
      </div>
    );
  }

  if (selection.kind === 'beam') {
    const b = project.beams.find((x) => x.id === selection.id);
    if (!b) return null;
    return (
      <div className="group inspector">
        <h3>
          Selected beam <small>{formatLength(dist(b.a, b.b), units)} long</small>
        </h3>
        <div className="grid2">
          <LengthInput label="Width" value={b.width} min={100} max={1000} onChange={(v) => updateBeam(b.id, { width: v })} />
          <LengthInput label="Depth" value={b.depth} min={100} max={1500} onChange={(v) => updateBeam(b.id, { depth: v })} />
          <LengthInput label="Underside from floor" value={b.bottom} min={1000} max={6000} onChange={(v) => updateBeam(b.id, { bottom: v })} />
        </div>
        <DeleteBtn />
      </div>
    );
  }

  if (selection.kind === 'column') {
    const c = project.columns.find((x) => x.id === selection.id);
    if (!c) return null;
    return (
      <div className="group inspector">
        <h3>Selected column</h3>
        <div className="grid2">
          <LengthInput label="Width" value={c.width} min={100} max={2000} onChange={(v) => updateColumn(c.id, { width: v })} />
          <LengthInput label="Depth" value={c.depth} min={100} max={2000} onChange={(v) => updateColumn(c.id, { depth: v })} />
          <LengthInput label="Height" value={c.height} min={500} max={8000} onChange={(v) => updateColumn(c.id, { height: v })} />
          <label className="field">
            <span>Rotation °</span>
            <input type="number" value={Math.round(c.rotation)} onChange={(e) => updateColumn(c.id, { rotation: Number(e.target.value) || 0 })} onKeyDown={(e) => e.stopPropagation()} />
          </label>
        </div>
        <DeleteBtn />
      </div>
    );
  }

  const room = project.rooms.find((r) => r.id === selRoomId(selection));
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
        <button className="btn" onClick={() => setUI({ view: 'elev', elevationWallId: wall.id })}>
          Show wall elevation
        </button>
        <p className="hint">Double-click (or double-tap) the wall on the plan to add a corner.</p>
      </div>
    );
  }

  if (selection.kind !== 'corner') return null;
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
