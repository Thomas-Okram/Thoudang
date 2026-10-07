import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react';
import QRCode from 'qrcode';
import { Page } from '../components/Page';
import { CaseProgressCard } from '../components/CaseProgressCard';
import { BatchPanel } from '../components/BatchPanel';
import {
  createSession,
  fetchSession,
  removeSessionFile,
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
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
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

  const addFiles = async (list: FileList | File[] | null) => {
    const files = [...(list ?? [])].filter(
      (f) => f.type.startsWith('image/') || /\.(jpe?g|png|webp|heic)$/i.test(f.name),
    );
    if (!session || !files.length) return;
    setBusy('uploading');
    setError(null);
    try {
      setSession(await uploadToSession(session.sessionId, files, 'desk'));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setBusy(null);
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

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    void addFiles(e.dataTransfer.files);
  };

  const files = session?.files ?? [];
  const full = files.length >= (session?.maxFiles ?? 6);

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          onClick={() => !full && inputRef.current?.click()}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => e.key === 'Enter' && inputRef.current?.click()}
          className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-10 text-center transition ${
            dragOver
              ? 'border-teal-accent bg-teal-soft/40'
              : 'border-slate-300 hover:border-teal-accent hover:bg-slate-50'
          } ${full ? 'pointer-events-none opacity-50' : ''}`}
        >
          <svg
            viewBox="0 0 24 24"
            className="h-10 w-10 text-teal-accent"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            aria-hidden
          >
            <path
              d="M12 16V4m0 0-4 4m4-4 4 4M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <p className="mt-3 text-lg font-semibold text-navy-900">
            {busy === 'uploading' ? 'Uploading…' : 'Drop document photos here, or click to choose'}
          </p>
          <p className="mt-1 text-slate-500">1–6 images per applicant · JPG or PNG · any order</p>
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(e) => {
              void addFiles(e.target.files);
              e.target.value = '';
            }}
          />
        </div>

        {files.length > 0 && (
          <ul className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
            {files.map((f) => (
              <li
                key={f.id}
                className="group relative overflow-hidden rounded-lg border border-slate-200 bg-slate-50"
              >
                <img src={f.thumbUrl} alt={f.originalName} className="h-36 w-full object-contain" />
                <div className="flex items-center justify-between gap-2 border-t border-slate-200 bg-white px-2 py-1.5 text-xs">
                  <span className="truncate text-slate-600">{f.originalName}</span>
                  {f.from === 'phone' && (
                    <span className="rounded bg-teal-soft px-1.5 font-semibold text-navy-900">
                      phone
                    </span>
                  )}
                </div>
                <button
                  onClick={() =>
                    session &&
                    removeSessionFile(session.sessionId, f.id)
                      .then(setSession)
                      .catch(() => undefined)
                  }
                  className="absolute right-1.5 top-1.5 rounded-full bg-white/90 px-2 text-sm font-bold text-slate-600 shadow hover:text-rose-600"
                  aria-label={`Remove ${f.originalName}`}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}

        {error && <p className="mt-4 rounded-lg bg-rose-50 px-4 py-2 text-rose-800">{error}</p>}

        <div className="mt-6 flex items-center justify-between gap-4">
          <p className="text-slate-500">
            {files.length
              ? `${files.length} image${files.length > 1 ? 's' : ''} ready`
              : 'No images yet'}
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
