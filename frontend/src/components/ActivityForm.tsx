import { useState } from 'react';

import { useActivities, useMembers, useResource } from '../api/queries';
import type { Activity } from '../api/types';
import { ApiError } from '../api/client';
import { activityDateErrors, useDateRange } from '../lib/dates';
import { fmtDate } from '../lib/format';
import { useConfirm } from './Confirm';
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
  const confirm = useConfirm();
  const startState = JSON.stringify([activity?.name ?? '', activity?.owner ?? '', activity?.start_date ?? task.planned_start ?? '', activity?.finish_date ?? task.planned_finish ?? '', activity?.predecessors[0] ?? '', activity?.predecessors[1] ?? '']);
  const dirty = JSON.stringify([name, owner, start, finish, p1, p2]) !== startState;
  // Closing with unsaved changes asks first.
  const close = async () => {
    if (dirty && !(await confirm({ title: 'Discard your changes?', message: 'What you changed in this activity is not saved yet.', confirmLabel: 'Discard', cancelLabel: 'Keep editing' }))) return;
    onClose();
  };
  const range = useDateRange();
  const preds = [p1, p2].filter((p): p is number => p !== '').map((id) => others.find((a) => a.id === id)).filter((a): a is Activity => !!a);
  const errs = activityDateErrors(start, finish, task, range, preds);
  const nameError = name && (name.trim().length < 3 || !/\p{L}/u.test(name)) ? 'Name the activity in at least 3 characters, with words.' : '';
  const invalid = !!(errs.task || errs.start || errs.finish || nameError);
  const serverError = (k: string) => (mutation.error instanceof ApiError ? mutation.error.fields[k]?.[0] : undefined);
  const fieldError = (msg?: string) => (msg ? <span className="field-error" role="alert">{msg}</span> : null);
  const taskSpan = task.planned_start && task.planned_finish ? `${fmtDate(task.planned_start)} – ${fmtDate(task.planned_finish)}` : '';

  const submit = () => {
    const predecessors = [p1, p2].filter((p, i, all): p is number => p !== '' && all.indexOf(p) === i);
    const body = { task: task.id, name, owner: owner || null, start_date: start, finish_date: finish, predecessors };
    if (activity) update.mutate({ id: activity.id, body }, { onSuccess: onClose });
    else create.mutate(body, { onSuccess: onClose });
  };

  return (
    <Modal
      title={activity ? 'Edit activity' : 'Add an activity'}
      onClose={() => void close()}
      footer={
        <>
          <button type="button" className="btn" onClick={() => void close()}>Cancel</button>
          <button type="button" className="btn pri" onClick={submit} disabled={!name.trim() || !start || !finish || invalid || mutation.isPending}>
            {mutation.isPending ? 'Saving…' : activity ? 'Save' : 'Add'}
          </button>
        </>
      }
    >
      <p className="intro">
        The detailed plan of a big task, once it is known: one row per activity, in order. A predecessor is an activity of the
        same task that must finish before this one starts.
      </p>
      {errs.task ? <div className="error-box" role="alert">{errs.task}</div> : <ErrorText error={mutation.error} />}
      {taskSpan && <p className="t2 small">{`The task runs ${taskSpan}: the activity's start and finish must be inside these dates.`}</p>}
      <div className="fgrid">
        <Field label="Activity" req="REQUIRED" wide htmlFor="af-name">
          <input id="af-name" value={name} onChange={(e) => setName(e.target.value)} placeholder='A clear activity, e.g. "Train the pilot teams"' maxLength={200} aria-invalid={!!nameError} />
          {fieldError(nameError || serverError('name'))}
        </Field>
        <Field label="Activity ID" req="AUTOMATIC"><div className="auto">{code}</div></Field>
        <Field label="Owner" req="OPTIONAL" htmlFor="af-owner" hint="Only the members of the task's own work group are listed. Administrators and the TMO add people in Configuration › Group members.">
          <select id="af-owner" value={owner} onChange={(e) => setOwner(e.target.value ? Number(e.target.value) : '')}>
            <option value="">{groupMembers.length ? '' : 'No members in this group yet'}</option>
            {ownerMissing && <option value={activity?.owner ?? ''}>{activity?.owner_name} ({activity?.owner_group})</option>}
            {groupMembers.map((m) => <option key={m.id} value={m.id}>{m.job_title ? `${m.name} – ${m.job_title}` : m.name}</option>)}
          </select>
          <span className="hint">{`${groupMembers.length} member(s) of ${task.work_group_code ?? ''}`}</span>
        </Field>
        <Field label="Start" req="REQUIRED" htmlFor="af-start" hint="Inside the task's planned dates, and after its predecessors finish.">
          <input id="af-start" type="date" value={start} min={task.planned_start ?? range.min} max={finish || task.planned_finish || range.max}
            aria-invalid={!!errs.start} onChange={(e) => setStart(e.target.value)} />
          {fieldError(errs.start || serverError('start_date'))}
        </Field>
        <Field label="Finish" req="REQUIRED" htmlFor="af-finish" hint="On or after the start, and on or before the task's planned finish.">
          <input id="af-finish" type="date" value={finish} min={start || task.planned_start || range.min} max={task.planned_finish ?? range.max}
            aria-invalid={!!errs.finish} onChange={(e) => setFinish(e.target.value)} />
          {fieldError(errs.finish || serverError('finish_date'))}
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
