import fs from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { eq } from 'drizzle-orm';
import { auditLog, documents, extractions } from '../src/db/schema.js';
import { FakeVision, FULL_AADHAAR, makeImage, packetVision } from './helpers.js';
import { setupApp, type TestApp } from './setup.js';

let t: TestApp;
afterEach(() => t?.cleanup());

const PACKET_FILES = ['form.jpg', 'aadhaar.jpg', 'passbook.jpg', 'epic.jpg'];
const COLORS = ['#f4f1e8', '#e8f0f4', '#f4e8ef', '#e9f4e8'];

async function postPacket(app: TestApp['app'], seed = 0) {
  let req = request(app).post('/api/cases');
  for (const [i, name] of PACKET_FILES.entries()) {
    req = req.attach('files', await makeImage(COLORS[i]!, 900, 600, `SPECIMEN ${seed}-${i}`), {
      filename: name,
      contentType: 'image/jpeg',
    });
  }
  return req;
}

describe('POST /api/cases → full pipeline (mocked Claude)', () => {
  it('screens a clean packet and persists documents, extractions, flags and audit', async () => {
    t = setupApp(packetVision());
    const res = await postPacket(t.app);
    expect(res.status).toBe(202);
    expect(res.body).toMatchObject({
      reference: expect.stringMatching(/^THD-\d{4}-0001$/),
      documents: 4,
    });
    await t.pipeline.whenIdle();

    const detail = await request(t.app).get(`/api/cases/${res.body.caseId}`);
    expect(detail.status).toBe(200);
    expect(detail.body.case).toMatchObject({
      status: 'READY',
      processingState: 'SCREENED',
      applicantName: 'Thokchom Ibemcha Devi',
      aadhaarMasked: `XXXX XXXX ${FULL_AADHAAR.slice(8)}`,
      source: 'api',
    });
    expect(detail.body.documents.map((d: { detectedType: string }) => d.detectedType)).toEqual([
      'application_form',
      'aadhaar',
      'bank_passbook',
      'epic',
    ]);
    expect(detail.body.documents.every((d: { state: string }) => d.state === 'EXTRACTED')).toBe(
      true,
    );
    expect(detail.body.documents[1].extraction.fields.name.value).toBe('Thokchom Ibemcha Devi');

    const db = t.handle.db;
    expect(db.select().from(documents).all()).toHaveLength(4);
    expect(db.select().from(extractions).all()).toHaveLength(8); // classify + extract per image
    const audit = db.select().from(auditLog).all();
    const count = (a: string) => audit.filter((r) => r.action === a).length;
    expect(count('CASE_CREATED')).toBe(1);
    expect(count('DOCUMENT_UPLOADED')).toBe(4);
    expect(count('AI_CLASSIFICATION')).toBe(4);
    expect(count('AI_EXTRACTION')).toBe(4);
    expect(count('RULE_RESULT')).toBe(1);
    const ai = audit.find((r) => r.action === 'AI_EXTRACTION')!;
    expect(ai.after).toMatchObject({
      model: 'claude-sonnet-5-5',
      latencyMs: 1234,
      inputTokens: 1500,
      outputTokens: 400,
      cacheHit: false,
    });
    expect(audit.find((r) => r.action === 'RULE_RESULT')!.after).toMatchObject({ status: 'READY' });

    // Original + processed images are kept.
    const doc = db.select().from(documents).all()[0]!;
    expect(fs.existsSync(doc.storedPath)).toBe(true);
    expect(fs.existsSync(doc.processedPath)).toBe(true);
  });

  it('emits SSE progress in order: uploaded → classifying → extracting → screening → done', async () => {
    t = setupApp(packetVision());
    const res = await postPacket(t.app);
    await t.pipeline.whenIdle();
    const stages = t.events
      .filter((e) => e.type === 'case' && e.caseId === res.body.caseId)
      .map((e) => (e.type === 'case' ? e.stage : ''));
    expect(stages).toEqual(['uploaded', 'classifying', 'extracting', 'screening', 'done']);
    const docEvents = t.events.filter((e) => e.type === 'document');
    expect(docEvents.filter((e) => e.type === 'document' && e.stage === 'extracted')).toHaveLength(
      4,
    );
    const done = t.events.at(-1);
    expect(done).toMatchObject({ type: 'case', stage: 'done', status: 'READY' });
  });

  it('Claude down, no cache → OFFICER_ATTENTION with "extraction failed — manual review", never crashes', async () => {
    t = setupApp(
      new FakeVision(() => {
        throw new Error('Could not reach the Claude API');
      }),
    );
    const res = await postPacket(t.app);
    await t.pipeline.whenIdle();
    const detail = await request(t.app).get(`/api/cases/${res.body.caseId}`);
    expect(detail.body.case).toMatchObject({
      status: 'OFFICER_ATTENTION',
      processingState: 'EXTRACTION_FAILED',
    });
    const codes = detail.body.flags.map((f: { code: string }) => f.code);
    expect(codes).toContain('EXTRACTION_FAILED');
    expect(codes).not.toContain('MISSING_DOCUMENT');
    expect(
      detail.body.flags.find((f: { code: string }) => f.code === 'EXTRACTION_FAILED').reason,
    ).toMatch(/extraction failed — manual review/i);
    expect(detail.body.notice.allowed).toBe(false);
  });

  it('DEMO_MODE=cache_first replays a packet with zero Claude calls', async () => {
    const vision = packetVision();
    t = setupApp(vision, 'cache_first');
    await postPacket(t.app, 7);
    await t.pipeline.whenIdle();
    const callsAfterFirst = vision.calls.length;
    const res = await postPacket(t.app, 7); // identical images
    await t.pipeline.whenIdle();
    expect(vision.calls.length).toBe(callsAfterFirst);
    const detail = await request(t.app).get(`/api/cases/${res.body.caseId}`);
    expect(detail.body.documents.every((d: { cacheHit: boolean }) => d.cacheHit)).toBe(true);
  });

  it('an undecodable image is stored, marked failed, and routed to the officer', async () => {
    t = setupApp(packetVision());
    const res = await request(t.app)
      .post('/api/cases')
      .attach('files', await makeImage('#fff'), { filename: 'form.jpg', contentType: 'image/jpeg' })
      .attach('files', Buffer.from('not really a jpeg'), {
        filename: 'aadhaar.jpg',
        contentType: 'image/jpeg',
      });
    expect(res.status).toBe(202);
    await t.pipeline.whenIdle();
    const detail = await request(t.app).get(`/api/cases/${res.body.caseId}`);
    expect(detail.body.documents[1].state).toBe('FAILED');
    expect(detail.body.case.status).toBe('OFFICER_ATTENTION');
  });

  it('rejects empty and oversized packets', async () => {
    t = setupApp(packetVision());
    expect((await request(t.app).post('/api/cases')).status).toBe(400);
    let req = request(t.app).post('/api/cases');
    for (let i = 0; i < 7; i++)
      req = req.attach('files', await makeImage('#eee'), {
        filename: `p${i}.jpg`,
        contentType: 'image/jpeg',
      });
    expect((await req).status).toBe(400);
  });
});

describe('duplicates from the database', () => {
  it('a second application with the same Aadhaar last-4 + DOB + name → DUPLICATE_SUSPECTED, notice blocked', async () => {
    t = setupApp(packetVision({ bank_passbook: { ifsc: 'BAD' } }));
    const first = await postPacket(t.app, 1);
    await t.pipeline.whenIdle();
    const second = await postPacket(t.app, 2);
    await t.pipeline.whenIdle();

    const a = await request(t.app).get(`/api/cases/${first.body.caseId}`);
    expect(a.body.case.status).toBe('NEEDS_CITIZEN_CORRECTION');
    expect(a.body.notice.allowed).toBe(true);

    const b = await request(t.app).get(`/api/cases/${second.body.caseId}`);
    const dup = b.body.flags.find((f: { code: string }) => f.code === 'DUPLICATE_SUSPECTED');
    expect(dup.reason).toContain(a.body.case.reference);
    expect(b.body.case.status).toBe('OFFICER_ATTENTION');
    expect(b.body.notice).toMatchObject({ allowed: false, blockedBy: ['DUPLICATE_SUSPECTED'] });
  });

  it('GET /api/cases filters by status and sorts by priority', async () => {
    t = setupApp(packetVision());
    await postPacket(t.app, 3);
    await t.pipeline.whenIdle();
    const ready = await request(t.app).get('/api/cases?status=READY');
    expect(ready.body.cases).toHaveLength(1);
    expect(
      (await request(t.app).get('/api/cases?status=OFFICER_ATTENTION')).body.cases,
    ).toHaveLength(0);
  });

  it('extraction rows for a document are queryable by case', async () => {
    t = setupApp(packetVision());
    const res = await postPacket(t.app, 4);
    await t.pipeline.whenIdle();
    const rows = t.handle.db
      .select()
      .from(extractions)
      .where(eq(extractions.caseId, res.body.caseId))
      .all();
    expect(rows.every((r) => r.status === 'OK')).toBe(true);
  });
});
