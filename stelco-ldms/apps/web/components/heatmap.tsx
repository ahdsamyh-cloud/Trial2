'use client';
import { t } from '@/lib/i18n';

/** Department × law compliance heat map (accessible: values are printed, colour is secondary). */
export function HeatMap({ cells }: { cells: { departmentId: string; department: string; lawId: string; law: string; score: number | null }[] }) {
  const depts = [...new Map(cells.map((c) => [c.departmentId, c.department])).entries()];
  const laws = [...new Map(cells.map((c) => [c.lawId, c.law])).entries()];
  if (!cells.length) return <p className="py-6 text-center text-sm text-slate-500">{t('No rated checks yet')}</p>;
  const tone = (s: number | null) => (s === null ? 'bg-slate-100 text-slate-500' : s >= 90 ? 'bg-green-200 text-green-900' : s >= 60 ? 'bg-amber-200 text-amber-900' : 'bg-red-200 text-red-900');
  return (
    <div className="overflow-x-auto">
      <table className="text-xs">
        <thead><tr><th className="px-2 py-1 text-left">{t('Department')}</th>{laws.map(([id, name]) => <th key={id} scope="col" className="max-w-[10rem] px-2 py-1 text-left font-medium">{name}</th>)}</tr></thead>
        <tbody>{depts.map(([did, dname]) => (
          <tr key={did}><th scope="row" className="px-2 py-1 text-left font-medium">{dname}</th>
            {laws.map(([lid]) => { const c = cells.find((x) => x.departmentId === did && x.lawId === lid); return <td key={lid} className={`px-2 py-1 text-center font-semibold ${tone(c?.score ?? null)}`}>{c?.score === undefined || c?.score === null ? '—' : `${c.score}%`}</td>; })}
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}
