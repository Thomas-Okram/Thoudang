import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';
import { useOfficer } from '../lib/officer';
import { BrandMark } from './BrandMark';
import { Spinner } from './ui';

/**
 * Officer screens need a signed-in officer (AUTH_MODE=session). The phone upload page and the
 * citizen status page live outside this guard — they are public by design.
 */
export function RequireOfficer({ children }: { children: ReactNode }) {
  const { mode, ready, officer } = useOfficer();
  const location = useLocation();
  if (!ready) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center gap-3 bg-canvas text-ink-soft">
        <BrandMark size={36} />
        <Spinner size={18} />
      </div>
    );
  }
  if (mode === 'session' && !officer) {
    const next = `${location.pathname}${location.search}`;
    return <Navigate to={`/login?next=${encodeURIComponent(next)}`} replace />;
  }
  return <>{children}</>;
}
