import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { fmtDate } from '../lib/format';
import { useConfirm } from './Confirm';
import { toast } from './Toasts';
import { ErrorText, Modal } from './ui';

export interface Delegation {
  id: number;
  work_group: number;
  work_group_code: string;
  work_group_name: string;
  leader: number;
  leader_name: string;
  delegate: number;
  delegate_name: string;
  starts_on: string;
  ends_on: string;
  note: string;
  state: 'active' | 'upcoming' | 'ended' | 'cancelled';
  created_by_name: string;
  can_cancel: boolean;
}

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export const useDelegations = () =>
  useQuery({ queryKey: ['delegations'], queryFn: () => api<Delegation[] | { results: Delegation[] }>('/api/auth/delegations/'), select: (d) => (Array.isArray(d) ? d : d.results) });

/**
 * On the Governance desk: a banner for a delegate (whose place they take, until when), and for a leader the
 * delegate of their group while they are away, with a button to name one and to cancel it.
 */
export function DelegationBox({ groups }: { groups: { id: number; code: string; name: string }[] }) {
  const { me } = useAuth();
  const q = useDelegations();
  const client = useQueryClient();
  const confirm = useConfirm();
  const [adding, setAdding] = useState<number | null>(null);
  const cancel = useMutation({
    mutationFn: (id: number) => api<Delegation>(`/api/auth/delegations/${id}/cancel/`, { method: 'POST' }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['delegations'] });
      toast('Delegation cancelled.');
    },
  });
  if (!me) return null;
  const list = q.data ?? [];
  const mine = list.filter((d) => d.delegate === me.id && d.state === 'active');
  // Groups the person may name a delegate for: those they lead; an administrator, the group on the desk.
  const own = me.permissions.admin ? (groups.length === 1 ? groups : []) : groups.filter((g) => me.work_groups.some((w) => w.id === g.id && w.leader));
  const live = (gid: number) => list.filter((d) => d.work_group === gid && (d.state === 'active' || d.state === 'upcoming'));

  const stop = async (d: Delegation) => {
    const ok = await confirm({
      title: 'Cancel this delegation?',
      message: <p>{`${d.delegate_name} stops deciding for ${d.work_group_code} at once, and is told by email.`}</p>,
      confirmLabel: 'Cancel delegation',
      cancelLabel: 'Keep it',
    });
    if (ok) cancel.mutate(d.id);
  };

  return (
    <>
      {mine.map((d) => (
        <div key={`me-${d.id}`} className="dlg-banner" role="note">
          <span className="dlg-ico" aria-hidden="true"><PersonSwap /></span>
          <div>
            <b>{`You stand in for ${d.leader_name} as leader of ${d.work_group_code}`}</b>
            <span>{` until ${fmtDate(d.ends_on)}. Approve or reject the group's tasks and links in their place.`}</span>
            {d.note && <span className="t2">{` “${d.note}”`}</span>}
          </div>
        </div>
      ))}
      {own.map((g) => {
        const rows = live(g.id);
        return (
          <div key={g.id} className={`dlg-box${rows.some((r) => r.state === 'active') ? ' on' : ''}`}>
            <span className="dlg-ico" aria-hidden="true"><PersonSwap /></span>
            <div className="dlg-main">
              <div className="dlg-head">
                <b>{own.length > 1 || me.permissions.admin ? `Delegate for ${g.code}` : 'Your delegate while you are away'}</b>
                {rows.length === 0 && <span className="t2">No delegate. Name one before you go on leave, so approvals do not stop.</span>}
              </div>
              {rows.map((d) => (
                <div key={d.id} className="dlg-row">
                  <span className={`pill ${d.state === 'active' ? 'ok' : ''}`}>{d.state === 'active' ? 'Active' : 'Upcoming'}</span>
                  <b>{d.delegate_name}</b>
                  <span className="t2">{`${fmtDate(d.starts_on)} – ${fmtDate(d.ends_on)}`}</span>
                  {d.note && <span className="t2 dlg-note">{`“${d.note}”`}</span>}
                  {d.can_cancel && <button type="button" className="btn sm" onClick={() => void stop(d)} disabled={cancel.isPending}>Cancel</button>}
                </div>
              ))}
            </div>
            <button type="button" className="btn sm pri" onClick={() => setAdding(g.id)}>Name a delegate</button>
          </div>
        );
      })}
      <ErrorText error={cancel.error} />
      {adding !== null && <DelegateDialog group={own.find((g) => g.id === adding)!} onClose={() => setAdding(null)} />}
    </>
  );
}

function DelegateDialog({ group, onClose }: { group: { id: number; code: string; name: string }; onClose: () => void }) {
  const client = useQueryClient();
  const today = new Date();
  const week = new Date(today.getTime() + 6 * 86400000);
  const [delegate, setDelegate] = useState('');
  const [from, setFrom] = useState(iso(today));
  const [to, setTo] = useState(iso(week));
  const [note, setNote] = useState('');
  const people = useQuery({
    queryKey: ['delegation-candidates', group.id],
    queryFn: () => api<{ id: number; name: string; has_email: boolean }[]>(`/api/auth/delegations/candidates/?work_group=${group.id}`),
  });
  const save = useMutation({
    mutationFn: () => api<Delegation>('/api/auth/delegations/', { method: 'POST', body: { work_group: group.id, delegate: Number(delegate), starts_on: from, ends_on: to, note } }),
    onSuccess: (d) => {
      void client.invalidateQueries({ queryKey: ['delegations'] });
      toast(`${d.delegate_name} will decide for ${d.work_group_code} from ${fmtDate(d.starts_on)} to ${fmtDate(d.ends_on)}.`);
      onClose();
    },
  });
  const chosen = people.data?.find((p) => String(p.id) === delegate);
  return (
    <Modal title={`Name a delegate for ${group.code}`} onClose={onClose}
      footer={<>
        <button type="button" className="btn" onClick={onClose}>Cancel</button>
        <button type="button" className="btn pri" disabled={!delegate || !from || !to || save.isPending} onClick={() => save.mutate()}>{save.isPending ? 'Saving…' : 'Name delegate'}</button>
      </>}>
      <div className="decide">
        <p className="t2">While you are away, the delegate approves or rejects the group&apos;s tasks and links in your place. They do not edit the register. You keep your own rights, and you can cancel at any time.</p>
        <ErrorText error={save.error} />
        <div className="fld">
          <label htmlFor="dlg-person">Delegate</label>
          <select id="dlg-person" value={delegate} onChange={(e) => setDelegate(e.target.value)} autoFocus>
            <option value="">{people.isLoading ? 'Loading…' : 'Choose a person of the group'}</option>
            {(people.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          {chosen && !chosen.has_email && <span className="hint">This person has no email address, so they will not be told by email.</span>}
          <span className="hint">Prefer someone who did not prepare the tasks: the Focal Point would approve their own work.</span>
        </div>
        <div className="row2">
          <div className="fld"><label htmlFor="dlg-from">First day</label><input id="dlg-from" type="date" value={from} min={iso(today)} onChange={(e) => setFrom(e.target.value)} /></div>
          <div className="fld"><label htmlFor="dlg-to">Last day</label><input id="dlg-to" type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} /></div>
        </div>
        <div className="fld">
          <label htmlFor="dlg-note">Note (optional)</label>
          <input id="dlg-note" maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} placeholder="For example: annual leave, back on 14 December" />
        </div>
        <p className="hint">At most 90 days. One delegate at a time for the group.</p>
      </div>
    </Modal>
  );
}

function PersonSwap() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20">
      <circle cx="8" cy="8" r="3.2" fill="none" stroke="currentColor" strokeWidth="1.7" />
      <path d="M2.5 19a5.5 5.5 0 0111 0" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M15 7h6m-2-2.5L21.5 7 19 9.5M21 14h-6m2-2.5L14.5 14l2.5 2.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
