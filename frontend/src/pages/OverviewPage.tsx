import { useRef } from 'react';
import { Link } from 'react-router-dom';

import { useSummary } from '../api/queries';
import type { Status, SummaryTask } from '../api/types';
import { BarChart, Donut, HBars, Legend } from '../components/charts';
import { useScope } from '../components/WorkGroupScope';
import { Num } from '../components/Drill';
import { Empty, ErrorText, Kpi, Loading, Pager, Panel, StatusPill, usePaging } from '../components/ui';
import { drillOf, problemWhy } from '../lib/drill';
import { STATUS_HINT, STATUS_LABEL } from '../lib/fields';
import { addDays, fmtDate, monthEnd, monthFull, monthLabel, monthsBetween, parseDate, todayIso } from '../lib/format';
import { useEntrance } from '../lib/motion';
import { useRefs } from '../lib/useRefs';

/** The four steps of the template's Read Me. */
const STEPS = [
  { to: '/register', title: 'Describe the task', text: 'Task, direction, main workstream and sub-objective.' },
  { to: '/links', title: 'Who it involves', text: 'Owner role and partners; agree the links with each group.' },
  { to: '/activities', title: 'Plan', text: 'Planned start and finish; activities of big tasks.' },
  { to: '/check', title: 'Data quality & readiness', text: 'Fix everything not OK, then submit it to the leader.' },
];
const ORDER: Status[] = ['draft', 'needs_completion', 'ready', 'leader_approved', 'in_master_plan'];

const ROLES = ['Direct', 'Enable', 'Support'];

export default function OverviewPage() {
  const { wg } = useScope();
  const refs = useRefs();
  const summary = useSummary(wg);
  const s = summary.data;
  const root = useRef<HTMLDivElement>(null);
  const dirPaging = usePaging(10);
  const nextPaging = usePaging(10);
  useEntrance(root, wg, !!s);

  if (summary.error) return <ErrorText error={summary.error} />;
  if (!s) return <Loading />;
  const maxDir = Math.max(1, ...s.by_direction.map((d) => d.count));
  const set = drillOf(s);
  const rows = s.drill.rows;
  const list = (title: string, picked: SummaryTask[], why?: (t: SummaryTask) => string) => ({ title, rows: picked.map((r) => ({ ...r, why: why?.(r) })) });
  const page = <T,>(items: T[], p: { page: number; size: number }) => items.slice((p.page - 1) * p.size, p.page * p.size);

  // Charts: readiness, check results, tasks per work group (or per type inside one group), finishes per month.
  const statusParts = ORDER.map((st) => ({ name: STATUS_LABEL[st], value: s.by_status[st] ?? 0, color: `var(--s-${st})`, drill: set(`status:${st}`, STATUS_LABEL[st], STATUS_HINT[st]) }));
  const ok = rows.filter((r) => r.check_summary.ok);
  const warn = ok.filter((r) => r.check_summary.warnings > 0);
  const bad = rows.filter((r) => !r.check_summary.ok);
  const checkParts = [
    { name: 'OK', value: ok.length - warn.length, color: 'var(--ok)', drill: list('Check OK', ok.filter((r) => !r.check_summary.warnings)) },
    { name: 'OK with warnings', value: warn.length, color: 'var(--warn)', drill: list('OK with warnings', warn) },
    { name: 'Not OK', value: bad.length, color: 'var(--bad)', drill: list('Not OK', bad, problemWhy) },
  ];
  const byKey = (key: (r: SummaryTask) => string, keys: string[]) => keys.map((k) => {
    const mine = rows.filter((r) => key(r) === k);
    return {
      key: k,
      label: wg ? k : <><b className="mono">{k}</b> {refs.groups.find((g) => g.code === k)?.name}</>,
      count: mine.length,
      drill: list(wg ? `${k} tasks` : `${k} – ${refs.groups.find((g) => g.code === k)?.name ?? ''}`, mine),
      parts: ORDER.map((st) => ({ value: mine.filter((r) => r.status === st).length, color: `var(--s-${st})`, tip: `${k} · ${STATUS_LABEL[st]}: ${mine.filter((r) => r.status === st).length}` })),
    };
  }).filter((r) => r.count);
  const groupRows = wg
    ? byKey((r) => r.owner_role || 'Not set', [...ROLES, 'Not set'])
    : byKey((r) => r.work_group_code, [...new Set(rows.map((r) => r.work_group_code))].sort());
  const today = todayIso();
  const months = monthsBetween(today, addDays(today, 330));
  const finishing = months.map((m) => rows.filter((r) => r.planned_finish && parseDate(r.planned_finish) >= m && parseDate(r.planned_finish) <= monthEnd(m)));
  const ROLE_COLOR: Record<string, string> = { Direct: 'var(--c1)', Enable: 'var(--c3)', Support: 'var(--c5)' };
  const finishSeries = ROLES.map((role) => ({ name: role, color: ROLE_COLOR[role], values: finishing.map((f) => f.filter((r) => r.owner_role === role).length) }));

  return (
    <div className="stack" ref={root}>
      <div className="walk">
        {STEPS.map((step, i) => (
          <Link key={step.title} to={step.to} className="step">
            <span className="no">{`Step ${i + 1}`}</span>
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
        <Kpi label="Not OK" value={s.not_ok} sub="Open the Data quality check to fix them" tip="Tasks whose check found at least one problem, including their partners, contributions and activities." drill={set('not_ok', 'Not OK', undefined, problemWhy)} />
        <Kpi label="Partner rows" value={s.partner_rows} sub={`${s.partner_rows_not_complete} not complete`} tip="One row per partner group named on a task (up to twenty per task): what we need from them, when, and their task number."
          drill={set('shared_with_partners', 'Tasks shared with partner groups', undefined, (t) => `Partners ${t.partner_codes.join(', ')}`)} />
        <Kpi label="Contributions" value={s.contributions} sub={`${s.contributions_not_complete} not complete`} tip="Up to twenty per task with owner role Enable or Support: what it delivers to other groups." drill={set('contributions', 'Contributions')} />
        <Kpi label="Linked to a sub-objective" value={s.with_sub_objective} sub={`of ${s.total} tasks`} tip="Tasks that deliver an existing sub-objective. Linking is optional." drill={set('with_sub_objective', 'Linked to a sub-objective')} />
        <Kpi label="Activities" value={s.activities} sub={`${s.with_activities} tasks with activities`} tip="Activities in the detailed plans of big tasks." drill={set('with_activities', 'Tasks with activities', undefined, (t) => `${t.activity_count} activities`)} />
      </div>

      <Panel title="Readiness" tip="Each task moves from Draft to Ready to include (submitted by the Focal Point), then Leader Approved (by the work group leader), then In Master Plan (by the TMO)." actions={<span className="dim small">Click a number to see its tasks</span>}>
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

      <div className="grid g2">
        <Panel title="Tasks by readiness" tip="Where the tasks stand: prepared by the Focal Point, submitted to the leader, approved by the leader, included by the TMO. Click a part to see its tasks.">
          <Donut parts={statusParts} center={s.total} sub="tasks" />
        </Panel>
        <Panel title="Check results" tip="The automatic check of every task: OK, OK with warnings to look at, or Not OK (something to fix). Click a part to see its tasks.">
          <Donut parts={checkParts} center={`${s.total ? Math.round((ok.length / s.total) * 100) : 0}%`} sub="OK" />
        </Panel>
        <Panel title={wg ? 'Tasks by type' : 'Tasks by work group'} tip={wg ? 'Direct, Enable and Support tasks of the group, by readiness. Click a number to see the tasks.' : 'Tasks of each work group, by readiness. Click a number to see the tasks.'}>
          <HBars rows={groupRows} empty="No tasks yet." />
          <Legend items={ORDER.map((st) => ({ name: STATUS_LABEL[st], color: `var(--s-${st})` }))} />
        </Panel>
        <Panel title="Planned finishes per month" tip="Tasks by planned finish month over the next eleven months, by type. The current month is marked. Click a bar to see the tasks.">
          <BarChart
            labels={months.map(monthLabel)}
            series={finishSeries}
            unit="tasks"
            todayIndex={0}
            fullLabel={(i) => monthFull(months[i])}
            names={(i, si) => finishing[i].filter((r) => r.owner_role === ROLES[si]).map((r) => r.code)}
            drill={(i, si) => list(`${ROLES[si]} · ${monthFull(months[i])}`, finishing[i].filter((r) => r.owner_role === ROLES[si]))}
          />
        </Panel>
      </div>

      <div className="grid g-ov">
        <Panel title="Coverage by direction" tip="Tasks per direction. A direction with no task is a gap to close." actions={<span className="dim small">{s.by_direction.filter((d) => d.count === 0).length} gaps</span>}>
          {s.by_direction.length ? (
            <div className="hbars">
              {page(s.by_direction, dirPaging).map((d) => (
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
          {s.by_direction.length > 10 && <Pager count={s.by_direction.length} page={dirPaging.page} size={dirPaging.size} onPage={dirPaging.setPage} onSize={dirPaging.setSize} />}
        </Panel>
        <Panel title="Coming up" tip="Task starts and finishes, and activities due to finish, in the next 60 days.">
          {s.coming_up.length ? (
            <div className="list">
              {page(s.coming_up, nextPaging).map((m, i) => (
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
          {s.coming_up.length > 10 && <Pager count={s.coming_up.length} page={nextPaging.page} size={nextPaging.size} onPage={nextPaging.setPage} onSize={nextPaging.setSize} />}
        </Panel>
      </div>

    </div>
  );
}
