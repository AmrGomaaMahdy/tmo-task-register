import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import { api } from '../api/client';
import type { Status } from '../api/types';
import { STATUS_LABEL } from '../lib/fields';
import { fmtStamp } from '../lib/format';

/** One step of a task's way through the readiness flow (GET /api/tasks/<id>/workflow/). */
export interface WorkflowEvent {
  kind: 'created' | 'submitted' | 'withdrawn' | 'leader_approved' | 'leader_rejected' | 'included' | 'sent_back' | 'status';
  at: string | null;
  by: string;
  role: string;
  from_status: Status | null;
  to_status: Status | null;
  note: string;
}

export function useWorkflow(taskId: number | undefined) {
  return useQuery({
    // Under ['task', id] so every change to the task (a decision, a transition, a save) refreshes it.
    queryKey: ['task', taskId, 'workflow'],
    queryFn: () => api<{ status: Status; events: WorkflowEvent[] }>(`/api/tasks/${taskId}/workflow/`),
    enabled: !!taskId,
  });
}

/** The four stages of the flow, and which events reach each one. */
const STAGES: { key: string; label: string; who: string; statuses: Status[]; kinds: WorkflowEvent['kind'][] }[] = [
  { key: 'prepare', label: 'Prepared', who: 'Focal Point', statuses: ['draft', 'needs_completion'], kinds: ['created', 'withdrawn', 'leader_rejected', 'sent_back', 'status'] },
  { key: 'ready', label: 'Ready to include', who: 'Submitted to the leader', statuses: ['ready'], kinds: ['submitted'] },
  { key: 'leader', label: 'Leader Approved', who: 'Work group leader', statuses: ['leader_approved'], kinds: ['leader_approved'] },
  { key: 'plan', label: 'In Master Plan', who: 'TMO', statuses: ['in_master_plan'], kinds: ['included'] },
];

const TITLE: Record<WorkflowEvent['kind'], string> = {
  created: 'Created',
  submitted: 'Submitted to the leader',
  withdrawn: 'Withdrawn to draft',
  leader_approved: 'Approved by the leader',
  leader_rejected: 'Rejected by the leader',
  included: 'Included in the Master Plan',
  sent_back: 'Sent back by the TMO',
  status: 'Status changed',
};
const TONE: Record<WorkflowEvent['kind'], string> = {
  created: 'neutral', submitted: 'ready', withdrawn: 'warn', leader_approved: 'leader', leader_rejected: 'bad',
  included: 'plan', sent_back: 'bad', status: 'neutral',
};

/**
 * The task's readiness flow at a glance: a stepper of the four stages (done, current, to come) with who
 * took each step and when, and below it the full history with every decision and its reason. `compact`
 * (the edit form) shows the stepper and the latest step only.
 */
export default function StatusWorkflow({ taskId, status, compact = false }: { taskId: number; status: Status; compact?: boolean }) {
  const flow = useWorkflow(taskId);
  const [all, setAll] = useState(false);
  const events = flow.data?.events ?? [];
  const current = STAGES.findIndex((s) => s.statuses.includes(status));
  const last = events[events.length - 1];
  const sentBack = status === 'needs_completion' && last && (last.kind === 'leader_rejected' || last.kind === 'sent_back');
  const latest = (i: number) => [...events].reverse().find((e) => STAGES[i].kinds.includes(e.kind));
  const shown = all ? events : events.slice(-6);

  return (
    <section className={`wf${compact ? ' wf-compact' : ''}`} aria-label="Status workflow">
      <ol className="wf-steps" style={{ ['--wf-done' as string]: String(Math.max(0, current)) }}>
        {STAGES.map((s, i) => {
          // The Master Plan is the end of the flow: reaching it completes the last step too.
          const state = i < current || (i === current && status === 'in_master_plan') ? 'done' : i === current ? 'current' : 'todo';
          const e = i <= current ? latest(i) : undefined;
          return (
            <li key={s.key} className={`wf-step ${state} st-${s.key}${i === 0 && sentBack ? ' returned' : ''}`} style={{ ['--i' as string]: String(i) }}
              aria-current={state === 'current' ? 'step' : undefined}>
              {i > 0 && <span className="wf-line" aria-hidden="true"><i /></span>}
              <span className="wf-dot" aria-hidden="true">
                {state === 'done' ? (
                  <svg viewBox="0 0 16 16" width="16" height="16"><path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
                ) : i === 0 && sentBack ? (
                  <svg viewBox="0 0 16 16" width="16" height="16"><path d="M6 4L2.5 7.5 6 11M3 7.5h6.5a4 4 0 010 8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
                ) : <b>{i + 1}</b>}
              </span>
              <span className="wf-label">
                <span className="wf-name">{i === 0 && current === 0 ? STATUS_LABEL[status] : s.label}</span>
                <span className="wf-who">
                  {e ? <>{e.by || '—'}{e.role && <em> · {e.role}</em>}{e.at && <><br /><time>{fmtStamp(e.at)}</time></>}</>
                    : state === 'todo' ? <span className="t2">{s.who}</span> : null}
                </span>
              </span>
            </li>
          );
        })}
      </ol>
      {sentBack && last?.note && (
        <p className="wf-back" role="note"><b>{TITLE[last.kind]}:</b> “{last.note}”</p>
      )}
      {compact ? (
        last && !sentBack && <p className="wf-latest t2">Latest: <b>{TITLE[last.kind]}</b> · {last.by}{last.role ? ` (${last.role})` : ''} · {fmtStamp(last.at)}</p>
      ) : (
        <>
          <h4 className="wf-h">History</h4>
          <ol className="wf-hist">
            {shown.map((e, i) => (
              <li key={`${e.kind}-${e.at}-${i}`} className={`wf-ev tone-${TONE[e.kind]}`} style={{ ['--i' as string]: String(i) }}>
                <span className="wf-ev-dot" aria-hidden="true" />
                <div>
                  <div className="wf-ev-title">
                    <b>{e.kind === 'status' && e.to_status ? `${TITLE.status}: ${STATUS_LABEL[e.to_status]}` : TITLE[e.kind]}</b>
                    {e.at && <time className="t2">{fmtStamp(e.at)}</time>}
                  </div>
                  <div className="t2">{e.by || '—'}{e.role ? ` · ${e.role}` : ''}</div>
                  {e.note && <div className="wf-note">“{e.note}”</div>}
                </div>
              </li>
            ))}
          </ol>
          {events.length > 6 && (
            <button type="button" className="dn wf-more" onClick={() => setAll((v) => !v)}>{all ? 'Show the latest steps' : `Show all ${events.length} steps`}</button>
          )}
          {flow.isLoading && <p className="t2">Loading the history…</p>}
        </>
      )}
    </section>
  );
}
