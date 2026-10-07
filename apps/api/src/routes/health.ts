import { Router } from 'express';
import { sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import type { DemoMode } from '../env.js';

export function healthRouter(
  db: Db,
  opts: { anthropicConfigured: boolean; demoMode: DemoMode; model: string },
): Router {
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
      demoMode: opts.demoMode,
      model: opts.model,
      time: new Date().toISOString(),
    });
  });
  return router;
}
