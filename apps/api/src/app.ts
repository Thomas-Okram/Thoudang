import express, { type ErrorRequestHandler } from 'express';
import type { Db } from './db/client.js';
import { healthRouter } from './routes/health.js';

export interface AppDeps {
  db: Db;
  anthropicConfigured: boolean;
}

export function createApp(deps: AppDeps): express.Express {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use('/api', healthRouter(deps.db, { anthropicConfigured: deps.anthropicConfigured }));

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  const onError: ErrorRequestHandler = (err: unknown, _req, res, _next) => {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api] unhandled error:', message);
    res.status(500).json({ error: 'Internal error' });
  };
  app.use(onError);
  return app;
}
