import type { NestSheet } from '../model/nesting';

const COLORS = ['#e8c58f', '#a9d3c4', '#c6b8e6', '#f2b4a5', '#b5cde8', '#e6d49a', '#c9e2a6', '#e8b8d4'];

/** SVG drawing of one nested sheet; part colours group by label prefix (module). */
export function SheetDiagram<T>({ sheet, w, h, title, grain, colorKey }: { sheet: NestSheet<T>; w: number; h: number; title: string; grain?: boolean; colorKey?: (label: string) => string }) {
  const keys = new Map<string, string>();
  const colour = (label: string) => {
    const k = colorKey ? colorKey(label) : label.split(':')[0];
    if (!keys.has(k)) keys.set(k, COLORS[keys.size % COLORS.length]);
    return keys.get(k)!;
  };
  return (
    <figure className="sheet">
      <figcaption>
        {title} <small>{((sheet.usedArea / (w * h)) * 100).toFixed(0)}% used</small>
      </figcaption>
      <svg viewBox={`-10 -10 ${w + 20} ${h + 20}`} role="img" aria-label={title}>
        <rect x={0} y={0} width={w} height={h} className="sheet-bg" />
        {grain &&
          Array.from({ length: Math.floor(h / 80) }, (_, i) => <line key={i} x1={0} x2={w} y1={(i + 0.5) * 80} y2={(i + 0.5) * 80} className="sheet-grain" />)}
        {sheet.placements.map((p, i) => {
          const fs = Math.max(18, Math.min(42, Math.min(p.w, p.h) / 5));
          const short = p.part.label.split(': ').pop() ?? '';
          return (
            <g key={i}>
              <rect x={p.x} y={p.y} width={p.w} height={p.h} fill={colour(p.part.label)} className="sheet-part" />
              {p.w > 120 && p.h > 60 && (
                <text x={p.x + p.w / 2} y={p.y + p.h / 2} fontSize={fs} textAnchor="middle" dominantBaseline="middle" className="sheet-text">
                  <tspan x={p.x + p.w / 2} dy={-fs * 0.6}>
                    {short.length > 22 ? short.slice(0, 21) + '…' : short}
                  </tspan>
                  <tspan x={p.x + p.w / 2} dy={fs * 1.2}>
                    {Math.round(p.rotated ? p.h : p.w)}×{Math.round(p.rotated ? p.w : p.h)}
                    {p.rotated ? ' ↻' : ''}
                  </tspan>
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </figure>
  );
}
