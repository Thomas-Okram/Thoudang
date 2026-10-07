import { Navigate, Route, Routes } from 'react-router';
import { Layout } from './components/Layout';
import { DashboardPage } from './pages/DashboardPage';
import { IntakePage } from './pages/IntakePage';
import { QueuePage } from './pages/QueuePage';
import { CasePage } from './pages/CasePage';
import { NoticePage } from './pages/NoticePage';
import { NoticesPage } from './pages/NoticesPage';
import { TrustReportPage } from './pages/TrustReportPage';
import { TemplatesPage } from './pages/TemplatesPage';
import { MobileUploadPage } from './pages/MobileUploadPage';
import { StatusPage } from './pages/StatusPage';
import { LoginPage } from './pages/LoginPage';
import { RequireOfficer } from './components/RequireOfficer';

export function App() {
  return (
    <Routes>
      <Route path="m/upload/:sessionId" element={<MobileUploadPage />} />
      <Route path="s/:ref" element={<StatusPage />} />
      <Route path="login" element={<LoginPage />} />
      <Route
        element={
          <RequireOfficer>
            <Layout />
          </RequireOfficer>
        }
      >
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="dashboard" element={<DashboardPage />} />
        <Route path="intake" element={<IntakePage />} />
        <Route path="queue" element={<QueuePage />} />
        <Route path="cases" element={<CasePage />} />
        <Route path="cases/:caseId" element={<CasePage />} />
        <Route path="cases/:caseId/notice" element={<NoticePage />} />
        <Route path="case" element={<Navigate to="/cases" replace />} />
        <Route path="case/:caseId" element={<CasePage />} />
        <Route path="notices" element={<NoticesPage />} />
        <Route path="trust" element={<TrustReportPage />} />
        <Route path="admin/templates" element={<TemplatesPage />} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Route>
    </Routes>
  );
}
