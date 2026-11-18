import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { useMasterPlan } from '../api/queries';
import type { MasterPlanRow, Status } from '../api/types';
import { DECISION_LABEL, STATUS_LABEL } from '../lib/fields';
import { fmtDate } from '../lib/format';
import { useRefs } from '../lib/useRefs';
import { Legend } from './charts';
import Gantt from './Gantt';
import { Panel } from './ui';

type GroupBy = 'direction' | 'workstream' | 'lifecycle' | 'group';
type Show = 'all' | 'plan';

const STAGES: Status[] = ['draft', 'needs_completion', 'ready', 'in_master_plan'];
const GROUP_BY: [GroupBy, string][] = [['direction', 'Direction'], ['workstream', 'Workstream'], ['lifecycle', 'Lifecycle'], ['group', 'Work group']];

function stored(key: string): { by: GroupBy; show: Show } {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? '{}');
    return { by: GROUP_BY.some(([k]) => k === v.by) ? v.by : 'direction', show: v.show === 'plan' ? 'plan' : 'all' };
  } catch {
    return { by: 'direction', show: 'all' };
  }
}

/**
 * The Master Plan as a Gantt timeline: every task (or only the included ones) with its planned dates,
 * coloured by lifecycle stage and grouped by direction, workstream, lifecycle stage or work group.
 */
export default function PlanGantt({ wg }: { wg: number | null }) {
  const plan = useMasterPlan(wg, true);
  return <TimelineGantt data={plan.data} fetching={plan.isFetching} wg={wg} storageKey="task-register.gantt" planToggle />;
}

/**
 * A Gantt timeline of task rows: coloured by lifecycle stage, grouped by direction, workstream, lifecycle
 * stage or work group. Used by the Master Plan and by the Task Register's timeline tab.
 */
export function TimelineGantt({ data, fetching, wg, storageKey, planToggle = false, title = 'Gantt timeline', tip }: {
  data: MasterPlanRow[] | undefined;
  fetching: boolean;
  wg: number | null;
  storageKey: string;
  planToggle?: boolean;
  title?: string;
  tip?: string;
}) {
  const navigate = useNavigate();
  const refs = useRefs();
  const [view, setView] = useState(() => stored(storageKey));
  const set = (next: Partial<typeof view>) => {
    const v = { ...view, ...next };
    setView(v);
    try {
      localStorage.setItem(storageKey, JSON.stringify(v));
    } catch {
      /* the choice lasts for this visit only */
    }
  };

  const rows = useMemo(() => {
    const all = (data ?? []).filter((r) => !planToggle || view.show === 'all' || r.status === 'in_master_plan');
    // Each grouping gives the order of its groups and the name shown on the group's header row.
    const groups: { key: string; name: string; match: (r: MasterPlanRow) => boolean }[] =
      view.by === 'direction'
        ? [
            ...refs.directions
              .filter((d) => !wg || d.work_group === wg)
              .map((d) => ({ key: `d${d.id}`, name: `${d.code} – ${d.title}`, match: (r: MasterPlanRow) => r.direction === d.id })),
            { key: 'd-', name: 'No direction yet', match: (r: MasterPlanRow) => !r.direction },
          ]
        : view.by === 'workstream'
          ? [
              ...refs.list('workstream').map((w) => ({ key: `w${w.id}`, name: w.value, match: (r: MasterPlanRow) => r.workstream === w.id })),
              { key: 'w-', name: 'No workstream yet', match: (r: MasterPlanRow) => !r.workstream },
            ]
          : view.by === 'lifecycle'
            ? STAGES.map((st) => ({ key: st, name: STATUS_LABEL[st], match: (r: MasterPlanRow) => r.status === st }))
            : [...new Set(all.map((r) => r.work_group_code))].sort().map((code) => ({
                key: code,
                name: `${code} – ${refs.groups.find((x) => x.code === code)?.name ?? ''}`,
                match: (r: MasterPlanRow) => r.work_group_code === code,
              }));
    return groups.flatMap((g) => {
      const list = all.filter(g.match).sort((a, b) => (a.planned_start ?? '9').localeCompare(b.planned_start ?? '9'));
      return list.map((r) => ({
        id: r.id,
        label: r.code,
        sub: r.title,
        start: r.planned_start,
        finish: r.planned_finish,
        tone: `var(--s-${r.status})`,
        group: `${g.name} · ${list.length}`,
        tip: [
          `${r.code} – ${r.title}`,
          `${fmtDate(r.planned_start)} → ${fmtDate(r.planned_finish)} · ${r.duration_days ?? 0} working days`,
          STATUS_LABEL[r.status],
          r.approval ? `Leader approval: ${DECISION_LABEL[r.approval]}` : '',
          r.activities.length ? `Activities: ${r.activities.length}` : '',
          r.waits_for.length ? `Waits for: ${r.waits_for.join(', ')}` : '',
        ].filter(Boolean).join('\n'),
        onClick: () => navigate(`/tasks/${r.id}`),
      }));
    });
  }, [data, view, refs, wg, navigate, planToggle]);

  return (
    <Panel title={title} tip={tip ?? 'Every task with its planned dates, coloured by lifecycle stage. Group the bars by direction, workstream, lifecycle stage or work group.'}>
      <div className="gantt-tools">
        <span className="small dim">Group by</span>
        <div className="seg" role="group" aria-label="Group by">
          {GROUP_BY.map(([k, label]) => (
            <button key={k} type="button" className={view.by === k ? 'on' : ''} aria-pressed={view.by === k} onClick={() => set({ by: k })}>{label}</button>
          ))}
        </div>
        {planToggle && (
          <div className="seg" role="group" aria-label="Tasks">
            <button type="button" className={view.show === 'all' ? 'on' : ''} aria-pressed={view.show === 'all'} onClick={() => set({ show: 'all' })}>All tasks</button>
            <button type="button" className={view.show === 'plan' ? 'on' : ''} aria-pressed={view.show === 'plan'} onClick={() => set({ show: 'plan' })}>In the Master Plan</button>
          </div>
        )}
        <Legend items={STAGES.map((s) => ({ name: STATUS_LABEL[s], color: `var(--s-${s})` }))} />
      </div>
      {data ? <div className={`fade-swap ${fetching ? 'busy' : ''}`} key={`${view.by}-${view.show}`}><Gantt rows={rows} /></div>
        : <div className="skel" style={{ height: 320 }} />}
    </Panel>
  );
}
