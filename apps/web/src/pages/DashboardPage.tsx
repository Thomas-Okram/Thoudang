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
import { PageHeader } from '../components/Page';
import {
  Card,
  CardHeader,
  Icon,
  Skeleton,
  StatTile,
  Table,
  Tabs,
  Td,
  Th,
  Tr,
} from '../components/ui';

/**
 * Status series colours — validated with the dataviz palette checker (light surface):
 * lightness/chroma/contrast pass; green↔amber is in the CVD floor band (ΔE 7.9), so the chart
 * always has secondary encoding: legend, 2px segment gaps, and a table view.
 * Same hue families as the queue: green ready, marigold citizen, indigo officer, cyan approved.
 */
const SERIES = [
  { key: 'ready', label: 'Ready', color: '#059669' },
  { key: 'correction', label: 'Citizen correction', color: '#d97706' },
  { key: 'attention', label: 'Officer attention', color: '#4f46e5' },
  { key: 'approved', label: 'Approved', color: '#0891b2' },
] as const;
const TEAL = '#0f9e8e';
const INK = { primary: '#0a1b33', secondary: '#334155', muted: '#5b6878', grid: '#e3e8ef' };
const AXIS_FONT = 13;

const pct = (x: number | null) => (x === null ? '—' : `${Math.round(x * 100)}%`);

export function DashboardPage() {
  const [includeHistorical, setIncludeHistorical] = useState(true);
  const { data, isPending } = useQuery({
    queryKey: ['dashboard', includeHistorical],
    queryFn: () => fetchDashboard(includeHistorical),
    refetchInterval: 15_000,
  });

  return (
    <div className="mx-auto max-w-[1560px] px-7 py-8">
      <PageHeader
        eyebrow="Department overview"
        title="Department dashboard"
        subtitle="Old Age Pension applications across Manipur — screening, corrections and who is waiting."
        actions={
          <label className="flex cursor-pointer items-center gap-2.5 rounded-full border border-line bg-white py-1.5 pl-3 pr-1.5 text-sm font-semibold text-ink-soft shadow-card">
            Include synthetic history
            <input
              type="checkbox"
              checked={includeHistorical}
              onChange={(e) => setIncludeHistorical(e.target.checked)}
              className="peer sr-only"
            />
            <span
              aria-hidden
              className="relative h-5 w-9 rounded-full bg-slate-300 transition-colors peer-checked:bg-teal-deep peer-focus-visible:outline peer-focus-visible:outline-3 peer-focus-visible:outline-teal-accent"
            >
              <span
                className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${includeHistorical ? 'translate-x-[1.125rem]' : 'translate-x-0.5'}`}
              />
            </span>
          </label>
        }
      />

      {data && data.historicalIncluded > 0 && (
        <p className="mb-5 flex items-center gap-2.5 rounded-xl border border-warm-200 bg-warm-50 px-4 py-2.5 text-sm text-warm-900">
          <Icon name="info" size={17} />
          <span>
            Includes <strong>{data.historicalIncluded}</strong> synthetic historical cases
            <span className="dev-noise"> (seed:dashboard)</span> so the trends are visible. They
            never appear in the live queue.
          </span>
        </p>
      )}

      {isPending || !data ? <DashboardSkeleton /> : <DashboardBody d={data} />}
    </div>
  );
}

function Segments({
  parts,
  label,
}: {
  parts: { label: string; value: number; color: string }[];
  label: string;
}) {
  const total = parts.reduce((a, p) => a + p.value, 0) || 1;
  return (
    <div>
      <div
        className="flex h-2.5 gap-[2px] overflow-hidden rounded-full"
        role="img"
        aria-label={label}
      >
        {parts.map((p) =>
          p.value ? (
            <span
              key={p.label}
              className="h-full transition-[width] duration-700 first:rounded-l-full last:rounded-r-full"
              style={{ width: `${(p.value / total) * 100}%`, background: p.color }}
            />
          ) : null,
        )}
      </div>
      <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-ink-muted">
        {parts.map((p) => (
          <li key={p.label} className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-sm" style={{ background: p.color }} />
            {p.label} <strong className="tabular-nums text-navy-900">{p.value}</strong>
          </li>
        ))}
      </ul>
    </div>
  );
}

function DashboardBody({ d }: { d: Dashboard }) {
  const k = d.kpis;
  const pendingTotal =
    k.pendingByStatus.READY +
    k.pendingByStatus.NEEDS_CITIZEN_CORRECTION +
    k.pendingByStatus.OFFICER_ATTENTION;
  const avg =
    k.avgScreeningMs === null
      ? '—'
      : k.avgScreeningMs < 100
        ? '<0.1 s'
        : `${(k.avgScreeningMs / 1000).toFixed(1)} s`;

  return (
    <>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          size="lg"
          icon="folder"
          label="Applications received"
          value={k.received.toLocaleString('en-IN')}
          hint={`${k.screenedToday} screened today`}
        />
        <StatTile
          size="lg"
          icon="clock"
          tone="teal"
          label="Avg screening time"
          value={avg}
          hint="Upload to sorted, per packet"
        />
        <StatTile
          size="lg"
          icon="check"
          tone="success"
          label="First-time-right"
          value={pct(k.firstTimeRight)}
          hint="Ready at first screening"
          footer={
            k.firstTimeRight !== null && (
              <div className="h-2.5 overflow-hidden rounded-full bg-slate-100">
                <div
                  className="h-full rounded-full bg-emerald-600 transition-[width] duration-700"
                  style={{ width: `${Math.round(k.firstTimeRight * 100)}%` }}
                />
              </div>
            )
          }
        />
        <StatTile
          size="lg"
          icon="queue"
          tone="warn"
          label="Pending"
          value={String(pendingTotal)}
          footer={
            <Segments
              label={`${k.pendingByStatus.READY} ready, ${k.pendingByStatus.NEEDS_CITIZEN_CORRECTION} correction, ${k.pendingByStatus.OFFICER_ATTENTION} attention`}
              parts={[
                { label: 'ready', value: k.pendingByStatus.READY, color: SERIES[0].color },
                {
                  label: 'correction',
                  value: k.pendingByStatus.NEEDS_CITIZEN_CORRECTION,
                  color: SERIES[1].color,
                },
                {
                  label: 'attention',
                  value: k.pendingByStatus.OFFICER_ATTENTION,
                  color: SERIES[2].color,
                },
              ]}
            />
          }
        />
      </div>
      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatTile size="sm" icon="sparkle" label="Screened today" value={String(k.screenedToday)} />
        <StatTile size="sm" icon="notice" label="Notices sent" value={String(k.noticesSent)} />
        <StatTile
          size="sm"
          icon="calendar"
          label="Avg days pending"
          value={k.avgDaysPending === null ? '—' : `${k.avgDaysPending}`}
        />
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-[1.2fr_1fr]">
        <Card aria-labelledby="def-title">
          <CardHeader
            titleId="def-title"
            icon="alert"
            title="What citizens get wrong most"
            subtitle="Corrections asked of applicants — feeds awareness drives at camps and offices."
          />
          <div className="px-6 pb-5 pt-3">
            {d.deficiencies.length ? (
              <div
                style={{ height: Math.max(240, d.deficiencies.length * 38 + 20) }}
                role="img"
                aria-label={`Top deficiencies: ${d.deficiencies.map((x) => `${x.title} ${x.count}`).join(', ')}`}
              >
                <ResponsiveContainer>
                  <BarChart
                    data={d.deficiencies}
                    layout="vertical"
                    margin={{ top: 4, right: 44, bottom: 4, left: 8 }}
                    barCategoryGap={8}
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
                      width={210}
                      tick={{ fill: INK.secondary, fontSize: AXIS_FONT }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <Tooltip
                      cursor={{ fill: 'rgba(15,158,142,0.08)' }}
                      formatter={(v) => [String(v), 'Cases']}
                      contentStyle={{ borderRadius: 10, borderColor: INK.grid, fontSize: 13 }}
                    />
                    <Bar dataKey="count" fill={TEAL} radius={[0, 4, 4, 0]} maxBarSize={24}>
                      <LabelList
                        dataKey="count"
                        position="right"
                        fill={INK.primary}
                        fontSize={13}
                        fontWeight={700}
                      />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <p className="mt-6 text-sm text-ink-muted">No citizen corrections yet.</p>
            )}
          </div>
        </Card>

        <Card aria-labelledby="watch-title">
          <CardHeader
            titleId="watch-title"
            icon="users"
            title="Priority watch"
            subtitle="Vulnerable applicants still pending after 30 days."
          />
          <div className="grid gap-3 p-5 sm:grid-cols-2">
            {d.priorityWatch.map((w) => (
              <div
                key={w.key}
                className={`rounded-xl border p-4 ${w.count ? 'border-warm-200 bg-warm-50/60' : 'border-line bg-slate-50/50'}`}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-semibold text-navy-900">{w.label}</span>
                  <span
                    className={`text-[1.9rem] font-bold leading-none tabular-nums ${w.count ? 'text-warm-700' : 'text-ink-muted'}`}
                  >
                    {w.count}
                  </span>
                </div>
                <ul className="mt-2.5 space-y-1 text-[0.88rem]">
                  {w.cases.slice(0, 3).map((c) => (
                    <li key={c.id} className="flex justify-between gap-2">
                      <Link
                        to={`/cases/${c.id}`}
                        className="truncate font-medium text-navy-800 hover:text-teal-deep hover:underline"
                      >
                        {c.applicantName ?? c.reference}
                      </Link>
                      <span className="shrink-0 tabular-nums text-ink-muted">
                        {c.daysPending} d
                      </span>
                    </li>
                  ))}
                  {!w.cases.length && (
                    <li className="flex items-center gap-1.5 text-ink-muted">
                      <Icon name="check" size={14} /> None overdue
                    </li>
                  )}
                </ul>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <DistrictSection d={d} />
    </>
  );
}

function DistrictSection({ d }: { d: Dashboard }) {
  const [view, setView] = useState<'chart' | 'table'>('chart');
  const rows = d.districts;
  return (
    <Card className="mt-5" aria-labelledby="district-title">
      <CardHeader
        titleId="district-title"
        icon="building"
        title="District-wise"
        subtitle="Applications received and where they stand, all 16 districts."
        actions={
          <Tabs
            label="District view"
            size="sm"
            value={view}
            onChange={setView}
            items={[
              { value: 'chart', label: 'Chart' },
              { value: 'table', label: 'Table' },
            ]}
          />
        }
      />
      <div className="px-6 pb-5">
        {view === 'chart' && (
          <ul
            className="mt-4 flex flex-wrap gap-5 text-sm font-medium text-ink-soft"
            aria-label="Legend"
          >
            {SERIES.map((s) => (
              <li key={s.key} className="flex items-center gap-1.5">
                <span
                  className="inline-block h-3.5 w-3.5 rounded"
                  style={{ background: s.color }}
                />
                {s.label}
              </li>
            ))}
          </ul>
        )}
        {view === 'chart' ? (
          <div className="mt-2" style={{ height: Math.max(260, rows.length * 32 + 30) }}>
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
                  width={120}
                  tick={{ fill: INK.secondary, fontSize: AXIS_FONT }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  cursor={{ fill: 'rgba(10,27,51,0.05)' }}
                  contentStyle={{ borderRadius: 10, borderColor: INK.grid, fontSize: 13 }}
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
          <div className="mt-4">
            <Table>
              <thead>
                <tr>
                  <Th>District</Th>
                  <Th align="right">Received</Th>
                  {SERIES.map((s) => (
                    <Th key={s.key} align="right">
                      <span
                        className="mr-1.5 inline-block h-2.5 w-2.5 rounded-sm align-middle"
                        style={{ background: s.color }}
                      />
                      {s.label}
                    </Th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <Tr key={r.district}>
                    <Td className="font-semibold text-navy-900">{r.district}</Td>
                    <Td align="right">{r.received}</Td>
                    <Td align="right">{r.ready}</Td>
                    <Td align="right">{r.correction}</Td>
                    <Td align="right">{r.attention}</Td>
                    <Td align="right">{r.approved}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </div>
        )}
      </div>
    </Card>
  );
}

function DashboardSkeleton() {
  return (
    <div aria-busy>
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-36" />
        ))}
      </div>
      <div className="mt-5 grid gap-5 xl:grid-cols-2">
        <Skeleton className="h-80" />
        <Skeleton className="h-80" />
      </div>
    </div>
  );
}
