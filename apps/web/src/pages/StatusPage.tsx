import { useQuery } from '@tanstack/react-query';
import { useParams, useSearchParams } from 'react-router';
import { fetchPublicStatus, type PublicStatus } from '../lib/api';
import { BrandMark } from '../components/BrandMark';
import { Icon, Skeleton } from '../components/ui';

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

  const tone =
    data?.status === 'Correction needed'
      ? { box: 'bg-warm-50 text-warm-900 ring-warm-400/50', icon: 'user' as const }
      : data?.status === 'Approved'
        ? { box: 'bg-emerald-50 text-emerald-900 ring-emerald-500/40', icon: 'check' as const }
        : { box: 'bg-teal-wash text-navy-900 ring-teal-accent/40', icon: 'clock' as const };

  return (
    <div className="min-h-[100dvh] bg-canvas">
      <header className="flex items-center gap-3 bg-navy-900 px-5 py-4 text-white">
        <BrandMark size={36} />
        <div className="leading-tight">
          <div className="text-lg font-bold">Application status</div>
          <div className="text-xs text-slate-300">
            Department of Social Welfare, Manipur · Prototype
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-md px-4 py-7">
        {isPending && <Skeleton className="h-64" />}
        {error && (
          <div className="rounded-2xl bg-white p-7 text-center shadow-raised">
            <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-navy-50 text-navy-600">
              <Icon name="search" size={28} />
            </span>
            <h1 className="mt-4 text-xl font-bold text-navy-900">Status not found</h1>
            <p className="mt-2 text-ink-soft">Please check the link or QR code on your notice.</p>
          </div>
        )}
        {data && (
          <div className="rounded-2xl bg-white p-6 shadow-raised" data-testid="public-status">
            <p className="text-lg text-ink-soft">Hello {data.firstName},</p>
            <p className="mt-1 inline-block rounded-md bg-slate-100 px-2 py-0.5 font-mono text-sm text-ink-soft">
              {data.reference}
            </p>
            <div className={`mt-5 rounded-2xl px-5 py-5 text-center ring-1 ring-inset ${tone.box}`}>
              <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-white/70">
                <Icon name={tone.icon} size={26} strokeWidth={2.2} />
              </span>
              <div className="mt-2 text-2xl font-bold">{data.status}</div>
              <div className="font-beng text-lg">{MNI[data.status]}</div>
            </div>
            {data.status === 'Correction needed' && (
              <p className="mt-4 rounded-xl bg-slate-50 px-4 py-3 text-[0.95rem] text-ink-soft">
                Please bring the documents listed on your notice to the District Social Welfare
                Office. This is not a rejection.
              </p>
            )}
            <ol className="mt-6 grid grid-cols-3 text-center text-sm text-ink-muted">
              {STEPS.map((s, i) => {
                const reachedIdx = STEPS.indexOf(
                  data.status === 'Correction needed' ? 'Under review' : data.status,
                );
                const reached = i <= reachedIdx;
                return (
                  <li
                    key={s}
                    className={`relative flex flex-col items-center gap-1.5 ${reached ? 'font-semibold text-navy-900' : ''}`}
                  >
                    {i < STEPS.length - 1 && (
                      <span
                        aria-hidden
                        className={`absolute left-1/2 right-[-50%] top-3 h-1 -translate-y-1/2 rounded-full ${i < reachedIdx ? 'bg-teal-accent' : 'bg-slate-200'}`}
                      />
                    )}
                    <span
                      className={`relative flex h-6 w-6 items-center justify-center rounded-full ${reached ? 'bg-teal-deep text-white' : 'border-2 border-line-strong bg-white'}`}
                    >
                      {reached && <Icon name="check" size={13} strokeWidth={3} />}
                    </span>
                    {s}
                  </li>
                );
              })}
            </ol>
            <p className="mt-6 text-xs text-ink-muted">
              Updated{' '}
              {new Date(data.updatedAt).toLocaleDateString('en-IN', { dateStyle: 'medium' })}
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
