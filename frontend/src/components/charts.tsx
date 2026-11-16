import type { ReactNode } from 'react';

import { useLang } from '../i18n/LanguageProvider';
import { Num, useDrill, type DrillSpec } from './Drill';

export interface Series {
  name: string;
  color: string;
  values: number[];
}

const plural = (n: number, unit: string) => (n === 1 ? unit.replace(/ies$/, 'y').replace(/s$/, '') : unit);

export function Legend({ items }: { items: { name: string; color: string }[] }) {
  return (
    <div className="legend">
      {items.map((s) => <span key={s.name}><i style={{ background: s.color }} />{s.name}</span>)}
    </div>
  );
}

/**
 * Stacked bars, one per label. Every segment has a tooltip (value, share of the bar, the items in it)
 * and, when `drill` is given, opens the list of tasks or activities behind it.
 */
export function BarChart({ labels, series, height = 210, unit = '', todayIndex = -1, fullLabel, names, drill }: {
  labels: string[];
  series: Series[];
  height?: number;
  unit?: string;
  todayIndex?: number;
  fullLabel?: (i: number) => string;
  names?: (i: number, s: number) => string[];
  drill?: (i: number, s: number) => DrillSpec | null;
}) {
  const open = useDrill();
  // Arabic reads right to left: the first label sits on the right and the value axis on the right.
  const rtl = useLang().lang === 'ar';
  const W = 640, L = 40, R = 8, T = 16, B = 26, ih = height - T - B, iw = W - L - R;
  const totals = labels.map((_, i) => series.reduce((n, s) => n + (s.values[i] ?? 0), 0));
  const top = Math.max(4, Math.ceil(Math.max(0, ...totals) / 4) * 4);
  const bw = iw / Math.max(1, labels.length), barW = Math.min(30, bw * 0.6);
  const y = (v: number) => T + ih - (v / top) * ih;
  const longest = Math.max(1, ...labels.map((l) => l.length));
  const step = Math.max(1, Math.ceil((labels.length * (longest * 6.2 + 10)) / iw));
  const X = (x: number) => (rtl ? W - x : x);
  const axisAnchor = rtl ? 'start' : 'end';
  return (
    <>
      <svg className="chart" viewBox={`0 0 ${W} ${height}`} role="img" aria-label="Bar chart">
        {[0, 1, 2, 3, 4].map((k) => (
          <g key={k}>
            <line x1={X(L)} x2={X(W - R)} y1={y((top * k) / 4)} y2={y((top * k) / 4)} stroke="var(--line2)" strokeDasharray={k ? '2 3' : undefined} />
            <text x={X(L - 6)} y={y((top * k) / 4) + 3.5} textAnchor={axisAnchor} className="ax">{Math.round((top * k) / 4)}</text>
          </g>
        ))}
        {labels.map((label, i) => {
          const cx = X(L + bw * i + bw / 2);
          let acc = 0;
          return (
            <g key={label + i}>
              {i === todayIndex && (
                <>
                  <rect x={cx - bw / 2} y={T} width={bw} height={ih} fill="var(--accent-soft)" opacity={0.7} />
                  <text x={cx} y={T - 4} textAnchor="middle" className="ax today-l">Today</text>
                </>
              )}
              {series.map((s, si) => {
                const v = s.values[i] ?? 0;
                if (!v) return null;
                const y0 = y(acc), y1 = y(acc + v);
                acc += v;
                const items = names?.(i, si) ?? [];
                const spec = drill?.(i, si) ?? null;
                const tip = [
                  fullLabel ? fullLabel(i) : label,
                  `${s.name}: ${v}${unit ? ` ${plural(v, unit)}` : ''}${totals[i] > v ? ` (${Math.round((v / totals[i]) * 100)}% of ${totals[i]})` : ''}`,
                  items.length ? items.slice(0, 6).join(', ') + (items.length > 6 ? ' …' : '') : '',
                  spec && spec.rows.length ? (spec.kind === 'activities' ? 'Click to see the activities' : 'Click to see the tasks') : '',
                ].filter(Boolean).join('\n');
                return (
                  <rect
                    key={s.name}
                    className={`bar ${spec ? 'can' : ''}`}
                    style={{ ['--i' as string]: i }}
                    x={cx - barW / 2}
                    y={y1}
                    width={barW}
                    height={Math.max(1, y0 - y1 - (acc > v ? 1.5 : 0))}
                    rx={3}
                    fill={s.color}
                    data-tip={tip}
                    onClick={spec && spec.rows.length ? () => open(spec) : undefined}
                  />
                );
              })}
              {totals[i] > 0 && labels.length <= 16 && (
                <text className="vl" style={{ ['--i' as string]: i }} x={cx} y={y(totals[i]) - 5} textAnchor="middle">{totals[i]}</text>
              )}
              {i % step === 0 && <text x={cx} y={height - 8} textAnchor="middle" className="ax">{label}</text>}
            </g>
          );
        })}
        <line x1={X(L)} x2={X(W - R)} y1={T + ih} y2={T + ih} stroke="var(--line)" />
      </svg>
      {series.length > 1 && <Legend items={series.map((s) => ({ name: s.name, color: s.color }))} />}
    </>
  );
}

export interface DonutPart {
  name: string;
  value: number;
  color: string;
  tip?: string;
  drill?: DrillSpec | null;
}

/** A ring of parts with the list beside it; segments and counts open their tasks. */
export function Donut({ parts, center, sub, unit = 'tasks' }: { parts: DonutPart[]; center: ReactNode; sub: string; unit?: string }) {
  const open = useDrill();
  const r = 52, C = 2 * Math.PI * r, total = parts.reduce((n, p) => n + p.value, 0) || 1;
  let offset = 0;
  return (
    <div className="donut">
      <svg viewBox="0 0 140 140" width="150" height="150" role="img" aria-label="Donut chart">
        <circle r={r} cx={70} cy={70} fill="none" stroke="var(--surface2)" strokeWidth={18} />
        {parts.filter((p) => p.value).map((p, i) => {
          const len = (p.value / total) * C;
          const el = (
            <circle
              key={p.name}
              className={`seg ${p.drill ? 'can' : ''}`}
              style={{ ['--i' as string]: i }}
              r={r} cx={70} cy={70} fill="none" stroke={p.color} strokeWidth={18}
              strokeDasharray={`${Math.max(0.5, len - 2)} ${C}`} strokeDashoffset={-offset}
              transform="rotate(-90 70 70)"
              data-tip={`${p.name}\n${p.value} ${plural(p.value, unit)} · ${Math.round((p.value / total) * 100)}%${p.drill ? '\nClick to see the tasks' : ''}`}
              onClick={p.drill ? () => open(p.drill as DrillSpec) : undefined}
            />
          );
          offset += len;
          return el;
        })}
        <text x={70} y={74} textAnchor="middle" className="dnum">{center}</text>
        <text x={70} y={92} textAnchor="middle" className="dsub">{sub}</text>
      </svg>
      <div className="list donut-list">
        {parts.map((p) => (
          <div key={p.name} className="li">
            <span className="pill" style={{ ['--c' as string]: p.color }} />
            <span>{p.name}</span>
            <span className="mono dim"><Num value={p.value} drill={p.drill} /> · {Math.round((p.value / total) * 100)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Two progress rings: outer = a reference (e.g. planned by today), inner = the value shown in the middle. */
export function Rings({ outer, inner, center, sub }: {
  outer: { value: number; color: string; tip: string };
  inner?: { value: number; color: string; tip: string };
  center: string;
  sub: string;
}) {
  const ring = (radius: number, v: { value: number; color: string; tip: string }, i: number) => {
    const C = 2 * Math.PI * radius;
    return (
      <g key={radius}>
        <circle cx={75} cy={75} r={radius} fill="none" stroke="var(--surface2)" strokeWidth={11} />
        <circle className="seg" style={{ ['--i' as string]: i }} cx={75} cy={75} r={radius} fill="none" stroke={v.color} strokeWidth={11} strokeLinecap="round"
          strokeDasharray={`${Math.max(0.1, (Math.min(100, v.value) / 100) * C)} ${C}`} transform="rotate(-90 75 75)" data-tip={v.tip} />
      </g>
    );
  };
  return (
    <svg className="rings" viewBox="0 0 150 150" width="150" height="150" role="img" aria-label="Progress rings">
      {ring(58, outer, 0)}
      {inner && ring(44, inner, 1)}
      <text x={75} y={80} textAnchor="middle" className="rv">{center}</text>
      <text x={75} y={97} textAnchor="middle" className="rs">{sub}</text>
    </svg>
  );
}

/** Horizontal bars: a label, a count that opens its rows, and a stacked track. */
export function HBars({ rows, empty }: {
  rows: { key: string; label: ReactNode; tip?: string; count: number; drill?: DrillSpec | null; width?: number; parts: { value: number; color: string; tip?: string }[] }[];
  empty?: ReactNode;
}) {
  if (!rows.length) return <div className="empty">{empty}</div>;
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <div className="hbars">
      {rows.map((r) => (
        <div key={r.key} className="hb">
          <span className="lab" data-tip={r.tip}>{r.label}</span>
          <span className="val"><Num value={r.count} drill={r.drill} /></span>
          <div className="trk" style={{ width: `${(r.width ?? r.count / max) * 100}%` }}>
            {r.parts.filter((p) => p.value).map((p, i) => (
              <span key={i} style={{ width: `${(p.value / Math.max(1, r.count)) * 100}%`, background: p.color }} data-tip={p.tip} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
