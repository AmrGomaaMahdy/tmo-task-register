import { Suspense, useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';

import { useAuth } from '../auth/AuthContext';
import { LanguageSwitch } from '../i18n/LanguageProvider';
import { useGovernance, useSystemSummary, useTmoDesk } from '../api/queries';
import ActionCenter from './ActionCenter';
import ErrorBoundary from './ErrorBoundary';
import { useRefs } from '../lib/useRefs';
import { APP_STAGE, STAGE_TIP } from '../lib/stage';
import { FinalMile, Logo } from './Brand';
import NavIcon from './NavIcon';
import UserMenu from './UserMenu';
import { Tip } from './ui';
import { useScope } from './WorkGroupScope';

/** `sub`: one short line under the page title saying what the page is for. */
export const NAV: { to: string; label: string; sub: string; tip: string; manage?: boolean; admin?: boolean; plan?: boolean; gov?: boolean; audit?: boolean; system?: boolean; tmoDesk?: boolean; report?: boolean; section?: string }[] = [
  { to: '/', label: 'Overview', sub: 'Where the registers of all work groups stand today.', tip: 'Where the registers stand: readiness, links with other groups, coverage of directions and what is coming up.' },
  { to: '/register', label: 'Task Register', sub: 'Every task a work group owns, as a list or a timeline.', tip: 'The tasks each work group owns, with filters and the automatic check.' },
  { to: '/activities', label: 'Task activities', sub: 'The detailed plans (activities) of big tasks.', tip: 'Sheet 4: the activities of every task, with owners, dates, predecessors, timeline and check.' },
  { to: '/check', label: 'Data quality check', sub: 'The automatic check: what to fix before tasks go to the leader and the TMO.', tip: 'Every problem the automatic check finds, before the register goes to the TMO.' },
  { to: '/links', label: 'Links with other groups', sub: 'What we need from other groups, and what we deliver to them.', tip: "Partners: what each task needs from its partner groups. Contributions: what Enable and Support tasks deliver to other groups. Both fill themselves from the register; when both groups record each other's task number, the link is agreed." },
  { to: '/governance', label: 'Leader approvals', sub: "Approve or reject the group's tasks and the links other groups record with it.", tip: "The work group leader's desk: approve the group's tasks the Focal Point submitted, and review what other groups need from it or deliver to it.", gov: true },
  { to: '/tmo-actions', label: 'TMO Action Center', sub: 'Tasks their leaders approved, waiting to be included in the Master Plan or sent back.', tip: 'Every Leader Approved task in one place, the longest waiting first: include it in the Master Plan (one by one or several at once) or send it back with a reason. Also the TMO decisions of the last 30 days.', tmoDesk: true },
  { to: '/master-plan', label: 'Master Plan', sub: 'The consolidated plan of all work groups.', tip: 'The consolidated plan of all work groups, with the TMO decisions on Leader Approved tasks and the Gantt view.', plan: true },
  { to: '/management-board', label: 'Management board', sub: 'Reports for the management board, each saved as PDF in one click, or all together as a board pack.', tip: 'Four reports for the board: the board summary, the Master Plan timeline, a scorecard for each work group, and dependencies and decisions. Each downloads as a PDF in English or Arabic; the board pack puts them all in one PDF with a cover page.', report: true },
  { to: '/reference-data', label: 'Reference data', sub: 'Work groups, directions, group members and the dropdown lists.', tip: 'Work groups, directions, group members and every dropdown list the register uses.', manage: true, section: 'Administration' },
  { to: '/users', label: 'User access', sub: 'Accounts, their email and their roles.', tip: 'Create accounts, set their email, give or remove roles, reset passwords and unlock accounts.', admin: true, section: 'Administration' },
  { to: '/settings', label: 'System settings', sub: 'Email, sign-in code, passwords and automatic sign-out.', tip: 'Outgoing email, the email code at sign-in, password expiry and length, and the automatic sign-out, each with its own switch.', admin: true, section: 'Administration' },
  { to: '/audit', label: 'Audit trail', sub: 'Everything that happened: who, what, when, from where, before and after.', tip: 'Every change, decision, sign-in, failed sign-in, export and restore, with the values before and after. For tracking and troubleshooting.', audit: true, section: 'Administration' },
  { to: '/system-issues', label: 'System errors & alerts', sub: 'Errors and security warnings for the administrators.', tip: 'Server errors with their technical details, errors in users\' browsers, and security warnings such as failed sign-ins and lockouts.', system: true, section: 'Administration' },
  { to: '/backup', label: 'Backup & restore', sub: 'Keep a copy of all data, or bring one back.', tip: 'Download a full backup or an Excel copy of all data, restore from a backup, or go back to a restore point.', admin: true, section: 'Administration' },
];

function readMenuState(): boolean {
  try {
    return localStorage.getItem('task-register.menu') === 'hidden';
  } catch {
    return false;
  }
}

export default function Layout() {
  const { me } = useAuth();
  // A leader sees how many decisions wait for them next to Governance.
  const desk = useGovernance(null, !!me?.permissions.leader);
  const pending = (desk.data?.direct.filter((t) => t.can_decide && t.approval === 'pending').length ?? 0)
    + (desk.data?.links.filter((l) => l.can_review && l.review === 'pending').length ?? 0);
  // Administrators see how many errors are open next to System issues.
  const sys = useSystemSummary(!!me?.permissions.system);
  const issues = sys.data?.open_errors ?? 0;
  const { wg, setWg } = useScope();
  // The TMO sees how many Leader Approved tasks wait for them next to the TMO Action Center.
  const tmoDesk = useTmoDesk(null, !!(me?.permissions.tmo || me?.permissions.admin));
  const tmoWaiting = tmoDesk.data?.waiting.length ?? 0;
  const refs = useRefs();
  const navigate = useNavigate();
  const location = useLocation();
  const [hidden, setHidden] = useState(readMenuState);
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
          {NAV.filter((n) => (!n.manage || me?.permissions.manage_master_data) && (!n.admin || me?.permissions.admin) && (!n.plan || me?.permissions.master_plan) && (!n.gov || me?.permissions.governance) && (!n.audit || me?.permissions.audit) && (!n.system || me?.permissions.system) && (!n.tmoDesk || me?.permissions.tmo || me?.permissions.admin) && (!n.report || me?.permissions.view_all)).map((n, i, list) => [
            n.section && n.section !== list[i - 1]?.section ? <div key={`s-${n.section}`} className="nav-sec">{n.section}</div> : null,
            <NavLink key={n.to} to={n.to} end={n.to === '/'} data-tip={`${n.label}: ${n.tip}`} aria-label={n.label}>
              <span className="k ico"><NavIcon to={n.to} /></span>
              <span className="lbl">{n.label}</span>
              {n.gov && pending > 0 && <span className="c pend" data-tip={`${pending} waiting for a decision`}>{pending}</span>}
              {n.tmoDesk && tmoWaiting > 0 && <span className="c pend" data-tip={`${tmoWaiting} waiting for the TMO`}>{tmoWaiting}</span>}
              {n.system && issues > 0 && <span className="c pend bad" data-tip={`${issues} open errors`}>{issues}</span>}
            </NavLink>,
          ])}
        </nav>
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
              <h1>
                {current?.label ?? 'Task'}
                {APP_STAGE && <span className="dev-tag" data-tip={STAGE_TIP}><i aria-hidden="true" />{APP_STAGE}</span>}
              </h1>
              {current && <p className="ttl-sub">{current.sub}</p>}
            </div>
          </div>
          <div className="top-actions">
            {/* Everyone with a part in the flow: Focal Points and leaders (create_tasks), delegates, the TMO. */}
            {(me?.permissions.create_tasks || me?.permissions.tmo || me?.permissions.leader) && <ActionCenter />}
            <a className="guide-link" href="/guide" target="_blank" rel="noopener" aria-label="User guide" data-tip="User guide: how to use the application (opens in a new tab)">
              <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M9.6 9.5a2.5 2.5 0 114 2c-.9.6-1.6 1.1-1.6 2.3M12 17h.01" /></svg>
              <span>User guide</span>
            </a>
            <LanguageSwitch />
            {me?.permissions.create_tasks && (
              <button type="button" className="btn pri" onClick={() => navigate('/tasks/new')}>
                + New task
              </button>
            )}
            <UserMenu />
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
