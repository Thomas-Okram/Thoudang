import { useQuery } from '@tanstack/react-query';
import { useParams, useSearchParams } from 'react-router';
import { fetchPublicStatus, type PublicStatus } from '../lib/api';

const STEPS: PublicStatus['status'][] = ['Received', 'Under review', 'Approved'];
const MNI: Record<PublicStatus['status'], string> = {
  Received: 'ফংলে',
  'Correction needed': 'শেমদোক্পা মথৌ তাই',
  'Under review': 'য়েংশিনরি',
  Approved: 'য়াথাং পীরে',
};

/** Citizen-facing status page (/s/<ref>?k=…). Shows only first name, reference and status. */
export function StatusPage() {
  const { ref = '' } = useParams();
  const [params] = useSearchParams();
  const k = params.get('k') ?? '';
  const { data, error, isPending } = useQuery({
    queryKey: ['public-status', ref, k],
    queryFn: () => fetchPublicStatus(ref, k),
    retry: false,
  });

  return (
    <div className="min-h-screen bg-slate-100">
      <header className="bg-navy-900 px-5 py-4 text-white">
        <div className="text-lg font-bold">Application status</div>
        <div className="text-sm text-slate-300">
          Department of Social Welfare, Manipur · Prototype
        </div>
      </header>
      <main className="mx-auto max-w-md px-5 py-8">
        {isPending && <div className="skeleton h-48" />}
        {error && (
          <div className="rounded-xl bg-white p-6 text-center shadow-sm">
            <h1 className="text-xl font-bold text-navy-900">Status not found</h1>
            <p className="mt-2 text-slate-600">Please check the link or QR code on your notice.</p>
          </div>
        )}
        {data && (
          <div className="rounded-xl bg-white p-6 shadow-sm" data-testid="public-status">
            <p className="text-slate-600">Hello {data.firstName},</p>
            <p className="mt-1 font-mono text-sm text-slate-500">{data.reference}</p>
            <div
              className={`mt-5 rounded-xl px-5 py-4 text-center ${data.status === 'Correction needed' ? 'bg-amber-100 text-amber-950' : data.status === 'Approved' ? 'bg-emerald-100 text-emerald-950' : 'bg-teal-soft text-navy-900'}`}
            >
              <div className="text-2xl font-bold">{data.status}</div>
              <div className="font-beng text-lg">{MNI[data.status]}</div>
            </div>
            {data.status === 'Correction needed' && (
              <p className="mt-4 text-sm text-slate-700">
                Please bring the documents listed on your notice to the District Social Welfare
                Office. This is not a rejection.
              </p>
            )}
            <ol className="mt-6 flex justify-between text-xs text-slate-500">
              {STEPS.map((s) => {
                const reached =
                  STEPS.indexOf(s) <=
                  STEPS.indexOf(data.status === 'Correction needed' ? 'Under review' : data.status);
                return (
                  <li
                    key={s}
                    className={`flex flex-col items-center gap-1 ${reached ? 'font-semibold text-navy-900' : ''}`}
                  >
                    <span
                      className={`h-3 w-3 rounded-full ${reached ? 'bg-teal-accent' : 'bg-slate-300'}`}
                    />
                    {s}
                  </li>
                );
              })}
            </ol>
            <p className="mt-6 text-xs text-slate-400">
              Updated{' '}
              {new Date(data.updatedAt).toLocaleDateString('en-IN', { dateStyle: 'medium' })}
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
