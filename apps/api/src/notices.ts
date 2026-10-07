import crypto from 'node:crypto';
import fs from 'node:fs';
import { asc, eq } from 'drizzle-orm';
import {
  EVIDENCE_DOC_TYPE,
  extractionFieldFor,
  noticeEligibility,
  noticeToPlainText,
  parseName,
  redactAadhaarInText,
  renderNotice,
  TemplateSetSchema,
  type EvidenceDocument,
  type Flag,
  type NoticeItemInput,
  type RenderedNotice,
  type TemplateSet,
} from '@thoudang/core';
import type { Db } from './db/client.js';
import { cases, documents, extractions, flags as flagsTable } from './db/schema.js';
import type { ExtractedDocument } from './extraction/schemas.js';
import { effectiveFlags } from './pipeline/screening.js';

/**
 * Reviewer-editable templates, stored in the repo file (packages/core/notices/templates.json)
 * so edits survive demo resets and can be committed. Writes are atomic.
 */
export class TemplateStore {
  constructor(private readonly file: string) {}

  load(): TemplateSet {
    return TemplateSetSchema.parse(JSON.parse(fs.readFileSync(this.file, 'utf8')));
  }

  update(
    kind: 'template' | 'block',
    key: string,
    patch: Partial<{ en: string; mni_beng: string; mni_mtei: string; reviewed: boolean }>,
  ): { before: unknown; after: unknown; set: TemplateSet } {
    const set = this.load();
    const list = kind === 'template' ? set.templates : set.blocks;
    const entry = list.find((e) => ('code' in e ? e.code : (e as { id: string }).id) === key);
    if (!entry) throw new Error(`Unknown ${kind} "${key}"`);
    const before = { ...entry };
    for (const k of ['en', 'mni_beng', 'mni_mtei'] as const) {
      if (typeof patch[k] === 'string') entry[k] = patch[k]!;
    }
    if (typeof patch.reviewed === 'boolean') entry.reviewed = patch.reviewed;
    const parsed = TemplateSetSchema.parse(set);
    const tmp = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify(parsed, null, 2)}\n`);
    fs.renameSync(tmp, this.file);
    return { before, after: { ...entry }, set: parsed };
  }
}

/** Short HMAC so status links (/s/<ref>?k=…) cannot be enumerated by guessing references. */
export function statusToken(secret: string, reference: string): string {
  return crypto.createHmac('sha256', secret).update(reference).digest('hex').slice(0, 12);
}

export function verifyStatusToken(secret: string, reference: string, token: unknown): boolean {
  if (typeof token !== 'string' || token.length !== 12) return false;
  return crypto.timingSafeEqual(Buffer.from(statusToken(secret, reference)), Buffer.from(token));
}

/**
 * Officer flags that become citizen corrections once an officer ACCEPTS them as real
 * (e.g. an unreadable document the citizen must re-submit).
 */
const CITIZEN_RESOLVABLE_WHEN_ACCEPTED = new Set([
  'EXTRACTION_FAILED',
  'AADHAAR_FORM_CARD_MISMATCH',
]);

type FlagRow = typeof flagsTable.$inferSelect;

/** Values "as written" on the document (raw extraction), falling back to the rule value. */
function valueAsWritten(
  e: Flag['evidence'][number],
  docsByType: Map<string, ExtractedDocument[]>,
): string | null {
  if (e.field === 'aadhaarLast4' || e.field === 'last4' || e.field === 'maskedNumber') {
    return e.value === null ? null : String(e.value).slice(-4);
  }
  const wire = extractionFieldFor(e);
  if (wire) {
    for (const d of docsByType.get(EVIDENCE_DOC_TYPE[e.document]) ?? []) {
      const v = d.fields[wire]?.value;
      if (v) return v;
    }
  }
  return e.value === null ? null : String(e.value);
}

export function noticeItemsFor(
  flagRows: FlagRow[],
  docsByType: Map<string, ExtractedDocument[]>,
): NoticeItemInput[] {
  const relevant = flagRows.filter(
    (f) =>
      f.resolution !== 'OVERRIDDEN' &&
      (f.action === 'citizen' ||
        (f.resolution === 'ACCEPTED' && CITIZEN_RESOLVABLE_WHEN_ACCEPTED.has(f.code))),
  );
  return relevant.map((f) => {
    const [a, b] = f.evidence.filter((e, i, all) =>
      // DOB evidence lists every document: keep the first two that disagree.
      f.code === 'DOB_MISMATCH' ? i === 0 || String(e.value) !== String(all[0]!.value) : true,
    );
    return {
      code: f.code,
      documentA: a?.document as EvidenceDocument | undefined,
      documentB: b?.document as EvidenceDocument | undefined,
      field: a?.field === 'document' ? undefined : a?.field,
      valueA: a ? valueAsWritten(a, docsByType) : null,
      valueB: b ? valueAsWritten(b, docsByType) : null,
      reason: f.reason,
    };
  });
}

export interface BuiltNotice {
  caseId: string;
  reference: string;
  applicantName: string;
  allowed: boolean;
  blockedReason: string | null;
  rendered: RenderedNotice | null;
  plainText: { en: string; mni_beng: string; mni_mtei: string } | null;
  /** Text read aloud (Manipuri, Bengali script). */
  audioText: string | null;
  statusPath: string;
  noticeSentAt: string | null;
  date: string;
}

export function buildNotice(
  db: Db,
  caseId: string,
  opts: { templates: TemplateSet; statusLinkSecret: string; now?: Date },
): BuiltNotice | null {
  const row = db.select().from(cases).where(eq(cases.id, caseId)).get();
  if (!row) return null;
  const flagRows = db.select().from(flagsTable).where(eq(flagsTable.caseId, caseId)).all();
  const docs = db.select().from(documents).where(eq(documents.caseId, caseId)).all();
  const calls = db
    .select()
    .from(extractions)
    .where(eq(extractions.caseId, caseId))
    .orderBy(asc(extractions.createdAt))
    .all();
  const docsByType = new Map<string, ExtractedDocument[]>();
  for (const d of docs) {
    const ext = calls
      .filter((c) => c.documentId === d.id && c.stage === 'extract' && c.status === 'OK')
      .at(-1);
    if (d.detectedType && ext?.result) {
      docsByType.set(d.detectedType, [
        ...(docsByType.get(d.detectedType) ?? []),
        ext.result as unknown as ExtractedDocument,
      ]);
    }
  }

  const date = (opts.now ?? new Date()).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Kolkata',
  });
  const eligibility = noticeEligibility(effectiveFlags(flagRows));
  const items = noticeItemsFor(flagRows, docsByType);
  const statusPath = `/s/${encodeURIComponent(row.reference)}?k=${statusToken(opts.statusLinkSecret, row.reference)}`;
  const base = {
    caseId,
    reference: row.reference,
    applicantName: row.applicantName ?? 'Applicant',
    statusPath,
    noticeSentAt: row.noticeSentAt?.toISOString() ?? null,
    date,
  };

  const blocked = eligibility.blockedBy.length > 0;
  if (blocked || !items.length) {
    return {
      ...base,
      allowed: false,
      blockedReason: blocked
        ? (eligibility.reasons[0] ?? 'Blocked')
        : 'There is nothing for the citizen to correct.',
      rendered: null,
      plainText: null,
      audioText: null,
    };
  }

  const rendered = renderNotice(opts.templates, {
    applicantName: base.applicantName,
    reference: row.reference,
    date,
    district: row.district ?? 'your district',
    items,
  });
  const plainText = {
    en: noticeToPlainText(rendered, 'en'),
    mni_beng: noticeToPlainText(rendered, 'mni_beng'),
    mni_mtei: noticeToPlainText(rendered, 'mni_mtei'),
  };
  const t = rendered.mni_beng;
  const audioText = redactAadhaarInText(
    [t.greeting, t.intro, ...t.items, t.bring, t.notRejection, t.finalDecision]
      .join(' ')
      .replace(/[“”]/g, ''),
  );
  return { ...base, allowed: true, blockedReason: null, rendered, plainText, audioText };
}

/** Citizen-facing status: no personal data beyond the first (given) name and the reference. */
export type PublicStatus = 'Received' | 'Correction needed' | 'Under review' | 'Approved';

export function publicStatusFor(row: typeof cases.$inferSelect): PublicStatus {
  if (row.processingState === 'RECEIVED' || row.processingState === 'EXTRACTING') return 'Received';
  if (row.status === 'APPROVED_BY_OFFICER') return 'Approved';
  if (row.status === 'NEEDS_CITIZEN_CORRECTION') return 'Correction needed';
  return 'Under review';
}

/** "Laishram Ningol Okram Ongbi Ibemcha Devi" → "Ibemcha" (given name, not the yumnak). */
export function firstNameOf(full: string | null): string {
  if (!full) return 'Applicant';
  const p = parseName(full);
  return p.givenDisplay[0] ?? full.split(/\s+/)[0] ?? 'Applicant';
}
