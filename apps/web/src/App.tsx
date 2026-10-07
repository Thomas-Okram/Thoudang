import { Navigate, Route, Routes } from 'react-router';
import { Layout } from './components/Layout';
import { IntakePage } from './pages/IntakePage';
import { QueuePage } from './pages/QueuePage';
import { CasePage } from './pages/CasePage';
import { NoticesPage } from './pages/NoticesPage';
import { TrustReportPage } from './pages/TrustReportPage';

export function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Navigate to="/queue" replace />} />
        <Route path="intake" element={<IntakePage />} />
        <Route path="queue" element={<QueuePage />} />
        <Route path="case" element={<CasePage />} />
        <Route path="case/:caseId" element={<CasePage />} />
        <Route path="notices" element={<NoticesPage />} />
        <Route path="trust" element={<TrustReportPage />} />
        <Route path="*" element={<Navigate to="/queue" replace />} />
      </Route>
    </Routes>
  );
}
