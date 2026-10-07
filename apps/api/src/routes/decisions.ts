import { Router, type Request } from 'express';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { flagTitle } from '@thoudang/core';
import type { Db } from '../db/client.js';
import {
  auditLog,
  cases,
  documents,
  extractions,
  flags as flagsTable,
  officers,
} from '../db/schema.js';
import type { EventBus } from '../events.js';
import { DOC_FIELDS, type ExtractableType, type ExtractedDocument } from '../extraction/schemas.js';
import { DOC_TITLE } from '../audit-summary.js';
import {
  HttpError,
  ROLE_LABEL,
  officerActor,
  permissionsOf,
  requireOfficer,
  type Officer,
} from '../officers.js';
import {
  blockingFlags,
  effectiveFlags,
  refreshStatus,
  rescreenCase,
} from '../pipeline/screening.js';
import { caseDetail, istToday } from '../read-model.js';
import { noticeEligibility } from '@thoudang/core';

export const OVERRIDE_REASONS = [
  { code: 'married_name', label: 'Married name — Ongbi/Ningol confirmed' },
  { code: 'spelling_variant', label: 'Known spelling / romanisation variant' },
  { code: 'abbreviation_confirmed', label: 'Yumnak abbreviation confirmed with applicant' },
  { code: 'verified_original', label: 'Verified against the original document' },
  { code: 'ai_misread', label: 'AI misread — value checked on the image' },
  { code: 'not_duplicate', label: 'Checked — not a duplicate application' },
  { code: 'other', label: 'Other (explain)' },
] as const;

export const EDIT_REASONS = [
  { code: 'ai_misread', label: 'AI misread — corrected from the image' },
  { code: 'verified_original', label: 'Corrected from the original document' },
  { code: 'applicant_confirmed', label: 'Confirmed with the applicant' },
  { code: 'other', label: 'Other (explain)' },
] as const;

type Reasons = typeof OVERRIDE_REASONS | typeof EDIT_REASONS;

/** Builds the audit reason from a dropdown code + free text. Throws 400 if no usable reason. */
export function reasonFrom(
  list: Reasons,
  body: { reasonCode?: unknown; reasonText?: unknown },
): string {
  const text = typeof body.reasonText === 'string' ? body.reasonText.trim() : '';
  const code = typeof body.reasonCode === 'string' ? body.reasonCode : '';
  const preset = (list as readonly { code: string; label: string }[]).find((r) => r.code === code);
  if (preset && preset.code !== 'other') return text ? `${preset.label}: ${text}` : preset.label;
  if (text.length >= 3) return text;
  throw new HttpError(400, 'A reason is required (choose one, or explain under "Other")');
}

export function decisionsRouter(deps: { db: Db; bus: EventBus; today?: () => string }): Router {
  const { db, bus } = deps;
  const router = Router();
  const today = () => (deps.today ?? istToday)();

  const loadCase = (id: string) => {
    const row = db.select().from(cases).where(eq(cases.id, id)).get();
    if (!row) throw new HttpError(404, 'Case not found');
    return row;
  };
  const audit = (
    caseId: string,
    officer: Officer,
    action: (typeof auditLog.$inferInsert)['action'],
    entityType: string,
    entityId: string,
    before: unknown,
    after: unknown,
    reason?: string,
  ) =>
    db
      .insert(auditLog)
      .values({
        caseId,
        actor: officerActor(officer),
        action,
        entityType,
        entityId,
        before,
        after,
        reason: reason ?? null,
      })
      .run();
  const updated = (
    row: { id: string; reference: string; batchId: string | null },
    status: string,
  ) =>
    bus.publish({
      type: 'case',
      caseId: row.id,
      reference: row.reference,
      batchId: row.batchId,
      stage: 'updated',
      status,
    });
  const respond = (req: Request, id: string, officer: Officer) =>
    caseDetail(db, id, officer) ?? { error: 'gone' };
  const notApproved = (row: { status: string }) => {
    if (row.status === 'APPROVED_BY_OFFICER')
      throw new HttpError(409, 'This case is already approved');
  };

  router.get('/meta', (_req, res) => {
    res.json({
      officers: db
        .select()
        .from(officers)
        .all()
        .map((o) => ({ ...o, roleLabel: ROLE_LABEL[o.role], permissions: permissionsOf(o.role) })),
      overrideReasons: OVERRIDE_REASONS,
      editReasons: EDIT_REASONS,
    });
  });

  /** { decision: 'accept' | 'override' | 'reopen', reasonCode?, reasonText? } */
  router.post('/cases/:id/flags/:flagId/resolve', (req, res) => {
    const officer = requireOfficer(db, req, 'resolve_flag');
    const row = loadCase(req.params.id);
    notApproved(row);
    const flag = db
      .select()
      .from(flagsTable)
      .where(and(eq(flagsTable.id, req.params.flagId), eq(flagsTable.caseId, row.id)))
      .get();
    if (!flag) throw new HttpError(404, 'Flag not found');
    const body = (req.body ?? {}) as {
      decision?: unknown;
      reasonCode?: unknown;
      reasonText?: unknown;
    };
    const decision = body.decision;
    if (decision !== 'accept' && decision !== 'override' && decision !== 'reopen') {
      throw new HttpError(400, 'decision must be accept, override or reopen');
    }
    const reason =
      decision === 'override'
        ? reasonFrom(OVERRIDE_REASONS, body)
        : typeof body.reasonText === 'string' && body.reasonText.trim()
          ? body.reasonText.trim()
          : undefined;
    const resolution =
      decision === 'accept' ? 'ACCEPTED' : decision === 'override' ? 'OVERRIDDEN' : 'OPEN';
    db.update(flagsTable)
      .set({
        resolution,
        resolvedBy: decision === 'reopen' ? null : officer.id,
        resolvedAt: decision === 'reopen' ? null : new Date(),
        resolutionReason: reason ?? null,
      })
      .where(eq(flagsTable.id, flag.id))
      .run();
    audit(
      row.id,
      officer,
      decision === 'accept'
        ? 'OFFICER_ACCEPT'
        : decision === 'override'
          ? 'OFFICER_OVERRIDE'
          : 'STATUS_CHANGE',
      'flag',
      flag.id,
      { resolution: flag.resolution },
      { code: flag.code, title: flagTitle(flag.code), resolution, officer: officer.name },
      reason,
    );
    const status = refreshStatus(db, row.id);
    if (status !== row.status) {
      audit(row.id, officer, 'STATUS_CHANGE', 'case', row.id, { status: row.status }, { status });
    }
    updated(row, status);
    res.json(respond(req, row.id, officer));
  });

  /** { documentId, field, value, reasonCode?, reasonText? } — re-screens with code only, no AI. */
  router.patch('/cases/:id/fields', (req, res) => {
    const officer = requireOfficer(db, req, 'edit_field');
    const row = loadCase(req.params.id);
    notApproved(row);
    const body = (req.body ?? {}) as { documentId?: unknown; field?: unknown; value?: unknown };
    const reason = reasonFrom(EDIT_REASONS, req.body ?? {});
    const doc = db
      .select()
      .from(documents)
      .where(and(eq(documents.id, String(body.documentId)), eq(documents.caseId, row.id)))
      .get();
    if (!doc || !doc.detectedType || doc.detectedType === 'other')
      throw new HttpError(404, 'Document not found');
    const field = String(body.field ?? '');
    if (!DOC_FIELDS[doc.detectedType as ExtractableType].includes(field)) {
      throw new HttpError(400, `Unknown field "${field}" for ${DOC_TITLE[doc.detectedType]}`);
    }
    if (field === 'aadhaar_number')
      throw new HttpError(
        400,
        'The Aadhaar number cannot be edited (only the masked form is stored)',
      );
    if (body.value !== null && typeof body.value !== 'string')
      throw new HttpError(400, 'value must be a string or null');
    const ext = db
      .select()
      .from(extractions)
      .where(
        and(
          eq(extractions.documentId, doc.id),
          eq(extractions.stage, 'extract'),
          eq(extractions.status, 'OK'),
        ),
      )
      .orderBy(desc(extractions.createdAt))
      .get();
    if (!ext?.result) throw new HttpError(409, 'This document has no extracted fields to edit');

    const result = ext.result as unknown as ExtractedDocument;
    const previous = result.fields[field];
    const value = typeof body.value === 'string' && body.value.trim() ? body.value.trim() : null;
    if ((previous?.value ?? null) === value) throw new HttpError(400, 'The value is unchanged');
    const next: ExtractedDocument = {
      ...result,
      fields: {
        ...result.fields,
        [field]: {
          value,
          status: value === null ? 'blank' : 'present',
          confidence: 'high',
          bbox: previous?.bbox ?? null,
          editedBy: officer.name,
        },
      },
    };
    db.update(extractions)
      .set({ result: next as unknown as Record<string, unknown> })
      .where(eq(extractions.id, ext.id))
      .run();
    audit(
      row.id,
      officer,
      'FIELD_EDITED',
      'document',
      doc.id,
      { value: previous?.value ?? null, confidence: previous?.confidence ?? null },
      { document: DOC_TITLE[doc.detectedType], field, value },
      reason,
    );
    const { result: screened, status } = rescreenCase(db, row.id, { today: today() });
    db.insert(auditLog)
      .values({
        caseId: row.id,
        actor: 'system:rules',
        action: 'RULE_RESULT',
        entityType: 'case',
        entityId: row.id,
        after: {
          status,
          trigger: 'officer edit',
          priorityScore: screened.priorityScore,
          flags: screened.flags.map((f) => ({
            code: f.code,
            severity: f.severity,
            action: f.action,
          })),
        },
      })
      .run();
    updated(row, status);
    res.json(respond(req, row.id, officer));
  });

  router.post('/cases/:id/approve', (req, res) => {
    const officer = requireOfficer(db, req, 'approve');
    const row = loadCase(req.params.id);
    notApproved(row);
    if (row.processingState === 'RECEIVED' || row.processingState === 'EXTRACTING') {
      throw new HttpError(409, 'The case is still being processed');
    }
    const blockers = blockingFlags(
      db.select().from(flagsTable).where(eq(flagsTable.caseId, row.id)).all(),
    );
    if (blockers.length) {
      throw new HttpError(
        409,
        'Resolve critical flags and review every warning before approving',
        blockers.map((f) => ({ id: f.id, code: f.code, title: flagTitle(f.code) })),
      );
    }
    const note =
      typeof req.body?.note === 'string' && req.body.note.trim() ? req.body.note.trim() : undefined;
    db.update(cases)
      .set({
        status: 'APPROVED_BY_OFFICER',
        decidedBy: officer.id,
        decidedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(cases.id, row.id))
      .run();
    audit(
      row.id,
      officer,
      'OFFICER_APPROVE',
      'case',
      row.id,
      { status: row.status },
      { status: 'APPROVED_BY_OFFICER' },
      note,
    );
    updated(row, 'APPROVED_BY_OFFICER');
    res.json(respond(req, row.id, officer));
  });

  router.post('/cases/:id/send-for-correction', (req, res) => {
    const officer = requireOfficer(db, req, 'send_for_correction');
    const row = loadCase(req.params.id);
    notApproved(row);
    const inForce = effectiveFlags(
      db.select().from(flagsTable).where(eq(flagsTable.caseId, row.id)).all(),
    );
    const notice = noticeEligibility(inForce);
    if (notice.blockedBy.length) throw new HttpError(409, notice.reasons[0] ?? 'Blocked');
    if (!inForce.some((f) => f.action === 'citizen'))
      throw new HttpError(409, 'There is nothing for the citizen to correct');
    const note =
      typeof req.body?.note === 'string' && req.body.note.trim() ? req.body.note.trim() : undefined;
    db.update(cases)
      .set({
        status: 'NEEDS_CITIZEN_CORRECTION',
        correctionRequestedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(cases.id, row.id))
      .run();
    audit(
      row.id,
      officer,
      'SENT_FOR_CORRECTION',
      'case',
      row.id,
      { status: row.status },
      { status: 'NEEDS_CITIZEN_CORRECTION' },
      note,
    );
    updated(row, 'NEEDS_CITIZEN_CORRECTION');
    res.json(respond(req, row.id, officer));
  });

  /** Bulk: { caseIds } — only READY cases are forwarded to the DSWO. */
  router.post('/cases/forward', (req, res) => {
    const officer = requireOfficer(db, req, 'forward');
    const ids = Array.isArray(req.body?.caseIds) ? (req.body.caseIds as unknown[]).map(String) : [];
    if (!ids.length) throw new HttpError(400, 'Select at least one case');
    const rows = db.select().from(cases).where(inArray(cases.id, ids)).all();
    const forwarded: string[] = [];
    const skipped: { id: string; reason: string }[] = [];
    for (const r of rows) {
      if (r.status !== 'READY') {
        skipped.push({ id: r.id, reason: 'Only Ready cases can be forwarded' });
        continue;
      }
      db.update(cases)
        .set({ forwardedAt: new Date(), forwardedBy: officer.id, updatedAt: new Date() })
        .where(eq(cases.id, r.id))
        .run();
      audit(r.id, officer, 'FORWARDED_FOR_APPROVAL', 'case', r.id, null, { to: 'DSWO' });
      updated(r, r.status);
      forwarded.push(r.id);
    }
    for (const id of ids)
      if (!rows.some((r) => r.id === id)) skipped.push({ id, reason: 'Case not found' });
    res.json({ forwarded, skipped });
  });

  router.post('/cases/:id/notes', (req, res) => {
    const officer = requireOfficer(db, req, 'add_note');
    const row = loadCase(req.params.id);
    const text = typeof req.body?.text === 'string' ? req.body.text.trim().slice(0, 1000) : '';
    if (!text) throw new HttpError(400, 'The note is empty');
    audit(row.id, officer, 'OFFICER_NOTE', 'case', row.id, null, { text });
    updated(row, row.status);
    res.status(201).json(respond(req, row.id, officer));
  });

  return router;
}
