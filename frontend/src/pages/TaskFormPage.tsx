import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';

import { api, ApiError } from '../api/client';
import { isShared, useActivities, useSaveTask, useTask, useTaskDirectory } from '../api/queries';
import type { CheckIssue, ContributionRow, ListKey, PartnerRow, Status, Task, TaskFields } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { useScope } from '../components/WorkGroupScope';
import { useConfirm } from '../components/Confirm';
import { Blocked, ErrorText, Field, ReqBadge, Tip } from '../components/ui';
import { FIELDS, LINK_HINT, MAX_ROWS, REQUIREMENT_HINT, REQUIREMENT_LABEL, SECTIONS, STATUS_LABEL, sectionOf, type Requirement } from '../lib/fields';
import { taskDateErrors, useDateRange } from '../lib/dates';
import { fmtDate, workingDays } from '../lib/format';
import { useRefs } from '../lib/useRefs';

type Form = Record<string, string>;
// Each row keeps a key of its own, so removing a row in the middle keeps the others' inputs in place.
type Row = Record<'work_group' | 'role' | 'need' | 'needed_when' | 'their_task_ref', string> & { key: number };
type ConForm = Record<'to_group' | 'benefit' | 'needed_when' | 'their_task_ref', string> & { key: number };

const FK_FIELDS = ['direction', 'workstream', 'sub_objective', 'owner_role'];
let rowKey = 0;
const emptyRow = (): Row => ({ key: ++rowKey, work_group: '', role: '', need: '', needed_when: '', their_task_ref: '' });
const emptyCon = (): ConForm => ({ key: ++rowKey, to_group: '', benefit: '', needed_when: '', their_task_ref: '' });
const str = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const num = (v: string) => (v ? Number(v) : null);

function toForm(task: Task | undefined, workGroup: number | null): Form {
  const f: Form = {
    work_group: str(task?.work_group ?? workGroup),
    title: task?.title ?? '',
    description: task?.description ?? '',
    status: task?.status ?? 'draft',
    planned_start: str(task?.planned_start),
    planned_finish: str(task?.planned_finish),
  };
  for (const k of FK_FIELDS) f[k] = str(task ? (task as unknown as Record<string, unknown>)[k] : '');
  return f;
}

function toRows(task: Task | undefined): Row[] {
  return (task?.partners ?? []).map((p) => ({
    key: ++rowKey,
    work_group: str(p.work_group),
    role: str(p.role),
    need: p.need ?? '',
    needed_when: str(p.needed_when),
    their_task_ref: p.their_task_ref ?? '',
  }));
}

function toCons(task: Task | undefined): ConForm[] {
  return (task?.contributions ?? []).map((c) => ({
    key: ++rowKey,
    to_group: str(c.to_group),
    benefit: c.benefit,
    needed_when: str(c.needed_when),
    their_task_ref: c.their_task_ref,
  }));
}

const filledCon = (c: ConForm) => Boolean(c.to_group || c.benefit.trim() || c.needed_when || c.their_task_ref.trim());

function toPayload(form: Form, rows: Row[], cons: ConForm[], linksOut: boolean): Partial<TaskFields> {
  const partners: PartnerRow[] = rows
    .filter((r) => r.work_group)
    .map((r) => ({
      work_group: Number(r.work_group),
      role: num(r.role),
      need: r.need.trim(),
      needed_when: num(r.needed_when),
      their_task_ref: r.their_task_ref.trim().toUpperCase(),
    }));
  const contributions: ContributionRow[] = linksOut
    ? cons.filter(filledCon).map((c) => ({
        to_group: num(c.to_group),
        benefit: c.benefit.trim(),
        needed_when: num(c.needed_when),
        their_task_ref: c.their_task_ref.trim().toUpperCase(),
      }))
    : [];
  const p: Record<string, unknown> = { partners, contributions };
  for (const k of FK_FIELDS) p[k] = num(form[k]);
  p.title = form.title;
  p.description = (form.description ?? '').trim();
  p.work_group = Number(form.work_group);
  p.planned_start = form.planned_start || null;
  p.planned_finish = form.planned_finish || null;
  p.status = form.status as Status;
  return p as Partial<TaskFields>;
}

/** Their task: free text with the other group's task numbers offered as suggestions. */
function TheirTask({ id, group, value, onChange }: { id: string; group: number | null; value: string; onChange: (v: string) => void }) {
  const dir = useTaskDirectory(group);
  return (
    <>
      <input id={id} list={`${id}-dl`} value={value} placeholder={group ? 'e.g. HR-T012' : 'Pick the group first'}
        onChange={(e) => onChange(e.target.value)} />
      <datalist id={`${id}-dl`}>
        {(dir.data ?? []).map((t) => <option key={t.id} value={t.code}>{t.title}</option>)}
      </datalist>
    </>
  );
}

// Row keys only keep inputs in place; they are not data, so they are left out of the comparison.
const snapshot = (f: unknown, r: Row[], c: ConForm[]) =>
  JSON.stringify([f, r, c], (k, v) => (k === 'key' ? undefined : v));

/** The form's shape while the task and the lists load, so nothing jumps when they arrive. */
function FormSkeleton() {
  return (
    <div className="panel form-shell">
      <div className="form-hd"><div className="skel" style={{ height: 22, width: 220 }} /></div>
      <div className="form-skel">
        <div>{[0, 1, 2, 3].map((i) => <div key={i} className="skel" style={{ height: 30 }} />)}</div>
        <div>
          <div className="skel" style={{ height: 26, width: '40%' }} />
          <div className="skel" style={{ height: 14, width: '80%' }} />
          {[0, 1, 2].map((i) => <div key={i} className="skel" style={{ height: 40 }} />)}
        </div>
        <div><div className="skel" style={{ height: 60 }} /></div>
      </div>
    </div>
  );
}

export default function TaskFormPage() {
  const { id } = useParams();
  const editing = id ? Number(id) : null;
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { me } = useAuth();
  const { wg } = useScope();
  const refs = useRefs();
  const fetched = useTask(editing);
  // Another group's task (shared part only) can never be edited here.
  const sharedOnly = isShared(fetched.data);
  const existingTask = isShared(fetched.data) ? undefined : fetched.data;
  const save = useSaveTask();
  const acts = useActivities(editing ?? 0, !!editing);
  const range = useDateRange();
  const [form, setForm] = useState<Form | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [cons, setCons] = useState<ConForm[]>([]);
  const [section, setSection] = useState(Number(params.get('section') ?? 0));
  const [checks, setChecks] = useState<CheckIssue[]>([]);
  const [checking, setChecking] = useState(false);
  const shell = useRef<HTMLDivElement>(null);
  // What was loaded, to tell whether there are unsaved changes.
  const [initial, setInitial] = useState('');

  const mine = me?.work_groups.map((g) => g.id) ?? [];
  const defaultGroup = (wg && (me?.permissions.admin || mine.includes(wg)) ? wg : mine[0]) ?? wg ?? refs.groups[0]?.id ?? null;
  useEffect(() => {
    if (form || !refs.ready) return;
    if (sharedOnly || (editing && !existingTask)) return;
    const f = toForm(existingTask, defaultGroup), r = toRows(existingTask), c = toCons(existingTask);
    setForm(f);
    setRows(r);
    setCons(c);
    setInitial(snapshot(f, r, c));
  }, [form, refs.ready, editing, existingTask, defaultGroup, sharedOnly]);

  const dirty = !!form && !!initial && snapshot(form, rows, cons) !== initial;
  const confirm = useConfirm();
  // Cancel with unsaved changes asks before leaving the form.
  const cancel = async () => {
    if (dirty && !(await confirm({ title: 'Discard your changes?', message: 'What you changed in this task is not saved yet.', confirmLabel: 'Discard', cancelLabel: 'Keep editing' }))) return;
    navigate(editing ? `/tasks/${editing}` : '/register');
  };
  // Leaving the page with unsaved changes asks first.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  // Ctrl+S (Cmd+S on a Mac) saves from any step.
  const submitRef = useRef<() => void>(() => undefined);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        submitRef.current();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // A new step starts at the top of the form, not wherever the last one was scrolled to.
  const go = (i: number) => {
    setSection(i);
    const top = shell.current?.getBoundingClientRect().top ?? 0;
    if (top < 0) shell.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const ownerRole = form?.owner_role ? refs.lookup(Number(form.owner_role)) : undefined;
  const linksOut = ownerRole?.semantic === 'enable' || ownerRole?.semantic === 'support';

  // Live check: the server checks the unsaved form, half a second after the last change.
  useEffect(() => {
    if (!form?.work_group) return;
    setChecking(true);
    const timer = setTimeout(() => {
      api<{ checks: CheckIssue[] }>('/api/tasks/check-draft/', {
        method: 'POST',
        body: { ...toPayload(form, rows, cons, linksOut), id: editing ?? undefined },
      })
        .then((r) => setChecks(r.checks ?? []))
        .catch(() => undefined)
        .finally(() => setChecking(false));
    }, 500);
    return () => clearTimeout(timer);
  }, [form, rows, cons, linksOut, editing]);

  const statusOptions = useMemo<Status[]>(() => {
    if (existingTask) {
      const current = existingTask.status;
      return [current, ...existingTask.access.transitions.filter((s) => s !== 'in_master_plan')];
    }
    return me?.permissions.create_tasks ? ['draft', 'needs_completion', 'ready'] : ['draft', 'needs_completion'];
  }, [existingTask, me]);

  if (sharedOnly) {
    return (
      <Blocked title="This task belongs to another work group" actions={<button type="button" className="btn pri" onClick={() => navigate(`/tasks/${editing}`)}>Open the task</button>}>
        Only its own group can change it. You can still read the links it shares with your group.
      </Blocked>
    );
  }
  if (!form || !refs.ready) return <FormSkeleton />;
  if (existingTask && !existingTask.access.can_edit) {
    const locked = existingTask.status === 'in_master_plan';
    return (
      <Blocked
        title="You cannot change this task"
        actions={<button type="button" className="btn pri" onClick={() => navigate(`/tasks/${existingTask.id}`)}>Back to {existingTask.code}</button>}
      >
        {locked
          ? 'It is in the Master Plan, so it is locked for its group until the TMO releases it.'
          : `Only the ${existingTask.work_group_code} team, its leader and administrators change this task.`}
      </Blocked>
    );
  }

  const set = (k: string) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });
  const setRow = (i: number, k: keyof Row, v: string) => setRows(rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  const setCon = (i: number, k: keyof ConForm, v: string) => setCons(cons.map((c, j) => (j === i ? { ...c, [k]: v } : c)));
  // A partner row with no group yet cannot be saved: the live check points at it.
  const rowsWithoutGroup = rows.map((r, i) => (r.work_group ? -1 : i)).filter((i) => i >= 0);
  const localChecks: CheckIssue[] = rowsWithoutGroup.map((i) => ({
    field: `partner_${i + 1}`,
    label: `Partner group ${i + 1}`,
    message: `Partner ${i + 1}: pick the partner group, or remove the row`,
    level: 'error',
  }));
  // The date rules of the API, shown at once: inside the register's range, finish on or after start,
  // and (when the task has activities) still holding every activity.
  const actList = acts.data ?? [];
  const dateErrs = taskDateErrors(form.planned_start, form.planned_finish, range, actList);
  const dateChecks: CheckIssue[] = (['planned_start', 'planned_finish'] as const)
    .filter((k) => dateErrs[k])
    .map((k) => ({ field: k, label: FIELDS[k].label, message: dateErrs[k] as string, level: 'error' }));
  localChecks.push(...dateChecks);
  const localFields = new Set(dateChecks.map((c) => c.field));
  const allChecks = [...localChecks, ...checks.filter((c) => !localFields.has(c.field))];
  const wgId = Number(form.work_group);
  const otherGroups = refs.groups.filter((g) => g.id !== wgId);
  const errorsBySection = SECTIONS.map((_, i) => allChecks.filter((c) => sectionOf(c.field) === i));
  const serverFieldError = (k: string) => (save.error instanceof ApiError ? save.error.fields[k]?.[0] : undefined);
  const listOptions = (key: ListKey) => refs.list(key).map((l) => ({ id: l.id, label: l.value }));
  const groupOptions = otherGroups.map((g) => ({ id: g.id, label: `${g.code} – ${g.name}` }));

  type Option = { id: number | string; label: string; disabled?: boolean };
  const selectEl = (elId: string, value: string, onChange: (v: string) => void, options: Option[]) => (
    <select id={elId} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="" />
      {options.map((o) => <option key={o.id} value={o.id} disabled={o.disabled}>{o.label}</option>)}
    </select>
  );
  const select = (k: string, options: { id: number | string; label: string }[]) =>
    selectEl(`f-${k}`, form[k], (v) => setForm(k === 'work_group' ? { ...form, work_group: v, direction: '', sub_objective: '' } : { ...form, [k]: v }), options);
  const field = (k: string, control: ReactElement, wide = false, localError?: string) => (
    <Field key={k} label={FIELDS[k].label} req={FIELDS[k].req} hint={FIELDS[k].hint} wide={wide} htmlFor={`f-${k}`}>
      {control}
      {(localError || serverFieldError(k)) && <span className="field-error" role="alert">{localError || serverFieldError(k)}</span>}
    </Field>
  );

  const usedGroups = rows.map((r) => r.work_group).filter(Boolean);
  const removeButton = (label: string, onClick: () => void) => (
    <button type="button" className="btn ghost sm rmrow" aria-label={label} onClick={onClick}>✕ Remove</button>
  );
  const partnerRow = (r: Row, i: number) => {
    const group = r.work_group ? Number(r.work_group) : null;
    // A group is named once per task: groups picked on the other rows are not offered again.
    const options = groupOptions.map((o) => ({ ...o, disabled: String(o.id) !== r.work_group && usedGroups.includes(String(o.id)) }));
    return (
      <div className="prow" key={r.key} data-prow={i + 1}>
        <div className="prow-hd">
          <span className="msn">{`Partner ${i + 1}`}</span>
          {removeButton('Remove this partner', () => setRows(rows.filter((_, j) => j !== i)))}
        </div>
        <div className="fgrid g3">
          <Field label="Partner group" req="REQUIRED" hint={LINK_HINT.partner} htmlFor={`p${r.key}-group`}>
            {selectEl(`p${r.key}-group`, r.work_group, (v) => setRow(i, 'work_group', v), options)}
          </Field>
          <Field label="Role" req="REQUIRED" hint={LINK_HINT.role} htmlFor={`p${r.key}-role`}>
            {selectEl(`p${r.key}-role`, r.role, (v) => setRow(i, 'role', v), listOptions('partner_role'))}
          </Field>
          <Field label="When needed" req="REQUIRED" hint={LINK_HINT.when} htmlFor={`p${r.key}-when`}>
            {selectEl(`p${r.key}-when`, r.needed_when, (v) => setRow(i, 'needed_when', v), listOptions('needed'))}
          </Field>
          <Field label="What we need" req="REQUIRED" hint={LINK_HINT.need} wide htmlFor={`p${r.key}-need`}>
            <input id={`p${r.key}-need`} value={r.need} placeholder='e.g. "approved offshore staffing rules"' onChange={(e) => setRow(i, 'need', e.target.value)} />
          </Field>
          <Field label="Their task" req="REQUIRED" hint={LINK_HINT.their} htmlFor={`p${r.key}-their`}>
            <TheirTask id={`p${r.key}-their`} group={group} value={r.their_task_ref} onChange={(v) => setRow(i, 'their_task_ref', v)} />
          </Field>
        </div>
      </div>
    );
  };
  const conRow = (c: ConForm, i: number) => (
    <div className="prow" key={c.key} data-crow={i + 1}>
      <div className="prow-hd">
        <span className="msn">{`Contribution ${i + 1}`}</span>
        {removeButton('Remove this contribution', () => setCons(cons.filter((_, j) => j !== i)))}
      </div>
      <div className="fgrid g3">
        <Field label="Group we enable / support" req="REQUIRED" hint={LINK_HINT.group} htmlFor={`c${c.key}-group`}>
          {selectEl(`c${c.key}-group`, c.to_group, (v) => setCon(i, 'to_group', v), groupOptions)}
        </Field>
        <Field label="When they need it" req="REQUIRED" hint={LINK_HINT.theirWhen} htmlFor={`c${c.key}-when`}>
          {selectEl(`c${c.key}-when`, c.needed_when, (v) => setCon(i, 'needed_when', v), listOptions('needed'))}
        </Field>
        <Field label="Their task" req="REQUIRED" hint={LINK_HINT.their} htmlFor={`c${c.key}-their`}>
          <TheirTask id={`c${c.key}-their`} group={c.to_group ? Number(c.to_group) : null} value={c.their_task_ref} onChange={(v) => setCon(i, 'their_task_ref', v)} />
        </Field>
        <Field label="What we deliver" req="REQUIRED" hint={LINK_HINT.deliver} wide htmlFor={`c${c.key}-what`}>
          <input id={`c${c.key}-what`} value={c.benefit} placeholder="The output or service they receive" onChange={(e) => setCon(i, 'benefit', e.target.value)} />
        </Field>
      </div>
    </div>
  );
  const addPartner = () => rows.length < MAX_ROWS && setRows([...rows, emptyRow()]);
  const addContribution = () => cons.length < MAX_ROWS && setCons([...cons, emptyCon()]);

  const panes = [
    <div className="fgrid" key="0">
      {field('work_group', editing
        ? <div className="auto">{refs.group(wgId)?.code} – {refs.group(wgId)?.name}</div>
        : select('work_group', refs.groups.filter((g) => me?.permissions.admin || mine.includes(g.id)).map((g) => ({ id: g.id, label: `${g.code} – ${g.name}` }))))}
      <div />
      {field('title', <input id="f-title" value={form.title} onChange={set('title')} maxLength={300} />, true)}
      {field('description', (
        <>
          <textarea id="f-description" rows={4} value={form.description ?? ''} onChange={set('description')} maxLength={3000}
            placeholder="Scope, expected result, and anything partner groups or the TMO should know (optional)" />
          <span className="hint r">{`${(form.description ?? '').length} / 3000`}</span>
        </>
      ), true)}
      {field('direction', select('direction', refs.directions.filter((d) => d.work_group === wgId).map((d) => ({ id: d.id, label: `${d.code} – ${d.title}` }))), true)}
      {field('workstream', select('workstream', listOptions('workstream')))}
      {field('sub_objective', select('sub_objective', refs.list('sub_objective')
        // Only the task's own group's sub-objectives; a saved one of another group stays visible so it can be changed.
        .filter((l) => !l.work_group || l.work_group === wgId || String(l.id) === String(form.sub_objective))
        .map((l) => ({ id: l.id, label: l.work_group && l.work_group !== wgId ? `${l.value} (${l.work_group_code})` : l.value }))))}
    </div>,
    <div className="stack" key="1">
      <div className="fgrid">{field('owner_role', select('owner_role', listOptions('owner_role')))}</div>
      <div className="fsub">
        <span>
          Partners <ReqBadge req="OPTIONAL" />{' '}
          <Tip text={`Add a partner only when another group works with us on this task, up to ${MAX_ROWS}. For each partner, everything in its row is required: the group, its role, what we need, when, and their task number agreed in the meeting.`} />
        </span>
        <span className="fcount">{`${rows.length} of ${MAX_ROWS}`}</span>
      </div>
      {rows.length > 0 && <div className="rowlist">{rows.map(partnerRow)}</div>}
      <div className="fadd">
        <button type="button" className="btn sm" id="add-partner" onClick={addPartner} disabled={rows.length >= MAX_ROWS}
          title={rows.length >= MAX_ROWS ? `A task can have up to ${MAX_ROWS} partner groups.` : 'Add a group that works with us on this task.'}>
          + Add partner
        </button>
        {!rows.length && <span className="t2">No partners. Add one when another group works with us on this task.</span>}
      </div>
      {linksOut && (
        <div className="conbox">
          <div className="fsub">
            <span>
              Contributions <ReqBadge req="WHEN" />{' '}
              <Tip text={`Required because the owner role is Enable or Support: what this task delivers to other groups, up to ${MAX_ROWS}. For each one, record the group it helps, what it delivers, when they need it and their task number, as agreed with that group.`} />
            </span>
            <span className="fcount">{`${cons.length} of ${MAX_ROWS}`}</span>
          </div>
          {cons.length > 0 && <div className="rowlist">{cons.map(conRow)}</div>}
          <div className="fadd">
            <button type="button" className="btn sm" id="add-contribution" onClick={addContribution} disabled={cons.length >= MAX_ROWS}
              title={cons.length >= MAX_ROWS ? `A task can have up to ${MAX_ROWS} contributions.` : 'Add another group this task delivers to.'}>
              + Add contribution
            </button>
            {!cons.length && <span className="t2 bad">An Enable or Support task needs at least one contribution.</span>}
          </div>
        </div>
      )}
    </div>,
    <div key="2">
      <div className="fgrid g3">
        {field('planned_start', <input id="f-planned_start" type="date" min={range.min} max={form.planned_finish || range.max} aria-invalid={!!dateErrs.planned_start} value={form.planned_start} onChange={set('planned_start')} />, false, dateErrs.planned_start)}
        {field('planned_finish', <input id="f-planned_finish" type="date" min={form.planned_start || range.min} max={range.max} aria-invalid={!!dateErrs.planned_finish} value={form.planned_finish} onChange={set('planned_finish')} />, false, dateErrs.planned_finish)}
        <Field label="Duration" req="AUTOMATIC" hint="Working days between start and finish, Friday and Saturday off.">
          <div className="auto">{workingDays(form.planned_start || null, form.planned_finish || null) ?? '–'}</div>
        </Field>
      </div>
      <div className="fgrid">
        <Field label="Activities" req="AUTOMATIC" hint="The activities listed for this task. Add them on the task page, Activities tab, once they are known.">
          <div className="auto">{existingTask?.activity_count ?? 0}{editing ? '' : ' (add them after saving)'}</div>
          {actList.length > 0 && (
            <span className="hint">{`Activities run from ${fmtDate(actList.reduce((m, a) => (a.start_date < m ? a.start_date : m), actList[0].start_date))} to ${fmtDate(actList.reduce((m, a) => (a.finish_date > m ? a.finish_date : m), actList[0].finish_date))}: the planned dates must include them.`}</span>
          )}
        </Field>
      </div>
    </div>,
    <div className="fgrid" key="3">
      {field('status', select('status', statusOptions.map((s) => ({ id: s, label: STATUS_LABEL[s] }))))}
    </div>,
  ];

  const submit = () => {
    if (!form.title.trim()) {
      go(0);
      return;
    }
    if (rowsWithoutGroup.length) {
      go(1);
      return;
    }
    if (dateChecks.length) {
      go(2);
      return;
    }
    save.mutate(
      { id: editing ?? undefined, data: toPayload(form, rows, cons, linksOut) },
      { onSuccess: (task) => navigate(`/tasks/${task.id}`) },
    );
  };
  submitRef.current = submit;

  return (
    <div className="panel form-shell" ref={shell}>
      <div className="form-hd">
        {existingTask && <span className="mono acc">{existingTask.code}</span>}
        <h2>{editing ? 'Edit task' : 'New task'}</h2>
        <span className="hint">Required fields save a draft; Before ready fields make the task ready for the Master Plan.</span>
        <span className={`saved ${dirty ? 'dirty' : ''}`}><i />{dirty ? 'Unsaved changes' : editing ? 'No changes yet' : 'Nothing typed yet'}</span>
        <div className="form-progress" aria-hidden="true"><span style={{ ['--p' as string]: `${((section + 1) / SECTIONS.length) * 100}%` }} /></div>
      </div>
      <div className="fbody">
        <nav className="fnav" aria-label="Form sections">
          {SECTIONS.map((s, i) => {
            const errs = errorsBySection[i].filter((c) => c.level === 'error').length;
            const warns = errorsBySection[i].length - errs;
            return (
              <button key={s.title} type="button" className={section === i ? 'on' : ''} onClick={() => go(i)}>
                <span className="no">{i + 1}</span>
                <span className="nm">{s.title}</span>
                <span className="st">{errs ? <b className="e">{errs}</b> : warns ? <b className="w">{warns}</b> : <span className="okk">✓</span>}</span>
              </button>
            );
          })}
        </nav>
        <div className="fmain">
          <div className="fph"><span className="no">STEP {section + 1} OF {SECTIONS.length}</span><h3>{SECTIONS[section].title}</h3></div>
          <p className="intro">{SECTIONS[section].intro}</p>
          <ErrorText error={save.error} />
          <div className="fpane" key={section}>{panes[section]}</div>
        </div>
        <aside className="fside">
          <h4>Live check <Tip text="Updates as you type. Click a problem to jump to its step. Red must be fixed; amber is still to complete." /><i className={`live-dot ${checking ? 'busy' : ''}`} title={checking ? 'Checking…' : 'Up to date'} /></h4>
          {allChecks.length ? (
            <ul className="issues">
              {allChecks.map((c, i) => (
                <li key={i} className={c.level} role={sectionOf(c.field) >= 0 ? 'button' : undefined} tabIndex={0}
                  onClick={() => sectionOf(c.field) >= 0 && go(sectionOf(c.field))}
                  onKeyDown={(e) => e.key === 'Enter' && sectionOf(c.field) >= 0 && go(sectionOf(c.field))}>
                  <span className="cl">{c.label}</span><span>{c.message}</span>
                </li>
              ))}
            </ul>
          ) : <div className="ok strong">✓ OK. The task is complete.</div>}
          <div className="flegend">
            {(Object.keys(REQUIREMENT_LABEL) as Requirement[]).map((r) => (
              <span key={r}><b className={`rq-${r}`}>{REQUIREMENT_LABEL[r]}</b> {REQUIREMENT_HINT[r].toLowerCase()}</span>
            ))}
          </div>
        </aside>
      </div>
      <div className="mf">
        <button type="button" className="btn" onClick={() => void cancel()}>Cancel</button>
        <span className="spacer" />
        <span className="kbd">Ctrl + S saves</span>
        <button type="button" className="btn" disabled={section === 0} onClick={() => go(section - 1)}>◀ Back</button>
        {section < SECTIONS.length - 1 && <button type="button" className="btn" onClick={() => go(section + 1)}>Next ▶</button>}
        <button type="button" className="btn pri" onClick={submit} disabled={save.isPending}>
          {save.isPending ? 'Saving…' : editing ? 'Save changes' : 'Add to register'}
        </button>
      </div>
    </div>
  );
}
