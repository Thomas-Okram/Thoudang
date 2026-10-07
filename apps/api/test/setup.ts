import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb, type DbHandle } from '../src/db/client.js';
import { createApp, type AppBundle } from '../src/app.js';
import { loadConfig, type DemoMode } from '../src/env.js';
import { createLogger } from '../src/logger.js';
import type { PipelineEvent } from '../src/events.js';
import type { VisionClient } from '../src/services/claude.js';
import type { TtsClient } from '../src/services/tts.js';

const TEMPLATES = new URL('../../../packages/core/notices/templates.json', import.meta.url);

export interface TestApp extends AppBundle {
  handle: DbHandle;
  dir: string;
  dbPath: string;
  logFile: string;
  events: PipelineEvent[];
  templatesPath: string;
  cleanup: () => void;
}

/** Full app on a temp directory with a FILE database (so the leak test can scan it). */
export function setupApp(
  vision: VisionClient | null,
  demoMode: DemoMode = 'live',
  opts: { tts?: TtsClient | null } = {},
): TestApp {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'thoudang-test-'));
  const dbPath = path.join(dir, 'test.db');
  const logFile = path.join(dir, 'logs', 'api.log');
  const templatesPath = path.join(dir, 'templates.json');
  fs.copyFileSync(TEMPLATES, templatesPath);
  const config = loadConfig({
    DB_PATH: dbPath,
    UPLOADS_DIR: path.join(dir, 'uploads'),
    LOG_FILE: logFile,
    DEMO_MODE: demoMode,
    TEMPLATES_PATH: templatesPath,
    AUDIO_DIR: path.join(dir, 'audio'),
    STATUS_LINK_SECRET: 'test-secret',
  });
  const handle = openDb(dbPath);
  const bundle = createApp({
    db: handle.db,
    config,
    vision,
    logger: createLogger({ file: logFile, console: false }),
    today: () => '2026-10-09',
    tts: opts.tts ?? null,
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
    templatesPath,
    cleanup: () => {
      handle.close();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}
