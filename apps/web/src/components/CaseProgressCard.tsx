import { useEffect, useState } from 'react';
import type { CaseProgress, DocProgress } from '../lib/progress';
import { STAGE_ORDER } from '../lib/progress';
import { DOC_LABEL, STATUS_ACCENT, STATUS_LABEL } from '../lib/labels';
import { StatusBadge } from './StatusBadge';
import { ProgressSteps } from './ui/ProgressSteps';
import { ButtonLink } from './ui/Button';
import { Icon } from './ui/Icon';
import { Spinner } from './ui/Spinner';

const LABELS = {
  uploaded: 'Uploaded',
  classifying: 'Identifying documents',
  extracting: 'Reading fields',
  screening: 'Checking rules',
  done: 'Sorted into queue',
} as const;

function DocChip({ d: raw, reading }: { d: DocProgress; reading: boolean }) {
  // Until the paced stepper reaches "Reading fields", show finished docs as not yet read.
  const d: DocProgress = !reading && raw.stage === 'extracted' ? { ...raw, stage: 'classified' } : raw;
  const busy = d.stage === 'classifying' || d.stage === 'extracting';
  const tone =
    d.stage === 'failed'
      ? 'border-warm-400/60 bg-warm-50 text-warm-900'
      : d.stage === 'skipped'
        ? 'border-line bg-slate-50 text-ink-muted'
        : d.stage === 'extracted'
          ? 'border-teal-accent/40 bg-teal-wash text-navy-900'
          : 'border-line bg-white text-ink-soft';
  return (
    <li
      className={`flex animate-enter items-center gap-2 rounded-xl border px-3 py-2 text-sm transition-colors duration-300 ${tone}`}
      title={d.message}
    >
      <span className="flex h-5 w-5 items-center justify-center">
        {busy ? (
          <Spinner size={15} className="text-teal-deep" />
        ) : d.stage === 'extracted' ? (
          <span className="flex h-5 w-5 animate-pop items-center justify-center rounded-full bg-teal-deep text-white">
            <Icon name="check" size={12} strokeWidth={3.2} />
          </span>
        ) : d.stage === 'failed' ? (
          <Icon name="alert" size={17} className="text-warm-700" />
        ) : (
          <Icon name="image" size={17} className="text-ink-muted" />
        )}
      </span>
      <span className="font-semibold">{d.type ? DOC_LABEL[d.type] : d.name}</span>
      {d.type && <span className="dev-noise text-xs text-ink-muted">{d.name}</span>}
      {d.stage === 'failed' && <span className="text-xs font-semibold">needs manual review</span>}
      {d.cacheHit && (
        <span className="dev-noise rounded bg-slate-200 px-1.5 text-[11px] font-semibold text-slate-700">
          cached
        </span>
      )}
    </li>
  );
}

const STEP_MS = 420;
const reducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/**
 * Display pacing: the visual stepper advances at most one stage per STEP_MS, so a cached
 * (instant) run still reads as five confident ticks. Real timings are shown unchanged.
 */
function usePacedStep(target: number): number {
  const [shown, setShown] = useState(() => (reducedMotion() ? target : 0));
  useEffect(() => {
    if (shown >= target) return;
    const t = setTimeout(() => setShown((s) => Math.min(target, s + 1)), STEP_MS);
    return () => clearTimeout(t);
  }, [shown, target]);
  return Math.min(shown, target);
}

export function CaseProgressCard({ c }: { c: CaseProgress }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (c.finishedAt) return;
    const t = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(t);
  }, [c.finishedAt]);
  const elapsed = (((c.finishedAt ?? now) - c.startedAt) / 1000).toFixed(1);
  const actual = STAGE_ORDER.indexOf(c.stage);
  // "done" is itself a step: pace one extra tick so the final stage visibly completes.
  const paced = usePacedStep(c.stage === 'done' ? actual + 1 : actual);
  const done = c.stage === 'done' && paced > actual;
  const current = Math.min(paced, actual);
  const docs = Object.values(c.docs);
  const identified = docs.filter((d) => d.type || d.stage !== 'classifying').length;
  const read = docs.filter((d) => ['extracted', 'failed', 'skipped'].includes(d.stage)).length;

  const steps = STAGE_ORDER.map((stage) => ({
    key: stage,
    label: LABELS[stage as keyof typeof LABELS],
    detail:
      stage === 'uploaded' && docs.length
        ? `${docs.length} image${docs.length === 1 ? '' : 's'}`
        : stage === 'classifying' && docs.length && current >= 1
          ? `${identified} of ${docs.length} identified`
          : stage === 'extracting' && docs.length && current >= 2
            ? `${read} of ${docs.length} read`
            : stage === 'screening' && current >= 3
              ? 'rules + name engine'
              : stage === 'done' && done && c.status
                ? STATUS_LABEL[c.status]
                : undefined,
  }));

  return (
    <article
      className={`animate-enter overflow-hidden rounded-card border bg-surface shadow-raised transition-colors duration-500 ${done ? 'border-teal-accent/40' : 'border-line'}`}
      aria-live="polite"
    >
      <header className="flex flex-wrap items-center justify-between gap-3 px-6 pt-5">
        <div className="flex items-center gap-3">
          <span
            className={`flex h-10 w-10 items-center justify-center rounded-xl ${done ? 'bg-teal-wash text-teal-deep' : 'bg-navy-50 text-navy-700'}`}
          >
            <Icon name={done ? 'check' : 'sparkle'} size={20} strokeWidth={done ? 2.6 : 1.8} />
          </span>
          <div>
            <div className="text-lg font-bold tracking-tight text-navy-900">{c.reference}</div>
            <div className="text-sm text-ink-muted">
              {c.packetName ?? (done ? 'Screening complete' : 'Screening in progress…')}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <span
            className="flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1 font-mono text-[0.95rem] font-semibold tabular-nums text-navy-900"
            aria-label={`Elapsed ${elapsed} seconds`}
          >
            <Icon name="clock" size={16} className="text-ink-muted" />
            {elapsed}s
          </span>
          {done && c.status && <StatusBadge status={c.status} large />}
        </div>
      </header>

      <div className="px-4 pb-2 pt-6">
        <ProgressSteps steps={steps} current={current} complete={done} label="Screening progress" />
      </div>

      {docs.length > 0 && (
        <ul className="flex flex-wrap gap-2 px-6 pb-5 pt-3" aria-label="Documents">
          {docs.map((d) => (
            <DocChip key={d.id} d={d} reading={current >= 2 || done} />
          ))}
        </ul>
      )}

      {done && (
        <div className="flex animate-enter flex-wrap items-center justify-between gap-3 border-t border-line bg-slate-50/80 px-6 py-4">
          <div className="flex items-center gap-3 text-[0.95rem] text-ink-soft">
            {c.status && (
              <span aria-hidden className={`h-3 w-3 rounded-full ${STATUS_ACCENT[c.status]}`} />
            )}
            Sorted in <strong className="tabular-nums text-navy-900">{elapsed} s</strong> — the
            officer decides from here.
          </div>
          <ButtonLink to={`/cases/${c.caseId}`} variant="navy" iconRight="arrowRight">
            Open case
          </ButtonLink>
        </div>
      )}
    </article>
  );
}
