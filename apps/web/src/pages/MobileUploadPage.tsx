import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router';
import { fetchSession, uploadToSession, type SlotType, type UploadSession } from '../lib/api';
import { DOC_LABEL } from '../lib/labels';

import { usePipelineEvents, type PipelineEvent } from '../lib/events';
import { BrandMark } from '../components/BrandMark';
import { Icon, Spinner, type IconName } from '../components/ui';

const TYPES: { type: SlotType | null; label: string; icon: IconName }[] = [
  { type: 'application_form', label: 'Form', icon: 'template' },
  { type: 'aadhaar', label: 'Aadhaar', icon: 'user' },
  { type: 'bank_passbook', label: 'Passbook', icon: 'building' },
  { type: 'epic', label: 'Voter ID', icon: 'users' },
  { type: null, label: 'Not sure', icon: 'help' },
];

/** Opened on a phone via the QR code: photographs go straight into the desk's upload session. */
export function MobileUploadPage() {
  const { sessionId = '' } = useParams();
  const [session, setSession] = useState<UploadSession | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'uploading' | 'gone' | 'submitted'>(
    'loading',
  );
  const [error, setError] = useState<string | null>(null);
  const [docType, setDocType] = useState<SlotType | null>('application_form');
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetchSession(sessionId)
      .then((s) => {
        setSession(s);
        setState('ready');
      })
      .catch(() => setState('gone'));
  }, [sessionId]);

  usePipelineEvents(
    useCallback((e: PipelineEvent) => {
      if (e.type !== 'session') return;
      if (e.action === 'submitted') setState('submitted');
      else
        fetchSession(e.sessionId)
          .then(setSession)
          .catch(() => undefined);
    }, []),
    '',
    `/api/sessions/${encodeURIComponent(sessionId)}/events`,
  );

  const upload = async (list: FileList | null) => {
    const files = [...(list ?? [])];
    if (!files.length) return;
    setState('uploading');
    setError(null);
    try {
      setSession(await uploadToSession(sessionId, files, 'phone', docType));
      // Suggest the next document in the usual order.
      const order = TYPES.map((t) => t.type);
      const next = order[order.indexOf(docType) + 1];
      if (docType && next !== undefined) setDocType(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setState((s) => (s === 'uploading' ? 'ready' : s));
    }
  };

  const count = session?.files.length ?? 0;
  const max = session?.maxFiles ?? 6;

  const active = state === 'ready' || state === 'uploading' || state === 'loading';
  const current = TYPES.find((t) => t.type === docType);

  return (
    <div className="min-h-[100dvh] bg-canvas">
      <header className="sticky top-0 z-20 flex items-center gap-3 bg-navy-900 px-4 py-3 text-white shadow-raised">
        <BrandMark size={34} />
        <div className="min-w-0 flex-1 leading-tight">
          <div className="text-lg font-bold">Thoudang</div>
          <div className="text-xs text-slate-300">Phone upload · Social Welfare Dept</div>
        </div>
        {active && (
          <span
            className="rounded-full bg-white/10 px-3 py-1 text-sm font-bold tabular-nums"
            aria-label={`${count} of ${max} sent`}
          >
            {count}/{max}
          </span>
        )}
      </header>
      <main className={`mx-auto max-w-md px-4 pt-5 ${active ? 'pb-48' : 'pb-10'}`}>
        {state === 'gone' && (
          <Notice
            icon="clock"
            title="This upload link has expired"
            body="The packet was already submitted. Scan the new QR code on the desk."
          />
        )}
        {state === 'submitted' && (
          <Notice
            icon="check"
            ok
            title="Packet submitted ✓"
            body="The desk is screening this application. Scan the new QR code for the next applicant."
          />
        )}
        {active && (
          <>
            <section aria-labelledby="which-doc">
              <h2
                id="which-doc"
                className="flex items-center gap-2 text-overline font-bold uppercase text-ink-muted"
              >
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-navy-900 text-[0.7rem] text-white">
                  1
                </span>
                Which document?
              </h2>
              <div
                className="mt-3 grid grid-cols-2 gap-2.5"
                role="radiogroup"
                aria-label="Document type"
              >
                {TYPES.map((t) => {
                  const on = docType === t.type;
                  const sent =
                    session?.files.filter((f) => (f.docType ?? null) === t.type).length ?? 0;
                  return (
                    <button
                      key={t.label}
                      role="radio"
                      aria-checked={on}
                      onClick={() => setDocType(t.type)}
                      className={`relative flex min-h-[4.25rem] items-center gap-3 rounded-2xl border-2 px-3.5 text-left text-[1.05rem] font-semibold transition active:scale-[0.98] ${
                        t.type === null ? 'col-span-2' : ''
                      } ${
                        on
                          ? 'border-teal-deep bg-teal-wash text-navy-900 shadow-raised'
                          : 'border-line bg-white text-ink-soft'
                      }`}
                    >
                      <span
                        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${on ? 'bg-teal-deep text-white' : 'bg-navy-50 text-navy-700'}`}
                      >
                        <Icon name={t.icon} size={21} />
                      </span>
                      {t.label}
                      {sent > 0 && (
                        <span className="ml-auto flex h-6 min-w-6 items-center justify-center rounded-full bg-emerald-600 px-1.5 text-xs font-bold text-white">
                          <Icon name="check" size={13} strokeWidth={3} />
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </section>

            <h2 className="mt-6 flex items-center gap-2 text-overline font-bold uppercase text-ink-muted">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-navy-900 text-[0.7rem] text-white">
                2
              </span>
              Photograph it flat, in good light
            </h2>
            <input
              ref={cameraRef}
              type="file"
              accept="image/*"
              capture="environment"
              multiple
              hidden
              onChange={(e) => {
                void upload(e.target.files);
                e.target.value = '';
              }}
            />
            <input
              ref={galleryRef}
              type="file"
              accept="image/*"
              multiple
              hidden
              onChange={(e) => {
                void upload(e.target.files);
                e.target.value = '';
              }}
            />
            {error && (
              <p className="mt-3 flex items-center gap-2 rounded-xl bg-rose-50 px-4 py-3 text-rose-800">
                <Icon name="alert" size={18} />
                {error}
              </p>
            )}
            <section className="mt-3 rounded-2xl border border-line bg-white p-4 shadow-card">
              <div className="flex items-center justify-between">
                <h2 className="font-semibold text-navy-900">
                  Sent to desk: {count} / {max}
                </h2>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100">
                <div
                  className="h-full rounded-full bg-teal-accent transition-[width] duration-500"
                  style={{ width: `${(count / Math.max(1, max)) * 100}%` }}
                />
              </div>
              {count > 0 ? (
                <ul className="mt-3 grid grid-cols-3 gap-2">
                  {session?.files.map((f) => (
                    <li
                      key={f.id}
                      className="animate-pop overflow-hidden rounded-xl border border-line bg-white"
                    >
                      <img
                        src={f.thumbUrl}
                        alt={f.originalName}
                        className="h-24 w-full object-cover"
                      />
                      <div className="truncate px-1.5 py-1 text-[11px] font-semibold text-ink-soft">
                        {f.docType ? DOC_LABEL[f.docType] : 'Unsorted'}
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-3 text-sm text-ink-muted">
                  Nothing sent yet. Photos appear on the desk instantly.
                </p>
              )}
              {count > 0 && (
                <p className="mt-3 text-[0.95rem] text-ink-soft">
                  When all documents are sent, press “Screen application” on the desk.
                </p>
              )}
            </section>
          </>
        )}
      </main>

      {active && (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-white/95 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 shadow-[0_-10px_30px_-12px_rgb(10_27_51/0.3)] backdrop-blur">
          <div className="mx-auto max-w-md space-y-2.5">
            <button
              disabled={state !== 'ready' || count >= max}
              onClick={() => cameraRef.current?.click()}
              className="flex h-16 w-full items-center justify-center gap-3 rounded-2xl bg-teal-deep text-xl font-bold text-white shadow-raised transition active:scale-[0.98] disabled:bg-slate-300 disabled:text-slate-600 disabled:shadow-none"
            >
              {state === 'uploading' ? (
                <>
                  <Spinner size={22} />
                  Sending…
                </>
              ) : (
                <>
                  <Icon name="camera" size={26} />
                  {`Photograph ${current?.label ?? 'document'}`}
                </>
              )}
            </button>
            <button
              disabled={state !== 'ready' || count >= max}
              onClick={() => galleryRef.current?.click()}
              className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl border-2 border-navy-900 bg-white text-base font-semibold text-navy-900 transition active:scale-[0.98] disabled:opacity-40"
            >
              <Icon name="image" size={20} />
              Choose from gallery
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Notice({
  title,
  body,
  icon,
  ok = false,
}: {
  title: string;
  body: string;
  icon: IconName;
  ok?: boolean;
}) {
  return (
    <div className="mt-6 rounded-2xl bg-white p-7 text-center shadow-raised">
      <span
        className={`mx-auto flex h-16 w-16 items-center justify-center rounded-full ${ok ? 'animate-pop bg-emerald-600 text-white' : 'bg-navy-50 text-navy-600'}`}
      >
        <Icon name={icon} size={32} strokeWidth={ok ? 2.8 : 1.8} />
      </span>
      <h1 className="mt-4 text-xl font-bold text-navy-900">{title}</h1>
      <p className="mt-2 text-ink-soft">{body}</p>
    </div>
  );
}
