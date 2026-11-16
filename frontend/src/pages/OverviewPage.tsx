import { useRef } from 'react';
import { Link } from 'react-router-dom';

import { useAudit, useSummary } from '../api/queries';
import type { Status } from '../api/types';
import { useScope } from '../components/WorkGroupScope';
import { Num } from '../components/Drill';
import { Empty, ErrorText, Kpi, Loading, Panel, StatusPill } from '../components/ui';
import { drillOf, problemWhy } from '../lib/drill';
import { STATUS_HINT, STATUS_LABEL } from '../lib/fields';
import { fmtDate, fmtStamp } from '../lib/format';
import { useEntrance } from '../lib/motion';
import { useRefs } from '../lib/useRefs';

/** The four steps of the template's Read Me. */
const STEPS = [
  { to: '/register', title: 'Describe the task', text: 'Task, direction, main workstream and sub-objective.' },
  { to: '/links', title: 'Who it involves', text: 'Owner role and partners; agree the links with each group.' },
  { to: '/activities', title: 'Plan', text: 'Planned start and finish; activities of big tasks.' },
  { to: '/check', title: 'Readiness & check', text: 'Ready to include, then fix everything not OK.' },
];
const ORDER: Status[] = ['draft', 'needs_completion', 'ready', 'in_master_plan'];

export default function OverviewPage() {
  const { wg } = useScope();
  const refs = useRefs();
  const summary = useSummary(wg);
  const audit = useAudit({ page_size: 8 });
  const s = summary.data;
  const root = useRef<HTMLDivElement>(null);
  useEntrance(root, wg, !!s);

  if (summary.error) return <ErrorText error={summary.error} />;
  if (!s) return <Loading />;
  const maxDir = Math.max(1, ...s.by_direction.map((d) => d.count));
  const set = drillOf(s);

  return (
    <div className="stack" ref={root}>
      <div className="walk">
        {STEPS.map((step, i) => (
          <Link key={step.title} to={step.to} className="step">
            <span className="no">STEP {String(i + 1).padStart(2, '0')}</span>
            <span className="tt">{step.title}</span>
            <span className="dd">{step.text}</span>
          </Link>
        ))}
      </div>

      <div className="kpis">
        <Kpi label="Tasks we own" value={s.total} sub={wg ? refs.group(wg)?.name : 'All work groups'} tip="Tasks in the selected register." drill={set('total', 'Tasks we own')} />
        <Kpi label="Ready & OK" value={s.ready_ok} small={` / ${s.total}`} sub={`${s.ready_not_ok} marked Ready but not OK`} tip="Ready or included tasks whose check is OK. Only these can enter the Master Plan." drill={set('ready_ok', 'Ready & OK')} />
        <Kpi label="Needs completion" value={s.needs_completion + s.readiness_not_set} sub={`${s.needs_completion} needs completion · ${s.readiness_not_set} not set`} tip="Tasks that still need something before they can be Ready to include."
          drill={{ title: 'Needs completion', rows: [...set('needs_completion', '').rows, ...set('readiness_not_set', '').rows] }} />
        <Kpi label="Not OK" value={s.not_ok} sub="Open Check to fix them" tip="Tasks whose check found at least one problem, including their partners, contributions and activities." drill={set('not_ok', 'Not OK', undefined, problemWhy)} />
        <Kpi label="Partner rows" value={s.partner_rows} sub={`${s.partner_rows_not_complete} not complete`} tip="One row per partner group named on a task (up to five per task): what we need from them, when, and their task number."
          drill={set('shared_with_partners', 'Tasks shared with partner groups', undefined, (t) => `Partners ${t.partner_codes.join(', ')}`)} />
        <Kpi label="Contributions" value={s.contributions} sub={`${s.contributions_not_complete} not complete`} tip="Up to five per task with owner role Enable or Support: what it delivers to other groups." drill={set('contributions', 'Contributions')} />
        <Kpi label="Linked to a sub-objective" value={s.with_sub_objective} sub={`of ${s.total} tasks`} tip="Tasks that deliver an existing sub-objective. Linking is optional." drill={set('with_sub_objective', 'Linked to a sub-objective')} />
        <Kpi label="Activities" value={s.activities} sub={`${s.with_activities} tasks with activities`} tip="Activities in the detailed plans of big tasks." drill={set('with_activities', 'Tasks with activities', undefined, (t) => `${t.activity_count} activities`)} />
      </div>

      <Panel title="Readiness" tip="Each task moves from Draft to Ready to include; the TMO then includes it in the Master Plan." actions={<span className="dim small">Click a number to see its tasks</span>}>
        <div className="cycle">
          {ORDER.map((st) => (
            <div key={st} className={`stage st-${st}`} data-tip={STATUS_HINT[st]}>
              <span className="bar" />
              <span className="n"><Num value={s.by_status[st] ?? 0} drill={set(`status:${st}`, STATUS_LABEL[st], STATUS_HINT[st])} /></span>
              <span className="t">{STATUS_LABEL[st]}</span>
            </div>
          ))}
        </div>
      </Panel>

      <div className="grid g-ov">
        <Panel title="Coverage by direction" tip="Tasks per direction. A direction with no task is a gap to close.">
          {s.by_direction.length ? (
            <div className="hbars">
              {s.by_direction.map((d) => (
                <div key={d.id} className="hb">
                  <span className="lab" data-tip={d.title}><b>{d.code}</b>{d.title}</span>
                  <span className="val"><Num value={d.count} drill={set(`direction:${d.id}`, `${d.code} – ${d.title}`)} />{d.count === 0 && <span className="bad"> gap</span>}</span>
                  <div className="trk">
                    <span style={{ width: `${(d.count / maxDir) * 100}%`, background: 'var(--accent)' }} />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <Empty>No directions for this work group yet.</Empty>
          )}
        </Panel>
        <Panel title="Coming up" tip="Task starts and finishes, and activities due to finish, in the next 60 days.">
          {s.coming_up.length ? (
            <div className="list">
              {s.coming_up.map((m, i) => (
                <Link key={`${m.task_id}-${i}`} to={`/tasks/${m.task_id}`} className="li">
                  <span className="mono dim">{fmtDate(m.date)}</span>
                  <span>{m.what}<span className="sub mono">{m.code} · {m.title}</span></span>
                  <StatusPill status={m.status} />
                </Link>
              ))}
            </div>
          ) : (
            <Empty>Nothing starts or finishes in the next 60 days.</Empty>
          )}
        </Panel>
      </div>

      <Panel title="Recent changes" tip="The latest changes you are allowed to see.">
        {audit.data?.results.length ? (
          <div className="list">
            {audit.data.results.map((a) => (
              <div key={a.id} className="li">
                <span className="mono dim">{fmtStamp(a.created_at)}</span>
                <span>{a.summary}</span>
                <span className="dim">{a.actor}</span>
              </div>
            ))}
          </div>
        ) : (
          <Empty>No changes recorded yet.</Empty>
        )}
      </Panel>
    </div>
  );
}
