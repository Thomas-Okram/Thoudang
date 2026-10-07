import type { CaseDetail, CaseStatus } from '../../lib/api';

const BANNER: Record<CaseStatus, { bg: string; label: string; icon: string }> = {
  READY: { bg: 'bg-emerald-600', label: 'Ready for sanction', icon: '✓' },
  NEEDS_CITIZEN_CORRECTION: { bg: 'bg-amber-500', label: 'Needs citizen correction', icon: '!' },
  OFFICER_ATTENTION: { bg: 'bg-rose-600', label: 'Officer attention', icon: '?' },
  APPROVED_BY_OFFICER: { bg: 'bg-navy-900', label: 'Approved by officer', icon: '★' },
};

/** "Age 86 (80+)" → "80+ · 86 yrs" etc. Displaced is shown as an address-based priority only. */
export function priorityChip(reason: string): { label: string; tone: string } {
  const age = /^Age (\d+)/.exec(reason);
  if (age) return { label: `80+ · ${age[1]} yrs`, tone: 'bg-violet-100 text-violet-900' };
  if (reason === 'Widowed') return { label: 'Widow', tone: 'bg-sky-100 text-sky-900' };
  if (reason === 'Person with disability')
    return { label: 'Disability', tone: 'bg-sky-100 text-sky-900' };
  if (reason.startsWith('Displaced'))
    return { label: 'Priority: displaced (address)', tone: 'bg-orange-100 text-orange-900' };
  const days = /^Pending (\d+) days?/.exec(reason);
  if (days)
    return {
      label: `${days[1]} day${days[1] === '1' ? '' : 's'} pending`,
      tone: 'bg-slate-200 text-slate-700',
    };
  return { label: reason, tone: 'bg-slate-200 text-slate-700' };
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

export function StatusBanner({ d }: { d: CaseDetail }) {
  const c = d.case;
  const b = BANNER[c.status];
  return (
    <section
      className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"
      aria-label="Case status"
    >
      <div
        className={`flex items-center gap-3 px-5 py-3 text-white ${b.bg}`}
        data-testid="status-banner"
        data-status={c.status}
      >
        <span
          className="flex h-8 w-8 items-center justify-center rounded-full bg-white/20 text-lg font-bold"
          aria-hidden
        >
          {b.icon}
        </span>
        <div className="min-w-0">
          <div className="text-lg font-bold leading-tight">{b.label}</div>
          <div className="text-sm text-white/90">{explain(d)}</div>
        </div>
        {c.processingState === 'EXTRACTING' && (
          <span className="ml-auto animate-pulse text-sm font-semibold">Processing…</span>
        )}
      </div>
      <div className="px-5 py-4">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h1 className="text-2xl font-bold tracking-tight text-navy-900">
            {c.applicantName ?? 'Name not read'}
          </h1>
          <span className="font-mono text-sm text-slate-500">{c.reference}</span>
        </div>
        <dl className="mt-1 flex flex-wrap gap-x-5 gap-y-1 text-sm text-slate-600">
          {c.aadhaarMasked && (
            <div>
              <dt className="sr-only">Aadhaar</dt>
              <dd className="font-mono">Aadhaar {c.aadhaarMasked}</dd>
            </div>
          )}
          {c.age !== null && <div>Age {c.age}</div>}
          {c.district && <div>{c.district}</div>}
          <div>Old Age Pension (MOAPS)</div>
          <div>
            Received{' '}
            {new Date(c.receivedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
          </div>
        </dl>
        {c.priorityReasons.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Priority {c.priorityScore}
            </span>
            {c.priorityReasons.map((r) => {
              const chip = priorityChip(r);
              return (
                <span
                  key={r}
                  className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${chip.tone}`}
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
