import fs from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { auditLog, cases, extractionCache } from '../src/db/schema.js';
import { dashboard } from '../src/dashboard.js';
import { generateHistoricalCases, seedHistorical } from '../src/demo/historical.js';
import { FULL_AADHAAR, makeImage, packetVision } from './helpers.js';
import { setupApp, type TestApp } from './setup.js';

let t: TestApp;
afterEach(() => t?.cleanup());

const NOW = new Date('2026-10-08T06:00:00Z');

async function liveCase() {
  let req = request(t.app).post('/api/cases');
  for (const [name, type] of [
    ['form.jpg', 'application_form'],
    ['aadhaar.jpg', 'aadhaar'],
    ['passbook.jpg', 'bank_passbook'],
  ] as const) {
    req = req
      .field('types', type)
      .attach('files', await makeImage('#f1f1f1', 400, 300, `${Math.random()}`), {
        filename: name,
        contentType: 'image/jpeg',
      });
  }
  const res = await req;
  await t.pipeline.whenIdle();
  return res.body.caseId as string;
}

describe('synthetic historical cases (seed:dashboard)', () => {
  it('are deterministic, spread across 16 districts and clearly synthetic', () => {
    const a = generateHistoricalCases(400, 7, NOW);
    const b = generateHistoricalCases(400, 7, NOW);
    expect(a.map((c) => c.row.applicantName)).toEqual(b.map((c) => c.row.applicantName));
    expect(new Set(a.map((c) => c.row.district)).size).toBe(16);
    expect(
      a.every(
        (c) =>
          c.row.historical && c.row.reference!.startsWith('HIST-') && c.row.aadhaarLast4 === null,
      ),
    ).toBe(true);
  });

  it('do not shift live reference numbering', async () => {
    t = await setupApp(packetVision());
    await seedHistorical(t.handle.db, 25, 1, NOW);
    await liveCase();
    const [c] = (await request(t.app).get('/api/cases')).body.cases;
    expect(c.reference).toMatch(/^THD-\d{4}-0001$/);
  });

  it('stay out of the live queue and its stats by default', async () => {
    t = await setupApp(packetVision());
    await seedHistorical(t.handle.db, 30, 1, NOW);
    await liveCase();
    expect((await request(t.app).get('/api/cases')).body.cases).toHaveLength(1);
    expect((await request(t.app).get('/api/stats')).body.total).toBe(1);
  });
});

describe('dashboard aggregation', () => {
  it('computes KPIs, top deficiencies, districts and the priority watch consistently', async () => {
    t = await setupApp(packetVision());
    await seedHistorical(t.handle.db, 120, 3, NOW);
    const d = await dashboard(t.handle.db, NOW);
    const k = d.kpis;
    expect(k.received).toBe(120);
    expect(
      k.pendingByStatus.READY +
        k.pendingByStatus.NEEDS_CITIZEN_CORRECTION +
        k.pendingByStatus.OFFICER_ATTENTION +
        k.approved,
    ).toBe(120);
    expect(d.districts.reduce((s, x) => s + x.received, 0)).toBe(120);
    expect(k.firstTimeRight).toBeGreaterThan(0.3);
    expect(k.firstTimeRight).toBeLessThan(0.8);
    expect(d.historicalIncluded).toBe(120);
    // deficiencies: citizen codes only, sorted by count
    const counts = d.deficiencies.map((x) => x.count);
    expect(counts).toEqual([...counts].sort((a, b) => b - a));
    expect(d.deficiencies.every((x) => !['NAME_AMBIGUOUS'].includes(x.code))).toBe(true);
    expect(d.deficiencies[0]!.title).toBeTruthy();
    // priority watch: only pending > 30 days
    for (const w of d.priorityWatch)
      for (const c of w.cases) expect(c.daysPending).toBeGreaterThan(30);
    expect(d.priorityWatch.map((w) => w.label)).toEqual([
      'Aged 80+',
      'Widows',
      'Persons with disability',
      'Displaced (address)',
    ]);
  });

  it('GET /api/dashboard can exclude historical cases', async () => {
    t = await setupApp(packetVision());
    await seedHistorical(t.handle.db, 20, 2, NOW);
    await liveCase();
    expect((await request(t.app).get('/api/dashboard')).body.kpis.received).toBe(21);
    const live = (await request(t.app).get('/api/dashboard?historical=exclude')).body;
    expect(live.kpis).toMatchObject({ received: 1, screenedToday: expect.any(Number) });
    expect(live.kpis.firstTimeRight).toBe(1);
  });
});

describe('trust report', () => {
  it('without an eval report it explains how to produce one; fairness shows the dev set', async () => {
    t = await setupApp(packetVision());
    const r = (await request(t.app).get('/api/trust')).body;
    expect(r.evaluation).toMatchObject({ available: false });
    expect(r.fairness.dev).toMatchObject({ label: 'Development set', pairs: 58 });
    expect(r.fairness.holdout).toBeNull();
    expect(r.safeguards).toMatchObject({ rejectStatusExists: false, notices: { aiCalls: 0 } });
    expect(r.limitations.some((l: string) => /unverified/.test(l))).toBe(true);
  });

  it('reads the latest eval report (₹ per application) and a held-out fairness set', async () => {
    t = await setupApp(packetVision());
    fs.writeFileSync(
      t.config.evalReportPath,
      JSON.stringify({
        generatedAt: '2026-10-08T01:00:00Z',
        model: 'claude-sonnet-5-5',
        mode: 'live',
        labelled: true,
        dataset: 'eval-data',
        summary: {
          packets: 3,
          fieldsScored: 80,
          fieldAccuracy: 0.95,
          classificationAccuracy: 1,
          statusAccuracy: 1,
          nameVerdictAccuracy: 1,
          byDocType: [],
          byField: [],
          byConfidence: [],
          latency: { avgApiCallMs: 4000, avgPacketWallMs: 9000 },
          cost: {
            inputTokens: 1,
            outputTokens: 1,
            totalUsd: 0.3,
            avgPerPacketUsd: 0.1,
            pricing: {},
          },
          calls: { api: 9, cacheHits: 0 },
          errors: [],
        },
      }),
    );
    fs.writeFileSync(
      t.config.fairnessHoldoutPath,
      JSON.stringify({
        source: 'holdout-pairs.csv',
        pairs: [{ a: 'Okram Thomas', b: 'Thomas Okram', community: 'Meitei', samePerson: true }],
      }),
    );
    const r = (await request(t.app).get('/api/trust')).body;
    expect(r.evaluation).toMatchObject({
      available: true,
      packets: 3,
      fieldAccuracy: 0.95,
      fixture: false,
      cost: { perApplicationInr: 8.8 },
    });
    // A run that replayed dev:fixtures truth must be labelled as such, never as AI accuracy.
    const file = JSON.parse(fs.readFileSync(t.config.evalReportPath, 'utf8')) as object;
    fs.writeFileSync(t.config.evalReportPath, JSON.stringify({ ...file, fixture: true }));
    expect((await request(t.app).get('/api/trust')).body.evaluation.fixture).toBe(true);
    expect(r.fairness.holdout).toMatchObject({ label: 'Held-out set', pairs: 1, errors: [] });
    expect(r.fairness.holdout.overall).toMatchObject({ falseMatches: 0, labelledAmbiguous: 0 });
  });

  it('holdout v1 marked seen shows as "pre-fix" with its before/after; v2 is the blind set', async () => {
    t = await setupApp(packetVision());
    const pair = { a: 'Laishram Ibomcha Singh', b: 'Laishram Ibocha Singh', community: 'Meitei' };
    fs.writeFileSync(
      t.config.fairnessHoldoutPath,
      JSON.stringify({
        status: 'seen',
        seenOn: '2026-10-08',
        preFix: {
          engine: 'old engine',
          overall: { falseMatches: 1, referred: 0, referralRate: 0 },
        },
        pairs: [{ ...pair, samePerson: false }],
      }),
    );
    let r = (await request(t.app).get('/api/trust')).body;
    expect(r.fairness.holdout).toMatchObject({ label: 'Holdout v1 (pre-fix)', seen: true });
    expect(r.fairness.holdout.preFix.overall.falseMatches).toBe(1);
    // The near-miss given name is now referred, not merged.
    expect(r.fairness.holdout.overall).toMatchObject({ falseMatches: 0, referred: 1 });
    expect(r.fairness.holdoutV2).toBeNull();
    expect(r.limitations.join(' ')).toMatch(/No blind name-engine number yet.*1 → 0 false matches/);

    fs.writeFileSync(
      t.config.fairnessHoldoutV2Path,
      JSON.stringify({ status: 'blind', pairs: [{ ...pair, samePerson: false }] }),
    );
    r = (await request(t.app).get('/api/trust')).body;
    expect(r.fairness.holdoutV2).toMatchObject({ label: 'Holdout v2 (blind)', pairs: 1 });
    expect(r.limitations.join(' ')).toMatch(/blind holdout v2 has 1 pairs \(0 false matches/);
  });

  it('override rate and approvals come from real officer decisions', async () => {
    t = await setupApp(packetVision({ bank_passbook: { ifsc: 'BAD' } }));
    const id = await liveCase();
    const d = (await request(t.app).get(`/api/cases/${id}`)).body;
    for (const f of d.flags.filter((x: { severity: string }) => x.severity !== 'info')) {
      await request(t.app)
        .post(`/api/cases/${id}/flags/${f.id}/resolve`)
        .set('Cookie', t.cookie('dswo-imphal-west'))
        .send({ decision: 'override', reasonCode: 'verified_original' });
    }
    await request(t.app)
      .post(`/api/cases/${id}/approve`)
      .set('Cookie', t.cookie('dswo-imphal-west'))
      .expect(200);
    const s = (await request(t.app).get('/api/trust')).body.safeguards;
    expect(s).toMatchObject({ overrideRate: 1, approvals: 1, approvalsByDswoOnly: true });
    expect(s.imagesRedacted).toBe(2); // form + Aadhaar carry the number; passbook does not
  });

  it('statuses proof link lists exactly four statuses, none of them a rejection', async () => {
    t = await setupApp(packetVision());
    const r = (await request(t.app).get('/api/trust/statuses')).body;
    expect(r.statuses).toEqual([
      'READY',
      'NEEDS_CITIZEN_CORRECTION',
      'OFFICER_ATTENTION',
      'APPROVED_BY_OFFICER',
    ]);
  });
});

describe('on-demand Aadhaar leak scan', () => {
  it('reports clean after real processing, and finds (without repeating) a planted leak', async () => {
    t = await setupApp(packetVision());
    await liveCase();
    const clean = (await request(t.app).post('/api/trust/leak-scan')).body;
    expect(clean.clean).toBe(true);
    expect(clean.scanned.dbRows).toBeGreaterThan(10);
    expect(clean.scanned.apiResponses).toBeGreaterThan(1);

    await t.handle.db.insert(auditLog).values({
      caseId: null,
      actor: 'test',
      action: 'OFFICER_NOTE',
      entityType: 'case',
      after: { text: `oops ${FULL_AADHAAR}` },
    });
    const dirty = await request(t.app).post('/api/trust/leak-scan');
    expect(dirty.body.clean).toBe(false);
    expect(dirty.body.findings).toEqual([
      expect.objectContaining({
        where: 'database',
        location: expect.stringMatching(/^audit_log row \d+$/),
      }),
    ]);
    expect(JSON.stringify(dirty.body)).not.toContain(FULL_AADHAAR);
    expect((await request(t.app).get('/api/trust')).body.safeguards.leakScan.clean).toBe(false);
  });
});

describe('demo reset', () => {
  it('is refused outside demo mode', async () => {
    t = await setupApp(packetVision(), 'live');
    expect((await request(t.app).post('/api/demo/reset')).status).toBe(403);
  });

  it('removes live cases and sessions, keeps cache and historical cases, and is audited', async () => {
    t = await setupApp(packetVision(), 'cache_first');
    await seedHistorical(t.handle.db, 10, 1, NOW);
    await liveCase();
    await request(t.app).post('/api/sessions');
    const cacheRows = (await t.handle.db.select().from(extractionCache)).length;
    const res = await request(t.app).post('/api/demo/reset');
    expect(res.body).toMatchObject({ ok: true, removed: { cases: 1, sessions: 1 } });
    const left = await t.handle.db.select().from(cases);
    expect(left).toHaveLength(10);
    expect(left.every((c) => c.historical)).toBe(true);
    expect((await t.handle.db.select().from(extractionCache)).length).toBe(cacheRows);
    expect((await t.handle.db.select().from(auditLog)).some((a) => a.action === 'DEMO_RESET')).toBe(
      true,
    );
    // replaying the same packet is instant and not a duplicate of anything
    const again = await liveCase();
    expect((await request(t.app).get(`/api/cases/${again}`)).body.case.status).toBe('READY');
  });
});
