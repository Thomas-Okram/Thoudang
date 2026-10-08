import { defineConfig } from 'drizzle-kit';

// DB_DRIVER=postgres npm run db:generate → drizzle/pg; default → drizzle/sqlite.
export default process.env.DB_DRIVER === 'postgres'
  ? defineConfig({
      dialect: 'postgresql',
      schema: './src/db/schema.pg.ts',
      out: './drizzle/pg',
      dbCredentials: { url: process.env.DATABASE_URL ?? 'postgres://localhost/thoudang' },
    })
  : defineConfig({
      dialect: 'sqlite',
      schema: './src/db/schema.sqlite.ts',
      out: './drizzle/sqlite',
      dbCredentials: { url: process.env.DB_PATH ?? './data/thoudang.db' },
    });
