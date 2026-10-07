import { ageOn, flagTitle } from '@thoudang/core';
import type { Db } from './db/client.js';
import { cases, flags } from './db/schema.js';

const DAY = 86_400_000;
const istDate = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

export type WatchCategory = 'age80' | 'widow' | 'disability' | 'displaced';
const WATCH: Record<WatchCategory, { label: string; test: (r: string) => boolean }> = {
  age80: { label: 'Aged 80+', test: (r) => r.startsWith('Age ') },
  widow: { label: 'Widows', test: (r) => r === 'Widowed' },
  disability: { label: 'Persons with disability', test: (r) => r === 'Person with disability' },
  displaced: { label: 'Displaced (address)', test: (r) => r.startsWith('Displaced') },
};

/** Department dashboard aggregates. Includes synthetic historical cases (flagged in the response). */
export function dashboard(db: Db, now = new Date(), opts: { includeHistorical?: boolean } = {}) {
  const include = opts.includeHistorical ?? true;
  const rows = db
    .select()
    .from(cases)
    .all()
    .filter((c) => include || !c.historical);
  const ids = new Set(rows.map((r) => r.id));
  const flagRows = db
    .select()
    .from(flags)
    .all()
    .filter((f) => ids.has(f.caseId) && f.resolution !== 'OVERRIDDEN');
  const today = istDate(now);
  const pending = rows.filter((r) => r.status !== 'APPROVED_BY_OFFICER');
  const screened = rows.filter((r) => r.screenedAt);
  const timed = screened
    .map((r) => r.screenedAt!.getTime() - r.receivedAt.getTime())
    .filter((ms) => ms >= 0);
  const firstScreened = rows.filter((r) => r.firstScreenStatus);
  const daysPending = (r: (typeof rows)[number]) =>
    Math.max(0, Math.floor((now.getTime() - r.receivedAt.getTime()) / DAY));
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

  const kpis = {
    received: rows.length,
    screenedToday: screened.filter((r) => istDate(r.screenedAt!) === today).length,
    avgScreeningMs: timed.length ? Math.round(avg(timed)!) : null,
    firstTimeRight: firstScreened.length
      ? firstScreened.filter((r) => r.firstScreenStatus === 'READY').length / firstScreened.length
      : null,
    pendingByStatus: {
      READY: rows.filter((r) => r.status === 'READY').length,
      NEEDS_CITIZEN_CORRECTION: rows.filter((r) => r.status === 'NEEDS_CITIZEN_CORRECTION').length,
      OFFICER_ATTENTION: rows.filter((r) => r.status === 'OFFICER_ATTENTION').length,
    },
    approved: rows.filter((r) => r.status === 'APPROVED_BY_OFFICER').length,
    noticesSent: rows.filter((r) => r.noticeSentAt).length,
    avgDaysPending: pending.length ? Number(avg(pending.map(daysPending))!.toFixed(1)) : null,
  };

  // What citizens get wrong most — citizen-correctable flags still in force.
  const byCode = new Map<string, number>();
  for (const f of flagRows.filter((x) => x.action === 'citizen'))
    byCode.set(f.code, (byCode.get(f.code) ?? 0) + 1);
  const deficiencies = [...byCode.entries()]
    .map(([code, n]) => ({ code, title: flagTitle(code), count: n }))
    .sort((a, b) => b.count - a.count || a.title.localeCompare(b.title))
    .slice(0, 8);

  const districtMap = new Map<
    string,
    {
      district: string;
      received: number;
      ready: number;
      correction: number;
      attention: number;
      approved: number;
    }
  >();
  for (const r of rows) {
    const key = r.district ?? 'Not stated';
    const d = districtMap.get(key) ?? {
      district: key,
      received: 0,
      ready: 0,
      correction: 0,
      attention: 0,
      approved: 0,
    };
    d.received += 1;
    if (r.status === 'READY') d.ready += 1;
    if (r.status === 'NEEDS_CITIZEN_CORRECTION') d.correction += 1;
    if (r.status === 'OFFICER_ATTENTION') d.attention += 1;
    if (r.status === 'APPROVED_BY_OFFICER') d.approved += 1;
    districtMap.set(key, d);
  }
  const districts = [...districtMap.values()].sort(
    (a, b) => b.received - a.received || a.district.localeCompare(b.district),
  );

  const overdue = pending.filter((r) => daysPending(r) > 30);
  const priorityWatch = (Object.keys(WATCH) as WatchCategory[]).map((key) => {
    const list = overdue
      .filter((r) => r.priorityReasons.some(WATCH[key].test))
      .sort((a, b) => daysPending(b) - daysPending(a));
    return {
      key,
      label: WATCH[key].label,
      count: list.length,
      cases: list.slice(0, 5).map((r) => ({
        id: r.id,
        reference: r.reference,
        applicantName: r.applicantName,
        district: r.district,
        daysPending: daysPending(r),
        age: r.applicantDob ? (ageOn(r.applicantDob, today)?.years ?? null) : null,
        historical: r.historical,
      })),
    };
  });

  return {
    generatedAt: now.toISOString(),
    historicalIncluded: include ? rows.filter((r) => r.historical).length : 0,
    kpis,
    deficiencies,
    districts,
    priorityWatch,
  };
}
