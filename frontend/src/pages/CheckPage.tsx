import { useRef } from 'react';
import { useNavigate } from 'react-router-dom';

import { useSummary, useTasks } from '../api/queries';
import { useScope } from '../components/WorkGroupScope';
import { Donut } from '../components/charts';
import { Num, type DrillSpec } from '../components/Drill';
import { CheckBadge, Empty, ErrorText, Loading, Pager, Panel, StatusPill, Tip, usePaging } from '../components/ui';
import { drillOf, problemWhy } from '../lib/drill';
import { useEntrance } from '../lib/motion';

type SummaryRow = [label: string, value: number, bad: boolean, tip: string, sub?: boolean, drill?: DrillSpec | null];

export default function CheckPage() {
  const { wg } = useScope();
  const navigate = useNavigate();
  const summary = useSummary(wg);
  const paging = usePaging();
  const notOk = useTasks({ work_group: wg, check: 'not_ok', page: paging.page, page_size: paging.size, ordering: 'code' });
  const s = summary.data;
  const root = useRef<HTMLDivElement>(null);
  useEntrance(root, wg, !!s);
  if (summary.error) return <ErrorText error={summary.error} />;
  if (!s) return <Loading />;
  const set = drillOf(s);
  const max = Math.max(1, ...s.problems_by_field.map((p) => p.errors + p.warnings));
  const rows: SummaryRow[] = [
    ['Tasks we own', s.total, false, 'All tasks in the selected register.', false, set('total', 'Tasks we own')],
    ['of which linked to an existing sub-objective', s.with_sub_objective, false, '', true, set('with_sub_objective', 'Linked to a sub-objective')],
    ['Ready to include (and OK)', s.ready_ok, false, '', true, set('ready_ok', 'Ready to include (and OK)')],
    ['Marked Ready but not OK', s.ready_not_ok, true, 'The TMO cannot include them until they are fixed.', true, set('ready_not_ok', 'Marked Ready but not OK', undefined, problemWhy)],
    ['Needs completion', s.needs_completion, false, '', true, set('needs_completion', 'Needs completion')],
    ['Readiness not set', s.readiness_not_set, true, '', true, set('readiness_not_set', 'Readiness not set')],
    ['Tasks not OK', s.not_ok, true, 'Tasks with at least one problem.', false, set('not_ok', 'Tasks not OK', undefined, problemWhy)],
    ['Tasks without planned dates', s.without_dates, true, 'Planned start and finish are needed before Ready.', false, set('without_dates', 'Tasks without planned dates')],
    ...s.by_owner_role.map((r): SummaryRow => [`Owner role: ${r.value}`, r.count, false, '', false, set(`owner_role:${r.id}`, `Owner role: ${r.value}`)]),
    ['Contributions to other groups', s.contributions, false, 'Up to twenty per task whose owner role is Enable or Support.', false, set('contributions', 'Contributions to other groups')],
    ['Contributions not complete', s.contributions_not_complete, true, '', true, set('contributions_not_complete', 'Contributions not complete', undefined, problemWhy)],
    ['Tasks shared with partner groups', s.shared_with_partners, false, 'Tasks with at least one partner group.', false, set('shared_with_partners', 'Tasks shared with partner groups')],
    ['Partner rows', s.partner_rows, false, 'One row per partner group named on a task (up to twenty per task).', false, set('shared_with_partners', 'Partner rows', undefined, (t) => `Partners ${t.partner_codes.join(', ')}`)],
    ['Partner rows not complete', s.partner_rows_not_complete, true, '', true, set('partner_rows_not_complete', 'Partner rows not complete', undefined, problemWhy)],
    ['Tasks with activities', s.with_activities, false, '', false, set('with_activities', 'Tasks with activities')],
    ['Activities recorded', s.activities, false, '', true, set('with_activities', 'Activities recorded', undefined, (t) => `${t.activity_count} activities`)],
    ['Activities not OK', s.activities_not_ok, true, '', true, set('activities_not_ok', 'Activities not OK')],
    ['Existing sub-objectives not linked to any task', s.sub_objectives.filter((x) => !x.count).length, false, 'Optional, for information.'],
  ];

  const readiness = [
    { name: 'Ready and OK', value: s.ready_ok, color: 'var(--ok)', drill: set('ready_ok', 'Ready and OK') },
    { name: 'Marked Ready but not OK', value: s.ready_not_ok, color: 'var(--bad)', drill: set('ready_not_ok', 'Marked Ready but not OK', undefined, problemWhy) },
    { name: 'Needs completion', value: s.needs_completion, color: 'var(--s-needs_completion)', drill: set('needs_completion', 'Needs completion') },
    { name: 'Readiness not set', value: s.readiness_not_set, color: 'var(--s-draft)', drill: set('readiness_not_set', 'Readiness not set') },
  ];

  return (
    <div className="stack" ref={root}>
      <div className="grid g-ov">
        <Panel title="Problems by field" tip="Every problem the check finds, grouped by the field to fix. Red must be fixed; amber is still to complete before Ready.">
          {s.problems_by_field.length ? (
            <>
              <div className="hbars">
                {s.problems_by_field.map((p) => (
                  <div key={p.label} className="hb">
                    <span className="lab">{p.label}</span>
                    <span className="val"><Num drill={set(`field:${p.label}`, p.label, 'Tasks with a problem in this field.', problemWhy)} value={<>{p.errors > 0 && <span className="bad">{p.errors}</span>}{p.errors > 0 && p.warnings > 0 && ' + '}{p.warnings > 0 && <span className="warn">{p.warnings}</span>}</>} /></span>
                    <div className="trk">
                      <span style={{ width: `${(p.errors / max) * 100}%`, background: 'var(--bad)' }} />
                      <span style={{ width: `${(p.warnings / max) * 100}%`, background: 'var(--warn)' }} />
                    </div>
                  </div>
                ))}
              </div>
              <div className="legend"><span><i style={{ background: 'var(--bad)' }} />Not OK</span><span><i style={{ background: 'var(--warn)' }} />To complete before Ready</span></div>
            </>
          ) : <Empty>No problems found.</Empty>}
        </Panel>
        <Panel title="Readiness" tip="How many tasks are in each readiness state. Click a segment or a number to see the tasks.">
          <Donut parts={readiness} center={s.total} sub="tasks" />
        </Panel>
      </div>
      <div className="grid g2">
        <Panel title="Summary" tip="The same counts as sheet 5 (Check) of the template. The TMO looks at them before accepting a register.">
          <div className="tw"><table><tbody>
            {rows.map(([label, value, bad, tip, sub, drill]) => (
              <tr key={label}>
                <td className={sub ? 'sub-cell' : 'strong'}>{label} {tip && <Tip text={tip} />}</td>
                <td className={`num r ${bad && value > 0 ? 'bad strong' : ''}`}><Num value={value} drill={drill} /></td>
              </tr>
            ))}
          </tbody></table></div>
        </Panel>
        <Panel title="Coverage by direction" tip="A direction with no task is a gap to close before submitting.">
          <div className="tw"><table>
            <thead><tr><th>Direction</th><th className="r">Tasks</th><th>Status</th></tr></thead>
            <tbody>{s.by_direction.map((d) => (
              <tr key={d.id}><td><b className="mono">{d.code}</b> {d.title}</td><td className="num r"><Num value={d.count} drill={set(`direction:${d.id}`, `${d.code} – ${d.title}`)} /></td>
                <td>{d.count ? <span className="chk ok">OK</span> : <span className="chk bad">Gap: no task</span>}</td></tr>))}</tbody>
          </table></div>
        </Panel>
        <div className="stack">
          <Panel title="By workstream" tip="Tasks per main workstream.">
            <div className="tw"><table>
              <thead><tr><th>Workstream</th><th className="r">Tasks</th></tr></thead>
              <tbody>{s.by_workstream.map((w) => (<tr key={w.id}><td>{w.value} <Tip text={w.definition} /></td><td className="num r"><Num value={w.count} drill={set(`workstream:${w.id}`, w.value, w.definition)} /></td></tr>))}</tbody>
            </table></div>
          </Panel>
          <Panel title="Existing sub-objectives" tip="Linking a task to a sub-objective is optional.">
            <div className="tw"><table>
              <thead><tr><th>Sub-objective</th><th className="r">Tasks</th><th>Status</th></tr></thead>
              <tbody>{s.sub_objectives.map((x) => (
                <tr key={x.id}><td>{x.value}</td><td className="num r"><Num value={x.count} drill={set(`sub_objective:${x.id}`, x.value)} /></td>
                  <td>{x.count ? <span className="chk ok">Linked</span> : <span className="t2">Not linked (optional)</span>}</td></tr>))}</tbody>
            </table></div>
          </Panel>
        </div>
      </div>
      <Panel title="Tasks to fix" tip="Tasks whose check is not OK, including their partners, contributions and activities. Open a task to see each problem.">
        <ErrorText error={notOk.error} />
        <div className="tw"><table>
          <thead><tr><th>Task</th><th>Readiness</th><th>Result</th></tr></thead>
          <tbody>
            {notOk.data?.results.map((t) => (
              <tr key={t.id} className="click" onClick={() => navigate(`/tasks/${t.id}`)}>
                <td><span className="id mono">{t.code}</span> {t.title}</td>
                <td><StatusPill status={t.status} /></td>
                <td><CheckBadge summary={t.check_summary} /></td>
              </tr>
            ))}
          </tbody>
        </table></div>
        {notOk.data && !notOk.data.count && <Empty>Every task is OK.</Empty>}
        {notOk.data && <Pager count={notOk.data.count} page={paging.page} size={paging.size} onPage={paging.setPage} onSize={paging.setSize} />}
      </Panel>
    </div>
  );
}
