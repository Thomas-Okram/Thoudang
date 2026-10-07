import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const apiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const env = {
  port: Number(process.env.PORT ?? 3001),
  dbPath: path.resolve(apiRoot, process.env.DB_PATH ?? './data/thoudang.db'),
  uploadsDir: path.resolve(apiRoot, './uploads'),
  migrationsDir: path.resolve(apiRoot, './drizzle'),
  anthropicConfigured: Boolean(process.env.ANTHROPIC_API_KEY),
} as const;
