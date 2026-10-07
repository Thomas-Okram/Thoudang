import fs from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { containsFullAadhaar } from '@thoudang/core';
import { extractionCache, extractions } from '../src/db/schema.js';
import { FULL_AADHAAR, makeImage, packetVision } from './helpers.js';
import { setupApp, type TestApp } from './setup.js';

let t: TestApp;
afterEach(() => t?.cleanup());

/** Every way the synthetic number could appear as text. */
const FORMS = [
  FULL_AADHAAR,
  `${FULL_AADHAAR.slice(0, 4)} ${FULL_AADHAAR.slice(4, 8)} ${FULL_AADHAAR.slice(8)}`,
  `${FULL_AADHAAR.slice(0, 4)}-${FULL_AADHAAR.slice(4, 8)}-${FULL_AADHAAR.slice(8)}`,
];
const leaks = (text: string) => FORMS.filter((f) => text.includes(f));

describe('no full Aadhaar number is ever persisted, logged or served', () => {
  it('Claude returns the full number in fields AND notes → DB file, logs, API and SSE stay clean', async () => {
    // packetVision returns the full number on the form, on the card, and inside the Aadhaar notes.
    t = setupApp(packetVision());
    let req = request(t.app).post('/api/cases');
    for (const name of ['form.jpg', 'aadhaar.jpg', 'passbook.jpg']) {
      req = req.attach('files', await makeImage('#fafafa', 700, 500, name), {
        filename: name,
        contentType: 'image/jpeg',
      });
    }
    const created = await req;
    await t.pipeline.whenIdle();

    // 1. API responses
    const detail = await request(t.app).get(`/api/cases/${created.body.caseId}`);
    const list = await request(t.app).get('/api/cases');
    expect(leaks(JSON.stringify(detail.body))).toEqual([]);
    expect(leaks(JSON.stringify(list.body))).toEqual([]);
    expect(detail.body.case.aadhaarMasked).toBe(`XXXX XXXX ${FULL_AADHAAR.slice(8)}`);

    // 2. Stored extraction results + cache (text columns) — generic scanner too
    const stored = JSON.stringify([
      t.handle.db
        .select()
        .from(extractions)
        .all()
        .map((r) => r.result),
      t.handle.db
        .select()
        .from(extractionCache)
        .all()
        .map((r) => r.result),
    ]);
    expect(containsFullAadhaar(stored)).toBe(false);

    // 3. Raw SQLite file + WAL
    t.handle.sqlite.pragma('wal_checkpoint(TRUNCATE)');
    for (const file of [t.dbPath, `${t.dbPath}-wal`]) {
      if (fs.existsSync(file)) expect(leaks(fs.readFileSync(file).toString('latin1'))).toEqual([]);
    }

    // 4. Log file
    expect(fs.existsSync(t.logFile)).toBe(true);
    expect(leaks(fs.readFileSync(t.logFile, 'utf8'))).toEqual([]);

    // 5. SSE events
    expect(leaks(JSON.stringify(t.events))).toEqual([]);
  });

  it('the logger itself redacts numbers passed to it', async () => {
    t = setupApp(packetVision());
    const { createLogger } = await import('../src/logger.js');
    const log = createLogger({ file: t.logFile, console: false });
    log.warn(`oops ${FULL_AADHAAR}`, { detail: FORMS[1] });
    expect(leaks(fs.readFileSync(t.logFile, 'utf8'))).toEqual([]);
  });
});
