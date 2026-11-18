import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { useTasks, useTimeline } from '../api/queries';
import type { Status } from '../api/types';
import { TimelineGantt } from '../components/PlanGantt';
import { useScope } from '../components/WorkGroupScope';
import { ApprovalBadge, CheckBadge, ErrorText, Pager, Panel, StatusPill, Tip, usePaging } from '../components/ui';
import { FIELDS, STATUS_LABEL } from '../lib/fields';
import { fmtDate } from '../lib/format';
import { useRefs } from '../lib/useRefs';

export default function RegisterPage() {
  const { wg } = useScope();
  const refs = useRefs();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  // Two views of the same filtered register: the table, or the Gantt timeline when it helps.
  const view = params.get('view') === 'gantt' ? 'gantt' : 'table';
  const setView = (v: 'table' | 'gantt') => {
    const next = new URLSearchParams(params);
    if (v === 'gantt') next.set('view', 'gantt');
    else next.delete('view');
    setParams(next, { replace: true });
  };
  const paging = usePaging();
  const [search, setSearch] = useState('');
  const [direction, setDirection] = useState('');
  const [workstream, setWorkstream] = useState('');
  const [status, setStatus] = useState(params.get('status') ?? '');
  const [role, setRole] = useState('');
  const [check, setCheck] = useState('');
  const filters = { work_group: wg, search, direction, workstream, status, owner_role: role, check };
  const tasks = useTasks({ ...filters, page: paging.page, page_size: paging.size, ordering: 'code' });
  const timeline = useTimeline(filters, view === 'gantt');
  const set = (fn: (v: string) => void) => (v: string) => {
    fn(v);
    paging.reset();
  };
  const directions = refs.directions.filter((d) => !wg || d.work_group === wg);

  return (
    <>
    <Panel>
      <div className="view-tabs" role="tablist" aria-label="Register view">
        <button type="button" role="tab" aria-selected={view === 'table'} className={view === 'table' ? 'on' : ''} onClick={() => setView('table')}>
          <span aria-hidden="true">▤</span> Table
        </button>
        <button type="button" role="tab" aria-selected={view === 'gantt'} className={view === 'gantt' ? 'on' : ''} onClick={() => setView('gantt')}>
          <span aria-hidden="true">▬</span> Gantt timeline
        </button>
        <span className="t2 view-note">{view === 'gantt' ? 'The same filters apply to the timeline.' : `${tasks.data?.count ?? '…'} tasks`}</span>
      </div>
      <div className="filters">
        <input type="search" placeholder="Search task or ID" value={search} onChange={(e) => set(setSearch)(e.target.value)} aria-label="Search" />
        <select value={direction} onChange={(e) => set(setDirection)(e.target.value)} aria-label="Direction">
          <option value="">All directions</option>
          {directions.map((d) => <option key={d.id} value={d.id}>{d.code} – {d.title}</option>)}
        </select>
        <select value={workstream} onChange={(e) => set(setWorkstream)(e.target.value)} aria-label="Workstream">
          <option value="">All workstreams</option>
          {refs.list('workstream').map((w) => <option key={w.id} value={w.id}>{w.value}</option>)}
        </select>
        <select value={status} onChange={(e) => set(setStatus)(e.target.value)} aria-label="Readiness">
          <option value="">All readiness</option>
          {(Object.keys(STATUS_LABEL) as Status[]).map((k) => <option key={k} value={k}>{STATUS_LABEL[k]}</option>)}
        </select>
        <select value={role} onChange={(e) => set(setRole)(e.target.value)} aria-label="Owner role">
          <option value="">All owner roles</option>
          {refs.list('owner_role').map((r) => <option key={r.id} value={r.id}>{r.value}</option>)}
        </select>
        <select value={check} onChange={(e) => set(setCheck)(e.target.value)} aria-label="Check">
          <option value="">Any check result</option>
          <option value="ok">Check OK</option>
          <option value="not_ok">Not OK</option>
        </select>
      </div>
      {view === 'table' && <ErrorText error={tasks.error} />}
      {view === 'table' && <div className="tw fade-swap">
        <table>
          <thead>
            <tr>
              <th>Task ID <Tip text="Work group code + running number, created automatically." /></th>
              <th>Task <Tip text={FIELDS.title.hint} /></th>
              {!wg && <th>Group</th>}
              <th>Direction</th>
              <th>Owner role <Tip text={FIELDS.owner_role.hint} /></th>
              <th>Partners <Tip text="The partner groups of each task (up to twenty)." /></th>
              <th>Planned</th>
              <th className="r">Days <Tip text="Working days, Friday and Saturday off." /></th>
              <th className="r">Acts <Tip text="Activities listed for this task." /></th>
              <th>Readiness</th>
              <th>Check <Tip text="The automatic check. Open the task to see each problem." /></th>
            </tr>
          </thead>
          <tbody>
            {tasks.data?.results.map((t) => (
              <tr key={t.id} className="click" onClick={() => navigate(`/tasks/${t.id}`)}>
                <td className="id">{t.code}</td>
                <td className="wide-cell">
                  <div className="t1">{t.title}</div>
                  {t.description && <div className="t2 clamp1" data-tip={t.description}>{t.description}</div>}
                  <div className="t2">{refs.value(t.workstream) || 'Workstream not set'}{t.sub_objective ? ` · ${refs.value(t.sub_objective).split(' – ')[0]}` : ''}</div>
                </td>
                {!wg && <td><span className="tag wg">{t.work_group_code}</span></td>}
                <td><span className="tag">{refs.direction(t.direction)?.code ?? '–'}</span></td>
                <td>{refs.value(t.owner_role) || '–'}</td>
                <td><div className="tags">{t.partner_codes.map((c) => <span key={c} className="tag wg">{c}</span>)}{!t.partner_codes.length && <span className="t2">—</span>}</div></td>
                <td className="mono nowrap small dates">{t.planned_start ? <><span>{fmtDate(t.planned_start)}</span><span className="t2">{t.planned_finish ? `→ ${fmtDate(t.planned_finish)}` : '→ not set'}</span></> : <span className="t2">Not planned</span>}</td>
                <td className="num r">{t.duration_days ?? ''}</td>
                <td className="num r">{t.activity_count || ''}</td>
                <td><div className="ready-cell"><StatusPill status={t.status} />{t.approval && <ApprovalBadge decision={t.approval} compact />}</div></td>
                <td><CheckBadge summary={t.check_summary} /></td>
              </tr>
            ))}
            {tasks.data && !tasks.data.results.length && (
              <tr><td colSpan={12} className="empty">No task matches these filters.</td></tr>
            )}
          </tbody>
        </table>
      </div>}
      {view === 'table' && tasks.data && <Pager count={tasks.data.count} page={paging.page} size={paging.size} onPage={paging.setPage} onSize={paging.setSize} />}
    </Panel>
    {view === 'gantt' && (
      <>
        <ErrorText error={timeline.error} />
        <TimelineGantt data={timeline.data} fetching={timeline.isFetching} wg={wg} storageKey="task-register.register-gantt"
          title="Task Register timeline" tip="The tasks of the register (with the filters above) on a timeline, coloured by lifecycle stage. Group them by direction, workstream, lifecycle stage or work group; click a bar to open the task." />
      </>
    )}
    </>
  );
}
