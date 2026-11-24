import { useState } from 'react';

import { useDecide, type DecisionBody } from '../api/queries';
import type { Decision } from '../api/types';
import { DECISION_LABEL } from '../lib/fields';
import { useConfirm } from './Confirm';
import { ErrorText, Modal } from './ui';

export interface DecisionTarget {
  kind: 'task' | 'partner' | 'contribution';
  id: number;
  /** What is being decided on, shown at the top of the dialog. */
  subject: string;
  decision: Exclude<Decision, 'pending'>;
  current?: string;
}

const PROMPT: Record<DecisionTarget['decision'], string> = {
  approved: 'Optional: a note for the other group.',
  clarification: 'Your question: what should they clarify?',
  rejected: 'The reason, if needed: why is it rejected? It is shown with the decision.',
  timeline: 'Why the change, and what the new date depends on.',
};
const VERB: Partial<Record<DecisionTarget['decision'], string>> = { rejected: 'Reject', approved: 'Approve' };
const TITLE = (d: DecisionTarget['decision']) => VERB[d] ?? DECISION_LABEL[d];

/**
 * Asks the leader for the note that goes with a decision. A leader only approves or rejects (1.20); since
 * 1.22 a link cannot be taken out of the other group's task any more, only rejected with a reason.
 */
export default function DecisionDialog({ target, onClose }: { target: DecisionTarget; onClose: () => void }) {
  const decide = useDecide();
  const [note, setNote] = useState('');
  const [date, setDate] = useState('');
  const needsDate = target.decision === 'timeline';
  const ready = !needsDate || date;
  const confirm = useConfirm();
  const submit = async () => {
    // Rejecting is hard to take back: ask once more, naming what is affected.
    if (target.decision === 'rejected') {
      const ok = await confirm({
        title: 'Reject this?',
        message: <><p className="confirm-subject">{target.subject}</p><p>{target.kind === 'task' ? 'The task goes back to its Focal Point as Needs completion, with your reason if you gave one.' : 'The other group sees the rejection and your reason, and has to change its task.'}</p></>,
        confirmLabel: 'Reject',
      });
      if (!ok) return;
    }
    const body: DecisionBody = { decision: target.decision, note: note.trim() };
    if (needsDate) body.proposed_date = date;
    decide.mutate({ kind: target.kind, id: target.id, body }, { onSuccess: onClose });
  };
  return (
    <Modal
      title={TITLE(target.decision)}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="button" className={`btn ${target.decision === 'rejected' ? 'danger' : 'pri'}`} disabled={!ready || decide.isPending} onClick={() => void submit()}>
            {decide.isPending ? 'Saving…' : TITLE(target.decision)}
          </button>
        </>
      }
    >
      <div className="decide">
        <p className="decide-subj">{target.subject}</p>
        {target.current && <p className="t2">{target.current}</p>}
        <ErrorText error={decide.error} />
        {needsDate && (
          <div className="fld">
            <label htmlFor="dec-date">Date your group can deliver by</label>
            <input id="dec-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
        )}
        <div className="fld">
          <label htmlFor="dec-note">{PROMPT[target.decision]}</label>
          <textarea id="dec-note" rows={3} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} autoFocus />
        </div>
      </div>
    </Modal>
  );
}

/** The leader's buttons for one item: approve straight away; reject asks for a reason first. */
export function DecisionButtons({ kinds, onPick, current }: {
  kinds: Exclude<Decision, 'pending'>[];
  onPick: (d: Exclude<Decision, 'pending'>) => void;
  current: Decision;
}) {
  const label: Record<Exclude<Decision, 'pending'>, string> = { approved: '✓ Approve', clarification: '? Clarify', timeline: '⏱ Timeline', rejected: '✕ Reject' };
  return (
    <span className="dec-btns">
      {kinds.map((k) => (
        <button key={k} type="button" className={`btn sm dec-${k} ${current === k ? 'on' : ''}`} onClick={(e) => { e.stopPropagation(); onPick(k); }}
          data-tip={DECISION_LABEL[k]}>
          {label[k]}
        </button>
      ))}
    </span>
  );
}
