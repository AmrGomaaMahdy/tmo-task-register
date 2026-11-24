import { lazy } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';

import { useAuth } from './auth/AuthContext';
import Layout from './components/Layout';
import { Loading, TooltipLayer } from './components/ui';
import PasswordRequiredPage from './pages/PasswordRequiredPage';
import LoginPage from './pages/LoginPage';
import Toasts from './components/Toasts';

// Each page loads when it is first opened, so the first visit downloads less (faster sign-in on slow links).
const ActivitiesPage = lazy(() => import('./pages/ActivitiesPage'));
const AuditPage = lazy(() => import('./pages/AuditPage'));
const SystemIssuesPage = lazy(() => import('./pages/SystemIssuesPage'));
const BackupPage = lazy(() => import('./pages/BackupPage'));
const CheckPage = lazy(() => import('./pages/CheckPage'));
const ConfigurationPage = lazy(() => import('./pages/ConfigurationPage'));
const GovernancePage = lazy(() => import('./pages/GovernancePage'));
const LinksPage = lazy(() => import('./pages/LinksPage'));
const MasterPlanPage = lazy(() => import('./pages/MasterPlanPage'));
const NotFoundPage = lazy(() => import('./pages/NotFoundPage'));
const OverviewPage = lazy(() => import('./pages/OverviewPage'));
const RegisterPage = lazy(() => import('./pages/RegisterPage'));
const TaskFormPage = lazy(() => import('./pages/TaskFormPage'));
const TaskPage = lazy(() => import('./pages/TaskPage'));
const GuidePage = lazy(() => import('./pages/GuidePage'));
const UsersPage = lazy(() => import('./pages/UsersPage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));
const TmoActionsPage = lazy(() => import('./pages/TmoActionsPage'));
const ManagementBoardPage = lazy(() => import('./pages/ManagementBoardPage'));

function RequireAuth({ children }: { children: JSX.Element }) {
  const { me, loading } = useAuth();
  const location = useLocation();
  if (loading) return <Loading />;
  if (!me) return <Navigate to="/login" replace state={{ from: location }} />;
  // The password must be changed first (it expired, or an administrator set it).
  if (me.password?.required) return <PasswordRequiredPage />;
  return children;
}

/** The Master Plan is for the TMO, administrators and the committee; teams go back to the overview. */
function GovernanceRoute() {
  const { me } = useAuth();
  return me?.permissions.governance ? <GovernancePage /> : <Navigate to="/" replace />;
}

function AuditRoute() {
  const { me } = useAuth();
  return me?.permissions.audit ? <AuditPage /> : <Navigate to="/" replace />;
}

function SystemIssuesRoute() {
  const { me } = useAuth();
  return me?.permissions.system ? <SystemIssuesPage /> : <Navigate to="/" replace />;
}

function MasterPlanRoute() {
  const { me } = useAuth();
  return me?.permissions.master_plan ? <MasterPlanPage /> : <Navigate to="/" replace />;
}

export default function App() {
  return (
    <>
      <TooltipLayer />
      <Toasts />
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        {/* The user guide is open to everyone, signed in or not (the sign-in page links to it). */}
        <Route path="/guide" element={<GuidePage />} />
        <Route element={<RequireAuth><Layout /></RequireAuth>}>
          <Route index element={<OverviewPage />} />
          <Route path="register" element={<RegisterPage />} />
          <Route path="tasks/new" element={<TaskFormPage />} />
          <Route path="tasks/:id" element={<TaskPage />} />
          <Route path="tasks/:id/edit" element={<TaskFormPage />} />
          <Route path="activities" element={<ActivitiesPage />} />
          <Route path="links" element={<LinksPage />} />
          <Route path="check" element={<CheckPage />} />
          <Route path="data-quality" element={<CheckPage />} />
          <Route path="governance" element={<GovernanceRoute />} />
          <Route path="tmo-actions" element={<TmoActionsPage />} />
          <Route path="management-board" element={<ManagementBoardPage />} />
          {/* The page's name in 1.27. */}
          <Route path="management-report" element={<Navigate to="/management-board" replace />} />
          <Route path="master-plan" element={<MasterPlanRoute />} />
          <Route path="reference-data" element={<ConfigurationPage />} />
          {/* The page's name until 1.24. */}
          <Route path="configuration" element={<Navigate to="/reference-data" replace />} />
          <Route path="users" element={<UsersPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="backup" element={<BackupPage />} />
          <Route path="audit" element={<AuditRoute />} />
          <Route path="system-issues" element={<SystemIssuesRoute />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </>
  );
}
