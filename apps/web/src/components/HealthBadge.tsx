import { useQuery } from '@tanstack/react-query';
import { fetchHealth } from '../lib/api';

function Dot({ ok }: { ok: boolean }) {
  return (
    <span
      aria-hidden
      className={`inline-block h-2.5 w-2.5 rounded-full ${ok ? 'bg-emerald-400' : 'bg-rose-400'}`}
    />
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
    <div className="space-y-1.5 rounded-lg bg-navy-800/70 px-3 py-2.5 text-sm" data-testid="health">
      <div className="flex items-center gap-2">
        <Dot ok={apiOk} />
        <span className="text-slate-200">
          {isPending ? 'Checking API…' : apiOk ? 'API connected' : 'API offline'}
        </span>
      </div>
      {apiOk && (
        <div className="flex items-center gap-2">
          <Dot ok={Boolean(data?.claudeConfigured)} />
          <span className="text-slate-300">
            {data?.claudeConfigured ? 'AI reader ready' : 'AI key missing'}
          </span>
        </div>
      )}
    </div>
  );
}
