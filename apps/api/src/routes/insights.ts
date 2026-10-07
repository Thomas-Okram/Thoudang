import { Router } from 'express';
import type { Db } from '../db/client.js';
import { CASE_STATUSES } from '../db/schema.js';
import type { AppConfig } from '../env.js';
import type { EventBus } from '../events.js';
import { dashboard } from '../dashboard.js';
import { resetDemo } from '../demo/reset.js';
import { runLeakScan, type LeakScanResult } from '../leak-scan.js';
import type { TemplateStore } from '../notices.js';
import { HttpError } from '../officers.js';
import { trustReport } from '../trust.js';

export function insightsRouter(deps: {
  db: Db;
  config: AppConfig;
  templates: TemplateStore;
  bus: EventBus;
}): Router {
  const { db, config, templates } = deps;
  const router = Router();
  let lastScan: LeakScanResult | null = null;

  router.get('/trust', (_req, res) => {
    res.json(trustReport(db, config, templates, lastScan));
  });

  /** Runs the Aadhaar leak scanner on demand (DB, logs, live API responses). */
  router.post('/trust/leak-scan', (_req, res) => {
    lastScan = runLeakScan(db, {
      logFile: config.logFile,
      templates,
      statusLinkSecret: config.statusLinkSecret,
    });
    res.json(lastScan);
  });

  /** Proof link: the complete list of case statuses (there is no reject status). */
  router.get('/trust/statuses', (_req, res) => {
    res.json({
      statuses: CASE_STATUSES,
      rejectStatusExists: false,
      source: 'apps/api/src/db/schema.ts (CASE_STATUSES)',
    });
  });

  router.get('/dashboard', (req, res) => {
    res.json(dashboard(db, new Date(), { includeHistorical: req.query.historical !== 'exclude' }));
  });

  /** Demo-only (DEMO_MODE cache_first/cache_only or npm run demo): restore the primed state. */
  router.post('/demo/reset', (req, res) => {
    if (config.demoMode === 'live' && !config.serveWeb)
      throw new HttpError(403, 'Demo reset is only available in demo mode');
    const result = resetDemo(
      db,
      config.uploadsDir,
      `officer:${req.header('x-officer-id') ?? 'demo'}`,
    );
    deps.bus.publish({
      type: 'case',
      caseId: 'demo-reset',
      reference: 'RESET',
      batchId: null,
      stage: 'updated',
    });
    res.json({ ok: true, removed: result });
  });

  return router;
}
