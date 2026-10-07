import { Navigate, Route, Routes } from 'react-router';
import { Layout } from './components/Layout';
import { IntakePage } from './pages/IntakePage';
import { QueuePage } from './pages/QueuePage';
import { CasePage } from './pages/CasePage';
import { NoticesPage } from './pages/NoticesPage';
import { TrustReportPage } from './pages/TrustReportPage';
import { MobileUploadPage } from './pages/MobileUploadPage';

export function App() {
  return (
    <Routes>
      <Route path="m/upload/:sessionId" element={<MobileUploadPage />} />
      <Route element={<Layout />}>
        <Route index element={<Navigate to="/intake" replace />} />
        <Route path="intake" element={<IntakePage />} />
        <Route path="queue" element={<QueuePage />} />
        <Route path="case" element={<CasePage />} />
        <Route path="case/:caseId" element={<CasePage />} />
        <Route path="notices" element={<NoticesPage />} />
        <Route path="trust" element={<TrustReportPage />} />
        <Route path="*" element={<Navigate to="/intake" replace />} />
      </Route>
    </Routes>
  );
}
