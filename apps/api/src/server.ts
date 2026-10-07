import { env } from './env.js';
import { openDb } from './db/client.js';
import { createApp } from './app.js';
import { createLogger } from './logger.js';
import { lanAddresses } from './network.js';
import { createAnthropicVisionClient } from './services/claude.js';
import { loadSecurityConfig } from './security/index.js';
import { runRetention } from './security/retention.js';

const logger = createLogger({ file: env.logFile });
const { db, close } = openDb();
const vision = env.anthropicConfigured
  ? createAnthropicVisionClient({
      model: env.claude.model,
      timeoutMs: env.claude.timeoutMs,
      maxRetries: env.claude.maxRetries,
      onRetry: (_err, attempt, delayMs) =>
        logger.warn('Retrying Claude call', { attempt, delayMs }),
    })
  : null;
const securityConfig = loadSecurityConfig();
const { app, pipeline, security } = createApp({
  db,
  config: env,
  vision,
  logger,
  security: securityConfig,
});
for (const w of security.warnings()) logger.warn(w);

// Backstop for audit rows written outside a request/pipeline event (they are normally sealed
// within milliseconds). Then the image-retention job: at start-up and every 24 h.
const sealTimer = setInterval(() => security.sealNow(), 30_000);
const retention = () => {
  try {
    const r = runRetention({ db, uploadsDir: env.uploadsDir, days: securityConfig.retentionDays });
    if (r.cases.length) {
      security.sealNow();
      logger.info('Retention: deleted images of closed cases', {
        cases: r.cases.length,
        files: r.filesDeleted,
        retentionDays: securityConfig.retentionDays,
      });
    }
  } catch (err) {
    logger.error('Retention job failed', {
      message: err instanceof Error ? err.message : 'unknown',
    });
  }
};
retention();
const retentionTimer = setInterval(retention, 24 * 3_600_000);
sealTimer.unref();
retentionTimer.unref();

const server = app.listen(env.port, '0.0.0.0', () => {
  logger.info(`Thoudang API on http://localhost:${env.port}`, {
    db: env.dbPath,
    demoMode: env.demoMode,
    model: env.claude.model,
  });
  const ip = lanAddresses()[0];
  if (env.serveWeb)
    logger.info(
      `Demo UI: http://localhost:${env.port}  (LAN: http://${ip ?? 'localhost'}:${env.port})`,
    );
  if (ip) logger.info(`Phone upload base: http://${ip}:${env.webPort}`);
  if (!vision) logger.warn('ANTHROPIC_API_KEY not set — serving cached extractions only.');
});

function shutdown(): void {
  clearInterval(sealTimer);
  clearInterval(retentionTimer);
  server.close(() => {
    security.sealNow();
    void pipeline.whenIdle().finally(() => {
      close();
      process.exit(0);
    });
  });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
