import { env } from './env.js';
import { openDb } from './db/client.js';
import { createApp } from './app.js';
import { createLogger } from './logger.js';
import { lanAddresses } from './network.js';
import { createVisionClient, resolveProvider } from './services/providers/index.js';
import { loadSecurityConfig } from './security/index.js';
import { runRetention } from './security/retention.js';

const logger = createLogger({ file: env.logFile });
const { db, close, location } = await openDb();
const provider = resolveProvider();
const vision = provider.configured
  ? createVisionClient({
      provider,
      timeoutMs: env.claude.timeoutMs,
      maxRetries: env.claude.maxRetries,
      onRetry: (_err, attempt, delayMs) =>
        logger.warn('Retrying Claude call', { attempt, delayMs }),
    })
  : null;
const securityConfig = loadSecurityConfig();
const { app, pipeline, security } = await createApp({
  db,
  config: env,
  vision,
  logger,
  security: securityConfig,
});
for (const w of security.warnings()) logger.warn(w);

// Backstop for audit rows written outside a request/pipeline event (they are normally sealed
// within milliseconds). Then the image-retention job: at start-up and every 24 h.
const sealTimer = setInterval(() => void security.sealNow(), 30_000);
const retention = async () => {
  try {
    const r = await runRetention({
      db,
      uploadsDir: env.uploadsDir,
      days: securityConfig.retentionDays,
    });
    if (r.cases.length) {
      await security.sealNow();
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
await retention();
const retentionTimer = setInterval(() => void retention(), 24 * 3_600_000);
sealTimer.unref();
retentionTimer.unref();

const server = app.listen(env.port, '0.0.0.0', () => {
  logger.info(`Thoudang API on http://localhost:${env.port}`, {
    db: location,
    demoMode: env.demoMode,
    aiProvider: provider.provider,
    model: provider.model,
    region: provider.region,
  });
  const ip = lanAddresses()[0];
  if (env.serveWeb)
    logger.info(
      `Demo UI: http://localhost:${env.port}  (LAN: http://${ip ?? 'localhost'}:${env.port})`,
    );
  if (ip) logger.info(`Phone upload base: http://${ip}:${env.webPort}`);
  if (!vision)
    logger.warn(
      provider.provider === 'bedrock'
        ? 'AI_PROVIDER=bedrock but no AWS credentials found — serving cached extractions only.'
        : 'ANTHROPIC_API_KEY not set — serving cached extractions only.',
    );
});

// Graceful shutdown (Railway sends SIGTERM on redeploy): stop accepting requests, let running
// cases finish, seal the audit chain, then close the database (SQLite file / Postgres pool).
let shuttingDown = false;
function shutdown(): void {
  if (shuttingDown) return;
  shuttingDown = true;
  clearInterval(sealTimer);
  clearInterval(retentionTimer);
  const force = setTimeout(() => process.exit(1), 25_000);
  force.unref();
  server.close();
  void (async () => {
    try {
      await pipeline.whenIdle();
      await security.sealNow();
    } finally {
      await close().catch(() => undefined);
      process.exit(0);
    }
  })();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
