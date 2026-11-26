import { useMemo } from 'react';
import { useProject } from '../store/projectStore';
import { usePrefs, useUI } from '../store/uiStore';
import { useCountertop } from '../store/derived';
import { elevationFor } from '../model/elevation';
import { formatLength } from '../model/units';

/** Front elevation of one wall with furniture, openings, services and dimension chains. */
export function ElevationView() {
  const project = useProject((s) => s.project);
  const wallId = useUI((s) => s.elevationWallId);
  const selection = useUI((s) => s.selection);
  const setUI = useUI((s) => s.set);
  const units = usePrefs((s) => s.units);
  const pieces = useCountertop();
  const walls = project.rooms.flatMap((r) => r.walls.map((w, i) => ({ id: w.id, label: `${r.name} — wall ${i + 1}` })));
  const current = wallId && walls.some((w) => w.id === wallId) ? wallId : selection?.kind === 'wall' ? selection.wallId : walls[0]?.id;
  const e = useMemo(() => (current ? elevationFor(project, current, pieces) : null), [project, current, pieces]);

  if (!e) return <div className="elev-empty">Draw a room first — then pick a wall to see its elevation.</div>;
  const pad = 420;
  const H = e.height;
  const W = e.length;
  const fs = Math.max(55, Math.min(110, W / 45));
  const flipZ = (z: number) => H - z;
  const dimY = H + 140;

  return (
    <div className="elevation">
      <div className="elev-bar">
        <select value={current} onChange={(ev) => setUI({ elevationWallId: ev.target.value })} aria-label="Wall">
          {walls.map((w) => (
            <option key={w.id} value={w.id}>
              {w.label}
            </option>
          ))}
        </select>
        <span className="muted">Elevation seen from inside the room</span>
      </div>
      <svg viewBox={`${-pad} ${-pad / 2} ${W + pad * 1.6} ${H + pad * 1.4}`} className="elev-svg">
        <rect x={0} y={0} width={W} height={H} className="elev-wall" />
        {e.rects.map((r, i) => (
          <rect
            key={i}
            x={r.x0}
            y={flipZ(r.z1)}
            width={Math.max(1, r.x1 - r.x0)}
            height={Math.max(1, r.z1 - r.z0)}
            fill={r.fill}
            className={`elev-${r.kind}${r.dashed ? ' dashed' : ''}`}
            onClick={() => r.id && r.kind !== 'opening' && setUI({ selection: r.kind === 'appliance' ? { kind: 'appliance', id: r.id } : r.kind === 'beam' ? { kind: 'beam', id: r.id } : r.kind === 'column' ? { kind: 'column', id: r.id } : { kind: 'module', id: r.id, ids: [r.id] } })}
          >
            {r.label && <title>{r.label}</title>}
          </rect>
        ))}
        {e.handles.map((h, i) =>
          h.orient === 'h' ? (
            <line key={i} x1={h.x - h.len / 2} x2={h.x + h.len / 2} y1={flipZ(h.z)} y2={flipZ(h.z)} className="elev-handle" />
          ) : (
            <line key={i} x1={h.x} x2={h.x} y1={flipZ(h.z + h.len / 2)} y2={flipZ(h.z - h.len / 2)} className="elev-handle" />
          ),
        )}
        {e.services.map((s, i) => (
          <g key={i} transform={`translate(${s.x} ${flipZ(s.z)})`}>
            <circle r={45} fill={s.color} />
            <text fontSize={45} textAnchor="middle" dominantBaseline="central" fill="#fff" fontWeight="bold">
              {s.symbol}
            </text>
            <title>
              {s.name} at {formatLength(s.z, units)}
            </title>
          </g>
        ))}
        {/* horizontal chain */}
        <g className="dim">
          <line x1={0} x2={W} y1={dimY} y2={dimY} />
          {e.chain.map((x) => (
            <line key={x} x1={x} x2={x} y1={dimY - 40} y2={dimY + 40} />
          ))}
          {e.chain.slice(1).map((x, i) => {
            const x0 = e.chain[i];
            if (x - x0 < 60) return null;
            return (
              <text key={i} x={(x + x0) / 2} y={dimY - 30} fontSize={fs * 0.8} textAnchor="middle">
                {formatLength(x - x0, units, { suffix: false })}
              </text>
            );
          })}
          <line x1={0} x2={W} y1={dimY + 180} y2={dimY + 180} />
          <text x={W / 2} y={dimY + 160} fontSize={fs} textAnchor="middle" fontWeight="bold">
            {formatLength(W, units)}
          </text>
        </g>
        {/* vertical chain */}
        <g className="dim">
          <line x1={-140} x2={-140} y1={0} y2={H} />
          {e.heights.map((z) => (
            <line key={z} x1={-180} x2={-100} y1={flipZ(z)} y2={flipZ(z)} />
          ))}
          {e.heights.slice(1).map((z, i) => {
            const z0 = e.heights[i];
            if (z - z0 < 60) return null;
            return (
              <text key={i} x={-160} y={flipZ((z + z0) / 2)} fontSize={fs * 0.8} textAnchor="middle" transform={`rotate(-90 ${-160} ${flipZ((z + z0) / 2)})`}>
                {formatLength(z - z0, units, { suffix: false })}
              </text>
            );
          })}
        </g>
        <text x={0} y={-80} fontSize={fs * 1.2} fontWeight="bold" className="elev-title">
          {e.title}
        </text>
      </svg>
    </div>
  );
}
