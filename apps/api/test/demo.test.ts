import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { openDb } from '../src/db/client.js';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/env.js';
import { silentLogger } from '../src/logger.js';
import { typeFromName } from '../src/demo/type-from-name.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'thoudang-demo-'));
fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><title>Thoudang</title>');
const handle = openDb(':memory:');
const config = {
  ...loadConfig({ UPLOADS_DIR: path.join(dir, 'uploads'), SERVE_WEB: '1' }),
  webDist: dir,
};
const { app } = createApp({ db: handle.db, config, vision: null, logger: silentLogger });
afterAll(() => {
  handle.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('npm run demo (API serves the built web app)', () => {
  it('serves the SPA for client routes and keeps /api working', async () => {
    for (const route of ['/', '/queue', '/case/abc', '/m/upload/xyz']) {
      const res = await request(app).get(route);
      expect(res.status).toBe(200);
      expect(res.text).toContain('<title>Thoudang</title>');
    }
    expect((await request(app).get('/api/health')).body.status).toBe('ok');
    expect((await request(app).get('/api/nope')).status).toBe(404);
  });
});

describe('demo:prime type guessing', () => {
  it.each([
    ['form.jpg', 'application_form'],
    ['01-Application.JPG', 'application_form'],
    ['aadhar_front.jpg', 'aadhaar'],
    ['bank-passbook.png', 'bank_passbook'],
    ['voter_id.jpg', 'epic'],
    ['IMG_1234.jpg', null],
  ])('%s → %s', (name, type) => expect(typeFromName(name)).toBe(type));
});

describe('fixture rows never block real priming', () => {
  it('purgeFixtures removes only fixture rows for that image', async () => {
    const { purgeFixtures, FIXTURE_MODEL } = await import('../src/demo/fixture-model.js');
    const { extractionCache } = await import('../src/db/schema.js');
    const row = (key: string, sha256: string, model: string) => ({
      key,
      sha256,
      stage: 'classify',
      model,
      promptVersion: 'v1',
      result: {},
      latencyMs: 0,
      inputTokens: 0,
      outputTokens: 0,
    });
    handle.db
      .insert(extractionCache)
      .values([
        row('a', 'img1', FIXTURE_MODEL),
        row('b', 'img1', 'claude-sonnet-5-5'),
        row('c', 'img2', FIXTURE_MODEL),
      ])
      .run();
    expect(purgeFixtures(handle.db, 'img1')).toBe(1);
    expect(
      handle.db
        .select()
        .from(extractionCache)
        .all()
        .map((r) => r.key)
        .sort(),
    ).toEqual(['b', 'c']);
  });
});
