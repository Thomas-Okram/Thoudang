import fs from 'node:fs';
import { eq } from 'drizzle-orm';
import { containsFullAadhaar } from '@thoudang/core';
import { rawOf, type Db, type RawDb } from './db/client.js';
import {
  auditLog,
  cases,
  documents,
  extractionCache,
  extractions,
  flags,
  sessionFiles,
  uploadSessions,
} from './db/schema.js';
import { caseDetail, listCases } from './read-model.js';
import { buildNotice, type TemplateStore } from './notices.js';

export interface LeakScanResult {
  scannedAt: string;
  findings: { where: string; location: string }[];
  scanned: { dbRows: number; logLines: number; apiResponses: number };
  clean: boolean;
}

/** UUIDs and SHA-256 hex can contain 12-digit runs by chance — they are not Aadhaar numbers. */
const NOISE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|\b[0-9a-f]{64}\b/gi;
const leaky = (text: string) => containsFullAadhaar(text.replace(NOISE, ''));

/**
 * Scans the database, the log file and live API responses for full (unmasked) Aadhaar numbers.
 * Reports WHERE a leak is, never the number itself.
 */
export async function runLeakScan(
  db: Db,
  opts: { logFile: string; templates: TemplateStore; statusLinkSecret: string },
): Promise<LeakScanResult> {
  const findings: LeakScanResult['findings'] = [];
  let dbRows = 0;
  if (rawOf(db).driver === 'postgres') {
    dbRows = await scanPostgres(rawOf(db), findings);
  } else {
    const tables = {
      cases,
      documents,
      extractions,
      extraction_cache: extractionCache,
      flags,
      audit_log: auditLog,
      session_files: sessionFiles,
      upload_sessions: uploadSessions,
    } as const;
    for (const [name, table] of Object.entries(tables)) {
      for (const row of (await db.select().from(table)) as Record<string, unknown>[]) {
        dbRows += 1;
        if (leaky(JSON.stringify(row)))
          findings.push({
            where: 'database',
            location: `${name} row ${String(row.id ?? row.key ?? '?')}`,
          });
      }
    }
  }

  let logLines = 0;
  if (fs.existsSync(opts.logFile)) {
    fs.readFileSync(opts.logFile, 'utf8')
      .split('\n')
      .forEach((line, i) => {
        if (!line) return;
        logLines += 1;
        if (leaky(line)) findings.push({ where: 'log file', location: `line ${i + 1}` });
      });
  }

  let apiResponses = 0;
  const check = (label: string, body: unknown) => {
    apiResponses += 1;
    if (leaky(JSON.stringify(body))) findings.push({ where: 'API response', location: label });
  };
  check('GET /api/cases', await listCases(db, { includeHistorical: true }));
  const templates = opts.templates.load();
  for (const c of await db
    .select({ id: cases.id, ref: cases.reference })
    .from(cases)
    .where(eq(cases.historical, false))) {
    check(`GET /api/cases/${c.ref}`, await caseDetail(db, c.id));
    check(
      `GET /api/cases/${c.ref}/notice`,
      await buildNotice(db, c.id, { templates, statusLinkSecret: opts.statusLinkSecret }),
    );
  }

  return {
    scannedAt: new Date().toISOString(),
    findings,
    scanned: { dbRows, logLines, apiResponses },
    clean: findings.length === 0,
  };
}

const quoteIdent = (name: string) => `"${name.replace(/"/g, '""')}"`;

/**
 * PostgreSQL: there is no database file to scan, so every text / varchar / json / jsonb column of
 * every table in the schema is read via SQL (including tables added after this was written).
 */
export async function scanPostgres(
  raw: RawDb,
  findings: LeakScanResult['findings'],
): Promise<number> {
  const columns = await raw.all<{ table_name: string; column_name: string; data_type: string }>(
    `SELECT table_name, column_name, data_type FROM information_schema.columns
     WHERE table_schema = current_schema()
     ORDER BY table_name, ordinal_position`,
  );
  const TEXTUAL = new Set(['text', 'character varying', 'character', 'json', 'jsonb']);
  const byTable = new Map<string, string[]>();
  const keyOf = new Map<string, string>();
  for (const c of columns) {
    if (c.column_name === 'id' || (c.column_name === 'key' && !keyOf.has(c.table_name)))
      keyOf.set(c.table_name, c.column_name);
    if (TEXTUAL.has(c.data_type))
      byTable.set(c.table_name, [...(byTable.get(c.table_name) ?? []), c.column_name]);
  }
  let rows = 0;
  for (const [table, cols] of byTable) {
    const keyCol = keyOf.get(table) ?? null;
    const select = cols.map((c, i) => `${quoteIdent(c)}::text AS c${i}`).join(', ');
    const data = await raw.all<Record<string, string | null>>(
      `SELECT ${keyCol ? `${quoteIdent(keyCol)}::text AS row_key, ` : ''}${select} FROM ${quoteIdent(table)}`,
    );
    for (const row of data) {
      rows += 1;
      const text = cols.map((_, i) => row[`c${i}`] ?? '').join('\n');
      if (leaky(text))
        findings.push({
          where: 'database',
          location: `${table} row ${row.row_key ?? '?'}`,
        });
    }
  }
  return rows;
}
