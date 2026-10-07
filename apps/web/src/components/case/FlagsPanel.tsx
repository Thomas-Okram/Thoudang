import { useEffect, useState } from 'react';
import type { CaseDocument, CaseFlag, FlagEvidence, Reason, Severity } from '../../lib/api';
import { DOC_SHORT, documentFor, wireField } from '../../lib/highlight';
import { Icon, type IconName } from '../ui/Icon';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';

/** Show evidence as written on the document (raw extraction), falling back to the rule value. */
function asWritten(e: FlagEvidence, documents: CaseDocument[]): string | null {
  const field = wireField(e);
  const raw = field ? documentFor(e, documents)?.extraction?.fields[field]?.value : undefined;
  if (raw !== undefined && raw !== null && e.field !== 'aadhaarLast4' && e.field !== 'last4')
    return raw;
  return e.value === null ? null : String(e.value);
}

const GROUPS: {
  severity: Severity;
  title: string;
  dot: string;
  card: string;
  icon: IconName;
  iconTone: string;
}[] = [
  {
    severity: 'critical',
    title: 'Critical',
    dot: 'bg-rose-600',
    card: 'border-l-rose-600',
    icon: 'alert',
    iconTone: 'bg-rose-50 text-rose-700',
  },
  {
    severity: 'warn',
    title: 'Needs review',
    dot: 'bg-warm-500',
    card: 'border-l-warm-500',
    icon: 'eye',
    iconTone: 'bg-warm-50 text-warm-700',
  },
  {
    severity: 'info',
    title: 'For information',
    dot: 'bg-slate-400',
    card: 'border-l-slate-300',
    icon: 'info',
    iconTone: 'bg-slate-100 text-slate-600',
  },
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
  documents = [],
  selectedId,
  onSelect,
  onResolve,
  canResolve,
  readOnlyReason,
  reasons,
}: {
  flags: CaseFlag[];
  documents?: CaseDocument[];
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
      className="rounded-card border border-line bg-surface shadow-card"
    >
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-6 py-4">
        <h2 id="flags-title" className="flex items-center gap-2.5 text-lg font-bold text-navy-900">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-navy-50 text-navy-700">
            <Icon name="alert" size={19} />
          </span>
          Flags{' '}
          <span className="rounded-full bg-slate-100 px-2 text-[0.9rem] font-bold tabular-nums text-ink-soft">
            {flags.filter((f) => f.severity !== 'info').length}
          </span>
          <span
            className={`ml-1 rounded-full px-2.5 py-0.5 text-[0.78rem] font-semibold ${open ? 'bg-warm-50 text-warm-900' : 'bg-emerald-50 text-emerald-800'}`}
          >
            {open ? `${open} open` : 'All reviewed'}
          </span>
        </h2>
        <span className="dev-noise flex items-center gap-1.5 text-xs text-ink-muted">
          <kbd>J</kbd>/<kbd>K</kbd> move · <kbd>A</kbd> accept · <kbd>O</kbd> override
        </span>
      </header>
      {readOnlyReason && (
        <p className="flex items-center gap-2 border-b border-line bg-slate-50 px-6 py-2.5 text-sm text-ink-muted">
          <Icon name="lock" size={15} />
          {readOnlyReason}
        </p>
      )}

      <div className="space-y-5 px-6 py-5">
        {!flags.length && (
          <div className="flex items-center gap-3 rounded-xl bg-emerald-50 px-4 py-3.5 font-medium text-emerald-900">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-700 text-white">
              <Icon name="check" size={18} strokeWidth={2.8} />
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
              <h3 className="mb-2.5 flex items-center gap-2 text-overline font-bold uppercase text-ink-muted">
                <span className={`h-2.5 w-2.5 rounded-full ${g.dot}`} />
                {g.title} · {list.length}
                {g.severity === 'info' && (
                  <button
                    className="ml-auto rounded-md px-2 py-0.5 text-xs font-semibold normal-case tracking-normal text-teal-deep hover:bg-teal-wash"
                    onClick={() => setShowInfo((s) => !s)}
                  >
                    {showInfo ? 'Hide' : 'Show'}
                  </button>
                )}
              </h3>
              {!collapsed && (
                <ul className="space-y-2.5">
                  {list.map((f) => (
                    <FlagCard
                      key={f.id}
                      flag={f}
                      documents={documents}
                      accent={g.card}
                      icon={g.icon}
                      iconTone={g.iconTone}
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
  documents,
  accent,
  icon,
  iconTone,
  selected,
  onSelect,
  canResolve,
  onAccept,
  onOverride,
  onReopen,
}: {
  flag: CaseFlag;
  documents: CaseDocument[];
  accent: string;
  icon: IconName;
  iconTone: string;
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
      className={`group cursor-pointer rounded-xl border border-l-4 p-4 transition-all duration-200 ${accent} ${
        selected
          ? 'border-teal-accent bg-teal-wash shadow-raised ring-2 ring-teal-accent'
          : 'border-line bg-white hover:border-navy-200 hover:shadow-card'
      } ${flag.resolution === 'OVERRIDDEN' ? 'opacity-60' : ''}`}
    >
      <div className="flex items-start gap-3">
        <span
          className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${iconTone}`}
        >
          <Icon name={icon} size={17} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[1.02rem] font-semibold text-navy-900">{flag.title}</span>
            <span
              className={`rounded-full px-2 py-0.5 text-[0.72rem] font-semibold ${
                flag.action === 'citizen'
                  ? 'bg-warm-50 text-warm-900'
                  : flag.action === 'officer'
                    ? 'bg-indigo-50 text-indigo-900'
                    : 'bg-slate-100 text-slate-700'
              }`}
            >
              {ACTION_LABEL[flag.action]}
            </span>
            {flag.resolution === 'ACCEPTED' && (
              <span className="flex items-center gap-1 rounded-full bg-slate-800 px-2 py-0.5 text-[11px] font-bold uppercase text-white">
                <Icon name="check" size={11} strokeWidth={3} />
                Accepted
              </span>
            )}
            {flag.resolution === 'OVERRIDDEN' && (
              <span className="rounded-full bg-teal-deep px-2 py-0.5 text-[11px] font-bold uppercase text-white">
                Overridden
              </span>
            )}
            {selected && (
              <span className="ml-auto flex items-center gap-1 text-xs font-semibold text-teal-darker">
                <Icon name="eye" size={14} />
                shown on document
              </span>
            )}
          </div>
          <p className="mt-1 text-[0.95rem] leading-relaxed text-ink-soft">{flag.reason}</p>

          {flag.evidence.some((e) => e.field !== 'document') && (
            <div
              className="mt-2.5 flex flex-wrap items-stretch gap-0 overflow-hidden rounded-lg border border-line bg-white text-[0.92rem]"
              data-testid="evidence"
            >
              {flag.evidence
                .filter((e) => e.field !== 'document')
                .map((e, i) => (
                  <span
                    key={i}
                    className={`flex items-baseline gap-1.5 px-3 py-1.5 ${i ? 'border-l border-line' : ''}`}
                  >
                    <span className="text-xs font-bold uppercase tracking-wide text-ink-muted">
                      {DOC_SHORT[e.document]}:
                    </span>
                    <span className="font-semibold text-navy-900">
                      {(() => {
                        const v = asWritten(e, documents);
                        return v === null ? '—' : `“${v}”`;
                      })()}
                    </span>
                    {e.confidence !== undefined && e.confidence < 0.75 && (
                      <span className="text-[11px] font-semibold text-warm-700">low confidence</span>
                    )}
                  </span>
                ))}
            </div>
          )}

          {resolved && flag.resolvedByName && (
            <p className="mt-2 text-sm text-ink-muted">
              {flag.resolution === 'ACCEPTED' ? 'Accepted' : 'Overridden'} by {flag.resolvedByName}
              {flag.resolutionReason ? ` — ${flag.resolutionReason}` : ''}
            </p>
          )}

          {flag.severity !== 'info' && canResolve && (
            <div className="mt-3 flex gap-2" onClick={(e) => e.stopPropagation()}>
              {flag.resolution === 'OPEN' ? (
                <>
                  <Button size="sm" icon="check" onClick={onAccept}>
                    Accept
                  </Button>
                  <Button size="sm" icon="note" onClick={onOverride}>
                    Override…
                  </Button>
                </>
              ) : (
                <Button size="sm" variant="ghost" icon="refresh" onClick={onReopen}>
                  Reopen
                </Button>
              )}
            </div>
          )}
        </div>
      </div>
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
  const valid = code && (code !== 'other' || text.trim().length >= 3);

  return (
    <Dialog
      title={`Override “${flag.title}”`}
      description="The flag stays on record. Your reason is written to the audit trail."
      icon="note"
      onClose={onCancel}
    >
      <form
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
        <fieldset className="space-y-2">
          <legend className="sr-only">Reason</legend>
          {reasons.map((r) => (
            <label
              key={r.code}
              className={`flex cursor-pointer items-center gap-3 rounded-xl border px-3.5 py-2.5 text-[0.95rem] transition ${code === r.code ? 'border-teal-accent bg-teal-wash font-semibold text-navy-900' : 'border-line hover:bg-slate-50'}`}
            >
              <input
                type="radio"
                name="reason"
                value={r.code}
                checked={code === r.code}
                onChange={() => setCode(r.code)}
                className="h-4 w-4 accent-teal-deep"
              />
              {r.label}
            </label>
          ))}
        </fieldset>
        <label className="mt-4 block text-sm font-semibold text-ink-soft">
          {code === 'other' ? 'Explain (required)' : 'Note (optional)'}
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={2}
            className="mt-1.5 w-full rounded-control border border-line-strong px-3 py-2 text-[0.95rem] font-normal focus:border-teal-accent focus:outline-none focus:ring-2 focus:ring-teal-accent/40"
          />
        </label>
        {error && <p className="mt-2 text-sm text-rose-700">{error}</p>}
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant="navy"
            disabled={!valid}
            loading={busy}
            loadingLabel="Saving…"
          >
            Override flag
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
