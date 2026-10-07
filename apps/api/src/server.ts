import { env } from './env.js';
import { openDb } from './db/client.js';
import { createApp } from './app.js';

const { db, close } = openDb();
const app = createApp({ db, anthropicConfigured: env.anthropicConfigured });

const server = app.listen(env.port, () => {
  console.log(`[api] Thoudang API on http://localhost:${env.port} (db: ${env.dbPath})`);
  if (!env.anthropicConfigured) {
    console.warn('[api] ANTHROPIC_API_KEY not set — extraction will be unavailable.');
  }
});

function shutdown(): void {
  server.close(() => {
    close();
    process.exit(0);
  });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
