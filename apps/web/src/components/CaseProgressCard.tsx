import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import type { CaseProgress, DocProgress } from '../lib/progress';
import { STAGE_ORDER } from '../lib/progress';
import { DOC_LABEL } from '../lib/labels';
import { StatusBadge } from './StatusBadge';

const STEPS = [
  { stage: 'uploaded', label: 'Uploaded' },
  { stage: 'classifying', label: 'Identifying documents' },
  { stage: 'extracting', label: 'Reading fields' },
  { stage: 'screening', label: 'Checking rules' },
  { stage: 'done', label: 'Sorted into queue' },
] as const;

function StepIcon({ state }: { state: 'done' | 'active' | 'pending' }) {
  if (state === 'done') {
    return (
      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-teal-accent text-white shadow-sm">
        <svg viewBox="0 0 20 20" className="h-4 w-4" fill="currentColor" aria-hidden>
          <path d="M7.6 13.2 4.4 10l-1.2 1.2 4.4 4.4 9.2-9.2-1.2-1.2z" />
        </svg>
      </span>
    );
  }
  if (state === 'active') {
    return (
      <span className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-teal-accent bg-white">
        <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-teal-accent border-t-transparent" />
      </span>
    );
  }
  return <span className="h-7 w-7 rounded-full border-2 border-slate-300 bg-white" />;
}

function DocChip({ d }: { d: DocProgress }) {
  const busy = d.stage === 'classifying' || d.stage === 'extracting';
  const tone =
    d.stage === 'failed'
      ? 'border-rose-300 bg-rose-50 text-rose-800'
      : d.stage === 'skipped'
        ? 'border-slate-200 bg-slate-50 text-slate-500'
        : d.stage === 'extracted'
          ? 'border-teal-accent/40 bg-teal-soft/60 text-navy-900'
          : 'border-slate-200 bg-white text-slate-700';
  return (
    <li
      className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm ${tone}`}
      title={d.message}
    >
      {busy && (
        <span className="h-3 w-3 animate-spin rounded-full border-2 border-teal-accent border-t-transparent" />
      )}
      <span className="font-medium">{d.type ? DOC_LABEL[d.type] : d.name}</span>
      {d.type && <span className="text-xs text-slate-500">{d.name}</span>}
      {d.stage === 'failed' && <span className="text-xs font-semibold">needs manual review</span>}
      {d.cacheHit && (
        <span className="rounded bg-slate-200 px-1.5 text-[11px] font-semibold text-slate-600">
          cached
        </span>
      )}
    </li>
  );
}

export function CaseProgressCard({ c }: { c: CaseProgress }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (c.finishedAt) return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [c.finishedAt]);
  const elapsed = (((c.finishedAt ?? now) - c.startedAt) / 1000).toFixed(1);
  const current = STAGE_ORDER.indexOf(c.stage);
  const docs = Object.values(c.docs);

  return (
    <article className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-lg font-bold text-navy-900">{c.reference}</div>
          {c.packetName && <div className="text-sm text-slate-500">{c.packetName}</div>}
        </div>
        <div className="flex items-center gap-3">
          <span className="font-mono text-sm tabular-nums text-slate-500">{elapsed}s</span>
          {c.stage === 'done' && c.status && <StatusBadge status={c.status} />}
        </div>
      </header>

      <ol className="mt-5 grid grid-cols-5 gap-2">
        {STEPS.map((s, i) => {
          const state =
            i < current || c.stage === 'done' ? 'done' : i === current ? 'active' : 'pending';
          return (
            <li key={s.stage} className="flex flex-col items-center text-center">
              <div className="flex w-full items-center">
                <span
                  className={`h-0.5 flex-1 ${i === 0 ? 'invisible' : i <= current ? 'bg-teal-accent' : 'bg-slate-200'}`}
                />
                <StepIcon state={state} />
                <span
                  className={`h-0.5 flex-1 ${i === STEPS.length - 1 ? 'invisible' : i < current ? 'bg-teal-accent' : 'bg-slate-200'}`}
                />
              </div>
              <span
                className={`mt-2 text-sm ${state === 'pending' ? 'text-slate-400' : 'font-medium text-navy-900'}`}
              >
                {s.label}
              </span>
            </li>
          );
        })}
      </ol>

      {docs.length > 0 && (
        <ul className="mt-5 flex flex-wrap gap-2">
          {docs.map((d) => (
            <DocChip key={d.id} d={d} />
          ))}
        </ul>
      )}

      {c.stage === 'done' && (
        <div className="mt-5 flex justify-end">
          <Link
            to={`/cases/${c.caseId}`}
            className="rounded-lg bg-navy-900 px-4 py-2 font-semibold text-white hover:bg-navy-800"
          >
            Open case →
          </Link>
        </div>
      )}
    </article>
  );
}
