import fs from 'node:fs';
import path from 'node:path';
import express, { type ErrorRequestHandler } from 'express';
import multer from 'multer';
import type { Db } from './db/client.js';
import type { AppConfig } from './env.js';
import { EventBus } from './events.js';
import { ExtractionService } from './extraction/service.js';
import { createLogger, type Logger } from './logger.js';
import { PacketError, Pipeline } from './pipeline/pipeline.js';
import { casesRouter } from './routes/cases.js';
import { decisionsRouter } from './routes/decisions.js';
import { ensureOfficers, HttpError } from './officers.js';
import { eventsRouter } from './routes/events.js';
import { healthRouter } from './routes/health.js';
import { NotFound, sessionsRouter } from './routes/sessions.js';
import type { VisionClient } from './services/claude.js';
import { SessionStore } from './sessions.js';

export interface AppDeps {
  db: Db;
  config: AppConfig;
  /** null when no API key — the pipeline then serves cached results only. */
  vision: VisionClient | null;
  logger?: Logger;
  today?: () => string;
}

export interface AppBundle {
  app: express.Express;
  pipeline: Pipeline;
  bus: EventBus;
  sessions: SessionStore;
  extraction: ExtractionService;
}

export function createApp(deps: AppDeps): AppBundle {
  const { db, config } = deps;
  const logger = deps.logger ?? createLogger({ file: config.logFile });
  ensureOfficers(db);
  const bus = new EventBus();
  const extraction = new ExtractionService({
    db,
    vision: deps.vision,
    model: config.claude.model,
    demoMode: config.demoMode,
    concurrency: config.claude.concurrency,
    effortClassify: config.claude.effortClassify,
    effortExtract: config.claude.effortExtract,
    logger,
  });
  const pipeline = new Pipeline({
    db,
    extraction,
    bus,
    logger,
    uploadsDir: config.uploadsDir,
    today: deps.today,
  });
  const sessions = new SessionStore(db, path.join(config.uploadsDir, 'sessions'));

  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use(
    '/api',
    healthRouter(db, {
      anthropicConfigured: Boolean(deps.vision),
      demoMode: config.demoMode,
      model: config.claude.model,
    }),
  );
  app.use('/api', eventsRouter(bus));
  app.use('/api', decisionsRouter({ db, bus, today: deps.today }));
  app.use('/api', casesRouter({ db, pipeline, uploadsDir: config.uploadsDir }));
  app.use(
    '/api',
    sessionsRouter({
      sessions,
      pipeline,
      bus,
      uploadsDir: config.uploadsDir,
      webPort: config.webPort,
    }),
  );

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  // Production-like demo: one process serves the built SPA and the API on the same port.
  if (config.serveWeb && fs.existsSync(path.join(config.webDist, 'index.html'))) {
    app.use(express.static(config.webDist, { index: false, maxAge: '1h' }));
    app.get(/^(?!\/api\/).*/, (_req, res) => {
      res.sendFile(path.join(config.webDist, 'index.html'));
    });
  }

  const onError: ErrorRequestHandler = (err: unknown, _req, res, _next) => {
    if (err instanceof PacketError || err instanceof multer.MulterError) {
      res.status(400).json({ error: err.message });
      return;
    }
    if (err instanceof HttpError) {
      res
        .status(err.status)
        .json({ error: err.message, ...(err.details ? { details: err.details } : {}) });
      return;
    }
    if (err instanceof NotFound) {
      res.status(404).json({ error: err.message });
      return;
    }
    logger.error('Unhandled API error', {
      message: err instanceof Error ? err.message : 'unknown',
    });
    res.status(500).json({ error: 'Internal error' });
  };
  app.use(onError);
  return { app, pipeline, bus, sessions, extraction };
}
