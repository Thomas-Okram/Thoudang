import crypto from 'node:crypto';
import { and, asc, eq, isNotNull, ne } from 'drizzle-orm';
import {
  deriveStatus,
  screenCase,
  type DuplicateCandidate,
  type Flag,
  type ScreeningResult,
} from '@thoudang/core';
import type { Db } from '../db/client.js';
import { cases, documents, extractions, flags as flagsTable } from '../db/schema.js';
import {
  EXTRACTABLE_TYPES,
  type ExtractableType,
  type ExtractedDocument,
} from '../extraction/schemas.js';
import { toExtractedCase, type DocOutcome } from './mapping.js';

type FlagRow = typeof flagsTable.$inferSelect;

/** Rebuilds per-document outcomes from the DB (latest classify/extract row per document). */
export function outcomesFromDb(db: Db, caseId: string): DocOutcome[] {
  const docs = db
    .select()
    .from(documents)
    .where(eq(documents.caseId, caseId))
    .orderBy(asc(documents.position))
    .all();
  const calls = db
    .select()
    .from(extractions)
    .where(eq(extractions.caseId, caseId))
    .orderBy(asc(extractions.createdAt))
    .all();
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

/** Critical flags that block approval: open, or accepted as real. Only an override clears them. */
export const blockingFlags = (rows: FlagRow[]): FlagRow[] =>
  rows.filter((f) => f.severity === 'critical' && f.resolution !== 'OVERRIDDEN');

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
): RescreenResult {
  const row = db.select().from(cases).where(eq(cases.id, caseId)).get();
  if (!row) throw new Error(`Case ${caseId} not found`);
  const outcomes = outcomesFromDb(db, caseId);
  const extracted = toExtractedCase(caseId, row.receivedAt, outcomes);
  const existingCases: DuplicateCandidate[] = db
    .select({
      caseId: cases.reference,
      aadhaarLast4: cases.aadhaarLast4,
      dob: cases.applicantDob,
      applicantName: cases.applicantName,
    })
    .from(cases)
    .where(and(ne(cases.id, caseId), isNotNull(cases.aadhaarLast4)))
    .all();
  const result = screenCase(extracted, { today: opts.today ?? istToday(), existingCases });

  const previous = new Map(
    db
      .select()
      .from(flagsTable)
      .where(eq(flagsTable.caseId, caseId))
      .all()
      .map((f) => [flagKey(f), f]),
  );
  const allFailed =
    outcomes.length > 0 &&
    outcomes.every((o) => o.kind === 'unidentified' || o.kind === 'extraction_failed');
  const district =
    extracted.documents.form?.status === 'ok'
      ? extracted.documents.form.fields.district.value
      : null;

  let stored: FlagRow[] = [];
  db.transaction((tx) => {
    tx.delete(flagsTable).where(eq(flagsTable.caseId, caseId)).run();
    for (const flag of result.flags) {
      const before = previous.get(flagKey(flag));
      tx.insert(flagsTable)
        .values({
          id: before?.id ?? crypto.randomUUID(),
          caseId,
          ...flag,
          resolution: before?.resolution ?? 'OPEN',
          resolvedBy: before?.resolvedBy ?? null,
          resolvedAt: before?.resolvedAt ?? null,
          resolutionReason: before?.resolutionReason ?? null,
        })
        .run();
    }
    stored = tx.select().from(flagsTable).where(eq(flagsTable.caseId, caseId)).all();
  });

  const status =
    row.status === 'APPROVED_BY_OFFICER' ? row.status : deriveStatus(effectiveFlags(stored));
  db.update(cases)
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
      updatedAt: new Date(),
    })
    .where(eq(cases.id, caseId))
    .run();
  return { result, status, allFailed };
}

/** Re-derives status from stored flags after an officer decision (no rules re-run needed). */
export function refreshStatus(db: Db, caseId: string): string {
  const row = db.select().from(cases).where(eq(cases.id, caseId)).get();
  if (!row) throw new Error(`Case ${caseId} not found`);
  if (row.status === 'APPROVED_BY_OFFICER') return row.status;
  const status = deriveStatus(
    effectiveFlags(db.select().from(flagsTable).where(eq(flagsTable.caseId, caseId)).all()),
  );
  db.update(cases).set({ status, updatedAt: new Date() }).where(eq(cases.id, caseId)).run();
  return status;
}
