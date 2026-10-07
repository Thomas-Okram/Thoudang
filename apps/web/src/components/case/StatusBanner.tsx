import type { ReactNode } from 'react';
import type { CaseDetail, CaseStatus } from '../../lib/api';
import { Icon, type IconName } from '../ui/Icon';

const BANNER: Record<CaseStatus, { band: string; ring: string; label: string; icon: IconName }> = {
  READY: {
    band: 'bg-emerald-700 text-white',
    ring: 'bg-white/20',
    label: 'Ready for sanction',
    icon: 'check',
  },
  NEEDS_CITIZEN_CORRECTION: {
    band: 'bg-warm-400 text-warm-900',
    ring: 'bg-white/45',
    label: 'Needs citizen correction',
    icon: 'user',
  },
  OFFICER_ATTENTION: {
    band: 'bg-indigo-700 text-white',
    ring: 'bg-white/20',
    label: 'Officer attention',
    icon: 'eye',
  },
  APPROVED_BY_OFFICER: {
    band: 'bg-navy-900 text-white',
    ring: 'bg-teal-accent/30',
    label: 'Approved by officer',
    icon: 'star',
  },
};

/** "Age 86 (80+)" → "80+ · 86 yrs" etc. Displaced is shown as an address-based priority only. */
export function priorityChip(reason: string): { label: string; tone: string } {
  const age = /^Age (\d+)/.exec(reason);
  if (age)
    return {
      label: `80+ · ${age[1]} yrs`,
      tone: 'bg-violet-50 text-violet-900 ring-1 ring-inset ring-violet-400/40',
    };
  if (reason === 'Widowed')
    return { label: 'Widow', tone: 'bg-sky-50 text-sky-900 ring-1 ring-inset ring-sky-500/30' };
  if (reason === 'Person with disability')
    return {
      label: 'Disability',
      tone: 'bg-sky-50 text-sky-900 ring-1 ring-inset ring-sky-500/30',
    };
  if (reason.startsWith('Displaced'))
    return {
      label: 'Priority: displaced (address)',
      tone: 'bg-orange-50 text-orange-900 ring-1 ring-inset ring-orange-400/40',
    };
  const days = /^Pending (\d+) days?/.exec(reason);
  if (days)
    return {
      label: `${days[1]} day${days[1] === '1' ? '' : 's'} pending`,
      tone: 'bg-slate-100 text-slate-700 ring-1 ring-inset ring-slate-300',
    };
  return { label: reason, tone: 'bg-slate-100 text-slate-700 ring-1 ring-inset ring-slate-300' };
}

function explain(d: CaseDetail): string {
  const inForce = d.flags.filter((f) => f.resolution !== 'OVERRIDDEN' && f.severity !== 'info');
  const citizen = inForce.filter((f) => f.action === 'citizen').length;
  const officer = inForce.filter((f) => f.action === 'officer').length;
  switch (d.case.status) {
    case 'READY':
      return 'Every check passed or was cleared by an officer. Ready for the DSWO’s sanction.';
    case 'NEEDS_CITIZEN_CORRECTION':
      return `${citizen} item${citizen === 1 ? '' : 's'} the applicant must correct${d.case.correctionRequestedAt ? ' — sent for correction' : ''}.`;
    case 'OFFICER_ATTENTION':
      return d.notice.blockedBy.length
        ? 'Possible duplicate — an officer must check before anything is sent to the citizen.'
        : `${officer} item${officer === 1 ? '' : 's'} need${officer === 1 ? 's' : ''} an officer’s judgement.`;
    case 'APPROVED_BY_OFFICER':
      return `Approved for sanction${d.case.decidedAt ? ` on ${new Date(d.case.decidedAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}` : ''}.`;
  }
}

function Meta({ icon, children }: { icon: IconName; children: ReactNode }) {
  return (
    <div className="flex items-center gap-1.5">
      <Icon name={icon} size={16} className="text-ink-muted" />
      {children}
    </div>
  );
}

export function StatusBanner({ d }: { d: CaseDetail }) {
  const c = d.case;
  const b = BANNER[c.status];
  return (
    <section
      className="overflow-hidden rounded-card border border-line bg-surface shadow-card"
      aria-label="Case status"
    >
      <div
        className={`flex items-center gap-4 px-6 py-4 ${b.band}`}
        data-testid="status-banner"
        data-status={c.status}
      >
        <span
          className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${b.ring}`}
          aria-hidden
        >
          <Icon name={b.icon} size={24} strokeWidth={2.4} />
        </span>
        <div className="min-w-0">
          <div className="text-xl font-bold leading-tight tracking-tight">{b.label}</div>
          <div className="text-[0.95rem] opacity-95">{explain(d)}</div>
        </div>
        {c.processingState === 'EXTRACTING' && (
          <span className="ml-auto flex animate-pulse items-center gap-2 text-sm font-semibold">
            Processing…
          </span>
        )}
      </div>
      <div className="px-6 py-5">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h1 className="text-title font-bold text-navy-900">
            {c.applicantName ?? 'Name not read'}
          </h1>
          <span className="rounded-lg bg-slate-100 px-2.5 py-1 font-mono text-sm font-semibold text-ink-soft">
            {c.reference}
          </span>
        </div>
        <dl className="mt-2 flex flex-wrap gap-x-5 gap-y-1.5 text-[0.92rem] text-ink-soft">
          {c.aadhaarMasked && (
            <div className="flex items-center gap-1.5">
              <dt className="sr-only">Aadhaar</dt>
              <Icon name="lock" size={16} className="text-ink-muted" />
              <dd className="font-mono">Aadhaar {c.aadhaarMasked}</dd>
            </div>
          )}
          {c.age !== null && <Meta icon="user">Age {c.age}</Meta>}
          {c.district && <Meta icon="building">{c.district}</Meta>}
          <Meta icon="template">Old Age Pension (MOAPS)</Meta>
          <Meta icon="calendar">
            Received{' '}
            {new Date(c.receivedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
          </Meta>
        </dl>
        {c.priorityReasons.length > 0 && (
          <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-4">
            <span className="mr-1 flex items-center gap-1.5 text-overline font-bold uppercase text-ink-muted">
              Priority
              <span className="rounded-md bg-navy-900 px-1.5 py-0.5 text-[0.75rem] tabular-nums text-white">
                {c.priorityScore}
              </span>
            </span>
            {c.priorityReasons.map((r) => {
              const chip = priorityChip(r);
              return (
                <span
                  key={r}
                  className={`rounded-full px-2.5 py-0.5 text-[0.8rem] font-semibold ${chip.tone}`}
                >
                  {chip.label}
                </span>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
