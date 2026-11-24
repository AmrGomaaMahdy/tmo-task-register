import { useEffect, useRef } from 'react';

import { parseDate, monthLabel, todayIso } from '../lib/format';

export interface GanttRow {
  id: number | string;
  label: string;
  sub?: string;
  start: string | null;
  finish: string | null;
  tone: string;
  milestones?: { name: string; date: string | null }[];
  group?: string;
  /** Tooltip of the bar: dates, working days and anything useful about the row. */
  tip?: string;
  onClick?: () => void;
}

/**
 * A simple month-scaled Gantt: one bar per row and a red line for today. Positions use the inline
 * start, so in Arabic the timeline starts on the right and runs leftwards.
 */
export default function Gantt({ rows }: { rows: GanttRow[] }) {
  const dated = rows.filter((r) => r.start && r.finish);
  if (!dated.length) return <div className="empty">No dated tasks to show.</div>;
  return <Timeline rows={rows} dated={dated} />;
}

function Timeline({ rows, dated }: { rows: GanttRow[]; dated: GanttRow[] }) {
  const wrap = useRef<HTMLDivElement>(null);
  const min = new Date(Math.min(...dated.map((r) => parseDate(r.start as string).getTime())));
  const max = new Date(Math.max(...dated.map((r) => parseDate(r.finish as string).getTime())));
  const start = new Date(min.getFullYear(), min.getMonth(), 1);
  const end = new Date(max.getFullYear(), max.getMonth() + 1, 0);
  const days = (end.getTime() - start.getTime()) / 864e5;
  const width = Math.max(900, Math.round(days * 2.4));
  const x = (s: string) => Math.max(0, Math.min(width, ((parseDate(s).getTime() - start.getTime()) / 864e5 / days) * width));
  const months: Date[] = [];
  for (const d = new Date(start); d <= end; d.setMonth(d.getMonth() + 1)) months.push(new Date(d));
  const today = todayIso();
  const tx = x(today);
  let lastGroup: string | undefined;

  // Open the timeline a little before today. In right-to-left pages the scroll runs negative.
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    // Only when today is well into the plan: otherwise the start of the plan stays in view.
    const sx = tx > 400 ? tx - 160 : 0;
    el.scrollLeft = getComputedStyle(el).direction === 'rtl' ? -sx : sx;
  }, [tx]);

  return (
    <div className="gantt-wrap" ref={wrap}>
      <div className="gantt" style={{ width: width + 280 }}>
        <div className="g-row g-hd">
          <div className="g-lab">Task</div>
          <div className="g-trk" style={{ width, height: 32 }}>
            {months.map((m) => (
              <span key={m.toISOString()} className="g-month" style={{ insetInlineStart: x(m.toISOString().slice(0, 10)) }}>{monthLabel(m)}</span>
            ))}
            {tx > 0 && tx < width && <span className="g-today" style={{ insetInlineStart: tx }} />}
          </div>
        </div>
        {rows.map((r, index) => {
          const header = r.group && r.group !== lastGroup ? r.group : null;
          lastGroup = r.group;
          return (
            <div key={r.id}>
              {header && <div className="g-grp">{header}</div>}
              <div className="g-row">
                <button type="button" className="g-lab" onClick={r.onClick}>
                  <span className="mono acc">{r.label}</span> <span className="nm">{r.sub}</span>
                </button>
                <div className="g-trk" style={{ width }}>
                  {r.start && r.finish ? (
                    <span className="g-bar" onClick={r.onClick} data-tip={r.tip ?? `${r.label}: ${r.start} → ${r.finish}`}
                      style={{ insetInlineStart: x(r.start), width: Math.max(4, x(r.finish) - x(r.start)), background: r.tone, ['--i' as string]: index }} />
                  ) : (
                    <span className="g-none">Planned dates not set</span>
                  )}
                  {(r.milestones ?? []).filter((m) => m.date).map((m) => (
                    <span key={m.name} className={`g-ms ${(m.date as string) < today ? 'done' : ''}`} style={{ insetInlineStart: x(m.date as string) }} title={`${m.name} · ${m.date}`} />
                  ))}
                  {tx > 0 && tx < width && <span className="g-today" style={{ insetInlineStart: tx }} />}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
