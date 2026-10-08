import { Router } from 'express';
import { rawOf, type Db } from '../db/client.js';
import type { DemoMode } from '../env.js';

export function healthRouter(
  db: Db,
  opts: {
    anthropicConfigured: boolean;
    demoMode: DemoMode;
    model: string;
    demo: boolean;
    ttsConfigured: boolean;
  },
): Router {
  const router = Router();
  router.get('/health', async (_req, res) => {
    let dbOk: boolean;
    try {
      await rawOf(db).all('select 1');
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
      demo: opts.demo,
      ttsConfigured: opts.ttsConfigured,
      time: new Date().toISOString(),
    });
  });
  return router;
}
