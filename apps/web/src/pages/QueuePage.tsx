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

type PriorityFilter = 'all' | 'age' | 'widow' | 'disability' | 'displaced';

const PRIORITY_FILTERS: { key: PriorityFilter; label: string; test: (r: string) => boolean }[] = [
  { key: 'all', label: 'All priorities', test: () => true },
  { key: 'age', label: '80+', test: (r) => r.startsWith('Age ') },
  { key: 'widow', label: 'Widow', test: (r) => r === 'Widowed' },
  { key: 'disability', label: 'Disability', test: (r) => r === 'Person with disability' },
  { key: 'displaced', label: 'Displaced (address)', test: (r) => r.startsWith('Displaced') },
];

const COLUMNS: { status: CaseStatus; title: string; accent: string; empty: string }[] = [
  {
    status: 'READY',
    title: 'Ready',
    accent: 'bg-emerald-500',
    empty: 'Cases that pass every check land here.',
  },
  {
    status: 'NEEDS_CITIZEN_CORRECTION',
    title: 'Needs citizen correction',
    accent: 'bg-amber-500',
    empty: 'Missing or inconsistent documents the applicant must fix.',
  },
  {
    status: 'OFFICER_ATTENTION',
    title: 'Officer attention',
    accent: 'bg-rose-500',
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
    <div className="mx-auto max-w-[1500px] px-6 py-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-navy-900">Queue</h1>
          <p className="mt-1 text-slate-600">
            Old Age Pension applications, sorted by priority. Updates live as packets are screened.
          </p>
        </div>
      </header>

      <StatsBar stats={stats.data} loading={stats.isPending} />

      <div className="mt-5 flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
        <div className="relative min-w-64 flex-1">
          <svg
            viewBox="0 0 20 20"
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
            aria-hidden
          >
            <circle cx="9" cy="9" r="6" stroke="currentColor" strokeWidth="2" fill="none" />
            <path d="m14 14 4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name — e.g. “Thomas Okram” also finds “O. Thomas Meitei”"
            aria-label="Search by name"
            className="w-full rounded-lg border border-slate-300 py-2 pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-teal-accent"
          />
        </div>
        <select
          aria-label="District"
          value={district}
          onChange={(e) => setDistrict(e.target.value)}
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
        >
          <option value="">All districts</option>
          {stats.data?.districts.map((d) => (
            <option key={d}>{d}</option>
          ))}
        </select>
        <select
          aria-label="Scheme"
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
          defaultValue="MOAPS"
        >
          <option value="MOAPS">Old Age Pension (MOAPS)</option>
        </select>
        <div className="flex flex-wrap gap-1" role="group" aria-label="Priority category">
          {PRIORITY_FILTERS.map((p) => (
            <button
              key={p.key}
              onClick={() => setPriority(p.key)}
              aria-pressed={priority === p.key}
              className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                priority === p.key
                  ? 'bg-navy-900 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {banner && (
        <p className="mt-3 animate-enter rounded-lg bg-navy-900 px-4 py-2 text-sm font-semibold text-white">
          {banner}
        </p>
      )}

      {processing.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-2 rounded-lg border border-teal-accent/30 bg-teal-soft/30 px-4 py-2 text-sm text-navy-900">
          <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-teal-accent border-t-transparent" />
          Screening now:
          {processing.map((c) => (
            <span key={c.id} className="rounded bg-white px-2 py-0.5 font-mono text-xs">
              {c.packetName ?? c.reference}
            </span>
          ))}
        </div>
      )}

      {q && !cases.isFetching && screened.length === 0 && (
        <p className="mt-6 text-center text-slate-500">No applicant matches “{q}”.</p>
      )}

      <div className="mt-5 grid gap-5 lg:grid-cols-3">
        {COLUMNS.map((col) => {
          const list = byStatus(col.status);
          const isReady = col.status === 'READY';
          return (
            <section
              key={col.status}
              aria-label={col.title}
              className="flex min-w-0 flex-col rounded-xl bg-slate-200/60 p-3"
            >
              <header className="mb-3 flex items-center gap-2 px-1">
                <span className={`h-2.5 w-2.5 rounded-full ${col.accent}`} />
                <h2 className="font-bold text-navy-900">{col.title}</h2>
                <span className="rounded-full bg-white px-2 text-sm font-semibold text-slate-600">
                  {list.length}
                </span>
                {isReady && readySelectable.length > 0 && officer && can('forward') && (
                  <button
                    onClick={() => void forward()}
                    disabled={selected.size === 0}
                    className="ml-auto rounded-md bg-navy-900 px-2.5 py-1 text-xs font-semibold text-white disabled:bg-slate-400"
                  >
                    Forward to DSWO{selected.size ? ` (${selected.size})` : ''}
                  </button>
                )}
              </header>
              <ul className="space-y-2.5">
                {cases.isPending &&
                  [0, 1, 2].map((i) => <li key={i} className="skeleton h-28 w-full" />)}
                {!cases.isPending && list.length === 0 && (
                  <li className="rounded-lg border-2 border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500">
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

      <section className="mt-6 rounded-xl border border-slate-200 bg-white">
        <button
          className="flex w-full items-center gap-2 px-5 py-3 text-left"
          onClick={() => setShowApproved((s) => !s)}
          aria-expanded={showApproved}
        >
          <span className="h-2.5 w-2.5 rounded-full bg-navy-900" />
          <span className="font-bold text-navy-900">Approved by officer</span>
          <span className="rounded-full bg-slate-100 px-2 text-sm font-semibold text-slate-600">
            {byStatus('APPROVED_BY_OFFICER').length}
          </span>
          <span className="ml-auto text-sm font-semibold text-teal-deep">
            {showApproved ? 'Hide' : 'Show'}
          </span>
        </button>
        {showApproved && (
          <ul className="grid gap-2.5 border-t border-slate-100 p-3 md:grid-cols-2 xl:grid-cols-3">
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
              <li className="px-2 py-3 text-sm text-slate-500">Nothing approved yet.</li>
            )}
          </ul>
        )}
      </section>
    </div>
  );
}

function StatsBar({ stats, loading }: { stats: Stats | undefined; loading: boolean }) {
  const items: { label: string; value: string; tone?: string }[] = stats
    ? [
        { label: 'Total cases', value: String(stats.total) },
        { label: 'Ready', value: String(stats.byStatus.READY ?? 0), tone: 'text-emerald-700' },
        {
          label: 'Citizen correction',
          value: String(stats.byStatus.NEEDS_CITIZEN_CORRECTION ?? 0),
          tone: 'text-amber-700',
        },
        {
          label: 'Officer attention',
          value: String(stats.byStatus.OFFICER_ATTENTION ?? 0),
          tone: 'text-rose-700',
        },
        {
          label: 'Approved',
          value: String(stats.byStatus.APPROVED_BY_OFFICER ?? 0),
          tone: 'text-navy-900',
        },
        {
          label: 'Avg screening time',
          value:
            stats.avgScreeningMs === null ? '—' : `${(stats.avgScreeningMs / 1000).toFixed(1)} s`,
        },
        { label: 'Issues caught', value: String(stats.flagsCaught), tone: 'text-teal-deep' },
      ]
    : [];
  return (
    <div
      className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-7"
      aria-label="Queue statistics"
    >
      {loading &&
        Array.from({ length: 7 }, (_, i) => <div key={i} className="skeleton h-[74px]" />)}
      {items.map((s) => (
        <div
          key={s.label}
          className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm"
        >
          <div className={`text-2xl font-bold tabular-nums ${s.tone ?? 'text-navy-900'}`}>
            {s.value}
          </div>
          <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
            {s.label}
          </div>
        </div>
      ))}
    </div>
  );
}

const SEV_DOT = { critical: 'bg-rose-500', warn: 'bg-amber-500', info: 'bg-slate-400' } as const;

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
    <li className={`${fresh ? 'animate-enter' : ''}`} data-testid="queue-card">
      <div
        className={`group relative rounded-lg border bg-white shadow-sm transition hover:shadow-md ${selected ? 'border-navy-900 ring-2 ring-navy-900/20' : 'border-slate-200'} ${fresh ? 'animate-flash' : ''}`}
      >
        {selectable && (
          <input
            type="checkbox"
            checked={selected}
            onChange={onToggle}
            aria-label={`Select ${c.applicantName ?? c.reference}`}
            className="absolute right-3 top-3.5 h-4 w-4 accent-navy-900"
          />
        )}
        <Link to={`/cases/${c.id}`} className="block px-4 py-3">
          <div className="flex items-baseline justify-between gap-2 pr-6">
            <span className="truncate font-semibold text-navy-900">
              {c.applicantName ?? 'Name not read'}
            </span>
            <span
              className="shrink-0 rounded bg-slate-100 px-1.5 text-xs font-bold tabular-nums text-slate-600"
              title="Priority score"
            >
              {c.priorityScore}
            </span>
          </div>
          <div className="mt-0.5 flex flex-wrap gap-x-2 text-xs text-slate-500">
            <span className="font-mono">{c.reference}</span>
            {c.district && <span>· {c.district}</span>}
            {c.age !== null && <span>· {c.age} yrs</span>}
            <span>· {timeSince(c.receivedAt)}</span>
          </div>
          {c.topFlag && (
            <div className="mt-2 flex items-center gap-1.5 text-sm text-slate-700">
              <span className={`h-2 w-2 shrink-0 rounded-full ${SEV_DOT[c.topFlag.severity]}`} />
              <span className="truncate">{c.topFlag.title}</span>
              {issues > 1 && (
                <span className="shrink-0 text-xs text-slate-400">+{issues - 1} more</span>
              )}
            </div>
          )}
          {(c.priorityReasons.some((r) => !r.startsWith('Pending')) || c.forwardedAt) && (
            <div className="mt-2 flex flex-wrap gap-1">
              {c.forwardedAt && (
                <span className="rounded-full bg-navy-900 px-2 py-0.5 text-[11px] font-semibold text-white">
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
