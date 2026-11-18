import { Suspense, useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';

import { useAuth } from '../auth/AuthContext';
import { LanguageSwitch } from '../i18n/LanguageProvider';
import { useGovernance, useSystemSummary } from '../api/queries';
import ErrorBoundary from './ErrorBoundary';
import { useRefs } from '../lib/useRefs';
import { currentTheme, saveTheme, THEMES, type Theme } from '../lib/theme';
import { FinalMile, Logo } from './Brand';
import NavIcon from './NavIcon';
import PasswordDialog from './PasswordDialog';
import { Tip } from './ui';
import { useScope } from './WorkGroupScope';

/** `sub`: one short line under the page title saying what the page is for. */
export const NAV: { to: string; label: string; sub: string; tip: string; manage?: boolean; admin?: boolean; plan?: boolean; gov?: boolean; audit?: boolean; system?: boolean }[] = [
  { to: '/', label: 'Overview', sub: 'Where the registers stand today.', tip: 'Where the registers stand: readiness, links with other groups, coverage of directions and what is coming up.' },
  { to: '/register', label: 'Task Register', sub: 'Every task a work group owns, as a table or a timeline.', tip: 'The tasks each work group owns, with filters and the automatic check.' },
  { to: '/activities', label: 'Activities', sub: 'The detailed plans of big tasks.', tip: 'Sheet 4: the activities of every task, with owners, dates, predecessors, timeline and check.' },
  { to: '/links', label: 'Links with other groups', sub: 'What we need from other groups, and what we deliver to them.', tip: "Partners: what each task needs from its partner groups. Contributions: what Enable and Support tasks deliver to other groups. Both fill themselves from the register; when both groups record each other's task number, the link is agreed." },
  { to: '/check', label: 'Check', sub: 'Problems to fix before the TMO takes tasks into the Master Plan.', tip: 'Every problem the automatic check finds, before the register goes to the TMO.' },
  { to: '/governance', label: 'Governance', sub: 'Decisions of the work group leaders.', tip: "The work group leader's desk: approve the group's Direct tasks, and review what other groups need from it or deliver to it.", gov: true },
  { to: '/master-plan', label: 'Master Plan', sub: 'The consolidated plan of all work groups.', tip: 'The consolidated plan of all work groups, with the TMO inbox and Gantt view.', plan: true },
  { to: '/configuration', label: 'Configuration', sub: 'Work groups, directions, members and lists.', tip: 'Work groups, directions, group members and every dropdown list.', manage: true },
  { to: '/audit', label: 'Audit trail', sub: 'Everything that happened: who, what, when, from where, before and after.', tip: 'Every change, decision, sign-in, failed sign-in, export and restore, with the values before and after. For tracking and troubleshooting.', audit: true },
  { to: '/system-issues', label: 'System issues', sub: 'Errors and security warnings for the administrators.', tip: 'Server errors with their technical details, errors in users\' browsers, and security warnings such as failed sign-ins and lockouts.', system: true },
  { to: '/backup', label: 'Backup & restore', sub: 'Keep a copy of all data, or bring one back.', tip: 'Download a full backup or an Excel copy of all data, restore from a backup, or go back to a restore point.', admin: true },
];

function readMenuState(): boolean {
  try {
    return localStorage.getItem('task-register.menu') === 'hidden';
  } catch {
    return false;
  }
}

export default function Layout() {
  const { me, logout } = useAuth();
  // A leader sees how many decisions wait for them next to Governance.
  const desk = useGovernance(null, !!me?.permissions.leader);
  const pending = (desk.data?.direct.filter((t) => t.can_decide && t.approval === 'pending').length ?? 0)
    + (desk.data?.links.filter((l) => l.can_review && l.review === 'pending').length ?? 0);
  // Administrators see how many errors are open next to System issues.
  const sys = useSystemSummary(!!me?.permissions.system);
  const issues = sys.data?.open_errors ?? 0;
  const { wg, setWg } = useScope();
  const refs = useRefs();
  const navigate = useNavigate();
  const location = useLocation();
  const [hidden, setHidden] = useState(readMenuState);
  const [pwOpen, setPwOpen] = useState(false);
  // Teams choose only among their own work groups; a stored choice of another group is dropped.
  const viewAll = !!me?.permissions.view_all;
  const scopeGroups = viewAll ? refs.groups : refs.groups.filter((g) => (me?.view_groups ?? me?.work_groups ?? []).some((m) => m.id === g.id));
  useEffect(() => {
    if (!viewAll && wg !== null && refs.ready && !scopeGroups.some((g) => g.id === wg)) setWg(null);
  }, [viewAll, wg, refs.ready, scopeGroups, setWg]);
  const current = NAV.find((n) => (n.to === '/' ? location.pathname === '/' : location.pathname.startsWith(n.to)));

  const toggleMenu = () => {
    setHidden((h) => {
      try {
        localStorage.setItem('task-register.menu', h ? 'shown' : 'hidden');
      } catch {
        /* ignore */
      }
      return !h;
    });
  };
  const [theme, setTheme] = useState<Theme>(currentTheme);
  const pickTheme = (t: Theme) => {
    saveTheme(t);
    setTheme(t);
  };

  return (
    <div className={`app ${hidden ? 'menu-off' : ''}`}>
      <a className="skip" href="#main">Skip to content</a>
      <aside className="rail">
        <div className="brand">
          <div className="brand-top">
            <Logo />
            <span className="name">
              <span className="tmo">TMO</span>
              <span className="full">Task Register</span>
            </span>
          </div>
          <FinalMile />
        </div>
        <div className="wgsel">
          <label htmlFor="wgSel">
            Work group <Tip text="Show one work group's register, or all work groups for the program view." />
          </label>
          <select id="wgSel" value={wg ?? ''} onChange={(e) => setWg(e.target.value ? Number(e.target.value) : null)}>
            <option value="">{viewAll ? 'All work groups' : scopeGroups.length > 1 ? 'All my work groups' : 'My work group'}</option>
            {scopeGroups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.code} – {g.name}{g.task_count !== null ? ` (${g.task_count})` : ''}
              </option>
            ))}
          </select>
        </div>
        <button type="button" className="wgmini" onClick={toggleMenu} data-tip="Selected work group. Click to show the menu.">
          {refs.group(wg)?.code ?? 'ALL'}
        </button>
        <nav className="nav" aria-label="Main">
          {NAV.filter((n) => (!n.manage || me?.permissions.manage_master_data) && (!n.admin || me?.permissions.admin) && (!n.plan || me?.permissions.master_plan) && (!n.gov || me?.permissions.governance) && (!n.audit || me?.permissions.audit) && (!n.system || me?.permissions.system)).map((n) => (
            <NavLink key={n.to} to={n.to} end={n.to === '/'} data-tip={`${n.label}: ${n.tip}`} aria-label={n.label}>
              <span className="k ico"><NavIcon to={n.to} /></span>
              <span className="lbl">{n.label}</span>
              {n.gov && pending > 0 && <span className="c pend" data-tip={`${pending} waiting for a decision`}>{pending}</span>}
              {n.system && issues > 0 && <span className="c pend bad" data-tip={`${issues} open errors`}>{issues}</span>}
            </NavLink>
          ))}
        </nav>
        <div className="foot">
          <div className="who">
            <strong>{me?.full_name}</strong>
            <span>
              {/* One text per role, so each is translated on its own. */}
              {me?.roles.map((r, i) => <span key={r}>{i ? ', ' : ''}{r}</span>)}
            </span>
          </div>
          <div className="themes">
            <span className="tl">Theme</span>
            <div className="sw" role="group" aria-label="Theme">
              {THEMES.map((t) => (
                <button key={t.id} type="button" className={theme === t.id ? 'on' : ''} aria-pressed={theme === t.id} aria-label={t.label}
                  data-tip={t.tip} style={{ ['--t' as string]: t.swatch, ['--tk' as string]: t.tick }} onClick={() => pickTheme(t.id)} />
              ))}
            </div>
          </div>
          <button type="button" onClick={() => setPwOpen(true)}>Change password</button>
          {pwOpen && <PasswordDialog onClose={() => setPwOpen(false)} />}
          <button
            type="button"
            onClick={async () => {
              await logout();
              navigate('/login');
            }}
          >
            Sign out
          </button>
        </div>
      </aside>
      <main className="main" id="main" tabIndex={-1}>
        <div className="top">
          <div className="ttl">
            <button
              type="button"
              className="btn menu-t"
              onClick={toggleMenu}
              aria-label={hidden ? 'Show menu' : 'Hide menu'}
              aria-expanded={!hidden}
              data-tip={hidden ? 'Show the side menu' : 'Hide the side menu to give the page more room'}
            >
              ☰
            </button>
            <div className="ttl-text">
              <h1>{current?.label ?? 'Task'}</h1>
              {current && <p className="ttl-sub">{current.sub}</p>}
            </div>
          </div>
          <div className="top-actions">
            <LanguageSwitch />
            {me?.permissions.create_tasks && (
              <button type="button" className="btn pri" onClick={() => navigate('/tasks/new')}>
                + New task
              </button>
            )}
          </div>
        </div>
        {/* Each page fades in, so moving between pages feels continuous rather than abrupt */}
        <div className="page-in" key={location.pathname}>
          <ErrorBoundary key={location.pathname} where={current?.label ?? location.pathname}>
          <Suspense fallback={<div className="route-loading" aria-busy="true"><div className="skel" style={{ height: 120 }} /><div className="skel" style={{ height: 320 }} /></div>}>
            <Outlet />
          </Suspense>
          </ErrorBoundary>
        </div>
      </main>
    </div>
  );
}
