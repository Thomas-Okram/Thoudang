import { Router } from 'express';
import { sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';

export function healthRouter(db: Db, opts: { anthropicConfigured: boolean }): Router {
  const router = Router();
  router.get('/health', (_req, res) => {
    let dbOk: boolean;
    try {
      db.get(sql`select 1`);
      dbOk = true;
    } catch {
      dbOk = false;
    }
    res.status(dbOk ? 200 : 503).json({
      status: dbOk ? 'ok' : 'degraded',
      service: 'thoudang-api',
      db: dbOk ? 'ok' : 'error',
      claudeConfigured: opts.anthropicConfigured,
      time: new Date().toISOString(),
    });
  });
  return router;
}
