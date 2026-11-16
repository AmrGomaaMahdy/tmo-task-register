import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

import { useMasterPlan, useTransition } from '../api/queries';
import type { MasterPlanRow } from '../api/types';
import { BarChart, HBars, Legend, Rings } from '../components/charts';
import type { DrillTask } from '../components/Drill';
import PlanGantt from '../components/PlanGantt';
import { useScope } from '../components/WorkGroupScope';
import { CheckBadge, Empty, ErrorText, Kpi, Loading, Pager, Panel, StatusPill, usePaging } from '../components/ui';
import { ACTIVITY_STATES, activityState } from '../lib/activities';
import { addDays, fmtDate, monthEnd, monthFull, monthLabel, monthsBetween, parseDate, todayIso, workingDays } from '../lib/format';
import { useEntrance } from '../lib/motion';
import { useRefs } from '../lib/useRefs';

export default function MasterPlanPage() {
  const { wg } = useScope();
  const refs = useRefs();
  const plan = useMasterPlan(wg);
  const transition = useTransition();
  const paging = usePaging(20);
  const [mode, setMode] = useState<'table' | 'gantt'>('table');
  const [open, setOpen] = useState<Set<number>>(new Set());
  const [full, setFull] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const sched = useRef<HTMLDivElement>(null);
  useEntrance(root, wg, !!plan.data);
  useEntrance(sched, `${mode}-${full}`, !!plan.data);

  // Full screen = the schedule over the whole window; Esc goes back. The page behind does not scroll meanwhile.
  useEffect(() => {
    document.body.classList.toggle('mp-locked', full);
    if (!full) return () => document.body.classList.remove('mp-locked');
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setFull(false);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.classList.remove('mp-locked');
    };
  }, [full]);

  const { included, waiting, wbs } = useMemo(() => {
    const rows = plan.data ?? [];
    const inc = rows.filter((r) => r.status === 'in_master_plan');
    const dirIndex = (r: MasterPlanRow) => {
      const own = refs.directions.filter((d) => d.work_group === r.work_group);
      const i = own.findIndex((d) => d.id === r.direction);
      return i < 0 ? 99 : i + 1;
    };
    inc.sort((a, b) => a.work_group_code.localeCompare(b.work_group_code) || dirIndex(a) - dirIndex(b) || (a.planned_start ?? '').localeCompare(b.planned_start ?? ''));
    const counter = new Map<string, number>();
    const codes = new Map<number, string>();
    for (const r of inc) {
      const key = `${r.work_group_code}.${dirIndex(r)}`;
      counter.set(key, (counter.get(key) ?? 0) + 1);
      codes.set(r.id, `${wg ? '' : `${r.work_group_code} `}${dirIndex(r)}.${counter.get(key)}`);
    }
    return { included: inc, waiting: rows.filter((r) => r.status === 'ready'), wbs: codes };
  }, [plan.data, refs.directions, wg]);

  if (plan.error) return <ErrorText error={plan.error} />;
  if (!plan.data) return <Loading />;
  const groups = new Set(included.map((r) => r.work_group_code)).size;
  const lastFinish = included.map((r) => r.planned_finish).filter(Boolean).sort().pop() ?? null;
  const activityCount = included.reduce((n, r) => n + r.activities.length, 0);
  const partnerLinks = included.reduce((n, r) => n + r.partner_codes.length, 0);
  const page = included.slice((paging.page - 1) * paging.size, paging.page * paging.size);
  const asDrill = (r: MasterPlanRow, why?: string): DrillTask => ({ ...r, why });
  const tasks = (title: string, rows: MasterPlanRow[], why?: (r: MasterPlanRow) => string) => ({ title, rows: rows.map((r) => asDrill(r, why?.(r))) });

  // Planned progress: how much of the included work the plan expects done by today, weighted by working days.
  const today = todayIso();
  const dated = included.filter((r) => r.planned_start && r.planned_finish);
  const weight = (r: MasterPlanRow) => r.duration_days || 1;
  const totalW = dated.reduce((n, r) => n + weight(r), 0) || 1;
  const share = (r: MasterPlanRow, at: string) => {
    if (!r.planned_start || !r.planned_finish) return 0;
    const done = workingDays(r.planned_start, at < r.planned_finish ? at : r.planned_finish) ?? 0;
    return at < r.planned_start ? 0 : Math.min(1, done / weight(r));
  };
  const plannedNow = Math.round((dated.reduce((n, r) => n + weight(r) * share(r, today), 0) / totalW) * 100);
  const first = dated.map((r) => r.planned_start as string).sort()[0];
  const last = dated.map((r) => r.planned_finish as string).sort().pop();
  const elapsed = first && last ? Math.round(Math.max(0, Math.min(1, (parseDate(today).getTime() - parseDate(first).getTime()) / Math.max(1, parseDate(last).getTime() - parseDate(first).getTime()))) * 100) : 0;
  const running = included.filter((r) => r.planned_start && r.planned_finish && r.planned_start <= today && today <= r.planned_finish);

  // Load per month, by direction, and activities by finish month
  const months = first && last ? monthsBetween(first, last) : [];
  const inMonth = (d: string, m: Date) => parseDate(d) >= m && parseDate(d) <= monthEnd(m);
  const todayIdx = months.findIndex((m) => inMonth(today, m));
  const dirCodes = [...new Set(included.map((r) => r.direction_code ?? '—'))].sort();
  const active = dirCodes.map((dc) => months.map((m) => dated.filter((r) => (r.direction_code ?? '—') === dc && parseDate(r.planned_start as string) <= monthEnd(m) && parseDate(r.planned_finish as string) >= m)));
  const allActs = included.flatMap((r) => r.activities.map((a) => ({ ...a, task: r })));
  const actsBy = ACTIVITY_STATES.map((st) => months.map((m) => allActs.filter((a) => activityState(a, today) === st.key && inMonth(a.finish_date, m))));
  const actDrill = (title: string, rows: typeof allActs) => ({
    kind: 'activities' as const,
    title,
    rows: rows.map((a) => {
      const st = ACTIVITY_STATES.find((x) => x.key === activityState(a, today)) ?? ACTIVITY_STATES[2];
      return { id: a.id, task: a.task.id, code: a.code, name: a.name, task_code: a.task.code, task_title: a.task.title, owner_name: a.owner_name, owner_group: a.owner_name ? a.task.work_group_code : '', start_date: a.start_date, finish_date: a.finish_date, duration_days: a.duration_days, status: { label: st.label, tone: st.tone }, issues: [] };
    }),
  });

  // Plan by work group, and what finishes next
  const byGroup = [...new Set([...included, ...waiting].map((r) => r.work_group_code))].sort().map((code) => ({
    code, inc: included.filter((r) => r.work_group_code === code), wait: waiting.filter((r) => r.work_group_code === code),
  }));
  const horizon = addDays(today, 45);
  const next = [
    ...included.filter((r) => r.planned_finish && r.planned_finish >= today && r.planned_finish <= horizon).map((r) => ({ date: r.planned_finish as string, id: r.id, what: 'Task finishes', name: r.title, code: r.code, tone: 'var(--s-in_master_plan)', tab: '' })),
    ...allActs.filter((a) => a.finish_date >= today && a.finish_date <= horizon).map((a) => ({ date: a.finish_date, id: a.task.id, what: a.code, name: a.name, code: a.task.code, tone: 'var(--amber)', tab: '?tab=activities' })),
  ].sort((a, b) => a.date.localeCompare(b.date)).slice(0, 6);
  const inDays = (d: string) => {
    const n = Math.round((parseDate(d).getTime() - parseDate(today).getTime()) / 864e5);
    return n === 0 ? 'Today' : n === 1 ? 'Tomorrow' : `In ${n} days`;
  };
  const toggle = (id: number) => {
    const next = new Set(open);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setOpen(next);
  };

  return (
    <div className="stack" ref={root}>
      <div className="kpis">
        <Kpi label="In the Master Plan" value={included.length} sub={`from ${groups} work group${groups === 1 ? '' : 's'}`} tip="Tasks the TMO has included." drill={tasks('In the Master Plan', included)} />
        <Kpi label="Planned progress" value={`${plannedNow}%`} sub="Due by today, by working days" tip="The share of the included work the plan expects to be done by today, weighted by working days. The register plans work; it does not record actual progress." />
        <Kpi label="Running now" value={running.length} sub="Planned dates include today" tip="Included tasks whose planned start and finish include today." drill={tasks('Running now', running, (r) => `${fmtDate(r.planned_start)} → ${fmtDate(r.planned_finish)}`)} />
        <Kpi label="Waiting for the TMO" value={waiting.length} sub="Ready to include" tip="Tasks marked Ready by their group, not yet included. See the TMO inbox below." drill={tasks('Waiting for the TMO', waiting)} />
        <Kpi label="Activities" value={activityCount} sub={`${partnerLinks} partner links`} tip="Activities of the included tasks, and the partner groups working on them." drill={actDrill('Activities', allActs)} />
        <Kpi label="Work groups" value={groups} sub="with tasks in the plan" tip="Work groups that have at least one task in the Master Plan." />
        <Kpi label="Not OK" value={included.filter((r) => !r.check_summary.ok).length} sub="Included tasks to fix" tip="Included tasks whose automatic check is no longer OK, for example after a partner changed its task." drill={tasks('Not OK', included.filter((r) => !r.check_summary.ok))} />
        <Kpi label="Planned finish" value={lastFinish ? fmtDate(lastFinish) : '–'} sub="Latest finish of included tasks" tip="The latest planned finish among included tasks." />
      </div>

      <div ref={sched} className={`mp-sched ${full ? 'maxi' : ''}`}>
        <div className="filters mp-bar">
          <div className="seg" role="group" aria-label="Plan view">
            <button type="button" className={mode === 'table' ? 'on' : ''} onClick={() => setMode('table')}>Schedule</button>
            <button type="button" className={mode === 'gantt' ? 'on' : ''} onClick={() => setMode('gantt')}>Gantt timeline</button>
          </div>
          <span className="dim small">{mode === 'table' ? 'Expand a task to see its activities.' : 'Bars are planned dates; the red line is today.'}</span>
          <button type="button" className="btn sm mp-full" aria-pressed={full} data-tip={full ? 'Back to the normal page (Esc)' : 'Show the schedule over the whole window'} onClick={() => setFull(!full)}>
            {full ? '✕ Exit full screen' : '⤢ Full screen'}
          </button>
        </div>
        {mode === 'gantt' ? (
          <PlanGantt wg={wg} />
        ) : (
          <Panel title="Master Plan schedule" tip="WBS = direction number . task number within each work group.">
            {included.length ? (
              <>
                <div className="tw"><table>
                  <thead><tr><th>WBS</th><th>ID</th><th>Task / activity</th><th>Start</th><th>Finish</th><th className="r">Days</th><th>Waits for</th><th>Status</th></tr></thead>
                  <tbody>
                    {page.map((r) => (
                      <Fragment key={r.id}>
                        <tr>
                          <td className="mono nowrap">
                            <button type="button" className="mx" onClick={() => toggle(r.id)} aria-label={`${open.has(r.id) ? 'Collapse' : 'Expand'} ${r.code}`}>{open.has(r.id) ? '▾' : '▸'}</button> {wbs.get(r.id)}
                          </td>
                          <td className="id"><Link to={`/tasks/${r.id}`}>{r.code}</Link></td>
                          <td className="wide-cell"><div className="t1">{r.title}</div><div className="t2">{r.owner_role} · {r.activities.length} activities{r.partner_codes.length ? ` · partners ${r.partner_codes.join(', ')}` : ''}</div></td>
                          <td className="mono small nowrap">{fmtDate(r.planned_start)}</td>
                          <td className="mono small nowrap">{fmtDate(r.planned_finish)}</td>
                          <td className="num r">{r.duration_days ?? ''}</td>
                          <td className="mono small">{r.waits_for.join(', ') || '—'}</td>
                          <td className="nowrap"><StatusPill status={r.status} />{r.can_release && (
                            <button type="button" className="btn ghost sm" onClick={() => transition.mutate({ id: r.id, status: 'ready' })}>Release</button>)}</td>
                        </tr>
                        {open.has(r.id) && (
                          <>
                            {r.activities.map((a, i) => (
                              <tr key={`a${a.id}`} className="sub-row">
                                <td className="mono">{wbs.get(r.id)}.{i + 1}</td><td className="mono">{a.code.slice(-3)}</td>
                                <td>{a.name}<div className="t2">{a.owner_name}</div></td>
                                <td className="mono small">{fmtDate(a.start_date)}</td><td className="mono small">{fmtDate(a.finish_date)}</td>
                                <td className="num r">{a.duration_days ?? ''}</td>
                                <td className="mono small">{a.predecessors.map((p) => p.slice(-3)).join(', ') || '—'}</td><td />
                              </tr>
                            ))}
                            {!r.activities.length && <tr className="sub-row"><td colSpan={8}>No activities recorded. A big task lists its activities on its task page once they are known.</td></tr>}
                          </>
                        )}
                      </Fragment>
                    ))}
                  </tbody>
                </table></div>
                <Pager count={included.length} page={paging.page} size={paging.size} onPage={paging.setPage} onSize={paging.setSize} />
              </>
            ) : <Empty>No task is in the Master Plan yet.</Empty>}
          </Panel>
        )}
      </div>

      <div className="grid g3">
        <Panel title="Progress at a glance" tip="Outer ring: how much of the plan window (first start to last finish) has passed. Inner ring: the share of the included work the plan expects done by today, weighted by working days.">
          <div className="ring">
            <Rings outer={{ value: elapsed, color: 'var(--s-ready)', tip: `Time elapsed in the plan window\n${elapsed}%` }}
              inner={{ value: plannedNow, color: 'var(--s-in_master_plan)', tip: `Planned work due by today\n${plannedNow}%` }} center={`${plannedNow}%`} sub="planned" />
            <div className="list">
              <div className="li"><span className="pill" style={{ ['--c' as string]: 'var(--s-ready)' }} /><span>Time elapsed in the plan window</span><span className="mono dim">{elapsed}%</span></div>
              <div className="li"><span className="pill" style={{ ['--c' as string]: 'var(--s-in_master_plan)' }} /><span>Planned work due by today</span><span className="mono dim">{plannedNow}%</span></div>
              <div className="li"><span className="pill" style={{ ['--c' as string]: 'var(--amber)' }} /><span>Running now</span><span className="mono dim">{running.length}</span></div>
            </div>
          </div>
        </Panel>
        <Panel title="Plan by work group" tip="Each work group's tasks in the Master Plan and those waiting for the TMO. Click a number to see the tasks.">
          <HBars
            empty="No task in the Master Plan yet."
            rows={byGroup.map((g) => ({
              key: g.code,
              label: <><b className="mono">{g.code}</b> {refs.groups.find((x) => x.code === g.code)?.name}</>,
              count: g.inc.length + g.wait.length,
              drill: tasks(`${g.code} – ${refs.groups.find((x) => x.code === g.code)?.name ?? ''}`, [...g.inc, ...g.wait]),
              parts: [
                { value: g.inc.length, color: 'var(--s-in_master_plan)', tip: `${g.code} · In Master Plan: ${g.inc.length}` },
                { value: g.wait.length, color: 'var(--s-ready)', tip: `${g.code} · Ready to include: ${g.wait.length}` },
              ],
            }))}
          />
          <Legend items={[{ name: 'In Master Plan', color: 'var(--s-in_master_plan)' }, { name: 'Ready to include', color: 'var(--s-ready)' }]} />
        </Panel>
        <Panel title="Next finishes" tip="Included tasks and their activities due to finish in the next 45 days.">
          {next.length ? (
            <div className="nx">
              {next.map((x, i) => (
                <Link key={i} to={`/tasks/${x.id}${x.tab}`} className="it" data-tip={`${x.code} · ${x.name}`}>
                  <span className="dot" style={{ ['--c' as string]: x.tone }} />
                  <span className="nx-t"><span className="mono dim small">{x.what} · {fmtDate(x.date)}</span><span className="nx-n">{x.name}</span></span>
                  <span className="in">{inDays(x.date)}</span>
                </Link>
              ))}
            </div>
          ) : <Empty>Nothing is due to finish in the next 45 days.</Empty>}
        </Panel>
      </div>

      {months.length > 0 && (
        <div className="grid g2">
          <Panel title="Active tasks per month" tip="How many included tasks run in each month, by direction. It shows where the load peaks. Click a bar to see the tasks.">
            <BarChart
              labels={months.map(monthLabel)}
              series={dirCodes.map((dc, i) => ({ name: dc, color: `var(--c${(i % 8) + 1})`, values: active[i].map((r) => r.length) }))}
              unit="tasks"
              todayIndex={todayIdx}
              fullLabel={(i) => monthFull(months[i])}
              names={(i, si) => active[si][i].map((r) => r.code)}
              drill={(i, si) => tasks(`${dirCodes[si]} · ${monthFull(months[i])}`, active[si][i])}
            />
          </Panel>
          <Panel title="Activities finishing per month" tip="Activities of included tasks by planned finish month. The current month is shaded. Click a bar to see them.">
            <BarChart
              labels={months.map(monthLabel)}
              series={ACTIVITY_STATES.map((st, i) => ({ name: st.label, color: st.tone, values: actsBy[i].map((r) => r.length) }))}
              unit="activities"
              todayIndex={todayIdx}
              fullLabel={(i) => monthFull(months[i])}
              names={(i, si) => actsBy[si][i].map((a) => a.code)}
              drill={(i, si) => actDrill(`${ACTIVITY_STATES[si].label} · ${monthFull(months[i])}`, actsBy[si][i])}
            />
          </Panel>
        </div>
      )}

      <Panel title="TMO inbox" tip="Tasks marked Ready to include. The TMO checks their links with other groups, confirms the dates and includes them. A task whose check is not OK cannot be included.">
        <ErrorText error={transition.error} />
        {waiting.length ? (
          <div className="list">
            {waiting.map((r) => (
              <div key={r.id} className="li li4">
                <Link to={`/tasks/${r.id}`} className="mono acc">{r.code}</Link>
                <span>{r.title}<span className="sub mono">{fmtDate(r.planned_start)} → {fmtDate(r.planned_finish)} · {r.partner_codes.length} partner(s){r.owner_role && r.owner_role !== 'Direct' ? ` · ${r.owner_role}` : ''}</span></span>
                <CheckBadge summary={r.check_summary} />
                {r.can_include ? (
                  <button type="button" className="btn sm pri" disabled={transition.isPending} onClick={() => transition.mutate({ id: r.id, status: 'in_master_plan' })}>Include</button>
                ) : <span className="dim small">TMO action</span>}
              </div>
            ))}
          </div>
        ) : <Empty>No task is waiting for the TMO.</Empty>}
      </Panel>
    </div>
  );
}
