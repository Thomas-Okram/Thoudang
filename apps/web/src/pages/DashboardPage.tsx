import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { fetchDashboard, type Dashboard } from '../lib/api';

/**
 * Status series colours — validated with the dataviz palette checker (light surface):
 * lightness/chroma/contrast pass; green↔amber is in the CVD floor band (ΔE 7.9), so the chart
 * always has secondary encoding: legend, 2px segment gaps, and a table view.
 */
const SERIES = [
  { key: 'ready', label: 'Ready', color: '#059669' },
  { key: 'correction', label: 'Citizen correction', color: '#d97706' },
  { key: 'attention', label: 'Officer attention', color: '#e11d48' },
  { key: 'approved', label: 'Approved', color: '#3b63c9' },
] as const;
const TEAL = '#0f9e8e';
const INK = { primary: '#0a1b33', secondary: '#475569', muted: '#94a3b8', grid: '#e2e8f0' };

const pct = (x: number | null) => (x === null ? '—' : `${Math.round(x * 100)}%`);

export function DashboardPage() {
  const [includeHistorical, setIncludeHistorical] = useState(true);
  const { data, isPending } = useQuery({
    queryKey: ['dashboard', includeHistorical],
    queryFn: () => fetchDashboard(includeHistorical),
    refetchInterval: 15_000,
  });

  return (
    <div className="mx-auto max-w-[1500px] px-6 py-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-navy-900">Department dashboard</h1>
          <p className="mt-1 text-slate-600">
            Old Age Pension applications across Manipur — screening, corrections and who is waiting.
          </p>
        </div>
        <label className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={includeHistorical}
            onChange={(e) => setIncludeHistorical(e.target.checked)}
            className="h-4 w-4 accent-teal-accent"
          />
          Include synthetic history
        </label>
      </header>

      {data && data.historicalIncluded > 0 && (
        <p className="mt-3 rounded-lg bg-amber-50 px-4 py-2 text-sm text-amber-900">
          Includes <strong>{data.historicalIncluded}</strong> synthetic historical cases
          (seed:dashboard) so the trends are visible. They never appear in the live queue.
        </p>
      )}

      {isPending || !data ? <DashboardSkeleton /> : <DashboardBody d={data} />}
    </div>
  );
}

function DashboardBody({ d }: { d: Dashboard }) {
  const k = d.kpis;
  const pendingTotal =
    k.pendingByStatus.READY +
    k.pendingByStatus.NEEDS_CITIZEN_CORRECTION +
    k.pendingByStatus.OFFICER_ATTENTION;
  const tiles = [
    { label: 'Applications received', value: k.received.toLocaleString('en-IN') },
    { label: 'Screened today', value: String(k.screenedToday) },
    {
      label: 'Avg screening time',
      value:
        k.avgScreeningMs === null
          ? '—'
          : k.avgScreeningMs < 100
            ? '<0.1 s'
            : `${(k.avgScreeningMs / 1000).toFixed(1)} s`,
    },
    { label: 'First-time-right', value: pct(k.firstTimeRight), hint: 'Ready at first screening' },
    {
      label: 'Pending',
      value: String(pendingTotal),
      hint: `${k.pendingByStatus.READY} ready · ${k.pendingByStatus.NEEDS_CITIZEN_CORRECTION} correction · ${k.pendingByStatus.OFFICER_ATTENTION} attention`,
    },
    { label: 'Notices sent', value: String(k.noticesSent) },
    { label: 'Avg days pending', value: k.avgDaysPending === null ? '—' : `${k.avgDaysPending}` },
  ];

  return (
    <>
      <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
        {tiles.map((t) => (
          <div
            key={t.label}
            className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm"
            title={t.hint}
          >
            <div className="text-2xl font-bold tabular-nums text-navy-900">{t.value}</div>
            <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
              {t.label}
            </div>
            {t.hint && <div className="mt-0.5 truncate text-[11px] text-slate-400">{t.hint}</div>}
          </div>
        ))}
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-[1.2fr_1fr]">
        <section
          className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
          aria-labelledby="def-title"
        >
          <h2 id="def-title" className="font-bold text-navy-900">
            What citizens get wrong most
          </h2>
          <p className="text-sm text-slate-500">
            Corrections asked of applicants — feeds awareness drives at camps and offices.
          </p>
          {d.deficiencies.length ? (
            <div
              className="mt-3 h-72"
              role="img"
              aria-label={`Top deficiencies: ${d.deficiencies.map((x) => `${x.title} ${x.count}`).join(', ')}`}
            >
              <ResponsiveContainer>
                <BarChart
                  data={d.deficiencies}
                  layout="vertical"
                  margin={{ top: 4, right: 40, bottom: 4, left: 8 }}
                  barCategoryGap={6}
                >
                  <CartesianGrid horizontal={false} stroke={INK.grid} />
                  <XAxis
                    type="number"
                    allowDecimals={false}
                    tick={{ fill: INK.muted, fontSize: 12 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    type="category"
                    dataKey="title"
                    width={190}
                    tick={{ fill: INK.secondary, fontSize: 13 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip
                    cursor={{ fill: 'rgba(15,158,142,0.08)' }}
                    formatter={(v) => [String(v), 'Cases']}
                    contentStyle={{ borderRadius: 8, borderColor: INK.grid }}
                  />
                  <Bar dataKey="count" fill={TEAL} radius={[0, 4, 4, 0]} maxBarSize={22}>
                    <LabelList
                      dataKey="count"
                      position="right"
                      fill={INK.secondary}
                      fontSize={12}
                    />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="mt-6 text-sm text-slate-500">No citizen corrections yet.</p>
          )}
        </section>

        <section
          className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
          aria-labelledby="watch-title"
        >
          <h2 id="watch-title" className="font-bold text-navy-900">
            Priority watch
          </h2>
          <p className="text-sm text-slate-500">
            Vulnerable applicants still pending after 30 days.
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {d.priorityWatch.map((w) => (
              <div
                key={w.key}
                className={`rounded-lg border p-3 ${w.count ? 'border-rose-200 bg-rose-50/50' : 'border-slate-200'}`}
              >
                <div className="flex items-baseline justify-between">
                  <span className="font-semibold text-navy-900">{w.label}</span>
                  <span
                    className={`text-2xl font-bold tabular-nums ${w.count ? 'text-rose-700' : 'text-slate-400'}`}
                  >
                    {w.count}
                  </span>
                </div>
                <ul className="mt-1 space-y-0.5 text-sm">
                  {w.cases.slice(0, 3).map((c) => (
                    <li key={c.id} className="flex justify-between gap-2">
                      <Link
                        to={`/cases/${c.id}`}
                        className="truncate text-navy-800 hover:underline"
                      >
                        {c.applicantName ?? c.reference}
                      </Link>
                      <span className="shrink-0 text-slate-500">{c.daysPending} d</span>
                    </li>
                  ))}
                  {!w.cases.length && <li className="text-slate-400">None overdue</li>}
                </ul>
              </div>
            ))}
          </div>
        </section>
      </div>

      <DistrictSection d={d} />
    </>
  );
}

function DistrictSection({ d }: { d: Dashboard }) {
  const [view, setView] = useState<'chart' | 'table'>('chart');
  const rows = d.districts;
  return (
    <section
      className="mt-5 rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
      aria-labelledby="district-title"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="district-title" className="font-bold text-navy-900">
            District-wise
          </h2>
          <p className="text-sm text-slate-500">
            Applications received and where they stand, all 16 districts.
          </p>
        </div>
        <div
          className="inline-flex rounded-lg bg-slate-100 p-1"
          role="tablist"
          aria-label="District view"
        >
          {(['chart', 'table'] as const).map((v) => (
            <button
              key={v}
              role="tab"
              aria-selected={view === v}
              onClick={() => setView(v)}
              className={`rounded-md px-3 py-1.5 text-sm font-semibold capitalize ${view === v ? 'bg-white text-navy-900 shadow-sm' : 'text-slate-600'}`}
            >
              {v}
            </button>
          ))}
        </div>
      </div>
      {view === 'chart' && (
        <ul className="mt-3 flex flex-wrap gap-4 text-sm text-slate-600" aria-label="Legend">
          {SERIES.map((s) => (
            <li key={s.key} className="flex items-center gap-1.5">
              <span className="inline-block h-3 w-3 rounded-sm" style={{ background: s.color }} />
              {s.label}
            </li>
          ))}
        </ul>
      )}
      {view === 'chart' ? (
        <div className="mt-2" style={{ height: Math.max(260, rows.length * 30 + 30) }}>
          <ResponsiveContainer>
            <BarChart
              data={rows}
              layout="vertical"
              margin={{ top: 4, right: 24, bottom: 4, left: 8 }}
              barCategoryGap={5}
            >
              <CartesianGrid horizontal={false} stroke={INK.grid} />
              <XAxis
                type="number"
                allowDecimals={false}
                tick={{ fill: INK.muted, fontSize: 12 }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                type="category"
                dataKey="district"
                width={110}
                tick={{ fill: INK.secondary, fontSize: 13 }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip
                cursor={{ fill: 'rgba(10,27,51,0.05)' }}
                contentStyle={{ borderRadius: 8, borderColor: INK.grid }}
                itemStyle={{ color: INK.primary }}
                labelStyle={{ color: INK.primary, fontWeight: 700 }}
                itemSorter={(item) => SERIES.findIndex((x) => x.label === item.name)}
              />
              {SERIES.map((s, i) => (
                <Bar
                  key={s.key}
                  dataKey={s.key}
                  name={s.label}
                  stackId="status"
                  fill={s.color}
                  stroke="#ffffff"
                  strokeWidth={2}
                  radius={i === SERIES.length - 1 ? [0, 4, 4, 0] : [0, 0, 0, 0]}
                  maxBarSize={20}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="py-2 pr-4">District</th>
                <th className="py-2 pr-4 text-right">Received</th>
                {SERIES.map((s) => (
                  <th key={s.key} className="py-2 pr-4 text-right">
                    <span
                      className="mr-1.5 inline-block h-2.5 w-2.5 rounded-sm align-middle"
                      style={{ background: s.color }}
                    />
                    {s.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.district} className="border-b border-slate-100">
                  <td className="py-1.5 pr-4 font-medium text-navy-900">{r.district}</td>
                  <td className="py-1.5 pr-4 text-right tabular-nums">{r.received}</td>
                  <td className="py-1.5 pr-4 text-right tabular-nums">{r.ready}</td>
                  <td className="py-1.5 pr-4 text-right tabular-nums">{r.correction}</td>
                  <td className="py-1.5 pr-4 text-right tabular-nums">{r.attention}</td>
                  <td className="py-1.5 pr-4 text-right tabular-nums">{r.approved}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function DashboardSkeleton() {
  return (
    <div aria-busy>
      <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
        {Array.from({ length: 7 }, (_, i) => (
          <div key={i} className="skeleton h-20" />
        ))}
      </div>
      <div className="mt-5 grid gap-5 xl:grid-cols-2">
        <div className="skeleton h-80" />
        <div className="skeleton h-80" />
      </div>
    </div>
  );
}
