import { env } from './env.js';
import { openDb } from './db/client.js';
import { createApp } from './app.js';
import { createLogger } from './logger.js';
import { lanAddresses } from './network.js';
import { createAnthropicVisionClient } from './services/claude.js';

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
const { app, pipeline } = createApp({ db, config: env, vision, logger });

const server = app.listen(env.port, '0.0.0.0', () => {
  logger.info(`Thoudang API on http://localhost:${env.port}`, {
    db: env.dbPath,
    demoMode: env.demoMode,
    model: env.claude.model,
  });
  const ip = lanAddresses()[0];
  if (ip) logger.info(`Phone upload base: http://${ip}:${env.webPort}`);
  if (!vision) logger.warn('ANTHROPIC_API_KEY not set — serving cached extractions only.');
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
