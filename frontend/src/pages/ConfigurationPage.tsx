import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Navigate } from 'react-router-dom';

import { api, ApiError } from '../api/client';
import { useLeaderCandidates, useMembers, useResource } from '../api/queries';
import type { Activity, Direction, GroupMember, ListKey, Lookup, MemberType, WorkGroup } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { useConfirm } from '../components/Confirm';
import { useDrill } from '../components/Drill';
import { ConfirmButton, Empty, ErrorText, Field, Loading, Modal, Pager, Tip, usePaging } from '../components/ui';
import { toDrillActivity } from '../lib/activities';
import { LIST_HINT, LIST_LABEL } from '../lib/fields';
import { useRefs } from '../lib/useRefs';

type Key = 'work_groups' | 'directions' | 'members' | ListKey;
const GROUPS: [string, Key[]][] = [
  ['Organization', ['work_groups', 'directions', 'members']],
  ['Task classification', ['workstream', 'sub_objective']],
  ['Roles', ['owner_role', 'partner_role']],
  ['Status values', ['needed']],
];
const NAMES: Record<string, string> = { work_groups: 'Work groups', directions: 'Directions', members: 'Group members', ...LIST_LABEL };
const HINTS: Record<string, string> = {
  work_groups: 'Groups that keep a task register. The code starts every task ID, so it is fixed once tasks exist; the name can be edited. Each work group has three roles, created with it: "<CODE> Team Leader" (full control of the group: approves or rejects the tasks its Focal Point submits and the links other groups record with it, and may name a delegate while away), "<CODE> Team Focal Point" (adds the group\'s tasks, edits and deletes them while they are Draft or Needs completion, and submits them to the leader) and "<CODE> Team Member" (reads the group\'s tasks). The weight is the group\'s share of the programme.',
  directions: "Each work group serves its own directions; a task can use only its own group's directions. IDs are created from the group code.",
  members: "The people of each work group, each a Leader, Focal Point or Member. When the person has a sign-in account, the type gives them that group's role: Team Leader, Team Focal Point or Team Member. An activity owner is picked from the members of the task's own work group. A member who owns activities cannot be deleted.",
  ...LIST_HINT,
};
/** One very short line under each list's title; the full explanation is in the (i) next to the title. */
const SHORT: Record<string, string> = {
  work_groups: 'The teams that keep a task register.',
  directions: "What each work group's tasks serve.",
  members: 'The people of each work group and their role.',
  workstream: 'The programme workstreams a task belongs to.',
  sub_objective: "Each group's sub-objectives a task can deliver.",
  owner_role: "Whose result the task is: Direct, Enable or Support.",
  partner_role: 'How a partner group works on a task.',
  needed: 'When an output from another group is needed.',
};
/** What the search box looks in, per list. */
const SEARCH_HINT: Record<string, string> = {
  work_groups: 'Search code, name, mission or leader',
  directions: 'Search ID, group, title or meaning',
  members: 'Search name, group, type, account, job title, email or phone',
  sub_objective: 'Search value, definition or group',
};
const INVALIDATE = ['work-groups', 'directions', 'lookups', 'members', 'leader-candidates'];

const norm = (s: unknown) => String(s ?? '').toLowerCase();
/** Every word of the search must appear in one of the fields. */
const matches = (q: string, ...fields: unknown[]) => !q || q.split(/\s+/).every((w) => fields.some((f) => norm(f).includes(w)));

/**
 * The rows of one page, the pager, and a "just saved" highlight: after a save the table jumps to the page
 * holding the saved row and marks it for a moment, so the change is seen at once without a reload.
 */
function usePagedRows<T extends { id: number }>(rows: T[], resetOn: unknown[]) {
  const paging = usePaging(10);
  const [flash, setFlash] = useState<number | null>(null);
  const pages = Math.max(1, Math.ceil(rows.length / paging.size));
  const page = Math.min(paging.page, pages);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => paging.reset(), resetOn);
  useEffect(() => {
    if (flash === null) return;
    const i = rows.findIndex((r) => r.id === flash);
    if (i >= 0) paging.setPage(Math.floor(i / paging.size) + 1);
    const t = setTimeout(() => setFlash(null), 2400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flash, rows.length]);
  return {
    pageRows: rows.slice((page - 1) * paging.size, page * paging.size),
    offset: (page - 1) * paging.size,
    flash,
    saved: (id?: number) => { if (id) setFlash(id); },
    pager: <Pager count={rows.length} page={page} size={paging.size} onPage={paging.setPage} onSize={paging.setSize} />,
  };
}

/** The bar above a table: list-specific filters on the left, the add button on the right. */
function Toolbar({ children, onAdd, addLabel }: { children?: ReactNode; onAdd: () => void; addLabel: string }) {
  return (
    <div className="filters">
      {children}
      <span className="spacer" />
      <button type="button" className="btn pri sm" onClick={onAdd}>{addLabel}</button>
    </div>
  );
}

function GroupFilter({ value, onChange }: { value: number | ''; onChange: (v: number | '') => void }) {
  const refs = useRefs();
  return (
    <select aria-label="Filter by work group" value={value} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : '')}>
      <option value="">All work groups</option>
      {refs.groups.map((g) => <option key={g.id} value={g.id}>{g.code} – {g.name}</option>)}
    </select>
  );
}

const fieldErr = (error: unknown, k: string) => {
  const msg = error instanceof ApiError ? error.fields[k]?.[0] : undefined;
  return msg ? <span className="field-error" role="alert">{msg}</span> : null;
};

/**
 * The dialog shared by every add / edit on this page. Enter saves; closing with unsaved changes asks
 * "Discard your changes?" first. The table is refreshed before the dialog closes.
 */
function EditDialog<F extends object>({ title, intro, initial, form, valid, saving, error, onSave, onClose, children }: {
  title: string;
  intro?: string;
  initial: F;
  form: F;
  valid: boolean;
  saving: boolean;
  error: unknown;
  onSave: () => void;
  onClose: () => void;
  children: ReactNode;
}) {
  const confirm = useConfirm();
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  const close = async () => {
    if (dirty && !(await confirm({ title: 'Discard your changes?', message: 'What you changed in this dialog is not saved yet.', confirmLabel: 'Discard', cancelLabel: 'Keep editing' }))) return;
    onClose();
  };
  return (
    <Modal title={title} onClose={() => void close()}
      footer={<>
        <button type="button" className="btn" onClick={() => void close()}>Cancel</button>
        <button type="button" className="btn pri" disabled={!valid || saving} onClick={onSave}>{saving ? 'Saving…' : 'Save'}</button>
      </>}>
      {intro && <p className="intro">{intro}</p>}
      <form className="fgrid" onSubmit={(e) => { e.preventDefault(); if (valid && !saving) onSave(); }}>
        {children}
        <button type="submit" hidden />
      </form>
      {error instanceof ApiError && !Object.keys(error.fields).length ? <ErrorText error={error} /> : null}
    </Modal>
  );
}

/** Save through create or update, then report the saved id and close. */
function submit(m: { create: { mutate: (b: unknown, o: { onSuccess: (r: unknown) => void }) => void }; update: { mutate: (v: { id: number; body: unknown }, o: { onSuccess: (r: unknown) => void }) => void } },
  id: number | undefined, body: unknown, onSaved: (id?: number) => void, onClose: () => void) {
  const done = (r: unknown) => {
    onSaved((r as { id?: number } | undefined)?.id ?? id);
    onClose();
  };
  if (id) m.update.mutate({ id, body }, { onSuccess: done });
  else m.create.mutate(body, { onSuccess: done });
}

/* ---- Work groups --------------------------------------------------------------------------- */

type WgForm = { id?: number; code: string; name: string; mission: string; weight: string; leader: number | ''; locked: boolean };

function WorkGroupDialog({ initial, onClose, onSaved }: { initial: WgForm; onClose: () => void; onSaved: (id?: number) => void }) {
  const res = useResource('work-groups', INVALIDATE);
  const candidates = useLeaderCandidates(true);
  const [f, setF] = useState(initial);
  const m = f.id ? res.update : res.create;
  const weight = Number(f.weight || 0);
  const valid = f.name.trim().length > 1 && /^[A-Z]{2,5}$/.test(f.code) && weight >= 0 && weight <= 100;
  const save = () => submit(res, f.id, {
    ...(f.locked ? {} : { code: f.code }), name: f.name.trim(), mission: f.mission.trim(), weight,
    ...(f.id ? { leader: f.leader === '' ? null : f.leader } : {}),
  }, onSaved, onClose);
  return (
    <EditDialog title={f.id ? 'Edit work group' : 'Add a work group'} initial={initial} form={f} valid={valid} saving={m.isPending} error={m.error} onSave={save} onClose={onClose}
      intro="Code and name are required. The group's three roles (Team Leader, Focal Point and Member) are created with it.">
      <Field label="Code" req="REQUIRED" htmlFor="wg-code" hint="2 to 5 capital letters. It starts every task ID of the group, so it cannot change once the group has tasks.">
        <input id="wg-code" value={f.code} maxLength={5} disabled={f.locked} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase().replace(/[^A-Z]/g, '') })} autoFocus={!f.id} />
        {fieldErr(m.error, 'code')}
      </Field>
      <Field label="Weight (%)" req="OPTIONAL" htmlFor="wg-weight" hint="The group's share of the programme, 0 to 100.">
        <input id="wg-weight" type="number" min={0} max={100} value={f.weight} onChange={(e) => setF({ ...f, weight: e.target.value })} />
        {fieldErr(m.error, 'weight')}
      </Field>
      <Field label="Name" req="REQUIRED" htmlFor="wg-name" wide>
        <input id="wg-name" value={f.name} maxLength={120} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus={!!f.id} />
        {fieldErr(m.error, 'name')}
      </Field>
      <Field label="Mission" req="OPTIONAL" htmlFor="wg-mission" wide>
        <textarea id="wg-mission" rows={4} maxLength={1000} value={f.mission} onChange={(e) => setF({ ...f, mission: e.target.value })} placeholder="What the group is set up to achieve" />
        {fieldErr(m.error, 'mission')}
      </Field>
      {f.id && (
        <Field label="Leader" req="OPTIONAL" htmlFor="wg-leader" wide hint="One leader per group, with the role '<CODE> Team Leader'. The previous leader stays in the group as a member.">
          <select id="wg-leader" value={f.leader} onChange={(e) => setF({ ...f, leader: e.target.value ? Number(e.target.value) : '' })}>
            <option value="">No leader</option>
            {(candidates.data ?? []).map((u) => <option key={u.id} value={u.id}>{u.name} ({u.username})</option>)}
          </select>
          {fieldErr(m.error, 'leader')}
        </Field>
      )}
    </EditDialog>
  );
}

function WorkGroups({ q }: { q: string }) {
  const refs = useRefs();
  const { remove } = useResource('work-groups', INVALIDATE);
  const [dialog, setDialog] = useState<WgForm | null>(null);
  const rows = useMemo(() => refs.groups.filter((g: WorkGroup) => matches(q, g.code, g.name, g.mission, g.leader_name)), [refs.groups, q]);
  const t = usePagedRows(rows, [q]);
  const total = refs.groups.reduce((n, g) => n + (g.weight ?? 0), 0);
  return (
    <>
      <Toolbar addLabel="+ Add work group" onAdd={() => setDialog({ code: '', name: '', mission: '', weight: '0', leader: '', locked: false })}>
        <span className="t2">All groups together weigh <b className="mono">{total}%</b></span>
      </Toolbar>
      <ErrorText error={remove.error} />
      <div className="tw"><table className="ctab">
        <thead><tr><th>Code</th><th>Name and mission</th><th className="r">Weight <Tip text={`The group's share of the programme, in per cent. All groups together: ${total}%.`} /></th><th>Leader <Tip text="One leader per work group, with the role '<CODE> Team Leader' (for example HR Team Leader). Picking the leader here gives the role and marks the person Leader in Group members; giving the role in the admin site sets the leader here. The leader has full control of the group." /></th><th className="r">Tasks</th><th /></tr></thead>
        <tbody>
          {t.pageRows.map((g) => (
            <tr key={g.id} className={t.flash === g.id ? 'flash' : ''}>
              <td><span className="tag wg">{g.code}</span></td>
              <td><div className="t1">{g.name}</div>{g.mission && <div className="t2 clamp">{g.mission}</div>}</td>
              <td className="num r">{g.weight ? `${g.weight}%` : '–'}</td>
              <td>{g.leader_name ? <span className="leader-name">★ {g.leader_name}</span> : <span className="t2">No leader yet</span>}</td>
              <td className="num r">{g.task_count || '–'}</td>
              <td className="cact">
                <button type="button" className="btn sm ghost" onClick={() => setDialog({ id: g.id, code: g.code, name: g.name, mission: g.mission ?? '', weight: String(g.weight ?? 0), leader: g.leader ?? '', locked: (g.task_count ?? 0) > 0 })}>Edit</button>
                <ConfirmButton label="Delete" onConfirm={() => remove.mutate(g.id)} disabled={(g.task_count ?? 0) > 0} title="This group has tasks. It cannot be deleted."
                  confirmTitle="Delete this work group?" subject={`${g.code} – ${g.name}`} message="Its directions, members and three roles are deleted with it. This cannot be undone." />
              </td>
            </tr>
          ))}
        </tbody>
      </table></div>
      {!rows.length && <Empty>No work group matches the search.</Empty>}
      {t.pager}
      {dialog && <WorkGroupDialog initial={dialog} onClose={() => setDialog(null)} onSaved={t.saved} />}
    </>
  );
}

/* ---- Directions ---------------------------------------------------------------------------- */

type DirForm = { id?: number; code?: string; work_group: number | ''; title: string; meaning: string };

function DirectionDialog({ initial, onClose, onSaved }: { initial: DirForm; onClose: () => void; onSaved: (id?: number) => void }) {
  const refs = useRefs();
  const res = useResource('directions', INVALIDATE);
  const [f, setF] = useState(initial);
  const m = f.id ? res.update : res.create;
  const valid = f.work_group !== '' && f.title.trim().length >= 3;
  const save = () => submit(res, f.id, f.id
    ? { title: f.title.trim(), meaning: f.meaning.trim() }
    : { work_group: f.work_group, title: f.title.trim(), meaning: f.meaning.trim() }, onSaved, onClose);
  const g = f.work_group ? refs.group(f.work_group) : undefined;
  return (
    <EditDialog title={f.id ? 'Edit direction' : 'Add a direction'} initial={initial} form={f} valid={valid} saving={m.isPending} error={m.error} onSave={save} onClose={onClose}
      intro={f.id ? undefined : 'The ID is created from the group code, for example HR-D08.'}>
      <Field label="Work group" req="REQUIRED" htmlFor="d-wg" wide>
        {f.id ? <div id="d-wg" className="auto"><span className="mono">{f.code}</span> · {g?.code} – {g?.name}</div> : (
          <select id="d-wg" value={f.work_group} onChange={(e) => setF({ ...f, work_group: e.target.value ? Number(e.target.value) : '' })}>
            <option value="" />
            {refs.groups.map((x) => <option key={x.id} value={x.id}>{x.code} – {x.name}</option>)}
          </select>
        )}
        {fieldErr(m.error, 'work_group')}
      </Field>
      <Field label="Title" req="REQUIRED" htmlFor="d-title" wide>
        <input id="d-title" value={f.title} maxLength={200} onChange={(e) => setF({ ...f, title: e.target.value })} autoFocus />
        {fieldErr(m.error, 'title')}
      </Field>
      <Field label="What it means" req="OPTIONAL" htmlFor="d-meaning" wide>
        <textarea id="d-meaning" rows={4} value={f.meaning} onChange={(e) => setF({ ...f, meaning: e.target.value })} placeholder="What the direction means for the group" />
        {fieldErr(m.error, 'meaning')}
      </Field>
    </EditDialog>
  );
}

function Directions({ q }: { q: string }) {
  const refs = useRefs();
  const { remove } = useResource('directions', INVALIDATE);
  const [filter, setFilter] = useState<number | ''>('');
  const [dialog, setDialog] = useState<DirForm | null>(null);
  const rows = useMemo(() => refs.directions.filter((d: Direction) => (!filter || d.work_group === filter) && matches(q, d.code, d.work_group_code, d.title, d.meaning)), [refs.directions, filter, q]);
  const t = usePagedRows(rows, [q, filter]);
  return (
    <>
      <Toolbar addLabel="+ Add direction" onAdd={() => setDialog({ work_group: filter || (refs.groups[0]?.id ?? ''), title: '', meaning: '' })}>
        <GroupFilter value={filter} onChange={setFilter} />
      </Toolbar>
      <ErrorText error={remove.error} />
      <div className="tw"><table className="ctab">
        <thead><tr><th>ID</th><th>Group</th><th>Direction and what it means</th><th className="r">Tasks</th><th /></tr></thead>
        <tbody>
          {t.pageRows.map((d) => (
            <tr key={d.id} className={t.flash === d.id ? 'flash' : ''}>
              <td className="id">{d.code}</td><td><span className="tag wg">{d.work_group_code}</span></td>
              <td><div className="t1">{d.title}</div><div className="t2 clamp">{d.meaning}</div></td>
              <td className="num r">{d.task_count || '–'}</td>
              <td className="cact">
                <button type="button" className="btn sm ghost" onClick={() => setDialog({ id: d.id, code: d.code, work_group: d.work_group, title: d.title, meaning: d.meaning })}>Edit</button>
                <ConfirmButton label="Delete" onConfirm={() => remove.mutate(d.id)} disabled={(d.task_count ?? 0) > 0} title="Tasks use this direction. Move them first."
                  confirmTitle="Delete this direction?" subject={`${d.code} – ${d.title}`} />
              </td>
            </tr>
          ))}
        </tbody>
      </table></div>
      {!rows.length && <Empty>No direction matches. Add one with + Add direction.</Empty>}
      {t.pager}
      {dialog && <DirectionDialog initial={dialog} onClose={() => setDialog(null)} onSaved={t.saved} />}
    </>
  );
}

/* ---- Group members ------------------------------------------------------------------------- */

type MemberForm = { id?: number; name: string; work_group: number | ''; member_type: MemberType; job_title: string; email: string; phone: string; is_active: boolean; username?: string };

const MEMBER_TYPES: { value: MemberType; label: string; hint: string }[] = [
  { value: 'leader', label: 'Leader', hint: 'Team Leader: full control of the group, and its governance decisions. One per group.' },
  { value: 'coordinator', label: 'Focal Point', hint: "Team Focal Point: adds the group's tasks, edits and deletes them while they are Draft or Needs completion, and submits them to the leader." },
  { value: 'member', label: 'Member', hint: "Team Member: reads the group's tasks." },
];
const typeLabel = (t?: MemberType) => MEMBER_TYPES.find((x) => x.value === t)?.label ?? 'Member';

/** Add or edit a member: name, work group and type, plus optional job title, email and phone. */
function MemberDialog({ initial, onClose, onSaved }: { initial: MemberForm; onClose: () => void; onSaved: (id?: number) => void }) {
  const refs = useRefs();
  const res = useResource('members', INVALIDATE);
  const [f, setF] = useState<MemberForm>(initial);
  const m = f.id ? res.update : res.create;
  const emailOk = !f.email || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim());
  const phoneOk = !f.phone || /^\+?[0-9][0-9 ()-]{5,28}$/.test(f.phone.trim());
  const valid = f.name.trim().length > 0 && f.work_group !== '' && emailOk && phoneOk;
  const save = () => submit(res, f.id, {
    name: f.name, work_group: f.work_group, member_type: f.member_type, job_title: f.job_title, email: f.email.trim(), phone: f.phone.trim(), is_active: f.is_active,
  }, onSaved, onClose);
  const set = (k: keyof MemberForm) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  return (
    <EditDialog title={f.id ? 'Edit member' : 'Add a member'} initial={initial} form={f} valid={valid} saving={m.isPending} error={m.error} onSave={save} onClose={onClose}
      intro="Name, work group and type are required. Contact details are optional and help other groups and the TMO reach the owner of an activity.">
      <Field label="Name" req="REQUIRED" htmlFor="m-name">
        <input id="m-name" value={f.name} onChange={set('name')} maxLength={120} autoFocus />{fieldErr(m.error, 'name')}
      </Field>
      <Field label="Work group" req="REQUIRED" htmlFor="m-wg" hint="Activities of this group's tasks can be assigned to the member.">
        <select id="m-wg" value={f.work_group} onChange={(e) => setF({ ...f, work_group: e.target.value ? Number(e.target.value) : '' })}>
          <option value="" />
          {refs.groups.map((g) => <option key={g.id} value={g.id}>{g.code} – {g.name}</option>)}
        </select>{fieldErr(m.error, 'work_group')}
      </Field>
      <Field label="Type" req="REQUIRED" htmlFor="m-type" hint={MEMBER_TYPES.find((x) => x.value === f.member_type)?.hint}>
        <select id="m-type" value={f.member_type} onChange={(e) => setF({ ...f, member_type: e.target.value as MemberType })}>
          {MEMBER_TYPES.map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}
        </select>{fieldErr(m.error, 'member_type')}
      </Field>
      <Field label="Sign-in account" htmlFor="m-user" hint="Set when the account was created from the member list. The type gives this account its role in the group.">
        <div id="m-user" className="auto">{f.username || 'No account'}</div>
      </Field>
      <Field label="Job title" req="OPTIONAL" htmlFor="m-title">
        <input id="m-title" value={f.job_title} onChange={set('job_title')} maxLength={120} placeholder="e.g. Solution Architect" />{fieldErr(m.error, 'job_title')}
      </Field>
      <Field label="Email" req="OPTIONAL" htmlFor="m-email">
        <input id="m-email" type="email" autoComplete="off" value={f.email} onChange={set('email')} maxLength={254} placeholder="name@al-ayuni.com" aria-invalid={!emailOk} />
        {!emailOk ? <span className="field-error" role="alert">Write a complete email address, e.g. name@al-ayuni.com.</span> : fieldErr(m.error, 'email')}
      </Field>
      <Field label="Phone" req="OPTIONAL" htmlFor="m-phone">
        <input id="m-phone" type="tel" value={f.phone} onChange={set('phone')} maxLength={30} placeholder="+966 11 234 5678" aria-invalid={!phoneOk} />
        {!phoneOk ? <span className="field-error" role="alert">Write the phone number with digits, e.g. +966 11 234 5678.</span> : fieldErr(m.error, 'phone')}
      </Field>
      {f.id && (
        <Field label="Status" htmlFor="m-active" hint="An inactive member keeps their activities but is no longer offered as an owner.">
          <label className="check"><input id="m-active" type="checkbox" checked={f.is_active} onChange={(e) => setF({ ...f, is_active: e.target.checked })} /> Active</label>
        </Field>
      )}
    </EditDialog>
  );
}

function Members({ q, members }: { q: string; members: GroupMember[] }) {
  const refs = useRefs();
  const drill = useDrill();
  const { remove } = useResource('members', INVALIDATE);
  const [filter, setFilter] = useState<number | ''>('');
  const [type, setType] = useState<MemberType | ''>('');
  const [dialog, setDialog] = useState<MemberForm | null>(null);
  const rows = useMemo(() => {
    const rank = { leader: 0, coordinator: 1, member: 2 };
    return members
      .filter((m) => (!filter || m.work_group === filter) && (!type || m.member_type === type)
        && matches(q, m.name, m.work_group_code, typeLabel(m.member_type), m.username, m.job_title, m.email, m.phone))
      .sort((a, b) => a.work_group_code.localeCompare(b.work_group_code) || rank[a.member_type ?? 'member'] - rank[b.member_type ?? 'member'] || a.name.localeCompare(b.name));
  }, [members, filter, type, q]);
  const t = usePagedRows(rows, [q, filter, type]);
  const openActivities = async (m: GroupMember) => {
    const acts = await api<Activity[]>(`/api/activities/`);
    drill({ kind: 'activities', title: m.name, rows: acts.filter((a) => a.owner === m.id).map(toDrillActivity) });
  };
  const blank: MemberForm = { name: '', work_group: filter || (refs.groups[0]?.id ?? ''), member_type: 'member', job_title: '', email: '', phone: '', is_active: true };
  return (
    <>
      <Toolbar addLabel="+ Add member" onAdd={() => setDialog(blank)}>
        <GroupFilter value={filter} onChange={setFilter} />
        <select aria-label="Filter by type" value={type} onChange={(e) => setType(e.target.value as MemberType | '')}>
          <option value="">Leaders, focal points and members</option>
          {MEMBER_TYPES.map((x) => <option key={x.value} value={x.value}>{x.label === 'Focal Point' ? 'Focal Points' : `${x.label}s`}</option>)}
        </select>
      </Toolbar>
      <ErrorText error={remove.error} />
      <div className="tw"><table className="ctab">
        <thead><tr>
          <th>Name</th>
          <th>Work group <Tip text="The member's own work group. Activities of that group's tasks can be assigned to them." /></th>
          <th>Type <Tip text="Leader, Focal Point or Member. With a sign-in account, the type sets the person's role in the group: Team Leader, Team Focal Point or Team Member." /></th>
          <th>Account</th>
          <th>Contact</th>
          <th className="r">Activities</th><th />
        </tr></thead>
        <tbody>
          {t.pageRows.map((m) => (
            <tr key={m.id} className={`${m.is_active ? '' : 'inactive'} ${t.flash === m.id ? 'flash' : ''}`}>
              <td>
                <div className="t1">{m.name} {!m.is_active && <span className="chk warn">Inactive</span>}</div>
                {m.job_title && <div className="t2">{m.job_title}</div>}
              </td>
              <td><span className="tag wg">{m.work_group_code}</span> <span className="t2">{refs.group(m.work_group)?.name}</span></td>
              <td><span className={`mtype ${m.member_type ?? 'member'}`}>{m.member_type === 'leader' ? '★ ' : ''}{m.member_type_label || typeLabel(m.member_type)}</span></td>
              <td>{m.username ? <code className="uname">{m.username}</code> : <span className="t2">—</span>}</td>
              <td className="contact">
                {m.email ? <a href={`mailto:${m.email}`}>{m.email}</a> : null}
                {m.phone ? <a href={`tel:${m.phone.replace(/[^+0-9]/g, '')}`} className="t2">{m.phone}</a> : null}
                {!m.email && !m.phone && <span className="t2">—</span>}
              </td>
              <td className="num r">{m.activity_count ? <button type="button" className="dn" data-tip="Click to see the activities" onClick={() => void openActivities(m)}>{m.activity_count}</button> : '–'}</td>
              <td className="cact">
                <button type="button" className="btn sm ghost" onClick={() => setDialog({ id: m.id, name: m.name, work_group: m.work_group, member_type: m.member_type ?? 'member', username: m.username, job_title: m.job_title ?? '', email: m.email ?? '', phone: m.phone ?? '', is_active: m.is_active })}>Edit</button>
                <ConfirmButton label="Delete" onConfirm={() => remove.mutate(m.id)} disabled={m.activity_count > 0} title="This member owns activities. Give them another owner first."
                  confirmTitle="Delete this member?" subject={`${m.name} · ${m.work_group_code}`}
                  message={m.username ? 'Their sign-in account stays, but loses its role in this group. This cannot be undone.' : 'This cannot be undone.'} />
              </td>
            </tr>
          ))}
        </tbody>
      </table></div>
      {!rows.length && <Empty>No member matches. Add the people of each work group with + Add member.</Empty>}
      {t.pager}
      {dialog && <MemberDialog initial={dialog} onClose={() => setDialog(null)} onSaved={t.saved} />}
    </>
  );
}

/* ---- Lists (workstreams, sub-objectives, roles, when needed) ------------------------------ */

type LookupForm = { id?: number; value: string; definition: string; work_group: number | '' };

function LookupDialog({ listKey, initial, onClose, onSaved }: { listKey: ListKey; initial: LookupForm; onClose: () => void; onSaved: (id?: number) => void }) {
  const refs = useRefs();
  const res = useResource('lookups', INVALIDATE);
  const [f, setF] = useState(initial);
  const m = f.id ? res.update : res.create;
  const grouped = listKey === 'sub_objective';
  const valid = f.value.trim().length > 0;
  const save = () => submit(res, f.id, {
    value: f.value.trim(), definition: f.definition.trim(),
    ...(grouped ? { work_group: f.work_group || null } : {}),
    ...(f.id ? {} : { list_key: listKey, sort_order: refs.list(listKey).length + 1 }),
  }, onSaved, onClose);
  return (
    <EditDialog title={f.id ? 'Edit value' : 'Add a value'} initial={initial} form={f} valid={valid} saving={m.isPending} error={m.error} onSave={save} onClose={onClose}
      intro={f.id ? 'Renaming a value renames it on every task that uses it.' : undefined}>
      {grouped && (
        <Field label="Work group" req="OPTIONAL" htmlFor="l-wg" wide hint="The work group this sub-objective belongs to. A task can use only its own group's sub-objectives.">
          <select id="l-wg" value={f.work_group} onChange={(e) => setF({ ...f, work_group: e.target.value ? Number(e.target.value) : '' })}>
            <option value="">Any group</option>
            {refs.groups.map((g) => <option key={g.id} value={g.id}>{g.code} – {g.name}</option>)}
          </select>
          {fieldErr(m.error, 'work_group')}
        </Field>
      )}
      <Field label="Value" req="REQUIRED" htmlFor="l-value" wide>
        <input id="l-value" value={f.value} maxLength={200} onChange={(e) => setF({ ...f, value: e.target.value })} autoFocus />
        {fieldErr(m.error, 'value')}
      </Field>
      <Field label="Definition" req="OPTIONAL" htmlFor="l-def" wide hint="Shown as a tooltip next to the value across the app.">
        <textarea id="l-def" rows={3} value={f.definition} onChange={(e) => setF({ ...f, definition: e.target.value })} />
        {fieldErr(m.error, 'definition')}
      </Field>
    </EditDialog>
  );
}

function LookupList({ listKey, q }: { listKey: ListKey; q: string }) {
  const refs = useRefs();
  const { remove } = useResource('lookups', INVALIDATE);
  const grouped = listKey === 'sub_objective';
  const [filter, setFilter] = useState<number | ''>('');
  const [dialog, setDialog] = useState<LookupForm | null>(null);
  const all = refs.list(listKey);
  const rows = useMemo(() => all.filter((l: Lookup) => (!filter || l.work_group === filter) && matches(q, l.value, l.definition, l.work_group_code)), [all, filter, q]);
  const t = usePagedRows(rows, [q, filter]);
  return (
    <>
      <Toolbar addLabel="+ Add value" onAdd={() => setDialog({ value: '', definition: '', work_group: filter })}>
        {grouped && <GroupFilter value={filter} onChange={setFilter} />}
      </Toolbar>
      <ErrorText error={remove.error} />
      <div className="tw"><table className="ctab">
        <thead><tr><th>#</th>{grouped && <th>Group <Tip text="The work group this sub-objective belongs to. A task can use only its own group's sub-objectives." /></th>}<th>Value</th><th>Definition <Tip text="Shown as a tooltip next to the value across the app." /></th><th className="r">In use</th><th /></tr></thead>
        <tbody>
          {t.pageRows.map((l, i) => (
            <tr key={l.id} className={t.flash === l.id ? 'flash' : ''}>
              <td className="num t2">{t.offset + i + 1}</td>
              {grouped && <td>{l.work_group_code ? <span className="tag wg">{l.work_group_code}</span> : <span className="t2">Any</span>}</td>}
              <td><span className="t1">{l.value}</span> {l.is_core && <span className="tag" data-tip="The automatic check relies on this value. You can rename it but not delete it.">core</span>}</td>
              <td className="t2">{l.definition || 'No definition yet'}</td>
              <td className="num r">{l.usage || '–'}</td>
              <td className="cact">
                <button type="button" className="btn sm ghost" onClick={() => setDialog({ id: l.id, value: l.value, definition: l.definition, work_group: l.work_group ?? '' })}>Edit</button>
                <ConfirmButton label="Delete" onConfirm={() => remove.mutate(l.id)} disabled={l.is_core || l.usage > 0}
                  title={l.is_core ? 'The automatic check relies on this value. Rename it instead.' : 'In use by tasks or links. Change those first.'}
                  confirmTitle="Delete this value?" subject={l.value} />
              </td>
            </tr>
          ))}
        </tbody>
      </table></div>
      {!rows.length && <Empty>{all.length ? 'No value matches the search.' : 'No values yet. Add the first one with + Add value.'}</Empty>}
      {t.pager}
      {dialog && <LookupDialog listKey={listKey} initial={dialog} onClose={() => setDialog(null)} onSaved={t.saved} />}
    </>
  );
}

export default function ConfigurationPage() {
  const { me } = useAuth();
  const refs = useRefs();
  const members = useMembers();
  const [selected, setSelected] = useState<Key>('work_groups');
  const [q, setQ] = useState('');
  if (!me?.permissions.manage_master_data) return <Navigate to="/" replace />;
  if (!refs.ready) return <Loading />;
  const count = (k: Key) =>
    k === 'work_groups' ? refs.groups.length : k === 'directions' ? refs.directions.length : k === 'members' ? members.data?.length ?? 0 : refs.list(k).length;
  const groups = GROUPS;
  const groupName = groups.find(([, keys]) => keys.includes(selected))?.[0];
  const choose = (k: Key) => {
    setSelected(k);
    setQ('');
  };
  const query = q.trim().toLowerCase();

  return (
    <div className="panel cfgwrap">
      <nav className="cnav" aria-label="Master data lists">
        {groups.map(([g, keys]) => (
          <div key={g}>
            <div className="cg">{g}</div>
            {keys.map((k) => (
              <button key={k} type="button" className={selected === k ? 'on' : ''} onClick={() => choose(k)}>
                <span>{NAMES[k]}</span><span className="cc">{count(k)}</span>
              </button>
            ))}
          </div>
        ))}
      </nav>
      <div className="cpane">
        <select className="csel" aria-label="Master data list" value={selected} onChange={(e) => choose(e.target.value as Key)}>
          {groups.map(([g, keys]) => <optgroup key={g} label={g}>{keys.map((k) => <option key={k} value={k}>{`${NAMES[k]} (${count(k)})`}</option>)}</optgroup>)}
        </select>
        <div className="cph">
          <div><div className="eyeb">{groupName}</div><h3>{NAMES[selected]} <span className="cc">{count(selected)}</span> <Tip text={HINTS[selected]} /></h3><p className="cph-short">{SHORT[selected]}</p></div>
          <input type="search" className="csearch" placeholder={SEARCH_HINT[selected] ?? 'Search value or definition'} aria-label="Search" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        {selected === 'work_groups' ? <WorkGroups q={query} />
          : selected === 'directions' ? <Directions q={query} />
          : selected === 'members' ? <Members q={query} members={members.data ?? []} />
          : <LookupList key={selected} listKey={selected} q={query} />}
        <p className="hint">Editing a value renames it everywhere, because tasks point to the value itself. Values in use, and core values the check relies on, cannot be deleted.</p>
      </div>
    </div>
  );
}
