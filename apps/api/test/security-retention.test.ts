import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { eq } from 'drizzle-orm';
import { auditLog, cases, documents, extractions, flags } from '../src/db/schema.js';
import { runRetention } from '../src/security/retention.js';
import { makeImage, packetVision } from './helpers.js';
import { setupApp, type TestApp } from './setup.js';

let t: TestApp;
afterEach(() => t?.cleanup());

const DAY = 86_400_000;
const NOW = new Date('2026-12-31T10:00:00Z');

async function makeCase(tag: string): Promise<string> {
  let req = request(t.app).post('/api/cases');
  for (const name of ['form.jpg', 'aadhaar.jpg', 'passbook.jpg'])
    req = req.attach('files', await makeImage('#eeeeee', 400, 300, `${tag}${name}`), name);
  const res = await req;
  expect(res.status).toBe(202);
  await t.pipeline.whenIdle();
  return res.body.caseId as string;
}
const close = (id: string, daysAgo: number) =>
  t.handle.db
    .update(cases)
    .set({ status: 'APPROVED_BY_OFFICER', decidedAt: new Date(NOW.getTime() - daysAgo * DAY) })
    .where(eq(cases.id, id))
    .run();
const filesOf = (id: string) =>
  t.handle.db
    .select()
    .from(documents)
    .where(eq(documents.caseId, id))
    .all()
    .flatMap((d) => [d.storedPath, d.processedPath]);

describe('data retention', () => {
  it('deletes images of cases closed more than N days ago, keeping masked data and audit', async () => {
    t = setupApp(packetVision());
    const old = await makeCase('a');
    const recent = await makeCase('b');
    const open = await makeCase('c');
    close(old, 31);
    close(recent, 10);
    const oldFiles = filesOf(old);
    expect(oldFiles.every((f) => fs.existsSync(f))).toBe(true);
    const before = {
      extractions: t.handle.db.select().from(extractions).where(eq(extractions.caseId, old)).all()
        .length,
      flags: t.handle.db.select().from(flags).where(eq(flags.caseId, old)).all().length,
    };

    const dry = runRetention({
      db: t.handle.db,
      uploadsDir: t.config.uploadsDir,
      days: 30,
      now: NOW,
      dryRun: true,
    });
    expect(dry.cases).toEqual([old]);
    expect(oldFiles.every((f) => fs.existsSync(f))).toBe(true);

    const res = runRetention({
      db: t.handle.db,
      uploadsDir: t.config.uploadsDir,
      days: 30,
      now: NOW,
    });
    expect(res.cases).toEqual([old]);
    expect(res.filesDeleted).toBe(6); // 3 originals + 3 processed
    expect(oldFiles.some((f) => fs.existsSync(f))).toBe(false);
    expect(fs.existsSync(path.join(t.config.uploadsDir, old))).toBe(false);
    // Recent and still-open cases are untouched.
    for (const id of [recent, open]) expect(filesOf(id).every((f) => fs.existsSync(f))).toBe(true);

    // Masked extracted data, flags, the case and the audit trail survive.
    expect(
      t.handle.db.select().from(extractions).where(eq(extractions.caseId, old)).all(),
    ).toHaveLength(before.extractions);
    expect(t.handle.db.select().from(flags).where(eq(flags.caseId, old)).all()).toHaveLength(
      before.flags,
    );
    const detail = await request(t.app).get(`/api/cases/${old}`);
    expect(detail.status).toBe(200);
    const purge = t.handle.db.select().from(auditLog).where(eq(auditLog.caseId, old)).all();
    expect(
      purge.some((a) => (a.action as string) === 'IMAGES_PURGED' && a.actor === 'system:retention'),
    ).toBe(true);
    expect(purge.some((a) => a.action === 'CASE_CREATED')).toBe(true);

    // The image endpoint degrades to a clean 404, not a crash.
    const docId = t.handle.db.select().from(documents).where(eq(documents.caseId, old)).get()!.id;
    expect((await request(t.app).get(`/api/documents/${docId}/image`)).status).toBe(404);

    // Idempotent: a second run finds nothing to do.
    expect(
      runRetention({ db: t.handle.db, uploadsDir: t.config.uploadsDir, days: 30, now: NOW }).cases,
    ).toEqual([]);
  });

  it('days = 0 disables retention', async () => {
    t = setupApp(packetVision());
    const id = await makeCase('d');
    close(id, 400);
    expect(
      runRetention({ db: t.handle.db, uploadsDir: t.config.uploadsDir, days: 0, now: NOW }).cases,
    ).toEqual([]);
    expect(filesOf(id).every((f) => fs.existsSync(f))).toBe(true);
  });
});
