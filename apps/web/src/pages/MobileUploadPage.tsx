import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router';
import { fetchSession, uploadToSession, type SlotType, type UploadSession } from '../lib/api';
import { DOC_LABEL } from '../lib/labels';

const TYPES: { type: SlotType | null; label: string }[] = [
  { type: 'application_form', label: 'Form' },
  { type: 'aadhaar', label: 'Aadhaar' },
  { type: 'bank_passbook', label: 'Passbook' },
  { type: 'epic', label: 'Voter ID' },
  { type: null, label: 'Not sure' },
];
import { usePipelineEvents, type PipelineEvent } from '../lib/events';

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
    `?sessionId=${sessionId}`,
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

  return (
    <div className="min-h-screen bg-slate-100">
      <header className="bg-navy-900 px-5 py-4 text-white">
        <div className="text-xl font-bold">Thoudang</div>
        <div className="text-sm text-slate-300">Phone upload · Social Welfare Dept</div>
      </header>
      <main className="mx-auto max-w-md space-y-5 px-5 py-6">
        {state === 'gone' && (
          <Notice
            title="This upload link has expired"
            body="The packet was already submitted. Scan the new QR code on the desk."
          />
        )}
        {state === 'submitted' && (
          <Notice
            title="Packet submitted ✓"
            body="The desk is screening this application. Scan the new QR code for the next applicant."
          />
        )}
        {(state === 'ready' || state === 'uploading' || state === 'loading') && (
          <>
            <div>
              <p className="text-sm font-semibold uppercase tracking-wide text-slate-500">
                1 · Which document?
              </p>
              <div
                className="mt-2 grid grid-cols-3 gap-2"
                role="radiogroup"
                aria-label="Document type"
              >
                {TYPES.map((t) => (
                  <button
                    key={t.label}
                    role="radio"
                    aria-checked={docType === t.type}
                    onClick={() => setDocType(t.type)}
                    className={`rounded-lg border-2 px-2 py-3 text-base font-semibold ${
                      docType === t.type
                        ? 'border-teal-accent bg-teal-soft text-navy-900'
                        : 'border-slate-200 bg-white text-slate-600'
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
            <p className="text-sm font-semibold uppercase tracking-wide text-slate-500">
              2 · Photograph it flat, in good light
            </p>
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
            <button
              disabled={state !== 'ready' || count >= max}
              onClick={() => cameraRef.current?.click()}
              className="w-full rounded-xl bg-teal-accent py-5 text-xl font-bold text-white shadow disabled:bg-slate-300"
            >
              {state === 'uploading'
                ? 'Sending…'
                : `📷  Photograph ${TYPES.find((t) => t.type === docType)?.label ?? 'document'}`}
            </button>
            <button
              disabled={state !== 'ready' || count >= max}
              onClick={() => galleryRef.current?.click()}
              className="w-full rounded-xl border-2 border-navy-900 bg-white py-4 text-lg font-semibold text-navy-900 disabled:opacity-40"
            >
              Choose from gallery
            </button>
            {error && <p className="rounded-lg bg-rose-50 px-4 py-2 text-rose-800">{error}</p>}
            <section>
              <h2 className="font-semibold text-navy-900">
                Sent to desk: {count} / {max}
              </h2>
              <ul className="mt-2 grid grid-cols-3 gap-2">
                {session?.files.map((f) => (
                  <li
                    key={f.id}
                    className="overflow-hidden rounded-lg border border-slate-200 bg-white"
                  >
                    <img
                      src={f.thumbUrl}
                      alt={f.originalName}
                      className="h-24 w-full object-cover"
                    />
                    <div className="truncate px-1.5 py-0.5 text-[11px] font-semibold text-slate-600">
                      {f.docType ? DOC_LABEL[f.docType] : 'Unsorted'}
                    </div>
                  </li>
                ))}
              </ul>
              {count > 0 && (
                <p className="mt-3 text-slate-600">
                  When all documents are sent, press “Screen application” on the desk.
                </p>
              )}
            </section>
          </>
        )}
      </main>
    </div>
  );
}

function Notice({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-xl bg-white p-6 text-center shadow-sm">
      <h1 className="text-xl font-bold text-navy-900">{title}</h1>
      <p className="mt-2 text-slate-600">{body}</p>
    </div>
  );
}
