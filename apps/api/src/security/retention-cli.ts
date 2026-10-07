import { openDb } from '../db/client.js';
import { env } from '../env.js';
import { AuditChain, anchorPathFor } from './audit-chain.js';
import { loadSecurityConfig } from './config.js';
import { runRetention } from './retention.js';

/** `npm run retention [-- --dry-run] [--days N]` — the same job the API runs daily. */
const sec = loadSecurityConfig();
const daysArg = process.argv.indexOf('--days');
const days = daysArg > 0 ? Number(process.argv[daysArg + 1]) : sec.retentionDays;
const { db, sqlite, close } = openDb();
try {
  const r = runRetention({
    db,
    uploadsDir: env.uploadsDir,
    days,
    dryRun: process.argv.includes('--dry-run'),
  });
  if (!r.dryRun) new AuditChain(sqlite, sec.auditChainKey, anchorPathFor(env.dbPath)).seal();
  console.log(
    `${r.dryRun ? '[dry run] would delete' : 'Deleted'} ${r.filesDeleted} image file(s), ` +
      `${(r.bytesFreed / 1024 / 1024).toFixed(1)} MB, from ${r.cases.length} case(s) closed more than ${days} day(s) ago.`,
  );
} finally {
  close();
}
