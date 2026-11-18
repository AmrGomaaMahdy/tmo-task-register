import { useState } from 'react';

import { useDecide, useRemoveLink, type DecisionBody } from '../api/queries';
import type { Decision } from '../api/types';
import { DECISION_LABEL } from '../lib/fields';
import { useConfirm } from './Confirm';
import { ErrorText, Modal } from './ui';

export interface DecisionTarget {
  kind: 'task' | 'partner' | 'contribution';
  id: number;
  /** What is being decided on, shown at the top of the dialog. */
  subject: string;
  /** A decision, or "remove": the leader takes the link out of the other group's task. */
  decision: Exclude<Decision, 'pending'> | 'remove';
  current?: string;
}

const PROMPT: Record<DecisionTarget['decision'], string> = {
  approved: 'Optional: a note for the other group.',
  clarification: 'Your question: what should they clarify?',
  rejected: 'The reason: why is it rejected?',
  timeline: 'Why the change, and what the new date depends on.',
  remove: 'The reason: why does this link not belong with your group? The other group sees it.',
};
const TITLE = (d: DecisionTarget['decision']) => (d === 'remove' ? 'Remove the link' : DECISION_LABEL[d]);

/** Asks the leader for the note (and, to change the timeline, the date) that goes with a decision. */
export default function DecisionDialog({ target, onClose }: { target: DecisionTarget; onClose: () => void }) {
  const decide = useDecide();
  const removeLink = useRemoveLink();
  const [note, setNote] = useState('');
  const [date, setDate] = useState('');
  const removing = target.decision === 'remove';
  const mutation = removing ? removeLink : decide;
  const needsNote = target.decision === 'rejected' || target.decision === 'clarification' || removing;
  const needsDate = target.decision === 'timeline';
  const ready = (!needsNote || note.trim().length >= (removing ? 3 : 1)) && (!needsDate || date);
  const confirm = useConfirm();
  const submit = async () => {
    // Rejecting and removing are hard to take back: ask once more, naming what is affected.
    if (target.decision === 'rejected' || removing) {
      const ok = await confirm({
        title: removing ? 'Remove this link from their task?' : 'Reject this?',
        message: <><p className="confirm-subject">{target.subject}</p><p>{removing ? 'The other group sees the removal and your reason. Their team can add the link again only if both groups agree.' : 'The other group sees the rejection and your note, and has to change its task.'}</p></>,
        confirmLabel: removing ? 'Remove the link' : 'Reject',
      });
      if (!ok) return;
    }
    if (target.decision === 'remove') {
      if (target.kind !== 'task') removeLink.mutate({ kind: target.kind, id: target.id, note: note.trim() }, { onSuccess: onClose });
      return;
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
          <button type="button" className={`btn ${target.decision === 'rejected' || removing ? 'danger' : 'pri'}`} disabled={!ready || mutation.isPending} onClick={() => void submit()}>
            {mutation.isPending ? 'Saving…' : TITLE(target.decision)}
          </button>
        </>
      }
    >
      <div className="decide">
        <p className="decide-subj">{target.subject}</p>
        {target.current && <p className="t2">{target.current}</p>}
        {removing && <p className="t2">The link is taken out of their task. Their team can add it again if both groups agree.</p>}
        <ErrorText error={mutation.error} />
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

/** The leader's buttons for one item: approve straight away; the others ask for a note first. */
export function DecisionButtons({ kinds, onPick, current, onRemove }: {
  kinds: Exclude<Decision, 'pending'>[];
  onPick: (d: Exclude<Decision, 'pending'>) => void;
  current: Decision;
  /** Shown for links the leader may take out of the other group's task. */
  onRemove?: () => void;
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
      {onRemove && (
        <button type="button" className="btn sm dec-remove" onClick={(e) => { e.stopPropagation(); onRemove(); }}
          data-tip="Take this link out of their task (a reason is required)">
          🗑 Remove
        </button>
      )}
    </span>
  );
}
