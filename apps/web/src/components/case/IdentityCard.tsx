import { useState } from 'react';
import type { Identity, IdentityPair, NameVerdict } from '../../lib/api';

export const VERDICT_LABEL: Record<NameVerdict, string> = {
  SAME: 'Same',
  LIKELY_SAME: 'Likely same',
  AMBIGUOUS: 'Ambiguous',
  DIFFERENT: 'Different',
};

export const VERDICT_STYLE: Record<NameVerdict, string> = {
  SAME: 'bg-emerald-100 text-emerald-900 ring-emerald-600/30',
  LIKELY_SAME: 'bg-teal-soft text-teal-deep ring-teal-accent/40',
  AMBIGUOUS: 'bg-amber-100 text-amber-900 ring-amber-500/40',
  DIFFERENT: 'bg-rose-100 text-rose-900 ring-rose-600/30',
};

export function VerdictPill({ verdict, score }: { verdict: NameVerdict; score?: number }) {
  return (
    <span
      data-verdict={verdict}
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-bold uppercase tracking-wide ring-1 ring-inset ${VERDICT_STYLE[verdict]}`}
    >
      {VERDICT_LABEL[verdict]}
      {score !== undefined && <span className="font-mono font-semibold opacity-70">{score}</span>}
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
      className="overflow-hidden rounded-xl border border-navy-800/20 bg-white shadow-sm ring-1 ring-navy-900/5"
    >
      <header className="flex items-start justify-between gap-3 bg-gradient-to-r from-navy-900 to-navy-700 px-5 py-3.5 text-white">
        <div>
          <h2 id="identity-title" className="text-base font-bold tracking-tight">
            Identity across documents
          </h2>
          <p className="text-xs text-slate-300">
            Manipur-aware name engine · rules, not AI · every verdict explained
          </p>
        </div>
        <VerdictPill verdict={summary.verdict} />
      </header>

      <div className="px-5 pb-4 pt-3">
        <p className="text-sm text-slate-600">{summary.text}</p>

        <ul
          className="mt-3 divide-y divide-slate-100 rounded-lg border border-slate-200"
          aria-label="Names as written"
        >
          {identity.entries.map((e) => (
            <li
              key={e.key}
              className="flex items-baseline justify-between gap-4 px-3 py-2 hover:bg-teal-soft/30"
              onMouseEnter={() => onHover?.({ documentId: e.documentId, field: e.field })}
              onMouseLeave={() => onHover?.(null)}
            >
              <span className="w-32 shrink-0 text-xs font-semibold uppercase tracking-wide text-slate-500">
                {e.label}
              </span>
              <span
                className="flex-1 text-right font-medium text-navy-900"
                data-testid="name-as-written"
              >
                “{e.value}”
              </span>
            </li>
          ))}
          {!identity.entries.length && (
            <li className="px-3 py-3 text-sm text-slate-500">
              No names could be read from the documents.
            </li>
          )}
        </ul>

        {identity.pairs.length > 0 && (
          <ul className="mt-3 space-y-2" aria-label="Pairwise comparisons">
            {identity.pairs.map((p) => (
              <PairRow key={`${p.a}-${p.b}`} pair={p} a={label(p.a)} b={label(p.b)} />
            ))}
          </ul>
        )}
        {identity.knownYumnaks.length > 0 && (
          <p className="mt-3 text-xs text-slate-500">
            Relative’s full yumnak in packet:{' '}
            <strong className="text-navy-900">{identity.knownYumnaks.join(', ')}</strong> — used to
            resolve abbreviations.
          </p>
        )}
      </div>
    </section>
  );
}

function PairRow({ pair, a, b }: { pair: IdentityPair; a: string; b: string }) {
  const [open, setOpen] = useState(pair.verdict === 'AMBIGUOUS' || pair.verdict === 'DIFFERENT');
  return (
    <li className="rounded-lg border border-slate-200" data-testid="identity-pair">
      <button
        className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="flex-1 text-slate-700">
          {a} <span className="text-slate-400">↔</span> {b}
        </span>
        <VerdictPill verdict={pair.verdict} score={pair.score} />
        <span className="w-10 text-right text-xs font-semibold text-teal-deep">
          {open ? 'Hide' : 'Why'}
        </span>
      </button>
      {open && (
        <div className="border-t border-slate-100 bg-slate-50/70 px-3 py-2.5">
          {pair.candidates.length > 0 && (
            <div
              className="mb-2 flex flex-wrap items-center gap-1.5"
              aria-label="Candidate yumnaks"
            >
              <span className="text-xs font-semibold text-amber-900">Could be:</span>
              {pair.candidates.map((c) => (
                <span
                  key={c}
                  className="rounded-md bg-white px-2 py-0.5 text-xs font-semibold text-navy-900 ring-1 ring-amber-400/60"
                >
                  {c}
                </span>
              ))}
            </div>
          )}
          <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">
            {pair.reasons.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </div>
      )}
    </li>
  );
}
