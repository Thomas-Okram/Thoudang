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
/** UUIDs and SHA-256 hex can contain 12-digit runs by chance (same rule as src/leak-scan.ts). */
const NOISE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|\b[0-9a-f]{64}\b/gi;

describe('no full Aadhaar number is ever persisted, logged or served', () => {
  it('Claude returns the full number in fields AND notes → DB file, logs, API and SSE stay clean', async () => {
    // packetVision returns the full number on the form, on the card, and inside the Aadhaar notes.
    t = await setupApp(packetVision());
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
      (await t.handle.db.select().from(extractions)).map((r) => r.result),
      (await t.handle.db.select().from(extractionCache)).map((r) => r.result),
    ]);
    expect(containsFullAadhaar(stored)).toBe(false);

    // 3. Raw storage. SQLite: the database file + WAL bytes. Postgres: every text/json column of
    //    every table, read via SQL.
    if (t.handle.sqlite) {
      t.handle.sqlite.pragma('wal_checkpoint(TRUNCATE)');
      for (const file of [t.dbPath, `${t.dbPath}-wal`]) {
        if (fs.existsSync(file))
          expect(leaks(fs.readFileSync(file).toString('latin1'))).toEqual([]);
      }
    } else {
      const columns = await t.handle.raw.all<{ table_name: string; column_name: string }>(
        `SELECT table_name, column_name FROM information_schema.columns
          WHERE table_schema = 'public'
            AND data_type IN ('text', 'jsonb', 'json', 'character varying')`,
      );
      expect(columns.length).toBeGreaterThan(20);
      let values = 0;
      for (const { table_name, column_name } of columns) {
        const rows = await t.handle.raw.all<{ v: string | null }>(
          `SELECT "${column_name}"::text AS v FROM "${table_name}"`,
        );
        for (const { v } of rows) {
          if (v === null) continue;
          values += 1;
          expect(leaks(v), `${table_name}.${column_name}`).toEqual([]);
          expect(containsFullAadhaar(v.replace(NOISE, '')), `${table_name}.${column_name}`).toBe(
            false,
          );
        }
      }
      expect(values).toBeGreaterThan(0);
    }

    // 4. Log file
    expect(fs.existsSync(t.logFile)).toBe(true);
    expect(leaks(fs.readFileSync(t.logFile, 'utf8'))).toEqual([]);

    // 5. SSE events
    expect(leaks(JSON.stringify(t.events))).toEqual([]);
  });

  it('the logger itself redacts numbers passed to it', async () => {
    t = await setupApp(packetVision());
    const { createLogger } = await import('../src/logger.js');
    const log = createLogger({ file: t.logFile, console: false });
    log.warn(`oops ${FULL_AADHAAR}`, { detail: FORMS[1] });
    expect(leaks(fs.readFileSync(t.logFile, 'utf8'))).toEqual([]);
  });
});
