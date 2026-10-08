import crypto from 'node:crypto';
import { and, asc, eq, isNotNull, ne } from 'drizzle-orm';
import {
  deriveStatus,
  screenCase,
  type DuplicateCandidate,
  type Flag,
  type ScreeningResult,
} from '@thoudang/core';
import { transaction, type Db } from '../db/client.js';
import { cases, documents, extractions, flags as flagsTable } from '../db/schema.js';
import {
  EXTRACTABLE_TYPES,
  type ExtractableType,
  type ExtractedDocument,
} from '../extraction/schemas.js';
import { toExtractedCase, type DocOutcome } from './mapping.js';

type FlagRow = typeof flagsTable.$inferSelect;

/** Rebuilds per-document outcomes from the DB (latest classify/extract row per document). */
export async function outcomesFromDb(db: Db, caseId: string): Promise<DocOutcome[]> {
  const docs = await db
    .select()
    .from(documents)
    .where(eq(documents.caseId, caseId))
    .orderBy(asc(documents.position));
  const calls = await db
    .select()
    .from(extractions)
    .where(eq(extractions.caseId, caseId))
    .orderBy(asc(extractions.createdAt));
  return docs.map((d): DocOutcome => {
    const mine = calls.filter((c) => c.documentId === d.id);
    const extract = mine.filter((c) => c.stage === 'extract').at(-1);
    const classify = mine.filter((c) => c.stage === 'classify').at(-1);
    if (!d.processedPath)
      return { kind: 'unidentified', error: 'The image could not be opened (unsupported format?)' };
    if (d.detectedType === 'other') return { kind: 'other' };
    const type = d.detectedType;
    if (!type || !(EXTRACTABLE_TYPES as readonly string[]).includes(type)) {
      return {
        kind: 'unidentified',
        error: classify?.errorMessage ?? 'The document type could not be identified',
      };
    }
    if (extract?.status === 'OK' && extract.result) {
      return {
        kind: 'extracted',
        type: type as ExtractableType,
        doc: extract.result as unknown as ExtractedDocument,
      };
    }
    return {
      kind: 'extraction_failed',
      type: type as ExtractableType,
      error: extract?.errorMessage ?? 'extraction failed',
    };
  });
}

/** Stable identity of a flag across re-screens: code + which document fields it is about. */
export function flagKey(f: Pick<Flag, 'code' | 'evidence'>): string {
  return `${f.code}|${f.evidence
    .map((e) => `${e.document}.${e.field}`)
    .sort()
    .join(',')}`;
}

export const toFlag = (f: FlagRow): Flag => ({
  code: f.code,
  severity: f.severity,
  action: f.action,
  reason: f.reason,
  evidence: f.evidence,
});

/** Flags still in force: everything the officer has not overridden. */
export const effectiveFlags = (rows: FlagRow[]): Flag[] =>
  rows.filter((f) => f.resolution !== 'OVERRIDDEN').map(toFlag);

/**
 * Flags that block approval:
 * - critical flags that are open or accepted as real (only an override clears them);
 * - warnings nobody has reviewed yet (accept or override each one).
 */
export const blockingFlags = (rows: FlagRow[]): FlagRow[] =>
  rows.filter(
    (f) =>
      (f.severity === 'critical' && f.resolution !== 'OVERRIDDEN') ||
      (f.severity === 'warn' && f.resolution === 'OPEN'),
  );

const istToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

export interface RescreenResult {
  result: ScreeningResult;
  status: ReturnType<typeof deriveStatus> | 'APPROVED_BY_OFFICER';
  allFailed: boolean;
}

/**
 * Runs the rules engine on what is stored for the case and persists flags + status.
 * Officer decisions (accept/override) survive when the same flag is produced again.
 * No AI calls — this is pure code over stored extractions.
 */
export function rescreenCase(
  db: Db,
  caseId: string,
  opts: { today?: string } = {},
): Promise<RescreenResult> {
  // One screening at a time: each reads the other cases as duplicate candidates, so two packets
  // screened concurrently (batch upload) must not both miss each other. Was implicit when every
  // query was synchronous (better-sqlite3); explicit now that Postgres queries yield.
  const next = screeningQueue.then(() => rescreenCaseNow(db, caseId, opts));
  screeningQueue = next.catch(() => undefined);
  return next;
}

let screeningQueue: Promise<unknown> = Promise.resolve();

async function rescreenCaseNow(
  db: Db,
  caseId: string,
  opts: { today?: string },
): Promise<RescreenResult> {
  const row = (await db.select().from(cases).where(eq(cases.id, caseId)))[0];
  if (!row) throw new Error(`Case ${caseId} not found`);
  const outcomes = await outcomesFromDb(db, caseId);
  const extracted = toExtractedCase(caseId, row.receivedAt, outcomes);
  const existingCases: DuplicateCandidate[] = await db
    .select({
      caseId: cases.reference,
      aadhaarLast4: cases.aadhaarLast4,
      dob: cases.applicantDob,
      applicantName: cases.applicantName,
    })
    .from(cases)
    .where(and(ne(cases.id, caseId), isNotNull(cases.aadhaarLast4)));
  const result = screenCase(extracted, { today: opts.today ?? istToday(), existingCases });

  const previous = new Map(
    (await db.select().from(flagsTable).where(eq(flagsTable.caseId, caseId))).map((f) => [
      flagKey(f),
      f,
    ]),
  );
  const allFailed =
    outcomes.length > 0 &&
    outcomes.every((o) => o.kind === 'unidentified' || o.kind === 'extraction_failed');
  const district =
    extracted.documents.form?.status === 'ok'
      ? extracted.documents.form.fields.district.value
      : null;

  let stored: FlagRow[] = [];
  await transaction(db, async (tx) => {
    await tx.delete(flagsTable).where(eq(flagsTable.caseId, caseId));
    // Strictly increasing created_at keeps the rules-engine order when read back ORDER BY
    // created_at (Postgres, unlike SQLite rowids, does not return rows in insertion order).
    const t0 = Date.now();
    for (const [i, flag] of result.flags.entries()) {
      const before = previous.get(flagKey(flag));
      await tx.insert(flagsTable).values({
        id: before?.id ?? crypto.randomUUID(),
        caseId,
        createdAt: new Date(t0 + i),
        ...flag,
        resolution: before?.resolution ?? 'OPEN',
        resolvedBy: before?.resolvedBy ?? null,
        resolvedAt: before?.resolvedAt ?? null,
        resolutionReason: before?.resolutionReason ?? null,
      });
    }
    stored = await tx
      .select()
      .from(flagsTable)
      .where(eq(flagsTable.caseId, caseId))
      .orderBy(asc(flagsTable.createdAt));
  });

  const status =
    row.status === 'APPROVED_BY_OFFICER' ? row.status : deriveStatus(effectiveFlags(stored));
  await db
    .update(cases)
    .set({
      status,
      processingState: allFailed ? 'EXTRACTION_FAILED' : 'SCREENED',
      priorityScore: result.priorityScore,
      priorityReasons: result.priorityReasons,
      applicantName: result.facts.applicantName,
      applicantDob: result.facts.dob,
      aadhaarLast4: result.facts.aadhaarLast4,
      district,
      screenedAt: row.screenedAt ?? new Date(),
      firstScreenStatus:
        row.firstScreenStatus ?? (status === 'APPROVED_BY_OFFICER' ? null : status),
      updatedAt: new Date(),
    })
    .where(eq(cases.id, caseId));
  return { result, status, allFailed };
}

/** Re-derives status from stored flags after an officer decision (no rules re-run needed). */
export async function refreshStatus(db: Db, caseId: string): Promise<string> {
  const row = (await db.select().from(cases).where(eq(cases.id, caseId)))[0];
  if (!row) throw new Error(`Case ${caseId} not found`);
  if (row.status === 'APPROVED_BY_OFFICER') return row.status;
  const status = deriveStatus(
    effectiveFlags(await db.select().from(flagsTable).where(eq(flagsTable.caseId, caseId))),
  );
  await db.update(cases).set({ status, updatedAt: new Date() }).where(eq(cases.id, caseId));
  return status;
}
