import { useQuery } from '@tanstack/react-query';
import { fetchHealth } from '../lib/api';

function Dot({ ok }: { ok: boolean }) {
  return (
    <span aria-hidden className="relative inline-flex h-2.5 w-2.5">
      {ok && (
        <span className="absolute inset-0 animate-ping rounded-full bg-emerald-400/60 [animation-duration:2.4s]" />
      )}
      <span
        className={`relative inline-block h-2.5 w-2.5 rounded-full ${ok ? 'bg-emerald-400' : 'bg-warm-400'}`}
      />
    </span>
  );
}

export function HealthBadge() {
  const { data, isError, isPending } = useQuery({
    queryKey: ['health'],
    queryFn: fetchHealth,
    refetchInterval: 10_000,
  });

  const apiOk = !isError && data?.status === 'ok';
  return (
    <div
      className="space-y-2 rounded-xl border border-white/[0.07] bg-white/[0.04] px-3.5 py-3 text-sm max-[1400px]:flex max-[1400px]:flex-col max-[1400px]:items-center max-[1400px]:px-0"
      title={
        isPending
          ? 'Checking API…'
          : apiOk
            ? `API connected · ${data?.claudeConfigured ? 'AI reader ready' : 'AI key missing — cache only'}`
            : 'API offline'
      }
      data-testid="health"
      aria-live="polite"
    >
      <div className="text-overline font-bold uppercase text-navy-300 max-[1400px]:sr-only">
        System
      </div>
      <div className="flex items-center gap-2.5">
        <Dot ok={apiOk} />
        <span className="text-slate-100 max-[1400px]:sr-only">
          {isPending ? 'Checking API…' : apiOk ? 'API connected' : 'API offline'}
        </span>
      </div>
      {apiOk && (
        <div className="flex items-center gap-2.5">
          <Dot ok={Boolean(data?.claudeConfigured)} />
          <span className="text-slate-200 max-[1400px]:sr-only">
            {data?.claudeConfigured ? 'AI reader ready' : 'AI key missing — cache only'}
          </span>
        </div>
      )}
      {apiOk && data?.demoMode !== 'live' && (
        <div className="dev-noise text-xs font-medium text-warm-200 max-[1400px]:hidden">
          Mode: {data?.demoMode.replace('_', ' ')}
        </div>
      )}
    </div>
  );
}
