import { dbExists, openDb } from '../db/client.js';
import { env } from '../env.js';
import { AuditChain, anchorPathFor } from './audit-chain.js';
import { loadSecurityConfig } from './config.js';

/**
 * `npm run audit:verify [-- --seal]` — recomputes the audit hash chain and proves no entry was
 * edited, deleted or inserted after sealing. Exit code 0 = intact, 1 = tampering detected.
 * --seal first chains entries written since the server last sealed (only do this when you trust
 * that nothing was tampered with in the meantime, e.g. right after a seed script).
 */
export async function verifyAuditCli(opts: {
  dbPath: string;
  key: string;
  seal?: boolean;
  print?: (line: string) => void;
}): Promise<number> {
  const print = opts.print ?? ((l: string) => console.log(l));
  // SQLite: the file must already exist. Postgres: DATABASE_URL (or the database for dbPath).
  if (!(await dbExists(opts.dbPath))) throw new Error(`Database not found: ${opts.dbPath}`);
  const handle = await openDb(opts.dbPath);
  try {
    const chain = await AuditChain.open(handle.raw, opts.key, anchorPathFor(opts.dbPath));
    if (opts.seal) print(`Sealed ${(await chain.seal()).sealed} new audit entries.`);
    const v = await chain.verify();
    print(`Audit log: ${handle.location}`);
    print(
      `Verified entries: ${v.verified}   (head ${v.head.slice(0, 16)}…, last sealed #${v.lastSealedId})`,
    );
    if (v.unsealed)
      print(
        `Not yet sealed:   ${v.unsealed} newest entr${v.unsealed === 1 ? 'y' : 'ies'} (sealed by the running API within seconds)`,
      );
    if (v.ok) {
      print('OK — audit hash chain intact. No entry was edited, deleted or inserted.');
      return 0;
    }
    print(`TAMPERING DETECTED — ${v.problems.length} problem(s):`);
    for (const p of v.problems.slice(0, 50))
      print(`  ${p.auditId === null ? '' : `#${p.auditId}: `}${p.problem}`);
    return 1;
  } finally {
    await handle.close();
  }
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'));
if (isMain) {
  const sec = loadSecurityConfig();
  if (sec.auditChainKeyIsDefault)
    console.warn('Note: AUDIT_CHAIN_KEY not set — using the public default key (prototype only).');
  process.exitCode = await verifyAuditCli({
    dbPath: env.dbPath,
    key: sec.auditChainKey,
    seal: process.argv.includes('--seal'),
  });
}
