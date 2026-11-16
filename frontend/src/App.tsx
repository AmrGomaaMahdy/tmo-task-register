import { Navigate, Route, Routes, useLocation } from 'react-router-dom';

import { useAuth } from './auth/AuthContext';
import Layout from './components/Layout';
import { Loading, TooltipLayer } from './components/ui';
import ActivitiesPage from './pages/ActivitiesPage';
import CheckPage from './pages/CheckPage';
import BackupPage from './pages/BackupPage';
import ConfigurationPage from './pages/ConfigurationPage';
import LinksPage from './pages/LinksPage';
import LoginPage from './pages/LoginPage';
import MasterPlanPage from './pages/MasterPlanPage';
import NotFoundPage from './pages/NotFoundPage';
import OverviewPage from './pages/OverviewPage';
import RegisterPage from './pages/RegisterPage';
import TaskFormPage from './pages/TaskFormPage';
import TaskPage from './pages/TaskPage';

function RequireAuth({ children }: { children: JSX.Element }) {
  const { me, loading } = useAuth();
  const location = useLocation();
  if (loading) return <Loading />;
  if (!me) return <Navigate to="/login" replace state={{ from: location }} />;
  return children;
}

/** The Master Plan is for the TMO, administrators and the committee; teams go back to the overview. */
function MasterPlanRoute() {
  const { me } = useAuth();
  return me?.permissions.master_plan ? <MasterPlanPage /> : <Navigate to="/" replace />;
}

export default function App() {
  return (
    <>
      <TooltipLayer />
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route element={<RequireAuth><Layout /></RequireAuth>}>
          <Route index element={<OverviewPage />} />
          <Route path="register" element={<RegisterPage />} />
          <Route path="tasks/new" element={<TaskFormPage />} />
          <Route path="tasks/:id" element={<TaskPage />} />
          <Route path="tasks/:id/edit" element={<TaskFormPage />} />
          <Route path="activities" element={<ActivitiesPage />} />
          <Route path="links" element={<LinksPage />} />
          <Route path="check" element={<CheckPage />} />
          <Route path="master-plan" element={<MasterPlanRoute />} />
          <Route path="configuration" element={<ConfigurationPage />} />
          <Route path="backup" element={<BackupPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </>
  );
}
