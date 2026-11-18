import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import { useDecide, useGovernance, useResource } from '../api/queries';
import type { Decision, GovernanceDirect, GovernanceLink } from '../api/types';
import DecisionDialog, { DecisionButtons, type DecisionTarget } from '../components/DecisionDialog';
import { useScope } from '../components/WorkGroupScope';
import { ApprovalBadge, ConfirmButton, Empty, ErrorText, Panel, StatusPill, Tip } from '../components/ui';
import { DECISION_LABEL } from '../lib/fields';
import { fmtDate, fmtStamp } from '../lib/format';

type Tab = 'direct' | 'links';
const FILTERS: (Decision | 'all')[] = ['all', 'pending', 'approved', 'clarification', 'timeline', 'rejected'];

function counts<T>(rows: T[], key: (r: T) => Decision) {
  const c: Record<Decision, number> = { pending: 0, approved: 0, clarification: 0, timeline: 0, rejected: 0 };
  rows.forEach((r) => (c[key(r)] += 1));
  return c;
}

/**
 * Governance: the work group leader's desk. Tab 1, the group's Direct tasks to approve, reject, question
 * or remove. Tab 2, every link other groups recorded with the group: what they need from it (partner
 * rows) and what they deliver to it (contributions), to approve, reject, question or move in time.
 */
export default function GovernancePage() {
  const { wg } = useScope();
  const [params, setParams] = useSearchParams();
  const tab: Tab = params.get('tab') === 'links' ? 'links' : 'direct';
  const setTab = (t: Tab) => setParams(t === 'links' ? { tab: 'links' } : {}, { replace: true });
  const [filter, setFilter] = useState<Decision | 'all'>('pending');
  const [taskType, setTaskType] = useState('');
  const [target, setTarget] = useState<DecisionTarget | null>(null);
  const desk = useGovernance(wg);
  const decide = useDecide();
  const { remove } = useResource('tasks', ['governance']);
  const d = desk.data;

  const direct = useMemo(() => (d?.direct ?? []).filter((t) => filter === 'all' || t.approval === filter), [d, filter]);
  const links = useMemo(
    () => (d?.links ?? []).filter((l) => (filter === 'all' || l.review === filter) && (!taskType || l.owner_role === taskType)),
    [d, filter, taskType],
  );
  const linkSummary = (l: GovernanceLink) =>
    `${l.kind === 'partner' ? `${l.from_group} needs from ${l.group}` : `${l.from_group} delivers to ${l.group}`}: ${l.what || '—'} · ${l.needed_when || 'when not set'}`;
  const removeLink = (l: GovernanceLink) => () =>
    setTarget({ kind: l.kind, id: l.id, decision: 'remove', subject: `${l.task_code} – ${l.task_title}`, current: linkSummary(l) });
  const cDirect = counts(d?.direct ?? [], (t) => t.approval);
  const cLinks = counts(d?.links ?? [], (l) => l.review);
  const c = tab === 'direct' ? cDirect : cLinks;
  const groups = d?.groups ?? [];

  const approve = (kind: DecisionTarget['kind'], id: number) => decide.mutate({ kind, id, body: { decision: 'approved' } });
  const pickTask = (t: GovernanceDirect) => (k: Exclude<Decision, 'pending'>) =>
    k === 'approved' ? approve('task', t.id) : setTarget({ kind: 'task', id: t.id, decision: k, subject: `${t.code} – ${t.title}` });
  const pickLink = (l: GovernanceLink) => (k: Exclude<Decision, 'pending'>) =>
    k === 'approved'
      ? approve(l.kind, l.id)
      : setTarget({
          kind: l.kind,
          id: l.id,
          decision: k,
          subject: `${l.task_code} – ${l.task_title}`,
          current: linkSummary(l),
        });

  return (
    <>
      <Panel
        title={groups.length === 1 ? `Governance · ${groups[0].code} – ${groups[0].name}` : 'Governance'}
        tip="Each work group has a Team Leader role (for example HR Team Leader), with full control of the group. The leader approves the group's own Direct tasks, and decides on other groups' Direct and Enable / Support tasks that involve the group: approve, reject, ask for clarification or propose a timeline. The TMO and the committee follow the decisions here."
      >
        <p className="intro">
          {groups.length === 1 && groups[0].leader ? <>Leader: <b>{groups[0].leader}</b>. </> : null}
          Approve what is valid; ask for clarification, propose a new date, reject, or remove what does not involve your group,
          with a short note the other group will see. A Direct task needs its leader&apos;s approval before the TMO can take it
          into the Master Plan.
        </p>
        {groups.length > 1 && (
          <div className="gov-leaders">
            {groups.map((g) => <span key={g.id} className="tag">{g.code} · {g.leader || <i className="t2">no leader yet</i>}</span>)}
          </div>
        )}
        <div className="view-tabs" role="tablist" aria-label="Governance">
          <button type="button" role="tab" aria-selected={tab === 'direct'} className={tab === 'direct' ? 'on' : ''} onClick={() => setTab('direct')}>
            Direct tasks {cDirect.pending > 0 && <b className="count">{cDirect.pending}</b>}
          </button>
          <button type="button" role="tab" aria-selected={tab === 'links'} className={tab === 'links' ? 'on' : ''} onClick={() => setTab('links')}>
            Other groups&apos; tasks with us {cLinks.pending > 0 && <b className="count">{cLinks.pending}</b>}
          </button>
        </div>
        {tab === 'links' && (
          <div className="filters gov-type">
            <select aria-label="Their task type" value={taskType} onChange={(e) => setTaskType(e.target.value)}>
              <option value="">Direct, Enable and Support tasks</option>
              <option value="Direct">Direct tasks</option>
              <option value="Enable">Enable tasks</option>
              <option value="Support">Support tasks</option>
            </select>
          </div>
        )}
        <div className="gov-filter seg" role="group" aria-label="Decision">
          {FILTERS.map((f) => (
            <button key={f} type="button" className={filter === f ? 'on' : ''} aria-pressed={filter === f} onClick={() => setFilter(f)}>
              {f === 'all' ? 'All' : DECISION_LABEL[f]} <span className="n">{f === 'all' ? (tab === 'direct' ? d?.direct.length : d?.links.length) ?? 0 : c[f]}</span>
            </button>
          ))}
        </div>
        <ErrorText error={desk.error || decide.error || remove.error} />
        {!d ? <div className="skel" style={{ height: 220 }} /> : tab === 'direct' ? (
          <div className="tw fade-swap" key={`d-${filter}`}>
            <table>
              <thead>
                <tr>
                  <th>Task ID</th>
                  <th>Task</th>
                  {groups.length > 1 && <th>Group</th>}
                  <th>Planned</th>
                  <th>Readiness</th>
                  <th>Leader decision <Tip text="The decision, its note, and who decided when." /></th>
                  <th className="r">Decide</th>
                </tr>
              </thead>
              <tbody>
                {direct.map((t) => (
                  <tr key={t.id}>
                    <td className="id"><Link to={`/tasks/${t.id}`}>{t.code}</Link></td>
                    <td className="wide-cell"><div className="t1">{t.title}</div><div className="t2">{t.direction_code || 'No direction yet'}</div></td>
                    {groups.length > 1 && <td><span className="tag wg">{t.work_group_code}</span></td>}
                    <td className="mono nowrap small">{fmtDate(t.planned_start)}{t.planned_finish ? ` → ${fmtDate(t.planned_finish)}` : ''}</td>
                    <td><StatusPill status={t.status} /></td>
                    <td>
                      <ApprovalBadge decision={t.approval} note={t.approval_note} />
                      {t.approval_note && <div className="t2 note">{t.approval_note}</div>}
                      {t.approval_by_name && <div className="t2">{t.approval_by_name} · {fmtStamp(t.approval_at)}</div>}
                    </td>
                    <td className="r nowrap">
                      {t.can_decide ? (
                        <>
                          <DecisionButtons kinds={['approved', 'clarification', 'rejected']} current={t.approval} onPick={pickTask(t)} />
                          {t.can_remove && <ConfirmButton label="Remove" title="Remove this task from the register" onConfirm={() => remove.mutate(t.id)}
                            confirmTitle="Remove this task from the register?" subject={`${t.code} – ${t.title}`} message="The task is deleted with its activities and links. This cannot be undone." />}
                        </>
                      ) : <span className="t2">Leader decides</span>}
                    </td>
                  </tr>
                ))}
                {!direct.length && <tr><td colSpan={7}><Empty>{filter === 'all' ? 'No Direct task yet.' : `No Direct task marked “${DECISION_LABEL[filter as Decision]}”.`}</Empty></td></tr>}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="tw fade-swap" key={`l-${filter}`}>
            <table>
              <thead>
                <tr>
                  <th>Link <Tip text="They need from us: another group named ours as a partner. They deliver to us: another group's Enable / Support task contributes to ours." /></th>
                  <th>Their task <Tip text="The other group's task: a Direct task that names your group as a partner, or an Enable / Support task that contributes to your group." /></th>
                  <th>What</th>
                  <th>When</th>
                  <th>Our task <Tip text="The task number of ours they recorded." /></th>
                  <th>Leader review</th>
                  <th className="r">Decide</th>
                </tr>
              </thead>
              <tbody>
                {links.map((l) => (
                  <tr key={`${l.kind}-${l.id}`}>
                    <td className="nowrap">
                      <span className={`dir dir-${l.kind}`}>{l.kind === 'partner' ? 'They need from us' : 'They deliver to us'}</span>
                      <div className="t2">{l.from_group} → {l.group}{l.role ? ` · ${l.role}` : ''}</div>
                    </td>
                    <td className="wide-cell">
                      <Link className="id" to={`/tasks/${l.task}`}>{l.task_code}</Link>
                      {l.owner_role && <span className={`tag own-${l.owner_role.toLowerCase()}`}>{l.owner_role}</span>}
                      <div className="t2">{l.task_title}</div>
                    </td>
                    <td className="wide-cell">{l.what || <span className="t2">Not filled in yet</span>}</td>
                    <td className="nowrap">{l.needed_when || '—'}<div className="t2 mono">{fmtDate(l.planned_start)}{l.planned_finish ? ` → ${fmtDate(l.planned_finish)}` : ''}</div></td>
                    <td className="id nowrap">{l.their_task_ref || <span className="t2">—</span>}</td>
                    <td>
                      <ApprovalBadge decision={l.review} note={l.review_note} />
                      {l.review === 'timeline' && l.review_date && <div className="t2">Proposed: {fmtDate(l.review_date)}</div>}
                      {l.review_note && <div className="t2 note">{l.review_note}</div>}
                      {l.reviewed_by_name && <div className="t2">{l.reviewed_by_name} · {fmtStamp(l.reviewed_at)}</div>}
                    </td>
                    <td className="r nowrap">
                      {l.can_review
                        ? <DecisionButtons kinds={['approved', 'clarification', 'timeline', 'rejected']} current={l.review} onPick={pickLink(l)}
                            onRemove={l.can_remove ? removeLink(l) : undefined} />
                        : <span className="t2">{l.group} leader decides</span>}
                    </td>
                  </tr>
                ))}
                {!links.length && <tr><td colSpan={7}><Empty>{filter === 'all' ? 'No link with other groups yet.' : `No link marked “${DECISION_LABEL[filter as Decision]}”.`}</Empty></td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      {target && <DecisionDialog target={target} onClose={() => setTarget(null)} />}
    </>
  );
}
