import { useEffect, useRef, useState } from 'react';
import type { CaseFlag, Reason, Severity } from '../../lib/api';
import { DOC_SHORT } from '../../lib/highlight';

const GROUPS: { severity: Severity; title: string; dot: string; card: string }[] = [
  { severity: 'critical', title: 'Critical', dot: 'bg-rose-500', card: 'border-l-rose-500' },
  { severity: 'warn', title: 'Needs review', dot: 'bg-amber-500', card: 'border-l-amber-500' },
  { severity: 'info', title: 'For information', dot: 'bg-slate-400', card: 'border-l-slate-300' },
];

const ACTION_LABEL: Record<CaseFlag['action'], string> = {
  citizen: 'Citizen must correct',
  officer: 'Officer to review',
  none: 'For information',
};

const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLElement &&
  (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName));

export function FlagsPanel({
  flags,
  selectedId,
  onSelect,
  onResolve,
  canResolve,
  readOnlyReason,
  reasons,
}: {
  flags: CaseFlag[];
  selectedId: string | null;
  onSelect: (flag: CaseFlag) => void;
  onResolve: (
    flag: CaseFlag,
    decision: 'accept' | 'override' | 'reopen',
    reason?: { reasonCode: string; reasonText?: string },
  ) => Promise<void>;
  canResolve: boolean;
  readOnlyReason: string | null;
  reasons: Reason[];
}) {
  const [showInfo, setShowInfo] = useState(false);
  const [overriding, setOverriding] = useState<CaseFlag | null>(null);
  const ordered = GROUPS.flatMap((g) =>
    g.severity === 'info' && !showInfo ? [] : flags.filter((f) => f.severity === g.severity),
  );

  // Keyboard: J/K move between flags, A accepts, O opens the override dialog.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (overriding || isTyping(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      const key = e.key.toLowerCase();
      const idx = ordered.findIndex((f) => f.id === selectedId);
      if (key === 'j' || key === 'k') {
        if (!ordered.length) return;
        const next =
          key === 'j'
            ? Math.min(ordered.length - 1, idx + 1)
            : Math.max(0, idx === -1 ? 0 : idx - 1);
        onSelect(ordered[next]!);
        document
          .getElementById(`flag-${ordered[next]!.id}`)
          ?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
        e.preventDefault();
      }
      const current = ordered[idx];
      if (!current || !canResolve || current.severity === 'info') return;
      if (key === 'a' && current.resolution !== 'ACCEPTED') {
        void onResolve(current, 'accept');
        e.preventDefault();
      }
      if (key === 'o') {
        setOverriding(current);
        e.preventDefault();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ordered, selectedId, onSelect, onResolve, canResolve, overriding]);

  const open = flags.filter((f) => f.severity !== 'info' && f.resolution === 'OPEN').length;

  return (
    <section
      aria-labelledby="flags-title"
      className="rounded-xl border border-slate-200 bg-white shadow-sm"
    >
      <header className="flex items-baseline justify-between gap-3 border-b border-slate-100 px-5 py-3">
        <h2 id="flags-title" className="text-base font-bold text-navy-900">
          Flags{' '}
          <span className="ml-1 font-semibold text-slate-400">
            {flags.filter((f) => f.severity !== 'info').length}
          </span>
        </h2>
        <span className="text-xs text-slate-500">
          {open ? `${open} open` : 'All reviewed'} · <kbd className="font-mono">J</kbd>/
          <kbd className="font-mono">K</kbd> move · <kbd className="font-mono">A</kbd> accept ·{' '}
          <kbd className="font-mono">O</kbd> override
        </span>
      </header>
      {readOnlyReason && (
        <p className="border-b border-slate-100 bg-slate-50 px-5 py-2 text-xs text-slate-500">
          {readOnlyReason}
        </p>
      )}

      <div className="space-y-4 px-5 py-4">
        {!flags.length && (
          <div className="flex items-center gap-3 rounded-lg bg-emerald-50 px-4 py-3 text-emerald-900">
            <span className="text-xl" aria-hidden>
              ✓
            </span>
            Every check passed — nothing to review.
          </div>
        )}
        {GROUPS.map((g) => {
          const list = flags.filter((f) => f.severity === g.severity);
          if (!list.length) return null;
          const collapsed = g.severity === 'info' && !showInfo;
          return (
            <div key={g.severity}>
              <h3 className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-slate-500">
                <span className={`h-2 w-2 rounded-full ${g.dot}`} />
                {g.title} · {list.length}
                {g.severity === 'info' && (
                  <button
                    className="ml-auto text-xs font-semibold normal-case text-teal-deep hover:underline"
                    onClick={() => setShowInfo((s) => !s)}
                  >
                    {showInfo ? 'Hide' : 'Show'}
                  </button>
                )}
              </h3>
              {!collapsed && (
                <ul className="space-y-2">
                  {list.map((f) => (
                    <FlagCard
                      key={f.id}
                      flag={f}
                      accent={g.card}
                      selected={f.id === selectedId}
                      onSelect={() => onSelect(f)}
                      canResolve={canResolve}
                      onAccept={() => onResolve(f, 'accept')}
                      onOverride={() => setOverriding(f)}
                      onReopen={() => onResolve(f, 'reopen')}
                    />
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>

      {overriding && (
        <OverrideDialog
          flag={overriding}
          reasons={reasons}
          onCancel={() => setOverriding(null)}
          onConfirm={async (reason) => {
            await onResolve(overriding, 'override', reason);
            setOverriding(null);
          }}
        />
      )}
    </section>
  );
}

function FlagCard({
  flag,
  accent,
  selected,
  onSelect,
  canResolve,
  onAccept,
  onOverride,
  onReopen,
}: {
  flag: CaseFlag;
  accent: string;
  selected: boolean;
  onSelect: () => void;
  canResolve: boolean;
  onAccept: () => void;
  onOverride: () => void;
  onReopen: () => void;
}) {
  const resolved = flag.resolution !== 'OPEN';
  return (
    <li
      id={`flag-${flag.id}`}
      data-testid="flag"
      aria-selected={selected}
      onClick={onSelect}
      className={`cursor-pointer rounded-lg border border-l-4 border-slate-200 p-3.5 transition ${accent} ${
        selected ? 'bg-teal-soft/30 ring-2 ring-teal-accent' : 'hover:bg-slate-50'
      } ${flag.resolution === 'OVERRIDDEN' ? 'opacity-60' : ''}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold text-navy-900">{flag.title}</span>
        <span className="text-xs text-slate-500">· {ACTION_LABEL[flag.action]}</span>
        {flag.resolution === 'ACCEPTED' && (
          <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[11px] font-bold uppercase text-white">
            Accepted
          </span>
        )}
        {flag.resolution === 'OVERRIDDEN' && (
          <span className="rounded-full bg-teal-deep px-2 py-0.5 text-[11px] font-bold uppercase text-white">
            Overridden
          </span>
        )}
      </div>
      <p className="mt-1 text-sm leading-relaxed text-slate-700">{flag.reason}</p>

      {flag.evidence.some((e) => e.field !== 'document') && (
        <div
          className="mt-2 flex flex-wrap items-stretch gap-0 overflow-hidden rounded-md border border-slate-200 text-sm"
          data-testid="evidence"
        >
          {flag.evidence
            .filter((e) => e.field !== 'document')
            .map((e, i) => (
              <span
                key={i}
                className={`flex items-baseline gap-1.5 bg-white px-2.5 py-1 ${i ? 'border-l border-slate-200' : ''}`}
              >
                <span className="text-xs font-semibold text-slate-500">
                  {DOC_SHORT[e.document]}:
                </span>
                <span className="font-medium text-navy-900">
                  {e.value === null ? '—' : `“${String(e.value)}”`}
                </span>
                {e.confidence !== undefined && e.confidence < 0.75 && (
                  <span className="text-[11px] font-semibold text-amber-700">low confidence</span>
                )}
              </span>
            ))}
        </div>
      )}

      {resolved && flag.resolvedByName && (
        <p className="mt-2 text-xs text-slate-500">
          {flag.resolution === 'ACCEPTED' ? 'Accepted' : 'Overridden'} by {flag.resolvedByName}
          {flag.resolutionReason ? ` — ${flag.resolutionReason}` : ''}
        </p>
      )}

      {flag.severity !== 'info' && canResolve && (
        <div className="mt-3 flex gap-2" onClick={(e) => e.stopPropagation()}>
          {flag.resolution === 'OPEN' ? (
            <>
              <button
                onClick={onAccept}
                className="rounded-md border border-slate-300 bg-white px-3 py-1 text-sm font-semibold text-navy-900 hover:bg-slate-50"
              >
                Accept
              </button>
              <button
                onClick={onOverride}
                className="rounded-md border border-slate-300 bg-white px-3 py-1 text-sm font-semibold text-navy-900 hover:bg-slate-50"
              >
                Override…
              </button>
            </>
          ) : (
            <button
              onClick={onReopen}
              className="text-sm font-semibold text-teal-deep hover:underline"
            >
              Reopen
            </button>
          )}
        </div>
      )}
    </li>
  );
}

export function OverrideDialog({
  flag,
  reasons,
  onCancel,
  onConfirm,
}: {
  flag: CaseFlag;
  reasons: Reason[];
  onCancel: () => void;
  onConfirm: (r: { reasonCode: string; reasonText?: string }) => Promise<void>;
}) {
  const [code, setCode] = useState('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const first = useRef<HTMLInputElement>(null);
  useEffect(() => {
    first.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onCancel();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);
  const valid = code && (code !== 'other' || text.trim().length >= 3);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-navy-950/40 p-4"
      role="dialog"
      aria-modal
      aria-labelledby="override-title"
    >
      <form
        className="w-full max-w-lg rounded-xl bg-white p-6 shadow-2xl"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!valid) return;
          setBusy(true);
          setError(null);
          try {
            await onConfirm({ reasonCode: code, reasonText: text.trim() || undefined });
          } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not save');
            setBusy(false);
          }
        }}
      >
        <h2 id="override-title" className="text-lg font-bold text-navy-900">
          Override “{flag.title}”
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          The flag stays on record. Your reason is written to the audit trail.
        </p>
        <fieldset className="mt-4 space-y-1.5">
          <legend className="sr-only">Reason</legend>
          {reasons.map((r, i) => (
            <label
              key={r.code}
              className={`flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 text-sm ${code === r.code ? 'border-teal-accent bg-teal-soft/40' : 'border-slate-200 hover:bg-slate-50'}`}
            >
              <input
                ref={i === 0 ? first : undefined}
                type="radio"
                name="reason"
                value={r.code}
                checked={code === r.code}
                onChange={() => setCode(r.code)}
                className="accent-teal-accent"
              />
              {r.label}
            </label>
          ))}
        </fieldset>
        <label className="mt-3 block text-sm font-medium text-slate-700">
          {code === 'other' ? 'Explain (required)' : 'Note (optional)'}
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={2}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-accent"
          />
        </label>
        {error && <p className="mt-2 text-sm text-rose-700">{error}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg px-4 py-2 font-semibold text-slate-600 hover:bg-slate-100"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!valid || busy}
            className="rounded-lg bg-navy-900 px-4 py-2 font-semibold text-white hover:bg-navy-800 disabled:bg-slate-300"
          >
            {busy ? 'Saving…' : 'Override flag'}
          </button>
        </div>
      </form>
    </div>
  );
}
