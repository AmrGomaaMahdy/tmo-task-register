import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';

import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { useConfirm } from '../components/Confirm';
import { toast } from '../components/Toasts';
import { Empty, ErrorText, Modal, Pager } from '../components/ui';
import { fmtStamp } from '../lib/format';

type GroupType = 'leader' | 'coordinator' | 'member';
interface User {
  id: number;
  username: string;
  first_name: string;
  last_name: string;
  full_name: string;
  email: string;
  is_active: boolean;
  last_login: string | null;
  date_joined: string;
  fixed_roles: string[];
  group_roles: { work_group: number; code: string; type: GroupType }[];
  password_changed_at: string | null;
  must_change_password: boolean;
  locked: boolean;
  sso_only: boolean;
}
interface RoleInfo {
  fixed: { name: string; hint: string }[];
  types: { value: GroupType; label: string }[];
  groups: { id: number; code: string; name: string; leader_id: number | null }[];
}

const TYPE_LABEL: Record<GroupType, string> = { leader: 'Leader', coordinator: 'Focal Point', member: 'Member' };
const FILTERS = [
  ['all', 'All'], ['active', 'Can sign in'], ['inactive', 'Deactivated'], ['no-email', 'No email'], ['locked', 'Locked'], ['must-change', 'Must change password'],
] as const;
type Filter = (typeof FILTERS)[number][0];

const matches = (u: User, f: Filter) =>
  f === 'all' ? true : f === 'active' ? u.is_active : f === 'inactive' ? !u.is_active : f === 'no-email' ? u.is_active && !u.email
    : f === 'locked' ? u.locked : u.must_change_password;

/**
 * User access (administrators): every account, its contact details, whether it can sign in, and its roles:
 * the programme roles and one role per work group. Here instead of the Django admin site. A work group role
 * also lists the person in the group's members (Reference data › Group members), and the other way round.
 */
export default function UsersPage() {
  const { me } = useAuth();
  const [params, setParams] = useSearchParams();
  const filter = (FILTERS.some(([k]) => k === params.get('filter')) ? params.get('filter') : 'all') as Filter;
  const [q, setQ] = useState('');
  const [role, setRole] = useState('');
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(25);
  const [editing, setEditing] = useState<User | 'new' | null>(null);
  const users = useQuery({ queryKey: ['users'], queryFn: () => api<User[]>('/api/auth/users/'), enabled: !!me?.permissions.admin });
  const roles = useQuery({ queryKey: ['user-roles'], queryFn: () => api<RoleInfo>('/api/auth/users/roles/'), enabled: !!me?.permissions.admin });

  const rows = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (users.data ?? []).filter((u) => matches(u, filter)
      && (!t || `${u.username} ${u.full_name} ${u.email}`.toLowerCase().includes(t))
      && (!role || (role === 'none' ? !u.fixed_roles.length && !u.group_roles.length
        : role.startsWith('type:') ? u.group_roles.some((g) => g.type === role.slice(5))
        : role.startsWith('group:') ? u.group_roles.some((g) => String(g.work_group) === role.slice(6))
        : u.fixed_roles.includes(role))));
  }, [users.data, q, filter, role]);
  const count = (f: Filter) => (users.data ?? []).filter((u) => matches(u, f)).length;
  if (!me?.permissions.admin) return <Navigate to="/" replace />;
  const shown = rows.slice((page - 1) * size, page * size);

  return (
    <div className="panel users">
      <div className="users-bar">
        <input type="search" className="csearch" placeholder="Search name, user name or email" aria-label="Search users" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
        <select aria-label="Role" value={role} onChange={(e) => { setRole(e.target.value); setPage(1); }}>
          <option value="">All roles</option>
          {roles.data?.fixed.map((r) => <option key={r.name} value={r.name}>{r.name}</option>)}
          <option value="type:leader">Team Leaders</option>
          <option value="type:coordinator">Focal Points</option>
          <option value="type:member">Team Members</option>
          <optgroup label="Work group">
            {roles.data?.groups.map((g) => <option key={g.id} value={`group:${g.id}`}>{`${g.code} – ${g.name}`}</option>)}
          </optgroup>
          <option value="none">No role</option>
        </select>
        <span className="spacer" />
        <button type="button" className="btn pri" onClick={() => setEditing('new')}>+ New user</button>
      </div>
      <div className="seg users-filters" role="group" aria-label="Show">
        {FILTERS.map(([k, label]) => (
          <button key={k} type="button" className={filter === k ? 'on' : ''} aria-pressed={filter === k}
            onClick={() => { setParams(k === 'all' ? {} : { filter: k }, { replace: true }); setPage(1); }}>
            {label} <span className="n">{count(k)}</span>
          </button>
        ))}
      </div>
      <ErrorText error={users.error} />
      {!users.data ? <div className="skel" style={{ height: 300 }} /> : rows.length === 0 ? <Empty>No account matches.</Empty> : (
        <div className="tw">
          <table className="users-table">
            <thead><tr><th>Person</th><th>Email</th><th>Roles</th><th>Status</th><th>Last sign-in</th><th aria-label="Actions" /></tr></thead>
            <tbody>
              {shown.map((u) => (
                <tr key={u.id} className={u.is_active ? '' : 'off'}>
                  <td><b>{u.full_name || u.username}</b><div className="t2 mono" dir="ltr">{u.username}</div></td>
                  <td dir="ltr">{u.email || <span className="warn-text">No email</span>}</td>
                  <td>
                    <div className="role-chips">
                      {u.fixed_roles.map((r) => <span key={r} className="rchip fixed">{r}</span>)}
                      {u.group_roles.map((g) => <span key={g.work_group} className={`rchip t-${g.type}`}><b>{g.code}</b> {TYPE_LABEL[g.type]}</span>)}
                      {!u.fixed_roles.length && !u.group_roles.length && <span className="t2">No role</span>}
                    </div>
                  </td>
                  <td>
                    <div className="role-chips">
                      <span className={`pill ${u.is_active ? 'ok' : ''}`}>{u.is_active ? 'Can sign in' : 'Deactivated'}</span>
                      {u.locked && <span className="pill bad">Locked</span>}
                      {u.must_change_password && <span className="pill warn">Must change password</span>}
                      {u.sso_only && <span className="pill">Microsoft sign-in</span>}
                    </div>
                  </td>
                  <td className="t2">{u.last_login ? fmtStamp(u.last_login) : 'Never'}</td>
                  <td><button type="button" className="btn sm" onClick={() => setEditing(u)}>Edit</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pager count={rows.length} page={page} size={size} onPage={setPage} onSize={(n) => { setSize(n); setPage(1); }} />
        </div>
      )}
      {editing && roles.data && <UserDialog user={editing === 'new' ? null : editing} roles={roles.data} meId={me.id} onClose={() => setEditing(null)} />}
    </div>
  );
}

function UserDialog({ user, roles, meId, onClose }: { user: User | null; roles: RoleInfo; meId: number; onClose: () => void }) {
  const client = useQueryClient();
  const confirm = useConfirm();
  const [tab, setTab] = useState<'details' | 'roles' | 'security'>('details');
  const [form, setForm] = useState({
    username: user?.username ?? '', first_name: user?.first_name ?? '', last_name: user?.last_name ?? '', email: user?.email ?? '',
    is_active: user?.is_active ?? true, password: '',
  });
  const [fixed, setFixed] = useState<string[]>(user?.fixed_roles ?? []);
  const [groups, setGroups] = useState<Record<number, GroupType | ''>>(
    Object.fromEntries((user?.group_roles ?? []).map((g) => [g.work_group, g.type])),
  );
  const [temp, setTemp] = useState<string | null>(null);
  const [gq, setGq] = useState('');
  const refresh = () => void client.invalidateQueries({ queryKey: ['users'] });
  const save = useMutation({
    mutationFn: () => {
      const before = Object.fromEntries((user?.group_roles ?? []).map((g) => [g.work_group, g.type]));
      const ids = new Set([...Object.keys(before), ...Object.keys(groups)].map(Number));
      const group_roles = [...ids].filter((id) => (before[id] ?? '') !== (groups[id] ?? '')).map((id) => ({ work_group: id, type: groups[id] || null }));
      const body = { ...form, fixed_roles: fixed, group_roles, ...(user ? { password: undefined } : {}) };
      return user ? api<User & { temporary_password?: string }>(`/api/auth/users/${user.id}/`, { method: 'PATCH', body })
        : api<User & { temporary_password?: string }>('/api/auth/users/', { method: 'POST', body });
    },
    onSuccess: (d) => {
      refresh();
      void client.invalidateQueries({ queryKey: ['members'] });
      if (!user && d.temporary_password) { setTemp(d.temporary_password); return; }
      toast(`User ${d.full_name || d.username} saved.`);
      onClose();
    },
  });
  const reset = useMutation({
    mutationFn: () => api<{ temporary_password: string }>(`/api/auth/users/${user!.id}/reset-password/`, { method: 'POST' }),
    onSuccess: (d) => { setTemp(d.temporary_password); refresh(); },
  });
  const unlock = useMutation({
    mutationFn: () => api<User>(`/api/auth/users/${user!.id}/unlock/`, { method: 'POST' }),
    onSuccess: () => { toast('Account unlocked.'); refresh(); },
  });
  const self = user?.id === meId;
  const leaderOf = (gid: number) => roles.groups.find((g) => g.id === gid)?.leader_id;
  const shownGroups = roles.groups.filter((g) => !gq || `${g.code} ${g.name}`.toLowerCase().includes(gq.toLowerCase()));
  const roleCount = fixed.length + Object.values(groups).filter(Boolean).length;

  if (temp) {
    return (
      <Modal title={user ? 'Temporary password' : 'User created'} onClose={onClose} footer={<button type="button" className="btn pri" onClick={onClose}>Done</button>}>
        <div className="decide">
          <p>{user ? `A new temporary password for ${user.username}.` : `The account ${form.username} is ready. Its temporary password:`}</p>
          <div className="temp-pw">
            <code dir="ltr">{temp}</code>
            <button type="button" className="btn sm" onClick={() => { void navigator.clipboard?.writeText(temp); toast('Copied.'); }}>Copy</button>
          </div>
          <p className="t2">It is shown only now. Give it to the person in a safe way: they must choose their own password when they sign in.</p>
        </div>
      </Modal>
    );
  }

  return (
    <Modal wide title={user ? `Edit user: ${user.full_name || user.username}` : 'New user'} onClose={onClose}
      footer={<>
        <button type="button" className="btn" onClick={onClose}>Cancel</button>
        <button type="button" className="btn pri" disabled={save.isPending || !form.username.trim()} onClick={() => save.mutate()}>{save.isPending ? 'Saving…' : user ? 'Save changes' : 'Create user'}</button>
      </>}>
      <div className="view-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'details'} className={tab === 'details' ? 'on' : ''} onClick={() => setTab('details')}>Details</button>
        <button type="button" role="tab" aria-selected={tab === 'roles'} className={tab === 'roles' ? 'on' : ''} onClick={() => setTab('roles')}>Roles <b className="count">{roleCount}</b></button>
        {user && <button type="button" role="tab" aria-selected={tab === 'security'} className={tab === 'security' ? 'on' : ''} onClick={() => setTab('security')}>Password and sign-in</button>}
      </div>
      <ErrorText error={save.error || reset.error || unlock.error} />
      {tab === 'details' && (
        <div className="set-form user-form">
          <label><span>User name</span><input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value.trim() })} dir="ltr" autoFocus={!user} placeholder="first.last" /></label>
          <label><span>Email</span><input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} dir="ltr" placeholder="first.last@al-ayuni.com" /></label>
          <label><span>First name</span><input value={form.first_name} onChange={(e) => setForm({ ...form, first_name: e.target.value })} /></label>
          <label><span>Last name</span><input value={form.last_name} onChange={(e) => setForm({ ...form, last_name: e.target.value })} /></label>
          {!user && (
            <label className="w2"><span>Password (optional)</span>
              <input type="text" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} dir="ltr" autoComplete="off" placeholder="Leave empty to create a temporary one" />
            </label>
          )}
          <label className="tgl w2">
            <input type="checkbox" role="switch" checked={form.is_active} disabled={self} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} />
            <span aria-hidden="true" />
            <b>{form.is_active ? 'Can sign in' : 'Deactivated: cannot sign in'}</b>
          </label>
          <p className="t2 w2">The email receives the sign-in codes and notices. It is also shown in the person&apos;s work group member rows.</p>
        </div>
      )}
      {tab === 'roles' && (
        <div className="roles-edit">
          <h4>Programme roles</h4>
          <div className="fixed-roles">
            {roles.fixed.map((r) => (
              <label key={r.name} className={`fixed-role${fixed.includes(r.name) ? ' on' : ''}`}>
                <input type="checkbox" checked={fixed.includes(r.name)} disabled={self && r.name === 'Admin'}
                  onChange={(e) => setFixed(e.target.checked ? [...fixed, r.name] : fixed.filter((x) => x !== r.name))} />
                <span><b>{r.name}</b><span className="t2">{r.hint}</span></span>
              </label>
            ))}
          </div>
          <div className="roles-hd">
            <h4>Work group roles</h4>
            <input type="search" placeholder="Find a work group" aria-label="Find a work group" value={gq} onChange={(e) => setGq(e.target.value)} />
          </div>
          <p className="t2">Leader: approves the group&apos;s tasks (one per group). Focal Point: prepares and submits them. Member: reads the register.</p>
          <div className="group-roles">
            {shownGroups.map((g) => {
              const v = groups[g.id] ?? '';
              const replaces = v === 'leader' && g.leader_id && g.leader_id !== user?.id;
              return (
                <div key={g.id} className={`group-role${v ? ' on' : ''}`}>
                  <span className="gr-name"><b>{g.code}</b> <span className="t2">{g.name}</span></span>
                  <div className="seg sm" role="group" aria-label={`Role in ${g.code}`}>
                    {(['', 'member', 'coordinator', 'leader'] as const).map((k) => (
                      <button key={k || 'none'} type="button" className={v === k ? 'on' : ''} aria-pressed={v === k}
                        onClick={() => setGroups({ ...groups, [g.id]: k })}>{k ? TYPE_LABEL[k] : 'None'}</button>
                    ))}
                  </div>
                  {replaces && <span className="gr-note warn-text">Replaces the current leader of {g.code}.</span>}
                  {v === 'leader' && !replaces && leaderOf(g.id) === user?.id && <span className="gr-note t2">Current leader.</span>}
                </div>
              );
            })}
          </div>
        </div>
      )}
      {tab === 'security' && user && (
        <div className="user-sec">
          <div className="user-sec-row">
            <div><b>Password</b><span className="t2">{user.sso_only ? 'Signs in with Microsoft: no password here.' : user.password_changed_at ? `Last set ${fmtStamp(user.password_changed_at)}.` : 'Never changed here.'}{user.must_change_password ? ' Must be changed at the next sign-in.' : ''}</span></div>
            <button type="button" className="btn" disabled={reset.isPending} onClick={async () => {
              if (await confirm({ title: 'Reset the password?', message: <p>{`${user.username} gets a temporary password, shown to you once. Their current password stops working, and they must choose a new one when they sign in.`}</p>, confirmLabel: 'Reset password' })) reset.mutate();
            }}>Reset password</button>
          </div>
          <div className="user-sec-row">
            <div><b>Failed sign-ins</b><span className="t2">{user.locked ? 'Locked after too many failed sign-ins.' : 'Not locked.'} Unlocking clears the failed attempts from every place.</span></div>
            <button type="button" className="btn" disabled={unlock.isPending} onClick={() => unlock.mutate()}>Unlock</button>
          </div>
          <div className="user-sec-row">
            <div><b>Account</b><span className="t2">{`Created ${fmtStamp(user.date_joined)}. Last sign-in: ${user.last_login ? fmtStamp(user.last_login) : 'never'}.`}</span></div>
          </div>
        </div>
      )}
    </Modal>
  );
}
