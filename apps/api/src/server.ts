import { env } from './env.js';
import { openDb } from './db/client.js';
import { createApp } from './app.js';
import { createLogger } from './logger.js';
import { lanAddresses } from './network.js';
import { createVisionClient, resolveProvider } from './services/providers/index.js';

const logger = createLogger({ file: env.logFile });
const { db, close } = openDb();
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
const { app, pipeline } = createApp({ db, config: env, vision, logger });

const server = app.listen(env.port, '0.0.0.0', () => {
  logger.info(`Thoudang API on http://localhost:${env.port}`, {
    db: env.dbPath,
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

function shutdown(): void {
  server.close(() => {
    void pipeline.whenIdle().finally(() => {
      close();
      process.exit(0);
    });
  });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
