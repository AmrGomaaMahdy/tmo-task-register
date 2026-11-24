import type { BoardSummary } from '../api/types';
import { fmtDate } from '../lib/format';
import { STATUS_LABEL } from '../lib/fields';
import { Page, pct, ReportHead, RunningHead, STAGES, type Stamp } from './common';

const WHY: Record<BoardSummary['attention'][number]['why'], string> = {
  waiting_tmo: 'Waiting for the TMO',
  waiting_leader: 'Waiting for the leader',
  plan_not_ok: 'In the plan, check not OK',
  past_finish: 'In the plan, past its finish',
};

/** The board summary: two A4 pages with the headline figures, what needs attention and every work group. */
export default function BoardSummaryReport({ r, stamp }: { r: BoardSummary; stamp: Stamp }) {
  const t = r.totals;
  const okPct = pct(t.ok, t.tasks);
  const reach = t.by_status.leader_approved + t.by_status.in_master_plan;
  return (
    <>
    {/* Page 1: the headline, the figures and what needs attention */}
    <Page stamp={stamp} n={1} of={2}>
      <ReportHead title="Board summary" stamp={stamp} />

      <p className="rp-lead">
        {`${t.tasks} tasks from ${t.groups} work groups. ${r.plan.included} in the Master Plan, ${r.plan.waiting_tmo} waiting for the TMO.`}
      </p>

      <div className="rp-kpis">
        <div><span className="rp-k-v">{t.tasks}</span><span className="rp-k-l">Tasks</span></div>
        <div><span className="rp-k-v">{r.plan.included}</span><span className="rp-k-l">In the Master Plan</span></div>
        <div><span className="rp-k-v">{reach}</span><span className="rp-k-l">Approved by leaders</span></div>
        <div><span className="rp-k-v">{`${okPct}%`}</span><span className="rp-k-l">Check OK</span></div>
        <div><span className="rp-k-v">{`${r.plan.progress}%`}</span><span className="rp-k-l">Planned progress</span></div>
        <div><span className="rp-k-v rp-k-d">{r.plan.last_finish ? fmtDate(r.plan.last_finish) : '–'}</span><span className="rp-k-l">Planned finish</span></div>
      </div>

      <h3 className="rp-h">Readiness of the registers</h3>
      <div className="rp-stack" role="img" aria-label="Tasks by readiness stage">
        {STAGES.map((s) => t.by_status[s] > 0 && (
          <span key={s} className={`rp-seg st-${s}`} style={{ flexGrow: t.by_status[s] }}>{t.by_status[s]}</span>
        ))}
      </div>
      <div className="rp-legend">
        {STAGES.map((s) => (
          <span key={s}><i className={`st-${s}`} />{STATUS_LABEL[s]}<b>{t.by_status[s]}</b></span>
        ))}
      </div>

      <div className="rp-two">
        <div className="rp-box">
          <h3 className="rp-h">Master Plan</h3>
          <div className="rp-meter"><span className="rp-meter-l">Planned progress</span><span className="rp-meter-bar"><i style={{ width: `${r.plan.progress}%` }} /></span><b>{`${r.plan.progress}%`}</b></div>
          <dl className="rp-dl">
            <div><dt>Running now</dt><dd>{r.plan.running}</dd></div>
            <div><dt>Activities planned</dt><dd>{r.plan.activities}</dd></div>
            <div><dt>Plan window</dt><dd>{r.plan.first_start ? `${fmtDate(r.plan.first_start)} → ${fmtDate(r.plan.last_finish)}` : '–'}</dd></div>
            <div><dt>Waiting for the TMO</dt><dd>{r.plan.waiting_tmo}</dd></div>
          </dl>
        </div>
        <div className="rp-box">
          <h3 className="rp-h">Links with other groups</h3>
          {(['approved', 'pending', 'rejected'] as const).map((k) => (
            <div key={k} className={`rp-meter rp-${k}`}>
              <span className="rp-meter-l">{k === 'approved' ? 'Agreed' : k === 'pending' ? 'Waiting for review' : 'Rejected'}</span>
              <span className="rp-meter-bar"><i style={{ width: `${pct(r.links[k], r.links.total)}%` }} /></span>
              <b>{r.links[k]}</b>
            </div>
          ))}
          <p className="rp-note">{`${r.links.total} links recorded between work groups.`}</p>
        </div>
      </div>

      <h3 className="rp-h">Needs attention</h3>
      {r.attention.length ? (
        <table className="rp-tab">
          <thead><tr><th>Task</th><th>Group</th><th>Why</th><th className="r">Days</th></tr></thead>
          <tbody>
            {r.attention.slice(0, 7).map((a) => (
              <tr key={`${a.why}-${a.id}`}>
                <td><span className="rp-code" data-notr>{a.code}</span> {a.title}</td>
                <td>{a.group}</td>
                <td><span className={`rp-why rp-${a.why}`}>{WHY[a.why]}</span></td>
                <td className="r">{a.days ?? '–'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : <p className="rp-note">Nothing needs attention: no task waits, and every included task is on track.</p>}
      {r.attention_total > 7 && <p className="rp-note">{`And ${r.attention_total - 7} more in the application.`}</p>}
    </Page>

    {/* Page 2: every work group, and what finishes next */}
    <Page stamp={stamp} n={2} of={2}>
      <RunningHead title="Board summary" stamp={stamp} />
      <h3 className="rp-h rp-h1">By work group</h3>
      <table className="rp-tab rp-groups">
        <thead><tr><th>Work group</th><th>Leader</th><th className="r">Tasks</th><th>Readiness</th><th className="r">Approved</th><th className="r">Not OK</th><th className="r">Progress</th></tr></thead>
        <tbody>
          {r.groups.map((g) => (
            <tr key={g.code}>
              <td><span className="rp-code" data-notr>{g.code}</span> {g.name}</td>
              <td>{g.leader || '–'}</td>
              <td className="r">{g.total}</td>
              <td>
                <span className="rp-mini">
                  {g.total ? STAGES.map((s) => g.by_status[s] > 0 && <i key={s} className={`st-${s}`} style={{ flexGrow: g.by_status[s] }} />) : <em>–</em>}
                </span>
              </td>
              <td className="r">{`${g.ready_pct}%`}</td>
              <td className={`r ${g.not_ok ? 'rp-bad' : ''}`}>{g.not_ok}</td>
              <td className="r">{`${g.progress}%`}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="rp-note">Approved: the share of the group&apos;s tasks its leader approved or the TMO included. Progress: the planned work of its Master Plan tasks due by today.</p>

      <h3 className="rp-h">Finishing in the next 30 days</h3>
      {r.upcoming.length ? (
        <table className="rp-tab">
          <thead><tr><th>Date</th><th>Task or activity</th></tr></thead>
          <tbody>
            {r.upcoming.slice(0, 8).map((u, i) => (
              <tr key={i}><td className="nowrap">{fmtDate(u.date)}</td><td><span className="rp-code" data-notr>{u.code}</span> {u.title}</td></tr>
            ))}
          </tbody>
        </table>
      ) : <p className="rp-note">Nothing in the Master Plan finishes in the next 30 days.</p>}
      {r.upcoming_total > 8 && <p className="rp-note">{`And ${r.upcoming_total - 8} more in the application.`}</p>}

      <div className="rp-sign">
        <div><span>Reviewed by</span><i /></div>
        <div><span>Date</span><i /></div>
      </div>
    </Page>
    </>
  );
}
