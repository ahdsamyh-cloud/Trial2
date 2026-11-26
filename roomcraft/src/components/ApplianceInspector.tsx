import { useProject } from '../store/projectStore';
import { useUI } from '../store/uiStore';
import { deleteSelection, rotateSelection, updateAppliance } from '../store/actions';
import { LengthInput } from './LengthInput';
import { applianceDef } from '../model/appliances';

export function ApplianceInspector() {
  const selection = useUI((s) => s.selection);
  const project = useProject((s) => s.project);
  const a = selection?.kind === 'appliance' ? project.appliances.find((x) => x.id === selection.id) : undefined;
  if (!a) return null;
  const def = applianceDef(a.type);
  return (
    <div className="group inspector">
      <h3>
        Selected appliance <small>{def?.name}</small>
      </h3>
      <label className="field">
        <span>Name</span>
        <input key={a.id} defaultValue={a.name} onBlur={(e) => e.target.value.trim() && updateAppliance(a.id, { name: e.target.value.trim() })} onKeyDown={(e) => e.stopPropagation()} />
      </label>
      <div className="grid2">
        <LengthInput label="Width" value={a.width} min={50} max={3000} onChange={(v) => updateAppliance(a.id, { width: v })} />
        <LengthInput label="Height" value={a.height} min={20} max={2500} onChange={(v) => updateAppliance(a.id, { height: v })} />
        <LengthInput label="Depth" value={a.depth} min={20} max={1200} onChange={(v) => updateAppliance(a.id, { depth: v })} />
        <LengthInput label="From floor" value={a.elevation} min={0} max={3000} onChange={(v) => updateAppliance(a.id, { elevation: v })} />
      </div>
      {def?.cutout && (
        <p className="hint">
          Makes a {def.cutout.width} × {def.cutout.depth} mm cut-out in the countertop{def.cutout.kind === 'sink' ? ' and removes shelves in the cabinet below' : ''}.
        </p>
      )}
      {def?.needsSpace && <p className="hint">Drop it onto a tall or base unit: doors and shelves in its zone are replaced by an opening and a support shelf.</p>}
      <div className="row">
        <button className="btn small" onClick={() => rotateSelection(90)}>
          ⟳ Rotate
        </button>
        <button className="btn small danger" onClick={deleteSelection}>
          Delete
        </button>
      </div>
    </div>
  );
}
