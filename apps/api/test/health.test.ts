import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { openDb } from '../src/db/client.js';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/env.js';
import { silentLogger } from '../src/logger.js';

const handle = openDb(':memory:');
const config = loadConfig({ UPLOADS_DIR: path.join(os.tmpdir(), 'thoudang-health-test') });
const { app } = createApp({ db: handle.db, config, vision: null, logger: silentLogger });
afterAll(() => handle.close());

describe('GET /api/health', () => {
  it('reports ok with a live database, demo mode and model', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: 'ok',
      db: 'ok',
      claudeConfigured: false,
      demoMode: 'live',
      model: 'claude-sonnet-5-5',
    });
  });

  it('returns JSON 404 for unknown API routes', async () => {
    const res = await request(app).get('/api/nope');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Not found' });
  });
});
