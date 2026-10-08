import 'dotenv/config';

export type DbDriver = 'sqlite' | 'postgres';

/** DB_DRIVER=sqlite (default — local demo, file DB) | postgres (Railway, via DATABASE_URL). */
export function resolveDriver(vars: NodeJS.ProcessEnv = process.env): DbDriver {
  return vars.DB_DRIVER === 'postgres' ? 'postgres' : 'sqlite';
}

/** Fixed for the life of the process: the table objects in schema.ts are chosen from it. */
export const DB_DRIVER: DbDriver = resolveDriver();
