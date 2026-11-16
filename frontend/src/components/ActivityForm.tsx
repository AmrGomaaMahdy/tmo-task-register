import { useState } from 'react';

import { useActivities, useMembers, useResource } from '../api/queries';
import type { Activity } from '../api/types';
import { ErrorText, Field, Modal } from './ui';

interface TaskInfo {
  id: number;
  code: string;
  work_group: number;
  work_group_code?: string;
  planned_start: string | null;
  planned_finish: string | null;
}

/**
 * Sheet 4 (Activities): add an activity to a big task, or edit one. The owner is picked from the members
 * of the task's own work group; up to two predecessors of the same task.
 */
export default function ActivityForm({ task, activity, onClose }: { task: TaskInfo; activity?: Activity; onClose: () => void }) {
  const activities = useActivities(task.id);
  const members = useMembers(task.work_group);
  const { create, update } = useResource('activities');
  const [name, setName] = useState(activity?.name ?? '');
  const [owner, setOwner] = useState<number | ''>(activity?.owner ?? '');
  const [start, setStart] = useState(activity?.start_date ?? task.planned_start ?? '');
  const [finish, setFinish] = useState(activity?.finish_date ?? task.planned_finish ?? '');
  const [p1, setP1] = useState<number | ''>(activity?.predecessors[0] ?? '');
  const [p2, setP2] = useState<number | ''>(activity?.predecessors[1] ?? '');
  const others = (activities.data ?? []).filter((a) => a.id !== activity?.id);
  const code = activity?.code ?? `${task.code}-A${String((activities.data?.length ?? 0) + 1).padStart(2, '0')}`;
  const predOptions = others.map((a) => <option key={a.id} value={a.id}>{a.code} {a.name}</option>);
  const groupMembers = (members.data ?? []).filter((m) => m.work_group === task.work_group && m.is_active);
  // An owner moved to another group stays selectable on its activity until it is changed.
  const ownerMissing = activity?.owner && !groupMembers.some((m) => m.id === activity.owner);
  const mutation = activity ? update : create;

  const submit = () => {
    const predecessors = [p1, p2].filter((p, i, all): p is number => p !== '' && all.indexOf(p) === i);
    const body = { task: task.id, name, owner: owner || null, start_date: start, finish_date: finish, predecessors };
    if (activity) update.mutate({ id: activity.id, body }, { onSuccess: onClose });
    else create.mutate(body, { onSuccess: onClose });
  };

  return (
    <Modal
      title={activity ? 'Edit activity' : 'Add an activity'}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="button" className="btn pri" onClick={submit} disabled={!name || !start || !finish || mutation.isPending}>
            {mutation.isPending ? 'Saving…' : activity ? 'Save' : 'Add'}
          </button>
        </>
      }
    >
      <p className="intro">
        The detailed plan of a big task, once it is known: one row per activity, in order. A predecessor is an activity of the
        same task that must finish before this one starts.
      </p>
      <ErrorText error={mutation.error} />
      <div className="fgrid">
        <Field label="Activity" req="REQUIRED" wide htmlFor="af-name">
          <input id="af-name" value={name} onChange={(e) => setName(e.target.value)} placeholder='A clear activity, e.g. "Train the pilot teams"' />
        </Field>
        <Field label="Activity ID" req="AUTOMATIC"><div className="auto">{code}</div></Field>
        <Field label="Owner" req="OPTIONAL" htmlFor="af-owner" hint="Only the members of the task's own work group are listed. Administrators and the TMO add people in Configuration › Group members.">
          <select id="af-owner" value={owner} onChange={(e) => setOwner(e.target.value ? Number(e.target.value) : '')}>
            <option value="">{groupMembers.length ? '' : 'No members in this group yet'}</option>
            {ownerMissing && <option value={activity?.owner ?? ''}>{activity?.owner_name} ({activity?.owner_group})</option>}
            {groupMembers.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
          <span className="hint">{groupMembers.length} member(s) of {task.work_group_code ?? ''}</span>
        </Field>
        <Field label="Start" req="REQUIRED" htmlFor="af-start" hint="Inside the task's planned dates.">
          <input id="af-start" type="date" value={start} onChange={(e) => setStart(e.target.value)} />
        </Field>
        <Field label="Finish" req="REQUIRED" htmlFor="af-finish">
          <input id="af-finish" type="date" value={finish} onChange={(e) => setFinish(e.target.value)} />
        </Field>
        <Field label="Predecessor 1" req="OPTIONAL" htmlFor="af-p1" hint="Empty = it can start first.">
          <select id="af-p1" value={p1} onChange={(e) => setP1(e.target.value ? Number(e.target.value) : '')}>
            <option value="">None: can start first</option>
            {predOptions}
          </select>
        </Field>
        <Field label="Predecessor 2" req="OPTIONAL" htmlFor="af-p2" hint="Only when the activity waits for two.">
          <select id="af-p2" value={p2} onChange={(e) => setP2(e.target.value ? Number(e.target.value) : '')} disabled={p1 === ''}>
            <option value="" />
            {predOptions}
          </select>
        </Field>
      </div>
    </Modal>
  );
}
