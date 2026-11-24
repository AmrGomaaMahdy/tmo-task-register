import { useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';

import { api } from '../api/client';
import { useTmoDesk, useTransition } from '../api/queries';
import type { TmoDesk } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { useConfirm, useConfirmWithReason } from '../components/Confirm';
import { toast } from '../components/Toasts';
import { useScope } from '../components/WorkGroupScope';
import { CheckBadge, Empty, ErrorText, Kpi, Loading, Panel, StatusPill } from '../components/ui';
import { fmtAgo, fmtDate } from '../lib/format';

type Row = TmoDesk['waiting'][number];
type Show = 'all' | 'ok' | 'fix' | 'late';
const LATE = 7;

/**
 * The TMO's own desk: every task its work group leader approved, waiting to be included in the Master Plan
 * or sent back, with the longest waiting first; and what the TMO decided in the last 30 days.
 */
export default function TmoActionsPage() {
  const { me } = useAuth();
  const { wg } = useScope();
  const allowed = !!(me?.permissions.tmo || me?.permissions.admin);
  const desk = useTmoDesk(wg, allowed);
  const transition = useTransition();
  const confirm = useConfirm();
  const confirmWithReason = useConfirmWithReason();
  const client = useQueryClient();
  const [q, setQ] = useState('');
  const [show, setShow] = useState<Show>('all');
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [bulk, setBulk] = useState(false);

  const waiting = useMemo(() => desk.data?.waiting ?? [], [desk.data]);
  const rows = useMemo(() => {
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return waiting.filter((r) => {
      if (show === 'ok' && !r.can_include) return false;
      if (show === 'fix' && r.check_summary.ok) return false;
      if (show === 'late' && (r.waiting_days ?? 0) < LATE) return false;
      const hay = `${r.code} ${r.title} ${r.work_group_code} ${r.direction_title} ${r.approval_by_name ?? ''}`.toLowerCase();
      return words.every((w) => hay.includes(w));
    });
  }, [waiting, q, show]);

  if (!allowed) return <Navigate to="/" replace />;
  if (desk.error) return <ErrorText error={desk.error} />;
  if (!desk.data) return <Loading />;

  const okRows = waiting.filter((r) => r.can_include);
  const late = waiting.filter((r) => (r.waiting_days ?? 0) >= LATE);
  const decided = desk.data.decided;
  const includedN = decided.filter((d) => d.outcome === 'included').length;
  const chosen = rows.filter((r) => picked.has(r.id) && r.can_include);

  const include = async (r: Row) => {
    const ok = await confirm({
      title: 'Include this task in the Master Plan?',
      message: <><p className="confirm-subject">{r.code} – {r.title}</p><p>It joins the consolidated plan and is locked for its group.</p></>,
      confirmLabel: 'Include',
      tone: 'primary',
    });
    if (ok) transition.mutate({ id: r.id, status: 'in_master_plan' });
  };
  const sendBack = async (r: Row) => {
    const note = await confirmWithReason({
      title: 'Send this task back to its group?',
      message: <><p className="confirm-subject">{r.code} – {r.title}</p><p>It goes back to its Focal Point as Needs completion; once completed, the leader decides again.</p></>,
      confirmLabel: 'Send back',
      reason: { label: 'What the group must complete', required: true, placeholder: 'For example: agree the dates with the partner group' },
    });
    if (note !== null) transition.mutate({ id: r.id, status: 'needs_completion', note });
  };
  const includeChosen = async () => {
    const ok = await confirm({
      title: `Include ${chosen.length} tasks in the Master Plan?`,
      message: <><p>{chosen.map((r) => r.code).join(', ')}</p><p>They join the consolidated plan and are locked for their groups.</p></>,
      confirmLabel: `Include ${chosen.length}`,
      tone: 'primary',
    });
    if (!ok) return;
    setBulk(true);
    let done = 0;
    const failed: string[] = [];
    for (const r of chosen) {
      try {
        await api(`/api/tasks/${r.id}/transition/`, { method: 'POST', body: { status: 'in_master_plan' } });
        done += 1;
      } catch {
        failed.push(r.code);
      }
    }
    setBulk(false);
    setPicked(new Set());
    await Promise.all(['tmo-desk', 'master-plan', 'tasks', 'task', 'summary', 'notifications', 'board-summary'].map((k) => client.invalidateQueries({ queryKey: [k] })));
    toast(failed.length ? `${done} included. Not included: ${failed.join(', ')}.` : `${done} tasks included in the Master Plan.`);
  };
  const toggle = (id: number) => {
    const next = new Set(picked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setPicked(next);
  };
  const pickable = rows.filter((r) => r.can_include);
  const allPicked = pickable.length > 0 && pickable.every((r) => picked.has(r.id));
  const ageTone = (d: number | null) => ((d ?? 0) >= 14 ? 'bad' : (d ?? 0) >= LATE ? 'warn' : '');
  const days = (d: number | null) => (d === null ? '–' : d === 0 ? 'Today' : d === 1 ? '1 day' : `${d} days`);

  return (
    <div className="stack">
      <div className="kpis k5">
        <Kpi label="Waiting for the TMO" value={waiting.length} sub="Approved by their leader" tip="Leader Approved tasks: include them in the Master Plan or send them back to their group." />
        <Kpi label="Ready to include" value={okRows.length} sub="Their check is OK" tip="Tasks whose automatic check is OK. They can be included at once." />
        <Kpi label="To fix first" value={waiting.length - okRows.length} sub="Check not OK" tip="A task whose check is not OK cannot be included. Send it back with what to fix." />
        <Kpi label={`Waiting ${LATE}+ days`} value={late.length} sub="Since the leader approved" tip={`Tasks the leader approved ${LATE} or more days ago.`} />
        <Kpi label={`Decided in ${desk.data.decided_days} days`} value={decided.length} sub={`${includedN} included · ${decided.length - includedN} sent back`} tip="The TMO's decisions of the last 30 days." />
      </div>

      <Panel
        title={`Waiting for your decision${waiting.length ? ` · ${waiting.length}` : ''}`}
        tip="Every task its work group leader approved. Check its links and dates, then include it in the Master Plan or send it back with a reason. The longest waiting come first."
        actions={chosen.length > 0 && (
          <button type="button" className="btn sm pri" disabled={bulk} onClick={() => void includeChosen()}>
            {bulk ? 'Including…' : `Include selected (${chosen.length})`}
          </button>
        )}
      >
        <div className="filters tmo-filters">
          <input type="search" placeholder="Search ID, title, group, direction or leader" aria-label="Search" value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="seg" role="group" aria-label="Show">
            {([['all', 'All', waiting.length], ['ok', 'Ready to include', okRows.length], ['fix', 'To fix first', waiting.length - okRows.length], ['late', `Waiting ${LATE}+ days`, late.length]] as [Show, string, number][]).map(([k, label, n]) => (
              <button key={k} type="button" className={show === k ? 'on' : ''} aria-pressed={show === k} onClick={() => setShow(k)}>{label} <span className="seg-n">{n}</span></button>
            ))}
          </div>
          {pickable.length > 0 && (
            <label className="tmo-all">
              <input type="checkbox" checked={allPicked} onChange={() => setPicked(allPicked ? new Set() : new Set(pickable.map((r) => r.id)))} />
              Select all ready to include
            </label>
          )}
        </div>
        <ErrorText error={transition.error} />
        {rows.length ? (
          <div className="tmo-list">
            {rows.map((r) => (
              <article key={r.id} className={`tmo-card ${picked.has(r.id) ? 'on' : ''}`}>
                <div className="tmo-pick">
                  <input type="checkbox" aria-label={`Select ${r.code}`} checked={picked.has(r.id)} disabled={!r.can_include} onChange={() => toggle(r.id)}
                    data-tip={r.can_include ? 'Select to include with others' : 'The check is not OK: it cannot be included'} />
                </div>
                <div className="tmo-main">
                  <div className="tmo-top">
                    <Link to={`/tasks/${r.id}`} className="id tmo-id">{r.code}</Link>
                    <span className="tag wg">{r.work_group_code}</span>
                    <CheckBadge summary={r.check_summary} />
                  </div>
                  <div className="tmo-title">{r.title}</div>
                  <div className="tmo-meta">
                    <span><b>Plan</b> {fmtDate(r.planned_start)} → {fmtDate(r.planned_finish)}{r.duration_days ? ` · ${r.duration_days} working days` : ''}</span>
                    {r.direction_code && <span><b>Direction</b> {r.direction_code}</span>}
                    <span><b>Partners</b> {r.partner_codes.length ? r.partner_codes.join(', ') : 'none'}</span>
                    <span><b>Activities</b> {r.activities.length}</span>
                    {r.waits_for.length > 0 && <span><b>Waits for</b> {r.waits_for.join(', ')}</span>}
                  </div>
                </div>
                <div className="tmo-side">
                  <span className={`tmo-age ${ageTone(r.waiting_days)}`} data-tip={r.approval_at ? `Approved ${fmtAgo(r.approval_at)}` : ''}>{days(r.waiting_days)}</span>
                  <span className="t2">{r.approval_by_name ? `Approved by ${r.approval_by_name}` : 'Approved by the leader'}</span>
                  <span className="tmo-acts">
                    <Link className="btn sm ghost" to={`/tasks/${r.id}`}>Open task</Link>
                    {r.can_return && <button type="button" className="btn sm" disabled={transition.isPending || bulk} onClick={() => void sendBack(r)}>Send back</button>}
                    {r.can_include
                      ? <button type="button" className="btn sm pri" disabled={transition.isPending || bulk} onClick={() => void include(r)}>Include</button>
                      : <button type="button" className="btn sm pri" disabled data-tip="Fix the check first">Include</button>}
                  </span>
                </div>
              </article>
            ))}
          </div>
        ) : waiting.length ? (
          <Empty>No task matches. Clear the search or choose All.</Empty>
        ) : (
          <Empty>Nothing waits for the TMO. Tasks come here once their work group leader approves them.</Empty>
        )}
      </Panel>

      <Panel title={`Decided in the last ${desk.data.decided_days} days`} tip="Tasks the TMO included in the Master Plan or sent back to their group, newest first.">
        {decided.length ? (
          <div className="tw"><table>
            <thead><tr><th>ID</th><th>Task</th><th>Decision</th><th>By</th><th>When</th><th>Now</th></tr></thead>
            <tbody>
              {decided.map((d) => (
                <tr key={d.id}>
                  <td className="id"><Link to={`/tasks/${d.id}`}>{d.code}</Link></td>
                  <td className="wide-cell"><div className="t1">{d.title}</div><div className="t2">{d.work_group_code}{d.note ? ` · “${d.note}”` : ''}</div></td>
                  <td><span className={`pill ${d.outcome === 'included' ? 'ok' : 'warn'}`}>{d.outcome === 'included' ? 'Included' : 'Sent back'}</span></td>
                  <td className="small">{d.by}</td>
                  <td className="small nowrap" data-tip={fmtDate(d.at.slice(0, 10))}>{fmtAgo(d.at)}</td>
                  <td><StatusPill status={d.status} /></td>
                </tr>
              ))}
            </tbody>
          </table></div>
        ) : <Empty>{`No decision in the last ${desk.data.decided_days} days.`}</Empty>}
      </Panel>
    </div>
  );
}
