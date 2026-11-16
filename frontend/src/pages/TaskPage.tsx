import { useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';

import { ApiError } from '../api/client';
import { isShared, useActivities, useNeededBy, useResource, useSupportedBy, useTask, useTransition } from '../api/queries';
import type { Activity, ContributionRow, PartnerRow, SharedTask, Status, Task, TaskRef } from '../api/types';
import ActivityForm from '../components/ActivityForm';
import { CheckBadge, ConfirmButton, Empty, ErrorText, Loading, StatusPill, Tip } from '../components/ui';
import { FIELDS, MAX_ROWS } from '../lib/fields';
import { fmtDate, fmtStamp } from '../lib/format';
import { useRefs, type Refs } from '../lib/useRefs';

const TRANSITION_LABEL: Record<Status, string> = {
  draft: 'Back to draft',
  needs_completion: 'Mark needs completion',
  ready: 'Mark Ready to include',
  in_master_plan: 'Include in Master Plan',
};

function Row({ field, label, hint, value, refs, raw }: { field?: string; label?: string; hint?: string; value?: unknown; refs?: Refs; raw?: ReactNode }) {
  const def = field ? FIELDS[field] : undefined;
  const lookup = refs && def?.list && typeof value === 'number' ? refs.lookup(value) : undefined;
  const text = raw ?? (lookup ? lookup.value : (value as string | null));
  const empty = text === null || text === undefined || text === '';
  return (
    <>
      <dt>{label ?? def?.label ?? field} <Tip text={hint ?? def?.hint} /></dt>
      <dd className={empty ? 'empty' : ''}>
        {empty ? 'Empty' : text} {lookup?.definition && <Tip text={lookup.definition} />}
      </dd>
    </>
  );
}

const issuesBadge = (issues: string[] | undefined) =>
  issues?.length ? <span className="chk bad" data-tip={issues.join('\n')}>{issues.length} to fix</span> : <span className="chk ok">OK</span>;

const their = (info: TaskRef | null | undefined, ref: string) =>
  info ? `${info.code} – ${info.title}` : ref || 'their task: —';

function Details({ task, refs }: { task: Task; refs: Refs }) {
  const dir = task.direction ? `${refs.direction(task.direction)?.code} – ${refs.direction(task.direction)?.title}` : '';
  const dependsOn = task.partners.filter((p) => p.need).map((p) => `${p.work_group_code} (${p.need})`).join(', ');
  const contributesTo = task.contributions
    .filter((c) => c.to_group_code)
    .map((c) => `${c.to_group_code}${c.their_task_ref ? ` (${c.their_task_ref})` : ''}`)
    .join(', ');
  return (
    <>
      <section className="sec"><h4>1 · Describe the task</h4><dl className="kv">
        <Row label="Task ID" hint="Work group code + running number, created automatically." raw={<span className="mono">{task.code}</span>} />
        <Row field="work_group" raw={<><span className="tag wg">{task.work_group_code}</span> {refs.group(task.work_group)?.name}</>} />
        <Row field="title" value={task.title} />
        <Row field="direction" value={dir} />
        <Row field="workstream" value={task.workstream} refs={refs} />
        <Row field="sub_objective" value={task.sub_objective} refs={refs} />
      </dl></section>
      <section className="sec"><h4>2 · Who it involves</h4><dl className="kv">
        <Row field="owner_role" value={task.owner_role} refs={refs} />
        <Row label="Partner groups" hint="Up to five groups that work with us on this task, each with its role. What we need from each one is on the Links tab."
          value={task.partners.map((p) => `${p.work_group_code} (${refs.value(p.role) || 'role not set'})`).join(', ')} />
        <Row label="Depends on" hint="Automatic, from the partners: what we need from each one." value={dependsOn} />
        <Row label="Contributes to" hint="Automatic, from the contributions: for an Enable or Support task, the groups and tasks it helps."
          value={contributesTo} />
      </dl></section>
      <section className="sec"><h4>3 · Plan</h4><dl className="kv">
        <Row field="planned_start" value={fmtDate(task.planned_start)} />
        <Row field="planned_finish" value={fmtDate(task.planned_finish)} />
        <Row label="Duration" hint="Working days between start and finish, Friday and Saturday off." value={task.duration_days?.toString() ?? ''} />
        <Row label="Activities" hint="Automatic: the activities listed for this task." value={String(task.activity_count)} />
      </dl></section>
      <section className="sec"><h4>4 · Readiness</h4><dl className="kv">
        <Row field="status" raw={<StatusPill status={task.status} />} />
        <Row label="Check" hint="The automatic check. See the Check tab for each problem." raw={<CheckBadge summary={task.check_summary} />} />
        <dt>Last change</dt><dd>{fmtStamp(task.updated_at)} {task.updated_by_name && `by ${task.updated_by_name}`}</dd>
      </dl></section>
    </>
  );
}

function Activities({ task, onAdd, onEdit }: { task: Task; onAdd: () => void; onEdit: (a: Activity) => void }) {
  const activities = useActivities(task.id);
  const { remove } = useResource('activities');
  const byId = new Map((activities.data ?? []).map((a) => [a.id, a]));
  return (
    <section className="sec">
      <div className="sech">
        <h4>Activities <Tip text="The detailed plan of a big task, once it is known: one row per activity, in order. The TMO adds them to the Master Plan under their task." /></h4>
        {task.access.can_edit && <button type="button" className="btn sm" onClick={onAdd}>+ Add activity</button>}
      </div>
      <ErrorText error={remove.error} />
      {activities.data?.length ? (
        <div className="tw"><table>
          <thead><tr><th>ID</th><th>Activity</th><th>Owner</th><th>Dates</th><th className="r">Days</th><th>Waits for</th><th>Check</th><th /></tr></thead>
          <tbody>
            {activities.data.map((a) => (
              <tr key={a.id}>
                <td className="id">{a.code}</td>
                <td>{a.name}</td>
                <td className="nowrap">{a.owner_name || '—'}</td>
                <td className="mono small nowrap">{fmtDate(a.start_date)} → {fmtDate(a.finish_date)}</td>
                <td className="num r">{a.duration_days ?? ''}</td>
                <td className="mono small">{a.predecessors.map((p) => byId.get(p)?.code.slice(-3)).join(', ') || '—'}</td>
                <td>{issuesBadge(a.issues)}</td>
                <td className="r nowrap">{task.access.can_edit && (
                  <><button type="button" className="btn ghost sm" onClick={() => onEdit(a)}>Edit</button><ConfirmButton onConfirm={() => remove.mutate(a.id)} /></>
                )}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      ) : <Empty>No activities yet. List the activities of a big task here once they are known.</Empty>}
    </section>
  );
}

function PartnerLine({ p, refs }: { p: PartnerRow; refs: Refs }) {
  return (
    <>
      <span className="tag wg">{p.work_group_code}</span>
      <span>{p.need || <span className="dim">What we need: not filled in</span>}
        <span className="sub">{refs.value(p.role) || 'role not set'} · {refs.value(p.needed_when) || 'when: —'} · {their(p.their_task_info, p.their_task_ref)}{p.agreed ? ' · agreed both sides' : ''}</span>
      </span>
    </>
  );
}

function ContributionLine({ c, refs }: { c: ContributionRow; refs: Refs }) {
  return (
    <>
      <span className="tag wg">{c.to_group_code || '—'}</span>
      <span>{c.benefit || <span className="dim">What we deliver: not filled in</span>}
        <span className="sub">{refs.value(c.needed_when) || 'when: —'} · {their(c.their_task_info, c.their_task_ref)}{c.agreed ? ' · agreed both sides' : ''}</span>
      </span>
    </>
  );
}

function Links({ task, refs }: { task: Task; refs: Refs }) {
  const navigate = useNavigate();
  const neededBy = useNeededBy(task.id);
  const supportedBy = useSupportedBy(task.id);
  const edit = task.access.can_edit;
  const linksOut = ['enable', 'support'].includes(refs.lookup(task.owner_role)?.semantic ?? '');
  const goEdit = () => navigate(`/tasks/${task.id}/edit?section=1`);
  return (
    <>
      <section className="sec">
        <div className="sech"><h4>Partners · what we need from them <Tip text={`Up to ${MAX_ROWS} partner groups: what we need from each one, when, and their task number agreed in the meeting. All are required.`} /> <span className="cc">{task.partners.length} / {MAX_ROWS}</span></h4>
          {edit && <span className="sech-a">
            {task.partners.length > 0 && <button type="button" className="btn sm" onClick={goEdit}>Edit partners</button>}
            {task.partners.length < MAX_ROWS && <button type="button" className="btn sm" onClick={goEdit}>+ Add partner</button>}
          </span>}</div>
        {task.partners.length ? <div className="list">{task.partners.map((p) => (
          <div key={p.id} className="li li4"><PartnerLine p={p} refs={refs} />{issuesBadge(p.issues)}<span /></div>))}</div>
          : <Empty>No partner groups. Add one when another group works with us on this task.</Empty>}
      </section>
      {linksOut && (
        <section className="sec">
          <div className="sech"><h4>Contributions · what we deliver <Tip text={`This task's owner role is ${refs.value(task.owner_role)}: record up to ${MAX_ROWS} contributions, each with the group it helps, what it delivers, when they need it and their task number.`} /> <span className="cc">{task.contributions.length} / {MAX_ROWS}</span></h4>
            {edit && <span className="sech-a">
              {task.contributions.length > 0 && <button type="button" className="btn sm" onClick={goEdit}>Edit contributions</button>}
              {task.contributions.length < MAX_ROWS && <button type="button" className="btn sm" onClick={goEdit}>+ Add contribution</button>}
            </span>}</div>
          {task.contributions.length ? <div className="list">{task.contributions.map((c) => (
            <div key={c.id} className="li li4"><ContributionLine c={c} refs={refs} />{issuesBadge(c.issues)}<span /></div>))}</div>
            : <div className="empty bad">No contribution yet: meet the group this task helps and record what we deliver and their task number.</div>}
        </section>
      )}
      <section className="sec">
        <div className="sech"><h4>Feeds into <Tip text="Other tasks that recorded this task as their partner's task, or as the task they contribute to." /></h4></div>
        {(neededBy.data?.results.length || supportedBy.data?.results.length) ? <div className="list">
          {neededBy.data?.results.map((p) => (
            <Link key={`p${p.id}`} to={`/tasks/${p.task}`} className="li"><span className="mono acc">{p.task_ref.code}</span><span>{p.need}<span className="sub">{p.task_ref.title}</span></span><span className="dim">needs it</span></Link>))}
          {supportedBy.data?.results.map((c) => (
            <Link key={`c${c.id}`} to={`/tasks/${c.task}`} className="li"><span className="mono acc">{c.task_ref.code}</span><span>{c.benefit}<span className="sub">{c.task_ref.title}</span></span><span className="dim">supports it</span></Link>))}
        </div> : <Empty>No other task points to this one yet.</Empty>}
      </section>
    </>
  );
}

function Checks({ task }: { task: Task }) {
  return (
    <section className="sec">
      <h4>Automatic check</h4>
      {task.checks.length ? (
        <ul className="issues">{task.checks.map((c, i) => (
          <li key={i} className={c.level}><span className="cl">{c.label}</span><span>{c.message}</span></li>))}</ul>
      ) : <div className="empty ok">✓ OK. The task, its partners, contributions and activities are complete.</div>}
      <p className="hint">Red must be fixed. Amber is still to complete before the task can be Ready to include.</p>
    </section>
  );
}

/** Another work group's task as a team sees it: who owns it, when, and the partner and contribution rows it shares with the team. */
function SharedTaskView({ t, refs }: { t: SharedTask; refs: Refs }) {
  const { partners, contributions } = t.shared;
  return (
    <div className="stack">
      <div className="task-head panel shared-head">
        <div className="row">
          <span className="mono acc">{t.code}</span>
          <span className="tag wg">{t.work_group_code}</span>
          <StatusPill status={t.status} />
          <span className="chk warn">Shared view</span>
        </div>
        <h2>{t.title}</h2>
        <div className="meta">
          {refs.group(t.work_group)?.name} · <span className="mono">{fmtDate(t.planned_start) || '?'} → {fmtDate(t.planned_finish) || '?'}</span>
        </div>
        <p className="hint shared-note">
          This task belongs to another work group. You see only what it has in common with your group: partner needs
          and contributions. Its other details and plan stay with its owners.
        </p>
      </div>
      <section className="sec">
        <h4>Partner needs with your group <Tip text="Partner rows: one side named the other as a partner and recorded what it needs." /></h4>
        {partners.length ? <div className="list">{partners.map((p) => (
          p.task === t.id ? (
            <div key={p.id} className="li"><PartnerLine p={p} refs={refs} /><span className="dim">needs your group</span></div>
          ) : (
            <Link key={p.id} to={`/tasks/${p.task}`} className="li"><span className="mono acc">{p.task_ref.code}</span>
              <span>{p.need}<span className="sub">{p.task_ref.title}</span></span><span className="dim">your task needs it</span></Link>
          )))}</div> : <Empty>No partner rows with your group.</Empty>}
      </section>
      <section className="sec">
        <h4>Contributions <Tip text="Contribution rows between this task and your group." /></h4>
        {contributions.length ? <div className="list">{contributions.map((c) => (
          c.task === t.id ? (
            <div key={c.id} className="li"><ContributionLine c={c} refs={refs} /><span className="dim">helps your group</span></div>
          ) : (
            <Link key={c.id} to={`/tasks/${c.task}`} className="li"><span className="mono acc">{c.task_ref.code}</span>
              <span>{c.benefit}<span className="sub">{c.task_ref.title}</span></span><span className="dim">your task supports it</span></Link>
          )))}</div> : <Empty>No contributions between this task and your group.</Empty>}
      </section>
    </div>
  );
}

export default function TaskPage() {
  const { id } = useParams();
  const taskId = Number(id);
  const task = useTask(taskId);
  const refs = useRefs();
  const navigate = useNavigate();
  const transition = useTransition();
  const { remove } = useResource('tasks');
  const [params] = useSearchParams();
  const asked = params.get('tab');
  const [tab, setTab] = useState<'details' | 'activities' | 'links' | 'check'>(
    asked === 'activities' || asked === 'links' || asked === 'check' ? asked : 'details',
  );
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Activity | null>(null);

  if (task.error instanceof ApiError && task.error.status === 404) {
    return <Empty>This task is not available to you. It belongs to another work group and is not linked to yours.</Empty>;
  }
  if (task.error) return <ErrorText error={task.error} />;
  if (!task.data || !refs.ready) return <Loading />;
  if (isShared(task.data)) return <SharedTaskView t={task.data} refs={refs} />;
  const t = task.data;
  const tabs = [
    ['details', 'Details'],
    ['activities', `Activities (${t.activity_count})`],
    ['links', `Links (${t.partners.length + t.contributions.length})`],
    ['check', `Check (${t.checks.length})`],
  ] as const;

  return (
    <div className="stack">
      <div className="task-head panel">
        <div className="row">
          <span className="mono acc">{t.code}</span>
          <span className="tag wg">{t.work_group_code}</span>
          <StatusPill status={t.status} />
          <CheckBadge summary={t.check_summary} />
          <span className="spacer" />
          {t.access.transitions.map((s) => (
            <button key={s} type="button" className={`btn sm ${s === 'in_master_plan' || s === 'ready' ? 'pri' : ''}`}
              onClick={() => transition.mutate({ id: t.id, status: s })} disabled={transition.isPending}>
              {t.status === 'in_master_plan' && s === 'ready' ? 'Release to the group' : TRANSITION_LABEL[s]}
            </button>
          ))}
          {t.access.can_edit && <button type="button" className="btn sm" onClick={() => navigate(`/tasks/${t.id}/edit`)}>Edit</button>}
          {t.access.can_delete && (
            <ConfirmButton label="Delete" onConfirm={() => remove.mutate(t.id, { onSuccess: () => navigate('/register') })} />
          )}
        </div>
        <h2>{t.title}</h2>
        <div className="meta">
          {refs.value(t.owner_role) || 'Owner role not set'} · <span className="mono">{fmtDate(t.planned_start) || '?'} → {fmtDate(t.planned_finish) || '?'}</span>
          {t.partners.length > 0 && <> · Partners {t.partners.map((p) => p.work_group_code).join(', ')}</>}
        </div>
        <ErrorText error={transition.error || remove.error} />
        <div className="tabs" role="tablist">
          {tabs.map(([k, label]) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{label}</button>
          ))}
        </div>
      </div>
      {tab === 'details' && <Details task={t} refs={refs} />}
      {tab === 'activities' && <Activities task={t} onAdd={() => setAdding(true)} onEdit={setEditing} />}
      {tab === 'links' && <Links task={t} refs={refs} />}
      {tab === 'check' && <Checks task={t} />}
      {adding && <ActivityForm task={t} onClose={() => setAdding(false)} />}
      {editing && <ActivityForm task={t} activity={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}
