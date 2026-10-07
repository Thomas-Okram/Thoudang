/**
 * npm run seed:dashboard [-- --count 400]
 * Writes ~400 SYNTHETIC historical cases across Manipur's 16 districts for the department
 * dashboard. Hidden from the live queue; re-running replaces them.
 */
import { openDb } from '../db/client.js';
import { env } from '../env.js';
import { parseArgs } from '../eval/cli-args.js';
import { seedHistorical } from './historical.js';

const { flags } = parseArgs(process.argv.slice(2));
const count = typeof flags.count === 'string' ? Number(flags.count) : 400;
const handle = openDb();
const n = seedHistorical(handle.db, count);
handle.close();
console.log(
  `Seeded ${n} synthetic historical cases (HIST-2026-…) into ${env.dbPath}. They appear on /dashboard only, labelled synthetic.`,
);
