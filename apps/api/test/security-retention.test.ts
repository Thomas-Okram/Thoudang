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
const close = async (id: string, daysAgo: number) =>
  await t.handle.db
    .update(cases)
    .set({ status: 'APPROVED_BY_OFFICER', decidedAt: new Date(NOW.getTime() - daysAgo * DAY) })
    .where(eq(cases.id, id));
const filesOf = async (id: string) =>
  (await t.handle.db.select().from(documents).where(eq(documents.caseId, id))).flatMap((d) => [
    d.storedPath,
    d.processedPath,
  ]);

describe('data retention', () => {
  it('deletes images of cases closed more than N days ago, keeping masked data and audit', async () => {
    t = await setupApp(packetVision());
    const old = await makeCase('a');
    const recent = await makeCase('b');
    const open = await makeCase('c');
    await close(old, 31);
    await close(recent, 10);
    const oldFiles = await filesOf(old);
    expect(oldFiles.every((f) => fs.existsSync(f))).toBe(true);
    const before = {
      extractions: (await t.handle.db.select().from(extractions).where(eq(extractions.caseId, old)))
        .length,
      flags: (await t.handle.db.select().from(flags).where(eq(flags.caseId, old))).length,
    };

    const dry = await runRetention({
      db: t.handle.db,
      uploadsDir: t.config.uploadsDir,
      days: 30,
      now: NOW,
      dryRun: true,
    });
    expect(dry.cases).toEqual([old]);
    expect(oldFiles.every((f) => fs.existsSync(f))).toBe(true);

    const res = await runRetention({
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
    for (const id of [recent, open])
      expect((await filesOf(id)).every((f) => fs.existsSync(f))).toBe(true);

    // Masked extracted data, flags, the case and the audit trail survive.
    expect(
      await t.handle.db.select().from(extractions).where(eq(extractions.caseId, old)),
    ).toHaveLength(before.extractions);
    expect(await t.handle.db.select().from(flags).where(eq(flags.caseId, old))).toHaveLength(
      before.flags,
    );
    const detail = await request(t.app).get(`/api/cases/${old}`);
    expect(detail.status).toBe(200);
    const purge = await t.handle.db.select().from(auditLog).where(eq(auditLog.caseId, old));
    expect(
      purge.some((a) => (a.action as string) === 'IMAGES_PURGED' && a.actor === 'system:retention'),
    ).toBe(true);
    expect(purge.some((a) => a.action === 'CASE_CREATED')).toBe(true);

    // The image endpoint degrades to a clean 404, not a crash.
    const docId = (
      await t.handle.db.select().from(documents).where(eq(documents.caseId, old)).limit(1)
    )[0]!.id;
    expect((await request(t.app).get(`/api/documents/${docId}/image`)).status).toBe(404);

    // Idempotent: a second run finds nothing to do.
    expect(
      (await runRetention({ db: t.handle.db, uploadsDir: t.config.uploadsDir, days: 30, now: NOW }))
        .cases,
    ).toEqual([]);
  });

  it('days = 0 disables retention', async () => {
    t = await setupApp(packetVision());
    const id = await makeCase('d');
    await close(id, 400);
    expect(
      (await runRetention({ db: t.handle.db, uploadsDir: t.config.uploadsDir, days: 0, now: NOW }))
        .cases,
    ).toEqual([]);
    expect((await filesOf(id)).every((f) => fs.existsSync(f))).toBe(true);
  });
});
