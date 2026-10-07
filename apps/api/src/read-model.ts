import { asc, eq } from 'drizzle-orm';
import {
  ageOn,
  flagTitle,
  identityMatrix,
  matchNames,
  noticeEligibility,
  normaliseName,
  type IdentityPair,
} from '@thoudang/core';
import type { Db } from './db/client.js';
import {
  auditLog,
  cases,
  documents,
  extractions,
  flags as flagsTable,
  officers,
  type DetectedType,
} from './db/schema.js';
import { describeAudit, DOC_TITLE } from './audit-summary.js';
import type { ExtractedDocument } from './extraction/schemas.js';
import { permissionsOf, type Officer } from './officers.js';
import { blockingFlags, effectiveFlags } from './pipeline/screening.js';
import { redactionFor } from './services/redact.js';

type CaseRow = typeof cases.$inferSelect;
type FlagRow = typeof flagsTable.$inferSelect;

const SEVERITY_RANK = { critical: 0, warn: 1, info: 2 } as const;
export const istToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

export function caseSummary(row: CaseRow, flagRows: FlagRow[] = [], today = istToday()) {
  const inForce = flagRows.filter((f) => f.resolution !== 'OVERRIDDEN');
  const top = [...inForce]
    .filter((f) => f.severity !== 'info')
    .sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity])[0];
  const count = (s: FlagRow['severity']) => inForce.filter((f) => f.severity === s).length;
  return {
    id: row.id,
    reference: row.reference,
    applicantName: row.applicantName,
    district: row.district,
    status: row.status,
    processingState: row.processingState,
    priorityScore: row.priorityScore,
    priorityReasons: row.priorityReasons,
    aadhaarMasked: row.aadhaarLast4 ? `XXXX XXXX ${row.aadhaarLast4}` : null,
    applicantDob: row.applicantDob,
    age: row.applicantDob ? (ageOn(row.applicantDob, today)?.years ?? null) : null,
    scheme: 'MOAPS',
    source: row.source,
    historical: row.historical,
    noticeSentAt: row.noticeSentAt?.toISOString() ?? null,
    batchId: row.batchId,
    packetName: row.packetName,
    receivedAt: row.receivedAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    screenedAt: row.screenedAt?.toISOString() ?? null,
    screeningMs: row.screenedAt ? row.screenedAt.getTime() - row.receivedAt.getTime() : null,
    forwardedAt: row.forwardedAt?.toISOString() ?? null,
    decidedAt: row.decidedAt?.toISOString() ?? null,
    correctionRequestedAt: row.correctionRequestedAt?.toISOString() ?? null,
    topFlag: top ? { code: top.code, title: flagTitle(top.code), severity: top.severity } : null,
    flagCounts: { critical: count('critical'), warn: count('warn'), info: count('info') },
    openFlags: flagRows.filter((f) => f.resolution === 'OPEN' && f.severity !== 'info').length,
  };
}
export type CaseSummary = ReturnType<typeof caseSummary>;

export interface ListFilters {
  /** Synthetic historical cases (seed:dashboard) are hidden from the live queue by default. */
  includeHistorical?: boolean;
  status?: string;
  batchId?: string;
  q?: string;
}

/**
 * Queue listing, sorted by priority. `q` searches names with the Manipur-aware name engine, so
 * "Thomas Okram" finds "O. Thomas Meitei"; reference numbers and packet names match by substring.
 */
export function listCases(db: Db, filters: ListFilters = {}) {
  const rows = db.select().from(cases).all();
  const flagRows = db.select().from(flagsTable).all();
  const byCase = new Map<string, FlagRow[]>();
  for (const f of flagRows) byCase.set(f.caseId, [...(byCase.get(f.caseId) ?? []), f]);
  const today = istToday();

  let list = rows
    .filter((r) => filters.includeHistorical || !r.historical)
    .filter((r) => !filters.status || r.status === filters.status)
    .filter((r) => !filters.batchId || r.batchId === filters.batchId)
    .map((r) => ({
      summary: caseSummary(r, byCase.get(r.id) ?? [], today),
      match: null as number | null,
    }));

  const q = filters.q?.trim();
  if (q) {
    const nq = normaliseName(q);
    list = list
      .map((item) => {
        const s = item.summary;
        if (
          s.reference.toLowerCase().includes(q.toLowerCase()) ||
          (s.packetName ?? '').toLowerCase().includes(q.toLowerCase())
        ) {
          return { ...item, match: 100 };
        }
        if (!s.applicantName) return item;
        if (nq && normaliseName(s.applicantName).includes(nq)) return { ...item, match: 95 };
        const r = matchNames(q, s.applicantName);
        // Searching is forgiving: AMBIGUOUS ("O." could be Okram) still counts as a hit.
        return r.verdict === 'DIFFERENT' ? item : { ...item, match: r.score };
      })
      .filter((item) => item.match !== null)
      .sort((a, b) => b.match! - a.match!);
    return list.map((i) => ({ ...i.summary, searchScore: i.match }));
  }
  return list
    .map((i) => i.summary)
    .sort((a, b) => b.priorityScore - a.priorityScore || a.receivedAt.localeCompare(b.receivedAt));
}

export function caseStats(db: Db) {
  const all = listCases(db);
  const byStatus = {
    READY: 0,
    NEEDS_CITIZEN_CORRECTION: 0,
    OFFICER_ATTENTION: 0,
    APPROVED_BY_OFFICER: 0,
  } as Record<string, number>;
  for (const c of all) byStatus[c.status] = (byStatus[c.status] ?? 0) + 1;
  const timed = all.map((c) => c.screeningMs).filter((n): n is number => n !== null);
  const flagsCaught = db
    .select()
    .from(flagsTable)
    .all()
    .filter((f) => f.severity !== 'info').length;
  return {
    total: all.length,
    byStatus,
    avgScreeningMs: timed.length
      ? Math.round(timed.reduce((a, b) => a + b, 0) / timed.length)
      : null,
    flagsCaught,
    districts: [
      ...new Set(all.map((c) => c.district).filter((d): d is string => Boolean(d))),
    ].sort(),
    processing: all.filter(
      (c) => c.processingState === 'RECEIVED' || c.processingState === 'EXTRACTING',
    ).length,
  };
}

const NAME_FIELD: Partial<Record<DetectedType, string>> = {
  application_form: 'applicant_name',
  aadhaar: 'name',
  bank_passbook: 'account_holder_name',
  epic: 'name',
};

export interface IdentityView {
  entries: {
    key: string;
    documentId: string;
    docType: DetectedType;
    label: string;
    field: string;
    value: string;
  }[];
  pairs: IdentityPair[];
  knownYumnaks: string[];
  relatives: string[];
}

export function caseDetail(db: Db, id: string, viewer?: Officer | null) {
  const row = db.select().from(cases).where(eq(cases.id, id)).get();
  if (!row) return null;
  const docs = db
    .select()
    .from(documents)
    .where(eq(documents.caseId, id))
    .orderBy(documents.position)
    .all();
  const calls = db
    .select()
    .from(extractions)
    .where(eq(extractions.caseId, id))
    .orderBy(asc(extractions.createdAt))
    .all();
  const flagRows = db.select().from(flagsTable).where(eq(flagsTable.caseId, id)).all();
  const audit = db
    .select()
    .from(auditLog)
    .where(eq(auditLog.caseId, id))
    .orderBy(asc(auditLog.id))
    .all();
  const officerRows = db.select().from(officers).all();
  const latest = (docId: string, stage: 'classify' | 'extract') =>
    calls.filter((c) => c.documentId === docId && c.stage === stage).at(-1) ?? null;

  const docViews = docs.map((d) => {
    const cls = latest(d.id, 'classify');
    const ext = latest(d.id, 'extract');
    const extraction = ext?.status === 'OK' ? (ext.result as unknown as ExtractedDocument) : null;
    const redaction = d.processedPath
      ? redactionFor(d.detectedType, extraction, { width: d.widthPx, height: d.heightPx })
      : { mode: 'none' as const };
    return {
      id: d.id,
      originalName: d.originalName,
      detectedType: d.detectedType,
      typeConfidence: d.typeConfidence,
      typeSource: d.typeSource,
      state: d.state,
      width: d.widthPx,
      height: d.heightPx,
      imageUrl: `/api/documents/${d.id}/image`,
      thumbUrl: `/api/documents/${d.id}/image?variant=thumb`,
      redaction: redaction.mode,
      classification: cls?.status === 'OK' ? cls.result : null,
      extraction,
      error: (ext ?? cls)?.status === 'FAILED' ? ((ext ?? cls)?.errorMessage ?? null) : null,
      cacheHit: Boolean(ext?.cacheHit ?? cls?.cacheHit),
      latencyMs: (cls?.latencyMs ?? 0) + (ext?.latencyMs ?? 0),
      model: ext?.model ?? cls?.model ?? null,
    };
  });

  // Identity across documents: the name as written on each document, compared pairwise.
  const entries: IdentityView['entries'] = [];
  const relatives: string[] = [];
  for (const d of docViews) {
    if (!d.detectedType || !d.extraction) continue;
    const field = NAME_FIELD[d.detectedType];
    const value = field ? d.extraction.fields[field]?.value : null;
    if (field && value) {
      const sameType = docViews.filter((x) => x.detectedType === d.detectedType).length > 1;
      entries.push({
        key: d.id,
        documentId: d.id,
        docType: d.detectedType,
        label: DOC_TITLE[d.detectedType] + (sameType ? ` (${d.originalName})` : ''),
        field,
        value,
      });
    }
    for (const rel of ['father_or_husband_name', 'relative_name']) {
      const v = d.extraction.fields[rel]?.value;
      if (v) relatives.push(v);
    }
  }
  const matrix = identityMatrix(
    entries.map((e) => ({ key: e.key, value: e.value })),
    { relativeNames: relatives },
  );

  const officerName = (actor: string) =>
    actor.startsWith('officer:')
      ? (officerRows.find((o) => `officer:${o.id}` === actor)?.name ?? null)
      : null;
  const docById = (docId: string | null) => docs.find((d) => d.id === docId);

  const inForce = effectiveFlags(flagRows);
  const blockers = blockingFlags(flagRows);
  const notice = noticeEligibility(inForce);

  return {
    case: caseSummary(row, flagRows),
    documents: docViews,
    identity: {
      entries,
      pairs: matrix.pairs,
      knownYumnaks: matrix.knownYumnaks,
      relatives,
    } satisfies IdentityView,
    flags: flagRows
      .sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity])
      .map((f) => ({
        ...f,
        title: flagTitle(f.code),
        resolvedByName: f.resolvedBy
          ? (officerRows.find((o) => o.id === f.resolvedBy)?.name ?? f.resolvedBy)
          : null,
        createdAt: f.createdAt.toISOString(),
        resolvedAt: f.resolvedAt?.toISOString() ?? null,
      })),
    notice,
    actions: {
      canApprove:
        row.status !== 'APPROVED_BY_OFFICER' &&
        row.processingState !== 'EXTRACTING' &&
        blockers.length === 0,
      approveBlockedBy: blockers.map((f) => ({ id: f.id, code: f.code, title: flagTitle(f.code) })),
      canSendForCorrection:
        row.status !== 'APPROVED_BY_OFFICER' &&
        notice.blockedBy.length === 0 &&
        inForce.some((f) => f.action === 'citizen'),
      correctionBlockedReason: notice.blockedBy.length
        ? notice.reasons[0]
        : inForce.some((f) => f.action === 'citizen')
          ? null
          : 'There is nothing for the citizen to correct.',
      viewerPermissions: viewer ? permissionsOf(viewer.role) : [],
    },
    audit: audit.map((a) => ({
      id: a.id,
      actor: a.actor,
      actorName: officerName(a.actor),
      action: a.action,
      entityType: a.entityType,
      entityId: a.entityId,
      before: a.before,
      after: a.after,
      reason: a.reason,
      createdAt: a.createdAt.toISOString(),
      summary: describeAudit(a, { officerName, document: docById }),
    })),
  };
}
export type CaseDetail = NonNullable<ReturnType<typeof caseDetail>>;
