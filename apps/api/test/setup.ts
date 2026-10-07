import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb, type DbHandle } from '../src/db/client.js';
import { createApp, type AppBundle } from '../src/app.js';
import { loadConfig, type DemoMode } from '../src/env.js';
import { createLogger } from '../src/logger.js';
import type { PipelineEvent } from '../src/events.js';
import type { VisionClient } from '../src/services/claude.js';

export interface TestApp extends AppBundle {
  handle: DbHandle;
  dir: string;
  dbPath: string;
  logFile: string;
  events: PipelineEvent[];
  cleanup: () => void;
}

/** Full app on a temp directory with a FILE database (so the leak test can scan it). */
export function setupApp(vision: VisionClient | null, demoMode: DemoMode = 'live'): TestApp {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'thoudang-test-'));
  const dbPath = path.join(dir, 'test.db');
  const logFile = path.join(dir, 'logs', 'api.log');
  const config = loadConfig({
    DB_PATH: dbPath,
    UPLOADS_DIR: path.join(dir, 'uploads'),
    LOG_FILE: logFile,
    DEMO_MODE: demoMode,
  });
  const handle = openDb(dbPath);
  const bundle = createApp({
    db: handle.db,
    config,
    vision,
    logger: createLogger({ file: logFile, console: false }),
    today: () => '2026-10-09',
  });
  const events: PipelineEvent[] = [];
  bundle.bus.subscribe((e) => events.push(e));
  return {
    ...bundle,
    handle,
    dir,
    dbPath,
    logFile,
    events,
    cleanup: () => {
      handle.close();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}
