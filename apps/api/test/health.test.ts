import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { openDb } from '../src/db/client.js';
import { createApp } from '../src/app.js';

const handle = openDb(':memory:');
const app = createApp({ db: handle.db, anthropicConfigured: false });
afterAll(() => handle.close());

describe('GET /api/health', () => {
  it('reports ok with a live database', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'ok', db: 'ok', claudeConfigured: false });
  });

  it('returns JSON 404 for unknown API routes', async () => {
    const res = await request(app).get('/api/nope');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Not found' });
  });
});
