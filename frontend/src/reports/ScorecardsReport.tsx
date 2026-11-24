import type { BoardSummary, DependenciesReport, MasterPlanRow, Status } from '../api/types';
import { fmtDate } from '../lib/format';
import { STATUS_LABEL } from '../lib/fields';
import { Page, ReportHead, STAGES, type Stamp } from './common';

const ORDER: Record<Status, number> = { in_master_plan: 0, leader_approved: 1, ready: 2, needs_completion: 3, draft: 4 };
const MAX_ROWS = 18;

/** One A4 page per work group: its figures, its links with other groups and its tasks. */
export default function ScorecardsReport({ summary, rows, deps, stamp }: {
  summary: BoardSummary;
  rows: MasterPlanRow[];
  deps: DependenciesReport;
  stamp: Stamp;
}) {
  const groups = summary.groups;
  const title = 'Work group scorecards';
  return (
    <>
      {groups.map((g, p) => {
        const tasks = rows
          .filter((r) => r.work_group_code === g.code)
          .sort((a, b) => ORDER[a.status] - ORDER[b.status] || (a.planned_finish ?? '9').localeCompare(b.planned_finish ?? '9'));
        const out = deps.matrix.filter((c) => c.from === g.code);
        const into = deps.matrix.filter((c) => c.to === g.code);
        const sum = (cs: typeof out, k: 'total' | 'approved' | 'pending' | 'rejected') => cs.reduce((n, c) => n + c[k], 0);
        const partners = [...new Set([...out.map((c) => c.to), ...into.map((c) => c.from)])].sort();
        const notOk = tasks.filter((r) => !r.check_summary.ok).length;
        return (
          <Page key={g.code} stamp={stamp} n={p + 1} of={groups.length} className="rp-card">
            <ReportHead title={title} stamp={stamp} sub={`${g.code} – ${g.name}`} />
            <div className="rp-sc-top">
              <div className="rp-sc-id">
                <span className="rp-sc-code" data-notr>{g.code}</span>
                <div>
                  <b>{g.name}</b>
                  <span className="rp-dim">{g.leader ? `Leader: ${g.leader}` : 'No leader yet'}</span>
                </div>
              </div>
              <div className="rp-strip rp-strip-sm">
                <div><b>{g.total}</b><span>Tasks</span></div>
                <div><b>{g.by_status.in_master_plan}</b><span>In the Master Plan</span></div>
                <div><b>{`${g.ready_pct}%`}</b><span>Approved</span></div>
                <div><b className={g.not_ok ? 'rp-bad' : ''}>{g.not_ok}</b><span>Not OK</span></div>
                <div><b>{`${g.progress}%`}</b><span>Planned progress</span></div>
              </div>
            </div>

            <h3 className="rp-h">Readiness</h3>
            {g.total ? (
              <div className="rp-stack">
                {STAGES.map((s) => g.by_status[s] > 0 && <span key={s} className={`rp-seg st-${s}`} style={{ flexGrow: g.by_status[s] }}>{g.by_status[s]}</span>)}
              </div>
            ) : <p className="rp-note">This group has no task yet.</p>}
            <div className="rp-legend">
              {STAGES.map((s) => <span key={s}><i className={`st-${s}`} />{STATUS_LABEL[s]}<b>{g.by_status[s]}</b></span>)}
            </div>

            <div className="rp-two">
              <div className="rp-box">
                <h3 className="rp-h">What we need from other groups</h3>
                <dl className="rp-dl">
                  <div><dt>Links</dt><dd>{sum(out, 'total')}</dd></div>
                  <div><dt>Agreed</dt><dd>{sum(out, 'approved')}</dd></div>
                  <div><dt>Waiting for review</dt><dd>{sum(out, 'pending')}</dd></div>
                  <div><dt>Rejected</dt><dd className={sum(out, 'rejected') ? 'rp-bad' : ''}>{sum(out, 'rejected')}</dd></div>
                </dl>
              </div>
              <div className="rp-box">
                <h3 className="rp-h">What other groups need from us</h3>
                <dl className="rp-dl">
                  <div><dt>Links</dt><dd>{sum(into, 'total')}</dd></div>
                  <div><dt>Agreed</dt><dd>{sum(into, 'approved')}</dd></div>
                  <div><dt>Waiting for review</dt><dd>{sum(into, 'pending')}</dd></div>
                  <div><dt>Rejected</dt><dd className={sum(into, 'rejected') ? 'rp-bad' : ''}>{sum(into, 'rejected')}</dd></div>
                </dl>
              </div>
            </div>
            <p className="rp-note">{partners.length ? `Works with: ${partners.join(', ')}` : 'No links with other groups yet.'}</p>

            <h3 className="rp-h">{`Tasks · ${tasks.length}`}</h3>
            {tasks.length ? (
              <table className="rp-tab">
                <thead><tr><th>Task</th><th>Stage</th><th>Check</th><th>Finish</th></tr></thead>
                <tbody>
                  {tasks.slice(0, MAX_ROWS).map((r) => (
                    <tr key={r.id}>
                      <td><span className="rp-code" data-notr>{r.code}</span> {r.title}</td>
                      <td className="nowrap"><span className={`rp-stage st-${r.status}`}><i />{STATUS_LABEL[r.status]}</span></td>
                      <td className="nowrap">{r.check_summary.ok ? <span className="rp-ok">✓ OK</span> : <span className="rp-bad">Not OK</span>}</td>
                      <td className="nowrap">{fmtDate(r.planned_finish) || '–'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : <p className="rp-note">This group has no task yet.</p>}
            {tasks.length > MAX_ROWS && <p className="rp-note">{`And ${tasks.length - MAX_ROWS} more in the application.`}</p>}
            {notOk > 0 && <p className="rp-note">{`${notOk} of the group's tasks need fixing before they can move on.`}</p>}
          </Page>
        );
      })}
    </>
  );
}
