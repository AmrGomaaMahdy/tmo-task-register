import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';

import { useMarkNotificationsSeen, useNotifications, type ActionItem } from '../api/queries';
import { fmtAgo } from '../lib/format';
import { toast } from './Toasts';

type Kind = ActionItem['kind'];
type Tone = 'bad' | 'warn' | 'ready' | 'plan' | 'link' | 'amber';

/**
 * What each kind of action asks, in the words of the person who has to do it.
 * `title`: what happened or what is asked; `cta`: the button; `by`: who the name under it is;
 * `how`: the instruction shown on the page the item opens.
 */
export const ACTION: Record<Kind, { title: string; cta: string; by: string; tone: Tone; how: string }> = {
  returned_tmo: {
    title: 'Sent back by the TMO', cta: 'Fix and resubmit', by: 'Returned by', tone: 'bad',
    how: 'The TMO sent this task back to your group. Make the change the TMO asks for, then submit it to the leader again.',
  },
  returned_leader: {
    title: 'Rejected by your leader', cta: 'Fix and resubmit', by: 'Rejected by', tone: 'bad',
    how: 'Your work group leader rejected this task. Make the change, then submit it to the leader again.',
  },
  link_rejected: {
    title: 'Link rejected by the other group', cta: 'Fix the link', by: 'Rejected by', tone: 'warn',
    how: "The other group's leader rejected a link on this task. Change it or take it out (Edit › Who it involves), then save.",
  },
  complete: {
    title: 'Complete and submit', cta: 'Complete it', by: 'Last change by', tone: 'amber',
    how: 'This task needs completion. Fill in what the check asks for, then submit it to the leader.',
  },
  decide: {
    title: 'Approve or reject', cta: 'Decide', by: 'Submitted by', tone: 'ready',
    how: 'Your Focal Point submitted this task. Check its details and its check, then approve it for the TMO or reject it with a reason.',
  },
  review_link: {
    title: 'Review a link with your group', cta: 'Review', by: 'Recorded by', tone: 'link',
    how: "Another group recorded what it needs from your group, or what it delivers to it. Approve it, or reject it with a reason when needed.",
  },
  include: {
    title: 'Include in the Master Plan', cta: 'Include or send back', by: 'Approved by', tone: 'plan',
    how: 'The work group leader approved this task. Include it in the Master Plan, or send it back to the group with a reason.',
  },
};

const SECTIONS: { title: string; kinds: Kind[] }[] = [
  { title: 'Sent back to you', kinds: ['returned_tmo', 'returned_leader', 'link_rejected'] },
  { title: 'Waiting for your decision', kinds: ['decide', 'include', 'review_link'] },
  { title: 'To complete', kinds: ['complete'] },
];

const ROLES: ActionItem['role'][] = ['Focal Point', 'Leader', 'TMO'];

export function KindIcon({ kind }: { kind: Kind }) {
  const p = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  const paths: Record<Kind, ReactNode> = {
    returned_tmo: <path d="M7 4L3.5 7.5 7 11M4 7.5h7a4 4 0 010 8H8" {...p} />,
    returned_leader: <path d="M7 4L3.5 7.5 7 11M4 7.5h7a4 4 0 010 8H8" {...p} />,
    link_rejected: <><path d="M8 12l-1.5 1.5a3 3 0 01-4-4L4 8M12 8l1.5-1.5a3 3 0 00-4-4L8 4" {...p} /><path d="M6 6l6 6" {...p} /></>,
    complete: <><path d="M12.5 3.5l2 2L7 13l-3 1 1-3z" {...p} /><path d="M3 17h12" {...p} /></>,
    decide: <><path d="M3 9.5l3.5 3.5L15 4.5" {...p} /></>,
    review_link: <><path d="M7.5 10.5a3 3 0 004.2 0l2.6-2.6a3 3 0 00-4.2-4.2L9 4.8M10.5 7.5a3 3 0 00-4.2 0L3.7 10.1a3 3 0 004.2 4.2L9 13.2" {...p} /></>,
    include: <><rect x="3" y="3.5" width="12" height="11" rx="2" {...p} /><path d="M6.5 9l2 2 3.5-4" {...p} /></>,
  };
  return <svg viewBox="0 0 18 18" width="18" height="18" aria-hidden="true">{paths[kind]}</svg>;
}

function Bell() {
  // A filled bell with a soft highlight, its clapper and two small "ring" strokes that show while work waits.
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" className="ac-bell-svg">
      <defs>
        <linearGradient id="ac-bell-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="1" />
          <stop offset="100%" stopColor="currentColor" stopOpacity=".78" />
        </linearGradient>
      </defs>
      <g className="ac-bell-body">
        <path d="M12 2.6c.7 0 1.2.5 1.2 1.2v.6a6.2 6.2 0 015 6.1v3.4l1.6 2.6c.4.7-.1 1.5-.9 1.5H5.1c-.8 0-1.3-.8-.9-1.5l1.6-2.6v-3.4a6.2 6.2 0 015-6.1v-.6c0-.7.5-1.2 1.2-1.2z" fill="url(#ac-bell-fill)" />
        <path d="M8.6 9.2a3.9 3.9 0 012.4-2.6" fill="none" stroke="var(--ac-shine, rgba(255,255,255,.55))" strokeWidth="1.4" strokeLinecap="round" />
        <path d="M9.6 19.4a2.5 2.5 0 004.8 0z" fill="currentColor" />
      </g>
      <g className="ac-waves" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
        <path d="M3.2 7.4a8.6 8.6 0 012.4-3.6" />
        <path d="M20.8 7.4a8.6 8.6 0 00-2.4-3.6" />
      </g>
    </svg>
  );
}

/** Keeps "(3) " in front of the tab's title while work waits, so it shows even when the tab is in the background. */
function useTitleCount(n: number) {
  useEffect(() => {
    const base = document.title.replace(/^\(\d+\+?\)\s/, '');
    document.title = n > 0 ? `(${n > 99 ? '99+' : n}) ${base}` : base;
  }, [n]);
}

/**
 * The action centre in the page header: a bell with the number of things the signed-in person has to do,
 * and a panel listing them, most urgent first. An item opens the task (or the governance row) with the
 * action pointed out; it leaves the list by itself once the work is done.
 */
export default function ActionCenter() {
  const q = useNotifications(true);
  const seen = useMarkNotificationsSeen();
  const client = useQueryClient();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [role, setRole] = useState<ActionItem['role'] | 'all'>('all');
  // The items that were new when the panel opened keep their mark until it closes.
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const wrap = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const known = useRef<Set<string> | null>(null);

  const items = useMemo(() => q.data?.items ?? [], [q.data]);
  const count = q.data?.count ?? 0;
  const newCount = q.data?.new ?? 0;
  useTitleCount(count);

  // A short note when new work arrives while the app is open (not on the first load).
  useEffect(() => {
    if (!q.data) return;
    const now = new Set(items.map((i) => i.key));
    if (known.current) {
      const arrived = items.filter((i) => !known.current!.has(i.key)).length;
      if (arrived > 0 && !open) toast(arrived === 1 ? 'Something new waits for you: open the bell to see it.' : `${arrived} new things wait for you: open the bell to see them.`);
    }
    known.current = now;
  }, [q.data, items, open]);

  const close = () => {
    setOpen(false);
    void client.invalidateQueries({ queryKey: ['notifications'] });
  };
  const toggle = () => {
    if (open) return close();
    setFresh(new Set(items.filter((i) => i.new).map((i) => i.key)));
    setOpen(true);
    void q.refetch();
    if (newCount > 0) seen.mutate();
  };

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (wrap.current && !wrap.current.contains(e.target as Node)) close(); };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { close(); wrap.current?.querySelector<HTMLButtonElement>('.ac-bell')?.focus(); }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        const list = [...(panel.current?.querySelectorAll<HTMLElement>('.ac-item') ?? [])];
        if (!list.length) return;
        e.preventDefault();
        const at = list.indexOf(document.activeElement as HTMLElement);
        list[(at + (e.key === 'ArrowDown' ? 1 : list.length - 1)) % list.length].focus();
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    panel.current?.querySelector<HTMLElement>('.ac-item, .ac-close')?.focus();
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const roles = ROLES.filter((r) => items.some((i) => i.role === r));
  const shown = role === 'all' || !roles.includes(role) ? items : items.filter((i) => i.role === role);
  const go = (i: ActionItem) => { close(); navigate(i.url); };
  const decisions = items.filter((i) => ['decide', 'include', 'review_link'].includes(i.kind)).length;
  const back = items.filter((i) => i.kind.startsWith('returned') || i.kind === 'link_rejected').length;

  return (
    <div className="ac" ref={wrap}>
      <button type="button" className={`ac-bell${count > 0 ? ' has-items' : ''}${newCount > 0 ? ' has-new' : ''}${open ? ' on' : ''}`} onClick={toggle}
        aria-expanded={open} aria-haspopup="dialog" aria-label={count ? `Your actions: ${count}` : 'Your actions: none'}
        data-tip={count ? `${count} things wait for you${newCount ? `, ${newCount} new` : ''}` : 'Nothing waits for you'}>
        <Bell />
        {count > 0 && <span className="ac-count" key={count}>{count > 99 ? '99+' : count}</span>}
      </button>
      {open && (
        <div className="ac-panel" ref={panel} role="dialog" aria-label="Your actions">
          <div className="ac-hd">
            <div>
              <h2>Your actions</h2>
              <p className="ac-sum">
                {count === 0 ? 'Nothing waits for you.' : (
                  <>
                    {back > 0 && <span className="ac-sum-bad">{`${back} sent back to you`}</span>}
                    {back > 0 && decisions > 0 && <span> · </span>}
                    {decisions > 0 && <span>{`${decisions} waiting for your decision`}</span>}
                    {(back > 0 || decisions > 0) && count - back - decisions > 0 && <span> · </span>}
                    {count - back - decisions > 0 && <span>{`${count - back - decisions} to complete`}</span>}
                  </>
                )}
              </p>
            </div>
            <button type="button" className="ac-close" onClick={close} aria-label="Close">✕</button>
          </div>
          {roles.length > 1 && (
            <div className="ac-roles" role="tablist" aria-label="Filter by role">
              {(['all', ...roles] as const).map((r) => (
                <button key={r} type="button" role="tab" aria-selected={role === r} className={role === r ? 'on' : ''} onClick={() => setRole(r)}>
                  <span>{r === 'all' ? 'All' : r}</span>
                  <b>{r === 'all' ? count : items.filter((i) => i.role === r).length}</b>
                </button>
              ))}
            </div>
          )}
          <div className="ac-body">
            {q.isLoading && <div className="ac-empty"><span className="skel" style={{ height: 56 }} /></div>}
            {!q.isLoading && shown.length === 0 && (
              <div className="ac-empty">
                <span className="ac-done" aria-hidden="true">
                  <svg viewBox="0 0 24 24" width="28" height="28"><path d="M5 12.5l4.5 4.5L19 7" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
                </span>
                <strong>You are all caught up</strong>
                <span className="t2">New work for you shows here as soon as it arrives.</span>
              </div>
            )}
            {SECTIONS.map((s) => {
              const rows = shown.filter((i) => s.kinds.includes(i.kind));
              if (!rows.length) return null;
              return (
                <section key={s.title} className="ac-sec">
                  <h3><span>{s.title}</span><b>{rows.length}</b></h3>
                  <ul>
                    {rows.map((i, n) => {
                      const a = ACTION[i.kind];
                      const isNew = i.new || fresh.has(i.key);
                      return (
                        <li key={i.key} style={{ ['--n' as string]: String(Math.min(n, 8)) }}>
                          <button type="button" className={`ac-item tone-${a.tone}${isNew ? ' new' : ''}`} onClick={() => go(i)}>
                            <span className="ac-ico"><KindIcon kind={i.kind} /></span>
                            <span className="ac-main">
                              <span className="ac-line1">
                                <b className="ac-title">{a.title}</b>
                                {i.link && <span className="tag">{i.link.group_code}</span>}
                                {isNew && <span className="ac-new">New</span>}
                              </span>
                              <span className="ac-task"><span className="mono">{i.task.code}</span> <span className="ac-tt" dir="auto">{i.task.title}</span></span>
                              {i.note && <span className="ac-note" dir="auto">“{i.note}”</span>}
                              <span className="ac-meta">
                                {i.by && <><span>{a.by}</span> <span className="ac-by">{i.by}</span></>}
                                {i.by && i.at && <span aria-hidden="true"> · </span>}
                                {i.at && <time dateTime={i.at}>{fmtAgo(i.at)}</time>}
                              </span>
                            </span>
                            <span className="ac-cta">{a.cta}<span aria-hidden="true" className="ac-arrow">›</span></span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              );
            })}
          </div>
          <div className="ac-ft t2">Each item leaves this list by itself once it is done.</div>
        </div>
      )}
    </div>
  );
}

/**
 * On the page an action opens (`?act=<kind>`): what to do here, and the reason when the work was sent back.
 * The place to act gets a short highlight. Closing it removes the hint from the address.
 */
export function ActionCallout({ kind, note, by, onClose }: { kind: Kind; note?: string; by?: string; onClose: () => void }) {
  const a = ACTION[kind];
  return (
    <div className={`act-callout tone-${a.tone}`} role="note">
      <span className="ac-ico"><KindIcon kind={kind} /></span>
      <div className="act-text">
        <span className="act-label">Your action: <b>{a.title}</b></span>
        <span>{a.how}</span>
        {note && <span className="act-note" dir="auto">“{note}”{by && <span className="t2"> · {by}</span>}</span>}
      </div>
      <button type="button" className="ac-close" onClick={onClose} aria-label="Hide this hint">✕</button>
    </div>
  );
}
