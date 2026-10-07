import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchHealth, resetDemo } from '../lib/api';
import { Button } from './ui/Button';
import { Dialog } from './ui/Dialog';
import { Toast } from './ui/Toast';

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
        <Dialog
          title="Reset the demo?"
          icon="refresh"
          tone="danger"
          onClose={() => setOpen(false)}
          description="Removes live cases and upload sessions. Keeps primed extractions, notice audio, templates, officers and the synthetic history. The reset is written to the audit log."
          footer={
            <>
              <Button variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button
                variant="danger"
                onClick={() => void confirm()}
                loading={busy}
                loadingLabel="Resetting…"
                data-autofocus
              >
                Reset demo
              </Button>
            </>
          }
        />
      )}
      {done && <Toast>{done}</Toast>}
    </>
  );
}
