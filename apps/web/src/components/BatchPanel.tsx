import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { uploadBatch, uploadBatchZip, type BatchResult, type CaseStatus } from '../lib/api';
import { STAGE_ORDER, type CaseProgress } from '../lib/progress';
import { STATUS_ACCENT, STATUS_LABEL } from '../lib/labels';
import { StatusBadge } from './StatusBadge';
import { Card } from './ui/Card';
import { Icon, type IconName } from './ui/Icon';
import { Spinner } from './ui/Spinner';

const STAGE_TEXT: Record<string, string> = {
  uploaded: 'Queued',
  classifying: 'Identifying…',
  extracting: 'Reading…',
  screening: 'Checking rules…',
};

function ChoiceTile({
  icon,
  title,
  body,
  onClick,
  disabled,
  primary,
}: {
  icon: IconName;
  title: string;
  body: string;
  onClick: () => void;
  disabled: boolean;
  primary?: boolean;
}) {
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      className={`group flex flex-1 items-center gap-4 rounded-2xl border-2 p-5 text-left transition disabled:cursor-not-allowed disabled:opacity-60 ${
        primary
          ? 'border-teal-accent/50 bg-teal-wash hover:border-teal-deep'
          : 'border-line bg-white hover:border-navy-300'
      }`}
    >
      <span
        className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl ${primary ? 'bg-teal-deep text-white' : 'bg-navy-50 text-navy-700'}`}
      >
        <Icon name={icon} size={24} />
      </span>
      <span>
        <span className="block text-lg font-bold text-navy-900">{title}</span>
        <span className="block text-sm text-ink-muted">{body}</span>
      </span>
      <Icon
        name="arrowRight"
        size={20}
        className="ml-auto text-ink-muted transition-transform group-hover:translate-x-1"
      />
    </button>
  );
}

export function BatchPanel({
  progress,
  onCreated,
}: {
  progress: Record<string, CaseProgress>;
  onCreated: (cases: { caseId: string; reference: string; packetName: string }[]) => void;
}) {
  const folderRef = useRef<HTMLInputElement>(null);
  const zipRef = useRef<HTMLInputElement>(null);
  const [result, setResult] = useState<BatchResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // React has no typed prop for folder pickers.
    folderRef.current?.setAttribute('webkitdirectory', '');
    folderRef.current?.setAttribute('directory', '');
  }, []);

  const run = async (upload: () => Promise<BatchResult>) => {
    setBusy(true);
    setError(null);
    try {
      const r = await upload();
      setResult(r);
      onCreated(r.cases);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Batch upload failed');
    } finally {
      setBusy(false);
    }
  };

  const onFolder = (list: FileList | null) => {
    const files = [...(list ?? [])].map((file) => ({
      file,
      relPath: (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name,
    }));
    if (files.length) void run(() => uploadBatch(files));
  };

  const tiles = (result?.cases ?? [])
    .map((c) => progress[c.caseId])
    .filter((c): c is CaseProgress => Boolean(c));
  const done = tiles.filter((t) => t.stage === 'done');
  const counts = done.reduce<Partial<Record<CaseStatus, number>>>((acc, t) => {
    if (t.status) acc[t.status] = (acc[t.status] ?? 0) + 1;
    return acc;
  }, {});
  const pct = tiles.length ? (done.length / tiles.length) * 100 : 0;

  return (
    <div className="space-y-6">
      <Card padded>
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-navy-50 text-navy-700">
            <Icon name="queue" size={20} />
          </span>
          <div>
            <h2 className="text-lg font-bold text-navy-900">Batch intake</h2>
            <p className="mt-0.5 max-w-3xl text-ink-muted">
              Choose a folder with <strong className="text-navy-900">one sub-folder per applicant</strong>{' '}
              (e.g. <code className="rounded bg-slate-100 px-1 text-[0.9em]">batch/packet-01/…</code>),
              or a .zip with the same layout. Each sub-folder becomes one case.
            </p>
          </div>
        </div>
        <div className="mt-5 flex flex-col gap-3 md:flex-row">
          <ChoiceTile
            primary
            icon="folder"
            title={busy ? 'Uploading…' : 'Choose folder'}
            body="Select the batch folder from this computer"
            disabled={busy}
            onClick={() => folderRef.current?.click()}
          />
          <ChoiceTile
            icon="archive"
            title="Upload .zip"
            body="Same layout, compressed"
            disabled={busy}
            onClick={() => zipRef.current?.click()}
          />
          <input
            ref={folderRef}
            type="file"
            multiple
            hidden
            onChange={(e) => {
              onFolder(e.target.files);
              e.target.value = '';
            }}
          />
          <input
            ref={zipRef}
            type="file"
            accept=".zip,application/zip"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void run(() => uploadBatchZip(f));
              e.target.value = '';
            }}
          />
        </div>
        {error && (
          <p className="mt-4 flex items-center gap-2 rounded-xl bg-rose-50 px-4 py-2.5 text-rose-800">
            <Icon name="alert" size={18} />
            {error}
          </p>
        )}
        {result?.skipped.length ? (
          <ul className="mt-4 space-y-1 rounded-xl bg-warm-50 px-4 py-3 text-sm text-warm-900">
            {result.skipped.map((s) => (
              <li key={s.packetName}>
                Skipped {s.packetName}: {s.reason}
              </li>
            ))}
          </ul>
        ) : null}
      </Card>

      {tiles.length > 0 && (
        <Card padded aria-live="polite">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <div className="text-overline font-bold uppercase text-ink-muted">Batch progress</div>
              <h2 className="mt-1 text-title font-bold text-navy-900">
                <span className="tabular-nums">{done.length}</span> of{' '}
                <span className="tabular-nums">{tiles.length}</span> packets screened
              </h2>
            </div>
            <div className="flex flex-wrap gap-2">
              {(Object.entries(counts) as [CaseStatus, number][]).map(([s, n]) => (
                <span
                  key={s}
                  className="flex items-center gap-2 rounded-xl border border-line bg-white px-3 py-1.5 text-sm text-ink-soft"
                >
                  <span className={`h-2.5 w-2.5 rounded-full ${STATUS_ACCENT[s]}`} />
                  {STATUS_LABEL[s]}:{' '}
                  <strong className="text-lg tabular-nums text-navy-900">{n}</strong>
                </span>
              ))}
            </div>
          </div>
          <div
            className="mt-4 h-3 overflow-hidden rounded-full bg-slate-100"
            role="progressbar"
            aria-valuenow={Math.round(pct)}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Batch progress"
          >
            <div
              className="h-full rounded-full bg-gradient-to-r from-teal-deep to-teal-accent transition-[width] duration-700 ease-out-expo"
              style={{ width: `${pct}%` }}
            />
          </div>
          <ul className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
            {tiles.map((t) => {
              const step = STAGE_ORDER.indexOf(t.stage);
              const finished = t.stage === 'done';
              return (
                <li key={t.caseId}>
                  <Link
                    to={`/cases/${t.caseId}`}
                    className={`relative block overflow-hidden rounded-xl border p-3.5 transition hover:-translate-y-0.5 hover:shadow-raised ${finished ? 'animate-flash border-line bg-white' : 'border-teal-accent/30 bg-teal-wash/60'}`}
                  >
                    {finished && t.status && (
                      <span
                        aria-hidden
                        className={`absolute inset-y-0 left-0 w-1 ${STATUS_ACCENT[t.status]}`}
                      />
                    )}
                    <div className="truncate font-semibold text-navy-900">{t.packetName}</div>
                    <div className="text-xs text-ink-muted">{t.reference}</div>
                    <div className="mt-2.5 flex gap-1" aria-label={`stage ${t.stage}`}>
                      {STAGE_ORDER.map((s, i) => (
                        <span
                          key={s}
                          className={`h-1.5 flex-1 rounded-full transition-colors duration-500 ${i <= step || finished ? 'bg-teal-accent' : 'bg-slate-200'} ${i === step && !finished ? 'animate-pulse' : ''}`}
                        />
                      ))}
                    </div>
                    <div className="mt-2.5 min-h-6">
                      {t.status && finished ? (
                        <StatusBadge status={t.status} />
                      ) : (
                        <span className="flex items-center gap-1.5 text-xs font-medium text-teal-darker">
                          <Spinner size={11} />
                          {STAGE_TEXT[t.stage] ?? `${t.stage}…`}
                        </span>
                      )}
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </div>
  );
}
