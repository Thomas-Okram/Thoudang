import { useCallback, useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { Page } from '../components/Page';
import { CaseProgressCard } from '../components/CaseProgressCard';
import { BatchPanel } from '../components/BatchPanel';
import { SlotBoard } from '../components/SlotBoard';
import {
  createSession,
  fetchSession,
  removeSessionFile,
  setSessionFileType,
  submitSession,
  uploadToSession,
  type UploadSession,
} from '../lib/api';
import { usePipelineEvents, type PipelineEvent } from '../lib/events';
import { useCaseProgress } from '../lib/progress';

type Tab = 'packet' | 'batch';

export function IntakePage() {
  const [tab, setTab] = useState<Tab>('packet');
  const { cases, track } = useCaseProgress();
  const started = Object.values(cases).sort((a, b) => b.startedAt - a.startedAt);
  const single = started.filter((c) => !c.packetName);

  return (
    <Page
      title="Intake"
      subtitle="Upload an application packet: form, Aadhaar, bank passbook (voter ID optional)."
    >
      <div className="mb-6 inline-flex rounded-lg bg-slate-200 p-1" role="tablist">
        {(
          [
            ['packet', 'Single packet'],
            ['batch', 'Batch mode'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={`rounded-md px-5 py-2 font-semibold transition ${
              tab === key
                ? 'bg-white text-navy-900 shadow-sm'
                : 'text-slate-600 hover:text-navy-900'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'packet' ? (
        <>
          <PacketIntake onSubmitted={(c) => track(c)} />
          {single.length > 0 && (
            <section className="mt-8 space-y-4">
              <h2 className="text-xl font-bold text-navy-900">Screening progress</h2>
              {single.map((c) => (
                <CaseProgressCard key={c.caseId} c={c} />
              ))}
            </section>
          )}
        </>
      ) : (
        <BatchPanel progress={cases} onCreated={(list) => list.forEach((c) => track(c))} />
      )}
    </Page>
  );
}

function PacketIntake({
  onSubmitted,
}: {
  onSubmitted: (c: { caseId: string; reference: string }) => void;
}) {
  const [session, setSession] = useState<UploadSession | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'uploading' | 'submitting' | null>(null);
  const creating = useRef(false);

  const newSession = useCallback(async () => {
    if (creating.current) return;
    creating.current = true;
    try {
      setSession(await createSession());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start an upload session');
    } finally {
      creating.current = false;
    }
  }, []);

  useEffect(() => {
    void newSession();
  }, [newSession]);

  // Phone uploads land in the same session — refresh thumbnails live.
  usePipelineEvents(
    useCallback(
      (e: PipelineEvent) => {
        if (
          e.type === 'session' &&
          e.sessionId === session?.sessionId &&
          e.action !== 'submitted'
        ) {
          fetchSession(e.sessionId)
            .then(setSession)
            .catch(() => undefined);
        }
      },
      [session?.sessionId],
    ),
    session ? `?sessionId=${session.sessionId}` : '',
  );

  const guard = async (kind: 'uploading' | null, fn: () => Promise<UploadSession>) => {
    if (kind) setBusy(kind);
    setError(null);
    try {
      setSession(await fn());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      if (kind) setBusy(null);
    }
  };

  const submit = async () => {
    if (!session) return;
    setBusy('submitting');
    setError(null);
    try {
      const created = await submitSession(session.sessionId);
      onSubmitted(created);
      setSession(null);
      await newSession();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not submit');
    } finally {
      setBusy(null);
    }
  };

  const files = session?.files ?? [];
  const labelled = files.filter((f) => f.docType).length;

  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_300px]">
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg font-bold text-navy-900">Drop each document into its slot</h2>
          <p className="text-sm text-slate-500">
            Labelled slots skip AI identification (faster). Not sure? Use “Other / unsorted”.
          </p>
        </div>
        {session ? (
          <SlotBoard
            session={session}
            busy={busy !== null}
            onUpload={(list, type) =>
              void guard('uploading', () => uploadToSession(session.sessionId, list, 'desk', type))
            }
            onMove={(id, type) =>
              void guard(null, () => setSessionFileType(session.sessionId, id, type))
            }
            onRemove={(id) => void guard(null, () => removeSessionFile(session.sessionId, id))}
          />
        ) : (
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-5">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="skeleton h-48" />
            ))}
          </div>
        )}

        {error && <p className="mt-4 rounded-lg bg-rose-50 px-4 py-2 text-rose-800">{error}</p>}

        <div className="mt-5 flex flex-wrap items-center justify-between gap-4">
          <p className="text-slate-500">
            {busy === 'uploading'
              ? 'Uploading…'
              : files.length
                ? `${files.length} image${files.length > 1 ? 's' : ''} · ${labelled} labelled, ${files.length - labelled} for the AI to identify`
                : 'No images yet — form, Aadhaar and passbook are required'}
          </p>
          <button
            onClick={() => void submit()}
            disabled={!files.length || busy !== null}
            className="rounded-lg bg-teal-accent px-6 py-3 text-lg font-bold text-white shadow-sm transition hover:brightness-110 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            {busy === 'submitting' ? 'Submitting…' : 'Screen application'}
          </button>
        </div>
      </section>

      <PhonePanel session={session} />
    </div>
  );
}

function PhonePanel({ session }: { session: UploadSession | null }) {
  const [qr, setQr] = useState<string | null>(null);
  useEffect(() => {
    if (!session) return;
    QRCode.toDataURL(session.mobileUrl, {
      margin: 1,
      width: 240,
      color: { dark: '#0A1B33', light: '#ffffff' },
    })
      .then(setQr)
      .catch(() => setQr(null));
  }, [session]);
  const localhost = session?.mobileUrl.includes('//localhost');

  return (
    <aside className="rounded-xl border border-slate-200 bg-white p-6 text-center shadow-sm">
      <h2 className="text-lg font-bold text-navy-900">Phone upload</h2>
      <p className="mt-1 text-sm text-slate-600">
        Scan with a phone on the same Wi-Fi or hotspot to photograph documents straight into this
        packet.
      </p>
      <div className="mx-auto mt-4 flex h-[240px] w-[240px] items-center justify-center rounded-lg border border-slate-200">
        {qr ? (
          <img src={qr} alt="QR code for phone upload" width={240} height={240} />
        ) : (
          <span className="text-slate-400">Preparing…</span>
        )}
      </div>
      {session && (
        <p className="mt-3 break-all font-mono text-xs text-slate-500">{session.mobileUrl}</p>
      )}
      {localhost && (
        <p className="mt-2 rounded bg-amber-50 px-2 py-1 text-xs text-amber-900">
          No LAN address found — connect this laptop to Wi-Fi or a phone hotspot.
        </p>
      )}
    </aside>
  );
}
