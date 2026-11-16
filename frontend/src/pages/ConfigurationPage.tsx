import { useState } from 'react';
import { Navigate } from 'react-router-dom';

import { api } from '../api/client';
import { useMembers, useResource } from '../api/queries';
import type { Activity, GroupMember, ListKey } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { useDrill } from '../components/Drill';
import { ConfirmButton, Empty, ErrorText, Loading, Tip } from '../components/ui';
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
  work_groups: 'Groups that keep a task register. The code starts every task ID, so it is fixed once tasks exist; the name can be edited. Each work group has its own role, "<CODE> Team", created with it; give that role to users in the admin site to let them maintain the register.',
  directions: "Each work group serves its own directions; a task can use only its own group's directions. IDs are created from the group code.",
  members: "The people of each work group. An activity owner is picked from the members of the task's own work group. A rename updates their activities; a member who owns activities cannot be deleted.",
  ...LIST_HINT,
};
const INVALIDATE = ['work-groups', 'directions', 'lookups', 'members'];

function WorkGroups({ q }: { q: string }) {
  const refs = useRefs();
  const { create, update, remove } = useResource('work-groups', INVALIDATE);
  const [edit, setEdit] = useState<{ id: number; name: string } | null>(null);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const rows = refs.groups.filter((g) => `${g.code} ${g.name}`.toLowerCase().includes(q));
  return (
    <>
      <ErrorText error={create.error || update.error || remove.error} />
      <div className="tw"><table className="ctab">
        <thead><tr><th>Code</th><th>Name</th><th className="r">Tasks</th><th /></tr></thead>
        <tbody>
          {rows.map((g) => edit?.id === g.id ? (
            <tr key={g.id} className="ced">
              <td><span className="tag wg">{g.code}</span></td>
              <td><input aria-label="Name" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} autoFocus /></td>
              <td className="num r">{g.task_count}</td>
              <td className="cact"><button type="button" className="btn sm pri" onClick={() => update.mutate({ id: g.id, body: { name: edit.name } }, { onSuccess: () => setEdit(null) })}>Save</button><button type="button" className="btn sm ghost" onClick={() => setEdit(null)}>Cancel</button></td>
            </tr>
          ) : (
            <tr key={g.id}>
              <td><span className="tag wg">{g.code}</span></td><td>{g.name}</td><td className="num r">{g.task_count || '–'}</td>
              <td className="cact"><button type="button" className="btn sm ghost" onClick={() => setEdit({ id: g.id, name: g.name })}>Edit</button>
                <ConfirmButton label="Delete" onConfirm={() => remove.mutate(g.id)} disabled={(g.task_count ?? 0) > 0} title="This group has tasks. It cannot be deleted." /></td>
            </tr>
          ))}
        </tbody>
        <tfoot><tr>
          <td><input aria-label="New code" placeholder="Code" maxLength={5} value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} /></td>
          <td><input aria-label="New name" placeholder="Name of the new work group" value={name} onChange={(e) => setName(e.target.value)} /></td>
          <td className="t2">2–5 letters</td>
          <td className="cact"><button type="button" className="btn sm pri" onClick={() => create.mutate({ code, name }, { onSuccess: () => { setCode(''); setName(''); } })}>+ Add</button></td>
        </tr></tfoot>
      </table></div>
    </>
  );
}

function Directions({ q }: { q: string }) {
  const refs = useRefs();
  const { create, update, remove } = useResource('directions', INVALIDATE);
  const [filter, setFilter] = useState<number | ''>('');
  const [edit, setEdit] = useState<{ id: number; title: string; meaning: string } | null>(null);
  const [wg, setWg] = useState<number | ''>(refs.groups[0]?.id ?? '');
  const [title, setTitle] = useState('');
  const [meaning, setMeaning] = useState('');
  const rows = refs.directions.filter((d) => (!filter || d.work_group === filter) && `${d.code} ${d.title} ${d.meaning}`.toLowerCase().includes(q));
  return (
    <>
      <div className="filters">
        <select aria-label="Filter by work group" value={filter} onChange={(e) => setFilter(e.target.value ? Number(e.target.value) : '')}>
          <option value="">All work groups</option>
          {refs.groups.map((g) => <option key={g.id} value={g.id}>{g.code} – {g.name}</option>)}
        </select>
      </div>
      <ErrorText error={create.error || update.error || remove.error} />
      <div className="tw"><table className="ctab">
        <thead><tr><th>ID</th><th>Group</th><th>Direction and what it means</th><th className="r">Tasks</th><th /></tr></thead>
        <tbody>
          {rows.map((d) => edit?.id === d.id ? (
            <tr key={d.id} className="ced">
              <td className="id">{d.code}</td><td><span className="tag wg">{d.work_group_code}</span></td>
              <td><div className="col-inputs"><input aria-label="Title" value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} /><textarea aria-label="Meaning" value={edit.meaning} onChange={(e) => setEdit({ ...edit, meaning: e.target.value })} /></div></td>
              <td className="num r">{d.task_count}</td>
              <td className="cact"><button type="button" className="btn sm pri" onClick={() => update.mutate({ id: d.id, body: { title: edit.title, meaning: edit.meaning } }, { onSuccess: () => setEdit(null) })}>Save</button><button type="button" className="btn sm ghost" onClick={() => setEdit(null)}>Cancel</button></td>
            </tr>
          ) : (
            <tr key={d.id}>
              <td className="id">{d.code}</td><td><span className="tag wg">{d.work_group_code}</span></td>
              <td><div className="t1">{d.title}</div><div className="t2 clamp">{d.meaning}</div></td>
              <td className="num r">{d.task_count || '–'}</td>
              <td className="cact"><button type="button" className="btn sm ghost" onClick={() => setEdit({ id: d.id, title: d.title, meaning: d.meaning })}>Edit</button>
                <ConfirmButton label="Delete" onConfirm={() => remove.mutate(d.id)} disabled={(d.task_count ?? 0) > 0} title="Tasks use this direction. Move them first." /></td>
            </tr>
          ))}
        </tbody>
        <tfoot><tr>
          <td className="t2">Automatic</td>
          <td><select aria-label="Work group" value={wg} onChange={(e) => setWg(Number(e.target.value))}>{refs.groups.map((g) => <option key={g.id} value={g.id}>{g.code}</option>)}</select></td>
          <td><div className="col-inputs"><input aria-label="New title" placeholder="Title of the new direction" value={title} onChange={(e) => setTitle(e.target.value)} /><textarea aria-label="New meaning" placeholder="What it means for the group" value={meaning} onChange={(e) => setMeaning(e.target.value)} /></div></td>
          <td />
          <td className="cact"><button type="button" className="btn sm pri" onClick={() => create.mutate({ work_group: wg, title, meaning }, { onSuccess: () => { setTitle(''); setMeaning(''); } })}>+ Add</button></td>
        </tr></tfoot>
      </table></div>
    </>
  );
}

function Members({ q, members }: { q: string; members: GroupMember[] }) {
  const refs = useRefs();
  const drill = useDrill();
  const { create, update, remove } = useResource('members', INVALIDATE);
  const [filter, setFilter] = useState<number | ''>('');
  const [edit, setEdit] = useState<{ id: number; name: string; work_group: number } | null>(null);
  const [wg, setWg] = useState<number | ''>(refs.groups[0]?.id ?? '');
  const [name, setName] = useState('');
  const rows = members.filter((m) => (!filter || m.work_group === filter) && `${m.name} ${m.work_group_code}`.toLowerCase().includes(q));
  const openActivities = async (m: GroupMember) => {
    const acts = await api<Activity[]>(`/api/activities/`);
    drill({ kind: 'activities', title: m.name, rows: acts.filter((a) => a.owner === m.id).map(toDrillActivity) });
  };
  return (
    <>
      <div className="filters">
        <select aria-label="Filter by work group" value={filter} onChange={(e) => setFilter(e.target.value ? Number(e.target.value) : '')}>
          <option value="">All work groups</option>
          {refs.groups.map((g) => <option key={g.id} value={g.id}>{g.code} – {g.name}</option>)}
        </select>
      </div>
      <ErrorText error={create.error || update.error || remove.error} />
      <div className="tw"><table className="ctab">
        <thead><tr><th>Name</th><th>Work group <Tip text="The member's own work group. Activities of that group's tasks can be assigned to them." /></th><th className="r">Activities</th><th /></tr></thead>
        <tbody>
          {rows.map((m) => edit?.id === m.id ? (
            <tr key={m.id} className="ced">
              <td><input aria-label="Member name" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} autoFocus /></td>
              <td><select aria-label="Work group" value={edit.work_group} onChange={(e) => setEdit({ ...edit, work_group: Number(e.target.value) })}>{refs.groups.map((g) => <option key={g.id} value={g.id}>{g.code} – {g.name}</option>)}</select></td>
              <td className="num r">{m.activity_count || '–'}</td>
              <td className="cact"><button type="button" className="btn sm pri" onClick={() => update.mutate({ id: m.id, body: { name: edit.name, work_group: edit.work_group } }, { onSuccess: () => setEdit(null) })}>Save</button><button type="button" className="btn sm ghost" onClick={() => setEdit(null)}>Cancel</button></td>
            </tr>
          ) : (
            <tr key={m.id}>
              <td className="t1">{m.name}</td>
              <td><span className="tag wg">{m.work_group_code}</span> <span className="t2">{refs.group(m.work_group)?.name}</span></td>
              <td className="num r">{m.activity_count ? <button type="button" className="dn" data-tip="Click to see the activities" onClick={() => void openActivities(m)}>{m.activity_count}</button> : '–'}</td>
              <td className="cact"><button type="button" className="btn sm ghost" onClick={() => setEdit({ id: m.id, name: m.name, work_group: m.work_group })}>Edit</button>
                <ConfirmButton label="Delete" onConfirm={() => remove.mutate(m.id)} disabled={m.activity_count > 0} title="This member owns activities. Give them another owner first." /></td>
            </tr>
          ))}
        </tbody>
        <tfoot><tr>
          <td><input aria-label="New member name" placeholder="Name of the new member" value={name} onChange={(e) => setName(e.target.value)} /></td>
          <td><select aria-label="Work group" value={wg} onChange={(e) => setWg(Number(e.target.value))}>{refs.groups.map((g) => <option key={g.id} value={g.id}>{g.code} – {g.name}</option>)}</select></td>
          <td />
          <td className="cact"><button type="button" className="btn sm pri" onClick={() => create.mutate({ name, work_group: wg }, { onSuccess: () => setName('') })}>+ Add</button></td>
        </tr></tfoot>
      </table></div>
    </>
  );
}

function LookupList({ listKey, q }: { listKey: ListKey; q: string }) {
  const refs = useRefs();
  const { create, update, remove } = useResource('lookups', INVALIDATE);
  const [edit, setEdit] = useState<{ id: number; value: string; definition: string } | null>(null);
  const [value, setValue] = useState('');
  const [definition, setDefinition] = useState('');
  const rows = refs.list(listKey).filter((l) => `${l.value} ${l.definition}`.toLowerCase().includes(q));
  return (
    <>
      <ErrorText error={create.error || update.error || remove.error} />
      <div className="tw"><table className="ctab">
        <thead><tr><th>#</th><th>Value</th><th>Definition <Tip text="Shown as a tooltip next to the value across the app." /></th><th className="r">In use</th><th /></tr></thead>
        <tbody>
          {rows.map((l, i) => edit?.id === l.id ? (
            <tr key={l.id} className="ced">
              <td className="num">{i + 1}</td>
              <td><input aria-label="Value" value={edit.value} onChange={(e) => setEdit({ ...edit, value: e.target.value })} autoFocus /></td>
              <td><textarea aria-label="Definition" value={edit.definition} onChange={(e) => setEdit({ ...edit, definition: e.target.value })} /></td>
              <td className="num r">{l.usage || '–'}</td>
              <td className="cact"><button type="button" className="btn sm pri" onClick={() => update.mutate({ id: l.id, body: { value: edit.value, definition: edit.definition } }, { onSuccess: () => setEdit(null) })}>Save</button><button type="button" className="btn sm ghost" onClick={() => setEdit(null)}>Cancel</button></td>
            </tr>
          ) : (
            <tr key={l.id}>
              <td className="num t2">{i + 1}</td>
              <td><span className="t1">{l.value}</span> {l.is_core && <span className="tag" data-tip="The automatic check relies on this value. You can rename it but not delete it.">core</span>}</td>
              <td className="t2">{l.definition || 'No definition yet'}</td>
              <td className="num r">{l.usage || '–'}</td>
              <td className="cact"><button type="button" className="btn sm ghost" onClick={() => setEdit({ id: l.id, value: l.value, definition: l.definition })}>Edit</button>
                <ConfirmButton label="Delete" onConfirm={() => remove.mutate(l.id)} disabled={l.is_core || l.usage > 0}
                  title={l.is_core ? 'The automatic check relies on this value. Rename it instead.' : 'In use by tasks or links. Change those first.'} /></td>
            </tr>
          ))}
        </tbody>
        <tfoot><tr>
          <td className="t2">+</td>
          <td><input aria-label="New value" placeholder="New value" value={value} onChange={(e) => setValue(e.target.value)} /></td>
          <td><input aria-label="New definition" placeholder="Definition (optional)" value={definition} onChange={(e) => setDefinition(e.target.value)} /></td>
          <td />
          <td className="cact"><button type="button" className="btn sm pri" onClick={() => create.mutate({ list_key: listKey, value, definition, sort_order: refs.list(listKey).length + 1 }, { onSuccess: () => { setValue(''); setDefinition(''); } })}>+ Add</button></td>
        </tr></tfoot>
      </table></div>
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
  const groupName = GROUPS.find(([, keys]) => keys.includes(selected))?.[0];
  const choose = (k: Key) => {
    setSelected(k);
    setQ('');
  };

  return (
    <div className="panel cfgwrap">
      <nav className="cnav" aria-label="Master data lists">
        {GROUPS.map(([g, keys]) => (
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
          {GROUPS.map(([g, keys]) => <optgroup key={g} label={g}>{keys.map((k) => <option key={k} value={k}>{NAMES[k]} ({count(k)})</option>)}</optgroup>)}
        </select>
        <div className="cph">
          <div><div className="eyeb">{groupName}</div><h3>{NAMES[selected]} <span className="cc">{count(selected)}</span></h3><p>{HINTS[selected]}</p></div>
          <input type="search" placeholder="Search" aria-label="Search" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        {selected === 'work_groups' ? <WorkGroups q={q.toLowerCase()} />
          : selected === 'directions' ? <Directions q={q.toLowerCase()} />
          : selected === 'members' ? <Members q={q.toLowerCase()} members={members.data ?? []} />
          : <LookupList listKey={selected} q={q.toLowerCase()} />}
        {count(selected) === 0 && <Empty>No values yet. Add the first one in the last row.</Empty>}
        <p className="hint">Editing a value renames it everywhere, because tasks point to the value itself. Values in use, and core values the check relies on, cannot be deleted.</p>
      </div>
    </div>
  );
}
