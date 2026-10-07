import fs from 'node:fs';
import { eq } from 'drizzle-orm';
import { containsFullAadhaar } from '@thoudang/core';
import type { Db } from './db/client.js';
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
export function runLeakScan(
  db: Db,
  opts: { logFile: string; templates: TemplateStore; statusLinkSecret: string },
): LeakScanResult {
  const findings: LeakScanResult['findings'] = [];
  let dbRows = 0;
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
    for (const row of db.select().from(table).all() as Record<string, unknown>[]) {
      dbRows += 1;
      if (leaky(JSON.stringify(row)))
        findings.push({
          where: 'database',
          location: `${name} row ${String(row.id ?? row.key ?? '?')}`,
        });
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
  check('GET /api/cases', listCases(db, { includeHistorical: true }));
  const templates = opts.templates.load();
  for (const c of db
    .select({ id: cases.id, ref: cases.reference })
    .from(cases)
    .where(eq(cases.historical, false))
    .all()) {
    check(`GET /api/cases/${c.ref}`, caseDetail(db, c.id));
    check(
      `GET /api/cases/${c.ref}/notice`,
      buildNotice(db, c.id, { templates, statusLinkSecret: opts.statusLinkSecret }),
    );
  }

  return {
    scannedAt: new Date().toISOString(),
    findings,
    scanned: { dbRows, logLines, apiResponses },
    clean: findings.length === 0,
  };
}
