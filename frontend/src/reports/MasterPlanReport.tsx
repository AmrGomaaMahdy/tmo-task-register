import type { BoardSummary, MasterPlanRow } from '../api/types';
import { fmtDate, monthLabel, monthsBetween, parseDate, todayIso } from '../lib/format';
import { Page, paginate, ReportHead, RunningHead, type Stamp } from './common';

type Line = { kind: 'group'; code: string; name: string; count: number } | { kind: 'task'; row: MasterPlanRow };

/**
 * The Master Plan as a landscape timeline: every included task, by work group, with its planned dates drawn
 * across the months of the plan window, and today marked.
 */
export default function MasterPlanReport({ rows, summary, groupName, stamp }: {
  rows: MasterPlanRow[];
  summary: BoardSummary;
  groupName: (code: string) => string;
  stamp: Stamp;
}) {
  const included = rows
    .filter((r) => r.status === 'in_master_plan')
    .sort((a, b) => a.work_group_code.localeCompare(b.work_group_code) || (a.planned_start ?? '9').localeCompare(b.planned_start ?? '9'));
  const dated = included.filter((r) => r.planned_start && r.planned_finish);
  const first = dated.map((r) => r.planned_start as string).sort()[0];
  const last = dated.map((r) => r.planned_finish as string).sort().pop();
  const months = first && last ? monthsBetween(first, last) : [];
  const t0 = months.length ? months[0].getTime() : 0;
  const end = months.length ? new Date(months[months.length - 1].getFullYear(), months[months.length - 1].getMonth() + 1, 1).getTime() : 1;
  const at = (iso: string) => Math.max(0, Math.min(100, ((parseDate(iso).getTime() - t0) / (end - t0)) * 100));
  const today = todayIso();
  const todayAt = months.length && today >= (first as string) && today <= (last as string) ? at(today) : null;
  // Fewer month labels when the window is long, so they stay readable.
  const step = months.length > 18 ? 3 : months.length > 9 ? 2 : 1;

  const lines: Line[] = [];
  for (const code of [...new Set(included.map((r) => r.work_group_code))]) {
    const mine = included.filter((r) => r.work_group_code === code);
    lines.push({ kind: 'group', code, name: groupName(code), count: mine.length });
    mine.forEach((row) => lines.push({ kind: 'task', row }));
  }
  const pages = paginate(lines, 17, 22);
  const title = 'Master Plan timeline';

  const scale = (
    <div className="rp-tl-scale" dir="ltr">
      {months.map((m, i) => (
        <span key={i} style={{ left: `${at(`${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, '0')}-01`)}%` }}>{i % step === 0 ? monthLabel(m) : ''}</span>
      ))}
    </div>
  );

  return (
    <>
      {pages.map((chunk, p) => (
        <Page key={p} stamp={stamp} n={p + 1} of={pages.length} wide>
          {p === 0 ? (
            <>
              <ReportHead title={title} stamp={stamp} />
              <div className="rp-strip">
                <div><b>{included.length}</b><span>Tasks in the Master Plan</span></div>
                <div><b>{new Set(included.map((r) => r.work_group_code)).size}</b><span>Work groups</span></div>
                <div><b>{`${summary.plan.progress}%`}</b><span>Planned progress</span></div>
                <div><b>{summary.plan.running}</b><span>Running now</span></div>
                <div><b className="rp-k-d">{first ? `${fmtDate(first)} → ${fmtDate(last)}` : '–'}</b><span>Plan window</span></div>
              </div>
            </>
          ) : <RunningHead title={title} stamp={stamp} />}
          {included.length ? (
            <table className="rp-tab rp-tl">
              <colgroup><col className="rp-tl-c1" /><col className="rp-tl-c2" /><col className="rp-tl-c3" /><col className="rp-tl-c3" /><col className="rp-tl-c4" /><col /></colgroup>
              <thead><tr><th>Task</th><th>Direction</th><th>Start</th><th>Finish</th><th className="r">Days</th><th className="rp-tl-h">{scale}</th></tr></thead>
              <tbody>
                {chunk.map((l) => l.kind === 'group' ? (
                  <tr key={`g${l.code}`} className="rp-tl-g"><td colSpan={6}><span className="rp-code" data-notr>{l.code}</span> {l.name} <span className="rp-dim">{`· ${l.count} tasks`}</span></td></tr>
                ) : (
                  <tr key={l.row.id}>
                    <td><span className="rp-code" data-notr>{l.row.code}</span> <span className="rp-tl-t">{l.row.title}</span></td>
                    <td className="rp-dim">{l.row.direction_code ?? '–'}</td>
                    <td className="nowrap">{fmtDate(l.row.planned_start)}</td>
                    <td className="nowrap">{fmtDate(l.row.planned_finish)}</td>
                    <td className="r">{l.row.duration_days ?? ''}</td>
                    <td className="rp-tl-cell" dir="ltr">
                      {todayAt !== null && <i className="rp-tl-today" style={{ left: `${todayAt}%` }} />}
                      {l.row.planned_start && l.row.planned_finish && (
                        <span className={`rp-tl-bar ${l.row.planned_finish < today ? 'done' : l.row.planned_start <= today ? 'now' : ''}`}
                          style={{ left: `${at(l.row.planned_start)}%`, width: `${Math.max(1.2, at(l.row.planned_finish) - at(l.row.planned_start))}%` }} />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <p className="rp-note">No task is in the Master Plan yet.</p>}
          {p === pages.length - 1 && (
            <div className="rp-legend rp-tl-legend">
              <span><i className="rp-sw-done" />Planned to have finished</span>
              <span><i className="rp-sw-now" />Running now</span>
              <span><i className="rp-sw-next" />Still to start</span>
              {todayAt !== null && <span><i className="rp-sw-today" />Today</span>}
            </div>
          )}
        </Page>
      ))}
    </>
  );
}
