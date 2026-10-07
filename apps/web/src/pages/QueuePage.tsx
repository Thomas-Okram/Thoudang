import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import {
  fetchCases,
  fetchStats,
  forwardCases,
  type CaseStatus,
  type CaseSummary,
  type Stats,
} from '../lib/api';
import { usePipelineEvents, type PipelineEvent } from '../lib/events';
import { useOfficer } from '../lib/officer';
import { priorityChip } from '../components/case/StatusBanner';
import { PageHeader } from '../components/Page';
import { Button, Icon, Skeleton, Spinner, StatTile, Toast, type IconName } from '../components/ui';

type PriorityFilter = 'all' | 'age' | 'widow' | 'disability' | 'displaced';

const PRIORITY_FILTERS: { key: PriorityFilter; label: string; test: (r: string) => boolean }[] = [
  { key: 'all', label: 'All priorities', test: () => true },
  { key: 'age', label: '80+', test: (r) => r.startsWith('Age ') },
  { key: 'widow', label: 'Widow', test: (r) => r === 'Widowed' },
  { key: 'disability', label: 'Disability', test: (r) => r === 'Person with disability' },
  { key: 'displaced', label: 'Displaced (address)', test: (r) => r.startsWith('Displaced') },
];

const COLUMNS: {
  status: CaseStatus;
  title: string;
  accent: string;
  rule: string;
  icon: IconName;
  iconTone: string;
  empty: string;
}[] = [
  {
    status: 'READY',
    title: 'Ready',
    accent: 'bg-emerald-600',
    rule: 'border-t-emerald-600',
    icon: 'check',
    iconTone: 'bg-emerald-50 text-emerald-700',
    empty: 'Cases that pass every check land here.',
  },
  {
    status: 'NEEDS_CITIZEN_CORRECTION',
    title: 'Needs citizen correction',
    accent: 'bg-warm-500',
    rule: 'border-t-warm-500',
    icon: 'user',
    iconTone: 'bg-warm-50 text-warm-700',
    empty: 'Missing or inconsistent documents the applicant must fix.',
  },
  {
    status: 'OFFICER_ATTENTION',
    title: 'Officer attention',
    accent: 'bg-indigo-600',
    rule: 'border-t-indigo-600',
    icon: 'eye',
    iconTone: 'bg-indigo-50 text-indigo-700',
    empty: 'Ambiguities and unclear readings for an officer.',
  },
];

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function timeSince(iso: string, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return `${d} day${d === 1 ? '' : 's'} ago`;
}

export function QueuePage() {
  const qc = useQueryClient();
  const { officer, can } = useOfficer();
  const [search, setSearch] = useState('');
  const [district, setDistrict] = useState('');
  const [priority, setPriority] = useState<PriorityFilter>('all');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showApproved, setShowApproved] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const q = useDebounced(search.trim(), 250);

  const cases = useQuery({
    queryKey: ['cases', q],
    queryFn: () => fetchCases({ q: q || undefined }),
    placeholderData: (prev) => prev,
  });
  const stats = useQuery({ queryKey: ['stats'], queryFn: fetchStats });

  // Live: refresh when a case finishes screening or an officer changes one (debounced for batches).
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  usePipelineEvents(
    useCallback(
      (e: PipelineEvent) => {
        if (e.type !== 'case' || !['done', 'updated', 'uploaded'].includes(e.stage)) return;
        if (pending.current) clearTimeout(pending.current);
        pending.current = setTimeout(() => {
          void qc.invalidateQueries({ queryKey: ['cases'] });
          void qc.invalidateQueries({ queryKey: ['stats'] });
        }, 250);
      },
      [qc],
    ),
  );

  // New arrivals animate in (not on the first load).
  const seen = useRef<Set<string> | null>(null);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  useEffect(() => {
    const list = cases.data?.cases;
    if (!list) return;
    const ids = list
      .filter((c) => c.processingState === 'SCREENED' || c.processingState === 'EXTRACTION_FAILED')
      .map((c) => c.id);
    if (seen.current === null) {
      seen.current = new Set(ids);
      return;
    }
    const added = ids.filter((id) => !seen.current!.has(id));
    added.forEach((id) => seen.current!.add(id));
    if (added.length) {
      setFresh((f) => new Set([...f, ...added]));
      setTimeout(() => setFresh((f) => new Set([...f].filter((id) => !added.includes(id)))), 2200);
    }
  }, [cases.data]);

  const visible = useMemo(() => {
    const test = PRIORITY_FILTERS.find((p) => p.key === priority)!.test;
    return (cases.data?.cases ?? []).filter(
      (c) =>
        (!district || c.district === district) &&
        (priority === 'all' || c.priorityReasons.some(test)),
    );
  }, [cases.data, district, priority]);

  const screened = visible.filter(
    (c) => c.processingState === 'SCREENED' || c.processingState === 'EXTRACTION_FAILED',
  );
  const processing = visible.filter(
    (c) => c.processingState === 'RECEIVED' || c.processingState === 'EXTRACTING',
  );
  const byStatus = (s: CaseStatus) => screened.filter((c) => c.status === s);
  const readySelectable = byStatus('READY').filter((c) => !c.forwardedAt);

  const forward = async () => {
    const ids = [...selected];
    const r = await forwardCases(ids);
    setSelected(new Set());
    setBanner(
      `${r.forwarded.length} case${r.forwarded.length === 1 ? '' : 's'} forwarded to the DSWO for approval`,
    );
    setTimeout(() => setBanner(null), 3500);
    void qc.invalidateQueries({ queryKey: ['cases'] });
  };

  return (
    <div className="mx-auto max-w-[1560px] px-7 py-8">
      <PageHeader
        eyebrow="Step 2 · Scrutinise"
        title="Queue"
        subtitle="Old Age Pension applications, sorted by priority. Updates live as packets are screened."
        actions={
          <span className="flex items-center gap-2 rounded-full border border-line bg-white px-3 py-1.5 text-sm font-semibold text-ink-soft shadow-card">
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inset-0 animate-ping rounded-full bg-emerald-400/70" />
              <span className="relative h-2.5 w-2.5 rounded-full bg-emerald-500" />
            </span>
            Live
          </span>
        }
      />

      <StatsBar stats={stats.data} loading={stats.isPending} />

      <div className="mt-5 flex flex-wrap items-center gap-3 rounded-card border border-line bg-white p-3 shadow-card">
        <div className="relative min-w-72 flex-1">
          <Icon
            name="search"
            size={18}
            className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-muted"
          />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name — e.g. “Thomas Okram” also finds “O. Thomas Meitei”"
            aria-label="Search by name"
            className="h-11 w-full rounded-control border border-line-strong bg-slate-50/60 pl-10 pr-3 text-[0.95rem] placeholder:text-ink-muted focus:border-teal-accent focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal-accent/40"
          />
        </div>
        <select
          aria-label="District"
          value={district}
          onChange={(e) => setDistrict(e.target.value)}
          className="h-11 rounded-control border border-line-strong bg-white px-3 text-[0.92rem] font-medium text-navy-900"
        >
          <option value="">All districts</option>
          {stats.data?.districts.map((d) => (
            <option key={d}>{d}</option>
          ))}
        </select>
        <select
          aria-label="Scheme"
          className="h-11 rounded-control border border-line-strong bg-white px-3 text-[0.92rem] font-medium text-navy-900"
          defaultValue="MOAPS"
        >
          <option value="MOAPS">Old Age Pension (MOAPS)</option>
        </select>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Priority category">
          {PRIORITY_FILTERS.map((p) => (
            <button
              key={p.key}
              onClick={() => setPriority(p.key)}
              aria-pressed={priority === p.key}
              className={`h-9 rounded-full px-3.5 text-[0.82rem] font-semibold transition ${
                priority === p.key
                  ? 'bg-navy-900 text-white shadow-sm'
                  : 'bg-slate-100 text-ink-soft hover:bg-slate-200'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {banner && <Toast>{banner}</Toast>}

      {processing.length > 0 && (
        <div
          className="mt-4 flex animate-enter flex-wrap items-center gap-2 rounded-card border border-teal-accent/40 bg-teal-wash px-4 py-3 text-[0.95rem] font-medium text-navy-900"
          aria-live="polite"
        >
          <Spinner size={16} className="text-teal-deep" />
          Screening now:
          {processing.map((c) => (
            <span
              key={c.id}
              className="animate-pop rounded-lg border border-teal-accent/30 bg-white px-2.5 py-0.5 font-mono text-xs font-semibold"
            >
              {c.packetName ?? c.reference}
            </span>
          ))}
        </div>
      )}

      {q && !cases.isFetching && screened.length === 0 && (
        <p className="mt-6 text-center text-ink-muted">No applicant matches “{q}”.</p>
      )}

      <div className="mt-6 grid gap-5 lg:grid-cols-3">
        {COLUMNS.map((col) => {
          const list = byStatus(col.status);
          const isReady = col.status === 'READY';
          return (
            <section
              key={col.status}
              aria-label={col.title}
              className={`flex min-w-0 flex-col rounded-card border border-t-4 border-line bg-slate-100/80 p-3 ${col.rule}`}
            >
              <header className="mb-3 flex items-center gap-2.5 px-1 pt-1">
                <span
                  className={`flex h-8 w-8 items-center justify-center rounded-lg ${col.iconTone}`}
                >
                  <Icon name={col.icon} size={17} strokeWidth={2.2} />
                </span>
                <h2 className="text-[1.05rem] font-bold text-navy-900">{col.title}</h2>
                <span
                  key={list.length}
                  className="animate-pop rounded-full bg-white px-2.5 py-0.5 text-[0.9rem] font-bold tabular-nums text-navy-900 shadow-sm ring-1 ring-line"
                >
                  {list.length}
                </span>
                {isReady && readySelectable.length > 0 && officer && can('forward') && (
                  <Button
                    size="sm"
                    variant="navy"
                    icon="send"
                    onClick={() => void forward()}
                    disabled={selected.size === 0}
                    className="ml-auto"
                  >
                    Forward to DSWO{selected.size ? ` (${selected.size})` : ''}
                  </Button>
                )}
              </header>
              <ul className="space-y-2.5">
                {cases.isPending &&
                  [0, 1, 2].map((i) => (
                    <li key={i}>
                      <Skeleton className="h-32 w-full" />
                    </li>
                  ))}
                {!cases.isPending && list.length === 0 && (
                  <li className="rounded-xl border-2 border-dashed border-line-strong px-4 py-10 text-center text-[0.92rem] text-ink-muted">
                    {col.empty}
                  </li>
                )}
                {list.map((c) => (
                  <QueueCard
                    key={c.id}
                    c={c}
                    fresh={fresh.has(c.id)}
                    selectable={isReady && !c.forwardedAt && Boolean(officer) && can('forward')}
                    selected={selected.has(c.id)}
                    onToggle={() =>
                      setSelected((s) => {
                        const n = new Set(s);
                        if (n.has(c.id)) n.delete(c.id);
                        else n.add(c.id);
                        return n;
                      })
                    }
                  />
                ))}
              </ul>
            </section>
          );
        })}
      </div>

      <section className="mt-6 overflow-hidden rounded-card border border-line bg-white shadow-card">
        <button
          className="flex w-full items-center gap-2.5 px-5 py-3.5 text-left hover:bg-slate-50"
          onClick={() => setShowApproved((s) => !s)}
          aria-expanded={showApproved}
        >
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-teal-wash text-teal-deep">
            <Icon name="star" size={17} />
          </span>
          <span className="font-bold text-navy-900">Approved by officer</span>
          <span className="rounded-full bg-slate-100 px-2.5 text-[0.9rem] font-bold tabular-nums text-ink-soft">
            {byStatus('APPROVED_BY_OFFICER').length}
          </span>
          <span className="ml-auto flex items-center gap-1 text-sm font-semibold text-teal-deep">
            {showApproved ? 'Hide' : 'Show'}
            <Icon
              name="chevronDown"
              size={16}
              className={`transition-transform ${showApproved ? 'rotate-180' : ''}`}
            />
          </span>
        </button>
        {showApproved && (
          <ul className="grid gap-2.5 border-t border-line bg-slate-50/60 p-3 md:grid-cols-2 xl:grid-cols-3">
            {byStatus('APPROVED_BY_OFFICER').map((c) => (
              <QueueCard
                key={c.id}
                c={c}
                fresh={false}
                selectable={false}
                selected={false}
                onToggle={() => {}}
              />
            ))}
            {!byStatus('APPROVED_BY_OFFICER').length && (
              <li className="px-2 py-3 text-sm text-ink-muted">Nothing approved yet.</li>
            )}
          </ul>
        )}
      </section>
    </div>
  );
}

function StatsBar({ stats, loading }: { stats: Stats | undefined; loading: boolean }) {
  const items: {
    label: string;
    value: string;
    tone?: 'navy' | 'success' | 'warn' | 'teal' | 'muted';
    icon: IconName;
    extra?: string;
  }[] = stats
    ? [
        { label: 'Total cases', value: String(stats.total), icon: 'folder' },
        {
          label: 'Ready',
          value: String(stats.byStatus.READY ?? 0),
          tone: 'success',
          icon: 'check',
        },
        {
          label: 'Citizen correction',
          value: String(stats.byStatus.NEEDS_CITIZEN_CORRECTION ?? 0),
          tone: 'warn',
          icon: 'user',
        },
        {
          label: 'Officer attention',
          value: String(stats.byStatus.OFFICER_ATTENTION ?? 0),
          icon: 'eye',
          extra: 'text-indigo-700',
        },
        {
          label: 'Approved',
          value: String(stats.byStatus.APPROVED_BY_OFFICER ?? 0),
          tone: 'teal',
          icon: 'star',
        },
        {
          label: 'Avg screening time',
          value:
            stats.avgScreeningMs === null
              ? '—'
              : stats.avgScreeningMs < 100
                ? '<0.1 s'
                : `${(stats.avgScreeningMs / 1000).toFixed(1)} s`,
          icon: 'clock',
        },
        { label: 'Issues caught', value: String(stats.flagsCaught), tone: 'teal', icon: 'shield' },
      ]
    : [];
  return (
    <div
      className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-7"
      aria-label="Queue statistics"
    >
      {loading && Array.from({ length: 7 }, (_, i) => <Skeleton key={i} className="h-[92px]" />)}
      {items.map((s) => (
        <StatTile
          key={s.label}
          size="sm"
          label={s.label}
          value={<span className={s.extra}>{s.value}</span>}
          tone={s.tone ?? 'navy'}
          icon={s.icon}
        />
      ))}
    </div>
  );
}

const SEV_DOT = { critical: 'bg-rose-600', warn: 'bg-warm-500', info: 'bg-slate-400' } as const;

function QueueCard({
  c,
  fresh,
  selectable,
  selected,
  onToggle,
}: {
  c: CaseSummary;
  fresh: boolean;
  selectable: boolean;
  selected: boolean;
  onToggle: () => void;
}) {
  const issues = c.flagCounts.critical + c.flagCounts.warn;
  return (
    <li className={`${fresh ? 'animate-arrive' : ''}`} data-testid="queue-card">
      <div
        className={`group relative rounded-xl border bg-white shadow-card transition duration-200 hover:-translate-y-0.5 hover:shadow-raised ${selected ? 'border-navy-900 ring-2 ring-navy-900/20' : 'border-line'} ${fresh ? 'animate-flash ring-2 ring-teal-accent' : ''}`}
      >
        {fresh && (
          <span className="absolute -top-2 left-3 z-10 animate-pop rounded-full bg-teal-deep px-2 py-0.5 text-[0.65rem] font-bold uppercase tracking-wider text-white shadow">
            New
          </span>
        )}
        {selectable && (
          <input
            type="checkbox"
            checked={selected}
            onChange={onToggle}
            aria-label={`Select ${c.applicantName ?? c.reference}`}
            className="absolute right-3.5 top-4 h-[18px] w-[18px] accent-navy-900"
          />
        )}
        <Link to={`/cases/${c.id}`} className="block rounded-xl px-4 py-3.5">
          <div className={`flex items-start justify-between gap-3 ${selectable ? 'pr-7' : ''}`}>
            <span className="min-w-0 text-[1.02rem] font-semibold leading-snug text-navy-900">
              {c.applicantName ?? 'Name not read'}
            </span>
            <span
              className="flex h-8 min-w-8 shrink-0 items-center justify-center rounded-lg bg-navy-50 px-1.5 text-sm font-bold tabular-nums text-navy-800 ring-1 ring-inset ring-navy-100"
              title="Priority score"
              aria-label={`Priority score ${c.priorityScore}`}
            >
              {c.priorityScore}
            </span>
          </div>
          <div className="mt-1 flex flex-wrap gap-x-2 text-[0.8rem] text-ink-muted">
            <span className="font-mono">{c.reference}</span>
            {c.district && <span>· {c.district}</span>}
            {c.age !== null && <span>· {c.age} yrs</span>}
            <span>· {timeSince(c.receivedAt)}</span>
          </div>
          {c.topFlag && (
            <div className="mt-2.5 flex items-center gap-2 rounded-lg bg-slate-50 px-2.5 py-1.5 text-[0.88rem] text-ink-soft">
              <span className={`h-2 w-2 shrink-0 rounded-full ${SEV_DOT[c.topFlag.severity]}`} />
              <span className="truncate font-medium">{c.topFlag.title}</span>
              {issues > 1 && (
                <span className="ml-auto shrink-0 text-xs font-semibold text-ink-muted">
                  +{issues - 1} more
                </span>
              )}
            </div>
          )}
          {(c.priorityReasons.some((r) => !r.startsWith('Pending')) || c.forwardedAt) && (
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {c.forwardedAt && (
                <span className="flex items-center gap-1 rounded-full bg-navy-900 px-2 py-0.5 text-[11px] font-semibold text-white">
                  <Icon name="send" size={11} strokeWidth={2.2} />
                  Forwarded to DSWO
                </span>
              )}
              {c.priorityReasons
                .filter((r) => !r.startsWith('Pending'))
                .map((r) => {
                  const chip = priorityChip(r);
                  return (
                    <span
                      key={r}
                      className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${chip.tone}`}
                    >
                      {chip.label}
                    </span>
                  );
                })}
            </div>
          )}
        </Link>
      </div>
    </li>
  );
}
