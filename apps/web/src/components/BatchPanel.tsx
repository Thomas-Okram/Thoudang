import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { uploadBatch, uploadBatchZip, type BatchResult, type CaseStatus } from '../lib/api';
import { STAGE_ORDER, type CaseProgress } from '../lib/progress';
import { STATUS_LABEL } from '../lib/labels';
import { StatusBadge } from './StatusBadge';

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

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-bold text-navy-900">Batch intake</h2>
        <p className="mt-1 text-slate-600">
          Choose a folder with <strong>one sub-folder per applicant</strong> (e.g.{' '}
          <code>batch/packet-01/…</code>), or a .zip with the same layout. Each sub-folder becomes
          one case.
        </p>
        <div className="mt-5 flex flex-wrap gap-3">
          <button
            disabled={busy}
            onClick={() => folderRef.current?.click()}
            className="rounded-lg bg-teal-accent px-5 py-3 font-bold text-white shadow-sm hover:brightness-110 disabled:bg-slate-300"
          >
            {busy ? 'Uploading…' : 'Choose folder'}
          </button>
          <button
            disabled={busy}
            onClick={() => zipRef.current?.click()}
            className="rounded-lg border border-slate-300 bg-white px-5 py-3 font-semibold text-navy-900 hover:bg-slate-50 disabled:opacity-50"
          >
            Upload .zip
          </button>
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
        {error && <p className="mt-4 rounded-lg bg-rose-50 px-4 py-2 text-rose-800">{error}</p>}
        {result?.skipped.length ? (
          <ul className="mt-4 space-y-1 text-sm text-amber-900">
            {result.skipped.map((s) => (
              <li key={s.packetName}>
                Skipped {s.packetName}: {s.reason}
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      {tiles.length > 0 && (
        <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h2 className="text-lg font-bold text-navy-900">
              {done.length} of {tiles.length} packets screened
            </h2>
            <div className="flex flex-wrap gap-3 text-sm text-slate-600">
              {(Object.entries(counts) as [CaseStatus, number][]).map(([s, n]) => (
                <span key={s}>
                  {STATUS_LABEL[s]}: <strong className="text-navy-900">{n}</strong>
                </span>
              ))}
            </div>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full bg-teal-accent transition-all"
              style={{ width: `${(done.length / tiles.length) * 100}%` }}
            />
          </div>
          <ul className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
            {tiles.map((t) => {
              const step = STAGE_ORDER.indexOf(t.stage);
              return (
                <li key={t.caseId}>
                  <Link
                    to={`/cases/${t.caseId}`}
                    className={`block rounded-lg border p-3 transition hover:shadow ${t.stage === 'done' ? 'border-slate-200 bg-white' : 'border-teal-accent/30 bg-teal-soft/20'}`}
                  >
                    <div className="truncate font-semibold text-navy-900">{t.packetName}</div>
                    <div className="text-xs text-slate-500">{t.reference}</div>
                    <div className="mt-2 flex gap-1" aria-label={`stage ${t.stage}`}>
                      {STAGE_ORDER.map((s, i) => (
                        <span
                          key={s}
                          className={`h-1.5 flex-1 rounded-full ${i <= step || t.stage === 'done' ? 'bg-teal-accent' : 'bg-slate-200'} ${i === step && t.stage !== 'done' ? 'animate-pulse' : ''}`}
                        />
                      ))}
                    </div>
                    <div className="mt-2 min-h-6">
                      {t.status && t.stage === 'done' ? (
                        <StatusBadge status={t.status} />
                      ) : (
                        <span className="text-xs text-slate-500">{t.stage}…</span>
                      )}
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
