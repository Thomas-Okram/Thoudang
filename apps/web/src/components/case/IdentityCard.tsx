import { useState } from 'react';
import type { Identity, IdentityPair, NameVerdict } from '../../lib/api';
import { Icon, type IconName } from '../ui/Icon';

export const VERDICT_LABEL: Record<NameVerdict, string> = {
  SAME: 'Same',
  LIKELY_SAME: 'Likely same',
  AMBIGUOUS: 'Ambiguous',
  DIFFERENT: 'Different',
};

export const VERDICT_STYLE: Record<NameVerdict, string> = {
  SAME: 'bg-emerald-100 text-emerald-900 ring-emerald-600/40',
  LIKELY_SAME: 'bg-teal-soft text-teal-darker ring-teal-accent/50',
  AMBIGUOUS: 'bg-warm-100 text-warm-900 ring-warm-500/60',
  DIFFERENT: 'bg-rose-100 text-rose-900 ring-rose-600/40',
};

const VERDICT_ICON: Record<NameVerdict, IconName> = {
  SAME: 'equal',
  LIKELY_SAME: 'approx',
  AMBIGUOUS: 'question',
  DIFFERENT: 'notEqual',
};

/** Left rule + tint for a whole comparison row. */
const VERDICT_ROW: Record<NameVerdict, string> = {
  SAME: 'border-l-emerald-500',
  LIKELY_SAME: 'border-l-teal-accent',
  AMBIGUOUS: 'border-l-warm-500 bg-warm-50/50',
  DIFFERENT: 'border-l-rose-500 bg-rose-50/40',
};

export function VerdictPill({
  verdict,
  score,
  size = 'md',
}: {
  verdict: NameVerdict;
  score?: number;
  size?: 'md' | 'lg';
}) {
  return (
    <span
      data-verdict={verdict}
      className={`inline-flex items-center whitespace-nowrap rounded-full font-bold uppercase tracking-wide ring-1 ring-inset ${VERDICT_STYLE[verdict]} ${
        size === 'lg' ? 'gap-2 px-3.5 py-1.5 text-[0.85rem]' : 'gap-1.5 px-2.5 py-1 text-[0.75rem]'
      }`}
    >
      <Icon name={VERDICT_ICON[verdict]} size={size === 'lg' ? 17 : 14} strokeWidth={2.6} />
      {VERDICT_LABEL[verdict]}
      {score !== undefined && (
        <span className="rounded-full bg-white/70 px-1.5 font-mono font-semibold tabular-nums">
          {score}
        </span>
      )}
    </span>
  );
}

function overall(pairs: IdentityPair[]): { verdict: NameVerdict; text: string } {
  if (!pairs.length)
    return { verdict: 'AMBIGUOUS', text: 'Only one document carries a name — nothing to compare.' };
  const worst = (['DIFFERENT', 'AMBIGUOUS', 'LIKELY_SAME', 'SAME'] as const).find((v) =>
    pairs.some((p) => p.verdict === v),
  )!;
  const n = pairs.filter((p) => p.verdict === worst).length;
  const text = {
    SAME: 'Every document names the same person.',
    LIKELY_SAME: 'Same person — minor spelling or optional-part differences.',
    AMBIGUOUS: `${n} comparison${n > 1 ? 's need' : ' needs'} an officer’s confirmation.`,
    DIFFERENT: `${n} comparison${n > 1 ? 's' : ''} point${n > 1 ? '' : 's'} to a different person.`,
  }[worst];
  return { verdict: worst, text };
}

const SUMMARY_TONE: Record<NameVerdict, string> = {
  SAME: 'bg-emerald-50 text-emerald-900',
  LIKELY_SAME: 'bg-teal-wash text-teal-darker',
  AMBIGUOUS: 'bg-warm-50 text-warm-900',
  DIFFERENT: 'bg-rose-50 text-rose-900',
};

export function IdentityCard({
  identity,
  onHover,
}: {
  identity: Identity;
  /** Hover a name → outline it on the document image. */
  onHover?: (entry: { documentId: string; field: string } | null) => void;
}) {
  const label = (key: string) => identity.entries.find((e) => e.key === key)?.label ?? key;
  const summary = overall(identity.pairs);

  return (
    <section
      aria-labelledby="identity-title"
      className="overflow-hidden rounded-card border border-navy-900/15 bg-surface shadow-raised"
    >
      <header className="relative flex items-center justify-between gap-3 overflow-hidden bg-navy-900 bg-[radial-gradient(90%_140%_at_100%_0%,#1b4a7a_0%,transparent_60%)] px-6 py-4 text-white">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-teal-accent/20 text-teal-soft">
            <Icon name="users" size={21} />
          </span>
          <div>
            <h2 id="identity-title" className="text-lg font-bold tracking-tight">
              Identity across documents
            </h2>
            <p className="text-[0.8rem] text-slate-300">
              Manipur-aware name engine · rules, not AI · every verdict explained
            </p>
          </div>
        </div>
        <VerdictPill verdict={summary.verdict} size="lg" />
      </header>

      <p
        className={`flex items-center gap-2.5 px-6 py-3 text-[0.98rem] font-semibold ${SUMMARY_TONE[summary.verdict]}`}
      >
        <Icon name={VERDICT_ICON[summary.verdict]} size={18} strokeWidth={2.6} />
        {summary.text}
      </p>

      <div className="px-6 pb-5 pt-4">
        <h3 className="text-overline font-bold uppercase text-ink-muted">Names as written</h3>
        <ul className="mt-2 grid gap-2 sm:grid-cols-2" aria-label="Names as written">
          {identity.entries.map((e) => (
            <li
              key={e.key}
              className="group cursor-default rounded-xl border border-line bg-slate-50/60 px-3.5 py-2.5 transition hover:border-teal-accent/60 hover:bg-teal-wash"
              onMouseEnter={() => onHover?.({ documentId: e.documentId, field: e.field })}
              onMouseLeave={() => onHover?.(null)}
            >
              <span className="flex items-center gap-1.5 text-overline font-bold uppercase text-ink-muted group-hover:text-teal-darker">
                {e.label}
                <Icon
                  name="eye"
                  size={13}
                  className="opacity-0 transition-opacity group-hover:opacity-100"
                />
              </span>
              <span
                className="mt-0.5 block text-[1.08rem] font-semibold leading-snug text-navy-900"
                data-testid="name-as-written"
              >
                “{e.value}”
              </span>
            </li>
          ))}
          {!identity.entries.length && (
            <li className="rounded-xl border border-dashed border-line-strong px-3.5 py-3 text-sm text-ink-muted sm:col-span-2">
              No names could be read from the documents.
            </li>
          )}
        </ul>

        {identity.pairs.length > 0 && (
          <>
            <h3 className="mt-5 text-overline font-bold uppercase text-ink-muted">Comparisons</h3>
            <ul className="mt-2 space-y-2" aria-label="Pairwise comparisons">
              {identity.pairs.map((p) => (
                <PairRow key={`${p.a}-${p.b}`} pair={p} a={label(p.a)} b={label(p.b)} />
              ))}
            </ul>
          </>
        )}
        {identity.knownYumnaks.length > 0 && (
          <p className="mt-4 flex items-start gap-2 rounded-xl bg-navy-50 px-3.5 py-2.5 text-sm text-ink-soft">
            <Icon name="info" size={17} className="mt-0.5 text-navy-500" />
            <span>
              Relative’s full yumnak in packet:{' '}
              <strong className="text-navy-900">{identity.knownYumnaks.join(', ')}</strong> — used
              to resolve abbreviations.
            </span>
          </p>
        )}
      </div>
    </section>
  );
}

function PairRow({ pair, a, b }: { pair: IdentityPair; a: string; b: string }) {
  const [open, setOpen] = useState(pair.verdict === 'AMBIGUOUS' || pair.verdict === 'DIFFERENT');
  // Short reasons from the name engine; older cached cases only have the long ones.
  const short = pair.points?.length ? pair.points : null;
  const moreDetail = short !== null && pair.reasons.join('\n') !== short.join('\n');
  return (
    <li
      className={`overflow-hidden rounded-xl border border-l-4 border-line ${VERDICT_ROW[pair.verdict]}`}
      data-testid="identity-pair"
    >
      <button
        className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-navy-50/60"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-2 text-[0.95rem] font-medium text-ink-soft">
            {a} <Icon name="arrowsLR" size={15} className="text-ink-muted" /> {b}
          </span>
          {pair.headline && (
            <span
              className="mt-0.5 block text-[0.85rem] leading-snug text-ink-muted"
              data-testid="pair-headline"
            >
              {pair.headline}
            </span>
          )}
        </span>
        <VerdictPill verdict={pair.verdict} score={pair.score} />
        <span className="flex w-14 items-center justify-end gap-0.5 text-sm font-semibold text-teal-deep">
          {open ? 'Hide' : 'Why'}
          <Icon
            name="chevronDown"
            size={15}
            className={`transition-transform ${open ? 'rotate-180' : ''}`}
          />
        </span>
      </button>
      {open && (
        <div className="animate-enter border-t border-line bg-white/80 px-4 py-3">
          {pair.candidates.length > 0 && (
            <div className="mb-3 flex flex-wrap items-center gap-2" aria-label="Candidate yumnaks">
              <span className="text-sm font-bold text-warm-900">Could be:</span>
              {pair.candidates.map((c) => (
                <span
                  key={c}
                  className="rounded-lg border-2 border-dashed border-warm-400 bg-warm-50 px-3 py-1 text-[0.95rem] font-bold text-navy-900"
                >
                  {c}
                </span>
              ))}
            </div>
          )}
          <ul className="space-y-1.5 text-[0.95rem] leading-snug text-ink-soft">
            {(short ?? pair.reasons).map((r, i) => (
              <li key={i} className="flex gap-2">
                <span
                  aria-hidden
                  className="mt-[0.55em] h-1.5 w-1.5 shrink-0 rounded-full bg-navy-400"
                />
                {r}
              </li>
            ))}
          </ul>
          {moreDetail && (
            <details className="group/full mt-2.5">
              <summary className="inline-flex cursor-pointer list-none items-center gap-1 rounded-md text-sm font-semibold text-teal-deep hover:text-teal-darker [&::-webkit-details-marker]:hidden">
                <Icon
                  name="chevronRight"
                  size={14}
                  className="transition-transform group-open/full:rotate-90"
                />
                Full reasoning
              </summary>
              <ul className="mt-1.5 space-y-1 border-l-2 border-line pl-3 text-sm leading-snug text-ink-muted">
                {pair.reasons.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </li>
  );
}
