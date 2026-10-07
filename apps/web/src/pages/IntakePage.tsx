import { useCallback, useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { Page } from '../components/Page';
import { Badge, Button, Card, CardHeader, Icon, Skeleton, Spinner, Tabs } from '../components/ui';
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
      eyebrow="Step 1 · Receive the packet"
      subtitle="Upload an application packet: form, Aadhaar, bank passbook (voter ID optional)."
      width="max-w-[1320px]"
      actions={
        <Tabs
          label="Intake mode"
          size="lg"
          value={tab}
          onChange={setTab}
          items={[
            { value: 'packet', label: 'Single packet' },
            { value: 'batch', label: 'Batch mode' },
          ]}
        />
      }
    >
      {tab === 'packet' ? (
        <>
          {single.length > 0 && (
            <section className="mb-8 space-y-4" aria-labelledby="progress-title">
              <h2 id="progress-title" className="flex items-center gap-2 text-title font-bold text-navy-900">
                Screening progress
              </h2>
              {single.map((c) => (
                <CaseProgressCard key={c.caseId} c={c} />
              ))}
            </section>
          )}
          <PacketIntake onSubmitted={(c) => track(c)} />
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

  const have = (t: string) => files.some((f) => f.docType === t);
  const required = [
    { key: 'application_form', label: 'Form' },
    { key: 'aadhaar', label: 'Aadhaar' },
    { key: 'bank_passbook', label: 'Passbook' },
  ];

  return (
    <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_300px]">
      <Card>
        <CardHeader
          icon="upload"
          title="Drop each document into its slot"
          subtitle="Labelled slots skip AI identification (faster). Not sure? Use “Other / unsorted”."
          actions={
            <ul className="flex gap-1.5" aria-label="Required documents">
              {required.map((r) => (
                <li key={r.key}>
                  <Badge
                    tone={have(r.key) ? 'teal' : 'neutral'}
                    icon={have(r.key) ? 'check' : undefined}
                  >
                    {r.label}
                  </Badge>
                </li>
              ))}
            </ul>
          }
        />
        <div className="p-5">
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
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-5">
              {[0, 1, 2, 3, 4].map((i) => (
                <Skeleton key={i} className="h-56" />
              ))}
            </div>
          )}

          {error && (
            <p className="mt-4 flex items-center gap-2 rounded-xl bg-rose-50 px-4 py-2.5 text-rose-800">
              <Icon name="alert" size={18} />
              {error}
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-4 rounded-b-card border-t border-line bg-slate-50/70 px-6 py-4">
          <p className="flex items-center gap-2 text-ink-muted">
            {busy === 'uploading' && <Spinner size={15} className="text-teal-deep" />}
            {busy === 'uploading'
              ? 'Uploading…'
              : files.length
                ? `${files.length} image${files.length > 1 ? 's' : ''} · ${labelled} labelled, ${files.length - labelled} for the AI to identify`
                : 'No images yet — form, Aadhaar and passbook are required'}
          </p>
          <Button
            variant="primary"
            size="xl"
            icon="sparkle"
            onClick={() => void submit()}
            disabled={!files.length || busy !== null}
            loading={busy === 'submitting'}
            loadingLabel="Submitting…"
          >
            Screen application
          </Button>
        </div>
      </Card>

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
      width: 480,
      color: { dark: '#0A1B33', light: '#ffffff' },
    })
      .then(setQr)
      .catch(() => setQr(null));
  }, [session]);
  const localhost = session?.mobileUrl.includes('//localhost');

  return (
    <aside className="flex flex-col overflow-hidden rounded-card bg-navy-900 text-white shadow-raised">
      <div className="px-6 pb-4 pt-6">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-teal-accent/20 text-teal-soft">
            <Icon name="phone" size={19} />
          </span>
          <h2 className="text-lg font-bold">Phone upload</h2>
        </div>
        <p className="mt-2 text-sm leading-relaxed text-slate-300">
          Scan with a phone on the same Wi-Fi or hotspot to photograph documents straight into this
          packet.
        </p>
      </div>
      <div className="mx-6 flex aspect-square items-center justify-center rounded-2xl bg-white p-3 shadow-inner">
        {qr ? (
          <img src={qr} alt="QR code for phone upload" width={240} height={240} className="h-full w-full" />
        ) : (
          <span className="flex items-center gap-2 text-ink-muted">
            <Spinner size={16} /> Preparing…
          </span>
        )}
      </div>
      <ol className="space-y-2 px-6 pb-2 pt-5 text-sm text-slate-200">
        {['Scan the code', 'Pick the document type', 'Photograph it flat, in good light'].map(
          (t, i) => (
            <li key={t} className="flex items-center gap-2.5">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/10 text-xs font-bold text-teal-soft">
                {i + 1}
              </span>
              {t}
            </li>
          ),
        )}
      </ol>
      <div className="mt-auto px-6 pb-5 pt-3">
        {session && (
          <p className="dev-noise break-all font-mono text-[0.7rem] text-slate-400">
            {session.mobileUrl}
          </p>
        )}
        {localhost && (
          <p className="mt-2 rounded-lg bg-warm-100 px-3 py-2 text-xs font-medium text-warm-900">
            No LAN address found — connect this laptop to Wi-Fi or a phone hotspot.
          </p>
        )}
      </div>
    </aside>
  );
}
