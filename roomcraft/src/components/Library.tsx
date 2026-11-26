import type { ReactNode } from 'react';
import { startPlacing, useUI, type PlaceSpec } from '../store/uiStore';

/** Library tile: drag onto the plan (desktop) or tap to arm placement (touch). */
export function Tile({ spec, icon, label, sub, color }: { spec: PlaceSpec; icon: ReactNode; label: string; sub?: string; color?: string }) {
  const placing = useUI((s) => s.placing);
  const active = placing && JSON.stringify(placing) === JSON.stringify(spec);
  return (
    <button
      className={`tile${active ? ' on' : ''}`}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('application/x-roomcraft', JSON.stringify(spec));
        e.dataTransfer.effectAllowed = 'copy';
      }}
      onClick={() => startPlacing(spec)}
      title={`${label}${sub ? ` — ${sub}` : ''}. Drag onto the plan, or click then click on the plan.`}
    >
      <span className="tile-icon" style={color ? { color } : undefined}>
        {icon}
      </span>
      <span className="tile-label">{label}</span>
      {sub && <span className="tile-sub">{sub}</span>}
    </button>
  );
}

export function TileGrid({ children }: { children: ReactNode }) {
  return <div className="tiles">{children}</div>;
}
