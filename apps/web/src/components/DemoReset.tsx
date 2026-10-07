import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchHealth, resetDemo } from '../lib/api';

/** Hidden demo shortcut: Ctrl+Shift+R (demo mode only) → confirm → restore the primed state. */
export function DemoReset() {
  const qc = useQueryClient();
  const { data: health } = useQuery({
    queryKey: ['health'],
    queryFn: fetchHealth,
    refetchInterval: 10_000,
  });
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    if (!health?.demo) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && !e.metaKey && e.code === 'KeyR') {
        e.preventDefault();
        setOpen(true);
      }
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [health?.demo]);

  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => setDone(null), 3500);
    return () => clearTimeout(t);
  }, [done]);

  const confirm = async () => {
    setBusy(true);
    try {
      const r = await resetDemo();
      await qc.invalidateQueries();
      setDone(
        `Demo reset — ${r.removed.cases} case${r.removed.cases === 1 ? '' : 's'} removed, cache kept`,
      );
      setOpen(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {open && (
        <div
          className="no-print fixed inset-0 z-[60] flex items-center justify-center bg-navy-950/50 p-4"
          role="dialog"
          aria-modal
          aria-labelledby="reset-title"
        >
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-2xl">
            <h2 id="reset-title" className="text-lg font-bold text-navy-900">
              Reset the demo?
            </h2>
            <p className="mt-2 text-sm text-slate-600">
              Removes live cases and upload sessions. Keeps primed extractions, notice audio,
              templates, officers and the synthetic history. The reset is written to the audit log.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => setOpen(false)}
                className="rounded-lg px-4 py-2 font-semibold text-slate-600 hover:bg-slate-100"
              >
                Cancel
              </button>
              <button
                onClick={() => void confirm()}
                disabled={busy}
                className="rounded-lg bg-rose-600 px-4 py-2 font-semibold text-white disabled:bg-slate-400"
              >
                {busy ? 'Resetting…' : 'Reset demo'}
              </button>
            </div>
          </div>
        </div>
      )}
      {done && (
        <div
          role="status"
          className="no-print fixed bottom-6 left-1/2 z-[60] -translate-x-1/2 animate-enter rounded-lg bg-navy-900 px-4 py-2.5 text-sm font-semibold text-white shadow-lg"
        >
          {done}
        </div>
      )}
    </>
  );
}
