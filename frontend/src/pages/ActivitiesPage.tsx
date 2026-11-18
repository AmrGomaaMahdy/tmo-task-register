import { useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { useAllActivities, useMembers, useResource, useSummary } from '../api/queries';
import type { Activity, SummaryTask } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import ActivityForm from '../components/ActivityForm';
import { BarChart, HBars, Legend } from '../components/charts';
import type { DrillSpec } from '../components/Drill';
import { useScope } from '../components/WorkGroupScope';
import { ConfirmButton, Empty, ErrorText, Kpi, Loading, Pager, Panel, Tip, usePaging } from '../components/ui';
import { ACTIVITY_STATES, activityState, toDrillActivity, type ActivityState } from '../lib/activities';
import { addDays, fmtDate, monthEnd, monthFull, monthLabel, monthsBetween, parseDate, todayIso } from '../lib/format';
import { useEntrance } from '../lib/motion';
import { useRefs } from '../lib/useRefs';

const acts = (title: string, rows: Activity[], sub?: string): DrillSpec => ({ kind: 'activities', title, sub, rows: rows.map(toDrillActivity) });

/** Sheet 4 of the template: every activity of the registers you can see, with owners, dates, predecessors and check. */
export default function ActivitiesPage() {
  const { wg } = useScope();
  const { me } = useAuth();
  const refs = useRefs();
  const navigate = useNavigate();
  const all = useAllActivities(wg);
  const summary = useSummary(wg);
  const members = useMembers();
  const { remove } = useResource('activities');
  const paging = usePaging(10);
  const [q, setQ] = useState('');
  const [taskF, setTaskF] = useState<number | ''>('');
  const [ownerF, setOwnerF] = useState<string>('');
  const [stateF, setStateF] = useState<ActivityState | ''>('');
  const [checkF, setCheckF] = useState<'' | 'ok' | 'bad'>('');
  const [editing, setEditing] = useState<Activity | null>(null);
  const [adding, setAdding] = useState<SummaryTask | null>(null);
  const root = useRef<HTMLDivElement>(null);
  useEntrance(root, wg, !!all.data && !!summary.data);

  const today = todayIso();
  const data = useMemo(() => {
    const list = all.data ?? [];
    const state = new Map(list.map((a) => [a.id, activityState(a, today)]));
    const by = (k: ActivityState) => list.filter((a) => state.get(a.id) === k);
    const soon = addDays(today, 30);
    const due = list.filter((a) => a.finish_date >= today && a.finish_date <= soon);
    const owners = [...new Set(list.map((a) => a.owner_name).filter(Boolean))].sort();
    const months = monthsBetween(
      list.map((a) => a.start_date).sort()[0] ?? today,
      list.map((a) => a.finish_date).sort().pop() ?? today,
    );
    return { list, state, by, due, owners, months };
  }, [all.data, today]);

  if (all.error || summary.error) return <ErrorText error={all.error || summary.error} />;
  if (!all.data || !summary.data || !refs.ready) return <Loading />;

  const { list, state, by, due, owners, months } = data;
  const s = summary.data;
  const rowsById = new Map(s.drill.rows.map((r) => [r.id, r]));
  const withActs = (s.drill.sets.with_activities ?? []).map((id) => rowsById.get(id)).filter((r): r is SummaryTask => !!r);
  const visibleMembers = (members.data ?? []).filter((m) => !wg || m.work_group === wg);
  const noOwner = list.filter((a) => !a.owner);
  const bad = list.filter((a) => a.issues.length);
  const canEdit = (a: { work_group: number; task_status: string }) =>
    !!me && (me.permissions.admin || (me.work_groups.some((g) => g.id === a.work_group) && a.task_status !== 'in_master_plan'));

  // charts
  const inMonth = (d: string, m: Date) => parseDate(d) >= m && parseDate(d) <= monthEnd(m);
  const todayIdx = months.findIndex((m) => inMonth(today, m));
  const byMonth = ACTIVITY_STATES.map((st) => months.map((m) => list.filter((a) => state.get(a.id) === st.key && inMonth(a.finish_date, m))));
  const workload = [...owners.map((o) => ({ o, rows: list.filter((a) => a.owner_name === o) })), ...(noOwner.length ? [{ o: '', rows: noOwner }] : [])]
    .sort((a, b) => b.rows.length - a.rows.length);

  // table
  const needle = q.trim().toLowerCase();
  const shown = list.filter((a) =>
    (!taskF || a.task === taskF) &&
    (!ownerF || (ownerF === '-' ? !a.owner : a.owner_name === ownerF)) &&
    (!stateF || state.get(a.id) === stateF) &&
    (!checkF || (checkF === 'ok' ? !a.issues.length : a.issues.length > 0)) &&
    (!needle || `${a.code} ${a.name} ${a.owner_name} ${a.task_title}`.toLowerCase().includes(needle)));
  const page = shown.slice((paging.page - 1) * paging.size, paging.page * paging.size);
  const codeOf = new Map(list.map((a) => [a.id, a.code]));
  const tasksWithActs = [...new Map(list.map((a) => [a.task, a])).values()];
  const addable = s.drill.rows.filter((r) => me && (me.permissions.admin || (me.work_groups.some((g) => g.code === r.work_group_code) && r.status !== 'in_master_plan')));

  // timeline
  const span = months.length ? { a: months[0], b: monthEnd(months[months.length - 1]) } : null;
  const pc = (d: string) => (span ? Math.max(0, Math.min(100, ((parseDate(d).getTime() - span.a.getTime()) / (span.b.getTime() - span.a.getTime())) * 100)) : 0);
  const shownTasks = [...new Map(shown.map((a) => [a.task, a])).values()];
  let bar = 0;

  return (
    <div className="stack" ref={root}>
      <div className="kpis">
        <Kpi label="Activities" value={list.length} sub={`${by('running').length} under way · ${by('upcoming').length} upcoming`} tip="All activities of the tasks in the selected register." drill={acts('Activities', list)} />
        <Kpi label="Tasks with activities" value={withActs.length} small={` / ${s.total}`} sub="Big tasks planned in detail" tip="Tasks whose plan is broken down into activities."
          drill={{ title: 'Tasks with activities', rows: withActs.map((t) => ({ ...t, why: `${t.activity_count} activities` })) }} />
        <Kpi label="Under way" value={by('running').length} sub="Between planned start and finish" tip="Activities whose planned dates include today." drill={acts('Under way', by('running'))} />
        <Kpi label="Due in the next 30 days" value={due.length} sub="Finish date within 30 days" tip="Activities whose planned finish is in the next 30 days." drill={acts('Due in the next 30 days', due)} />
        <Kpi label="Past finish date" value={by('past').length} sub="Planned finish has passed" tip="Activities whose planned finish date has passed." drill={acts('Past finish date', by('past'))} />
        <Kpi label="Activities not OK" value={bad.length} sub="Open them to fix" tip="Activities the check flags: dates outside the task, predecessors, or an owner from another group." drill={acts('Activities not OK', bad)} />
        <Kpi label="Owners" value={owners.length} small={` / ${visibleMembers.length}`} sub="Group members with activities" tip="Group members who own at least one activity." />
        <Kpi label="Without owner" value={noOwner.length} sub="Owner is optional" tip="Activities with no owner yet. Pick one from the members of the task's work group." drill={acts('Without owner', noOwner)} />
      </div>

      <div className="grid g-ov">
        <Panel title="Activities finishing per month" tip="Activities by planned finish month and where they stand by their dates. Click a bar to see them.">
          <BarChart
            labels={months.map(monthLabel)}
            series={ACTIVITY_STATES.map((st, i) => ({ name: st.label, color: st.tone, values: byMonth[i].map((r) => r.length) }))}
            unit="activities"
            todayIndex={todayIdx}
            fullLabel={(i) => monthFull(months[i])}
            names={(i, si) => byMonth[si][i].map((a) => a.code)}
            drill={(i, si) => acts(`${ACTIVITY_STATES[si].label} · ${monthFull(months[i])}`, byMonth[si][i])}
          />
        </Panel>
        <Panel title="Workload by owner" tip="Activities per group member, by where they stand. Click a number to see them.">
          <HBars
            empty="No activities yet."
            rows={workload.map((w) => {
              const member = (members.data ?? []).find((m) => m.name === w.o);
              return {
                key: w.o || '-',
                label: <>{w.o || <span className="t2">No owner</span>} {member && <span className="tag wg">{member.work_group_code}</span>}</>,
                count: w.rows.length,
                drill: acts(w.o || 'Without owner', w.rows),
                parts: ACTIVITY_STATES.map((st) => {
                  const n = w.rows.filter((a) => state.get(a.id) === st.key).length;
                  return { value: n, color: st.tone, tip: `${w.o || 'No owner'} · ${st.label}: ${n}` };
                }),
              };
            })}
          />
          <Legend items={ACTIVITY_STATES.map((st) => ({ name: st.label, color: st.tone }))} />
        </Panel>
      </div>

      <Panel title="Activity timeline" tip="Every activity on one timeline, grouped by task, coloured by where it stands. The red line is today. Click a bar to edit the activity."
        actions={<Legend items={ACTIVITY_STATES.map((st) => ({ name: st.label, color: st.tone }))} />}>
        {shownTasks.length && span ? (
          <div className="atl">
            <div className="atl-hd"><div /><div className="atl-trk" style={{ ['--m' as string]: months.length }}>
              {months.map((m, i) => <span key={i} className="atl-m" style={{ insetInlineStart: `${(i / months.length) * 100}%` }}>{monthLabel(m)}</span>)}
            </div></div>
            {shownTasks.map((t) => (
              <div key={t.task}>
                <Link className="atl-grp" to={`/tasks/${t.task}?tab=activities`}><span className="mono acc">{t.task_code}</span> {t.task_title}</Link>
                {shown.filter((a) => a.task === t.task).map((a) => {
                  const st = ACTIVITY_STATES.find((x) => x.key === state.get(a.id)) ?? ACTIVITY_STATES[2];
                  const tip = `${a.code} · ${a.name}\n${fmtDate(a.start_date)} → ${fmtDate(a.finish_date)} · ${a.duration_days ?? 0} working days\n${st.label}${a.owner_name ? ` · ${a.owner_name}` : ''}${a.predecessors.length ? `\nWaits for: ${a.predecessors.map((p) => codeOf.get(p) ?? '').join(', ')}` : ''}`;
                  const edit = canEdit(a) ? () => setEditing(a) : () => navigate(`/tasks/${a.task}?tab=activities`);
                  return (
                    <div key={a.id} className="atl-row">
                      <button type="button" className="atl-lab" data-tip={tip} onClick={edit}><span className="id">{a.code.slice(-3)}</span> {a.name}</button>
                      <div className="atl-trk" style={{ ['--m' as string]: months.length }}>
                        <button type="button" className="atl-bar" aria-label={a.code} data-tip={tip} onClick={edit}
                          style={{ insetInlineStart: `${pc(a.start_date)}%`, width: `${Math.max(0.6, pc(a.finish_date) - pc(a.start_date))}%`, ['--c' as string]: st.tone, ['--i' as string]: bar++ }} />
                        <span className="atl-today" style={{ insetInlineStart: `${pc(today)}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        ) : <Empty>No activity matches these filters.</Empty>}
      </Panel>

      <Panel title="Activity register" tip="Sheet 4 of the template: one row per activity, in order under its task. A predecessor is an activity of the same task that must finish before this one starts."
        actions={addable.length > 0 && (
          <select className="add-sel" aria-label="Add an activity to a task" value="" onChange={(e) => setAdding(addable.find((r) => r.id === Number(e.target.value)) ?? null)}>
            <option value="">+ Add activity to a task…</option>
            {addable.map((r) => <option key={r.id} value={r.id}>{r.code} – {r.title}</option>)}
          </select>
        )}>
        <div className="filters">
          <input type="search" placeholder="Search activity, ID, owner or task" aria-label="Search" value={q} onChange={(e) => { setQ(e.target.value); paging.reset(); }} />
          <select aria-label="All tasks" value={taskF} onChange={(e) => { setTaskF(e.target.value ? Number(e.target.value) : ''); paging.reset(); }}>
            <option value="">All tasks</option>
            {tasksWithActs.map((a) => <option key={a.task} value={a.task}>{a.task_code} – {a.task_title}</option>)}
          </select>
          <select aria-label="All owners" value={ownerF} onChange={(e) => { setOwnerF(e.target.value); paging.reset(); }}>
            <option value="">All owners</option>
            {owners.map((o) => <option key={o}>{o}</option>)}
            {noOwner.length > 0 && <option value="-">No owner</option>}
          </select>
          <select aria-label="Any status" value={stateF} onChange={(e) => { setStateF(e.target.value as ActivityState | ''); paging.reset(); }}>
            <option value="">Any status</option>
            {ACTIVITY_STATES.map((st) => <option key={st.key} value={st.key}>{st.label}</option>)}
          </select>
          <select aria-label="Any check" value={checkF} onChange={(e) => { setCheckF(e.target.value as '' | 'ok' | 'bad'); paging.reset(); }}>
            <option value="">Any check</option><option value="ok">Check OK</option><option value="bad">Not OK</option>
          </select>
          <span className="dim small">{shown.length} rows · {shown.filter((a) => a.issues.length).length} to fix</span>
        </div>
        <ErrorText error={remove.error} />
        <div className="tw"><table>
          <thead><tr><th>Activity ID</th><th>Activity</th><th>Task</th><th>Owner <Tip text="A member of the task's own work group." /></th><th>Start</th><th>Finish</th><th className="r">Days</th><th>Waits for <Tip text="Up to two predecessors of the same task." /></th><th>Status</th><th>Check</th><th /></tr></thead>
          <tbody>
            {page.map((a) => {
              const st = ACTIVITY_STATES.find((x) => x.key === state.get(a.id)) ?? ACTIVITY_STATES[2];
              return (
                <tr key={a.id}>
                  <td className="id mono">{a.code}</td>
                  <td className="wide-cell">{a.name}</td>
                  <td><Link to={`/tasks/${a.task}?tab=activities`} className="mono acc small">{a.task_code}</Link><div className="t2">{a.task_title}</div></td>
                  <td className="nowrap">{a.owner_name || <span className="t2">—</span>} {a.owner_group && <span className="tag wg">{a.owner_group}</span>}</td>
                  <td className="mono small nowrap">{fmtDate(a.start_date)}</td>
                  <td className="mono small nowrap">{fmtDate(a.finish_date)}</td>
                  <td className="num r">{a.duration_days ?? ''}</td>
                  <td className="mono small">{a.predecessors.map((p) => codeOf.get(p)?.slice(-3)).join(', ') || '—'}</td>
                  <td><span className="pill" style={{ ['--c' as string]: st.tone }} data-tip={st.tip}>{st.label}</span></td>
                  <td>{a.issues.length ? <span className="chk bad" data-tip={a.issues.join('\n')}>{a.issues.length} to fix</span> : <span className="chk ok">OK</span>}</td>
                  <td className="r nowrap">{canEdit(a) && (
                    <><button type="button" className="btn ghost sm" onClick={() => setEditing(a)}>Edit</button><ConfirmButton onConfirm={() => remove.mutate(a.id)} confirmTitle="Remove this activity?" subject={`${a.code} – ${a.name}`} /></>
                  )}</td>
                </tr>
              );
            })}
          </tbody>
        </table></div>
        {!shown.length && <Empty>No activity matches these filters.</Empty>}
        <Pager count={shown.length} page={paging.page} size={paging.size} onPage={paging.setPage} onSize={paging.setSize} />
      </Panel>

      {editing && (
        <ActivityForm
          task={{ id: editing.task, code: editing.task_code, work_group: editing.work_group, work_group_code: editing.work_group_code, planned_start: rowsById.get(editing.task)?.planned_start ?? null, planned_finish: rowsById.get(editing.task)?.planned_finish ?? null }}
          activity={editing}
          onClose={() => setEditing(null)}
        />
      )}
      {adding && (
        <ActivityForm
          task={{ id: adding.id, code: adding.code, work_group: refs.groups.find((g) => g.code === adding.work_group_code)?.id ?? 0, work_group_code: adding.work_group_code, planned_start: adding.planned_start, planned_finish: adding.planned_finish }}
          onClose={() => setAdding(null)}
        />
      )}
    </div>
  );
}
