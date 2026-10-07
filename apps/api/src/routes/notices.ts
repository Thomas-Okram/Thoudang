import fs from 'node:fs';
import { Router } from 'express';
import { and, eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { auditLog, cases } from '../db/schema.js';
import type { EventBus } from '../events.js';
import { HttpError, officerActor, requireOfficer } from '../officers.js';
import {
  buildNotice,
  firstNameOf,
  publicStatusFor,
  verifyStatusToken,
  type TemplateStore,
} from '../notices.js';
import type { AudioCache, TtsClient } from '../services/tts.js';
import { TtsError } from '../services/tts.js';

export function noticesRouter(deps: {
  db: Db;
  bus: EventBus;
  templates: TemplateStore;
  tts: TtsClient | null;
  audio: AudioCache;
  statusLinkSecret: string;
  ttsModel: string;
  ttsVoice: string;
}): Router {
  const { db, bus, templates, tts, audio } = deps;
  const router = Router();
  const build = (id: string) => {
    const n = buildNotice(db, id, {
      templates: templates.load(),
      statusLinkSecret: deps.statusLinkSecret,
    });
    if (!n) throw new HttpError(404, 'Case not found');
    return n;
  };
  const audioInfo = (text: string | null, caseId: string) => {
    if (!text) return { available: false, cached: false, url: null, reason: 'No notice to read' };
    const hash = audio.key(
      { model: tts?.model ?? deps.ttsModel, voice: tts?.voice ?? deps.ttsVoice },
      text,
    );
    const cached = audio.has(hash);
    if (cached)
      return {
        available: true,
        cached: true,
        url: `/api/cases/${caseId}/notice/audio?h=${hash}`,
        reason: null,
      };
    return tts
      ? { available: true, cached: false, url: null, reason: null }
      : {
          available: false,
          cached: false,
          url: null,
          reason: 'Audio unavailable (no GEMINI_API_KEY and not pre-generated)',
        };
  };

  router.get('/cases/:id/notice', (req, res) => {
    const n = build(req.params.id);
    res.json({ ...n, audio: audioInfo(n.audioText, n.caseId) });
  });

  /** Generates (or returns cached) audio. Never fails the notice: errors → available:false. */
  router.post('/cases/:id/notice/audio', async (req, res) => {
    const n = build(req.params.id);
    if (!n.audioText) {
      res.json({ available: false, reason: n.blockedReason ?? 'No notice to read' });
      return;
    }
    const info = audioInfo(n.audioText, n.caseId);
    if (info.cached || !tts) {
      res.json(info);
      return;
    }
    try {
      const out = await audio.ensure(tts, n.audioText);
      res.json({
        available: true,
        cached: out.cached,
        url: `/api/cases/${n.caseId}/notice/audio?h=${out.hash}`,
        reason: null,
      });
    } catch (err) {
      res.json({
        available: false,
        cached: false,
        url: null,
        reason:
          err instanceof TtsError ? `Audio unavailable — ${err.message}` : 'Audio unavailable',
      });
    }
  });

  router.get('/cases/:id/notice/audio', (req, res) => {
    const hash =
      typeof req.query.h === 'string' && /^[0-9a-f]{64}$/.test(req.query.h) ? req.query.h : null;
    if (!hash || !audio.has(hash)) throw new HttpError(404, 'Audio not generated');
    res.set('Cache-Control', 'private, max-age=86400').type('audio/wav');
    fs.createReadStream(audio.pathFor(hash)).pipe(res);
  });

  router.post('/cases/:id/notice/sent', (req, res) => {
    const officer = requireOfficer(db, req, 'send_for_correction');
    const n = build(req.params.id);
    if (!n.allowed) throw new HttpError(409, n.blockedReason ?? 'Notice not allowed');
    const channel = ['print', 'whatsapp', 'in_person'].includes(req.body?.channel)
      ? (req.body.channel as string)
      : 'print';
    const row = db.select().from(cases).where(eq(cases.id, n.caseId)).get()!;
    const now = new Date();
    db.update(cases)
      .set({
        noticeSentAt: now,
        noticeSentBy: officer.id,
        correctionRequestedAt: row.correctionRequestedAt ?? now,
        status: row.status === 'APPROVED_BY_OFFICER' ? row.status : 'NEEDS_CITIZEN_CORRECTION',
        updatedAt: now,
      })
      .where(eq(cases.id, n.caseId))
      .run();
    db.insert(auditLog)
      .values({
        caseId: n.caseId,
        actor: officerActor(officer),
        action: 'NOTICE_SENT',
        entityType: 'case',
        entityId: n.caseId,
        after: {
          channel,
          items: n.rendered?.codes ?? [],
          templatesPendingReview: n.rendered?.review.pendingCount ?? 0,
        },
      })
      .run();
    bus.publish({
      type: 'case',
      caseId: n.caseId,
      reference: n.reference,
      batchId: row.batchId,
      stage: 'updated',
      status: 'NEEDS_CITIZEN_CORRECTION',
    });
    const fresh = build(n.caseId);
    res.json({ ...fresh, audio: audioInfo(fresh.audioText, fresh.caseId) });
  });

  /** Cases that need (or are blocked from) a citizen notice. */
  router.get('/notices', (_req, res) => {
    const rows = db.select().from(cases).where(eq(cases.historical, false)).all();
    const set = templates.load();
    const list = rows
      .map((r) => ({
        r,
        n: buildNotice(db, r.id, { templates: set, statusLinkSecret: deps.statusLinkSecret })!,
      }))
      .filter(
        ({ r, n }) =>
          n.allowed ||
          r.status === 'NEEDS_CITIZEN_CORRECTION' ||
          n.blockedReason?.includes('duplicate'),
      )
      .map(({ r, n }) => ({
        caseId: r.id,
        reference: r.reference,
        applicantName: r.applicantName,
        district: r.district,
        status: r.status,
        allowed: n.allowed,
        blockedReason: n.blockedReason,
        items: n.rendered?.codes.length ?? 0,
        noticeSentAt: n.noticeSentAt,
      }))
      .sort(
        (a, b) =>
          Number(Boolean(a.noticeSentAt)) - Number(Boolean(b.noticeSentAt)) ||
          a.reference.localeCompare(b.reference),
      );
    res.json({ notices: list });
  });

  // ---- Template review (/admin/templates) -----------------------------------------------------

  router.get('/templates', (_req, res) => {
    const set = templates.load();
    const all = [...set.templates, ...set.blocks];
    res.json({
      ...set,
      summary: {
        total: all.length,
        reviewed: all.filter((e) => e.reviewed).length,
        manualMeetei: all.filter((e) => e.mni_mtei.trim()).length,
      },
    });
  });

  router.patch('/templates/:kind/:key', (req, res) => {
    const officer = requireOfficer(db, req, 'edit_templates');
    const kind =
      req.params.kind === 'block' ? 'block' : req.params.kind === 'template' ? 'template' : null;
    if (!kind) throw new HttpError(400, 'kind must be template or block');
    const body = (req.body ?? {}) as Record<string, unknown>;
    const patch = Object.fromEntries(
      Object.entries(body).filter(
        ([k, v]) =>
          (['en', 'mni_beng', 'mni_mtei'].includes(k) && typeof v === 'string') ||
          (k === 'reviewed' && typeof v === 'boolean'),
      ),
    );
    if (!Object.keys(patch).length) throw new HttpError(400, 'Nothing to update');
    let result;
    try {
      result = templates.update(kind, req.params.key, patch);
    } catch (err) {
      throw new HttpError(400, err instanceof Error ? err.message : 'Invalid template');
    }
    db.insert(auditLog)
      .values({
        caseId: null,
        actor: officerActor(officer),
        action: 'TEMPLATE_EDITED',
        entityType: kind,
        entityId: req.params.key,
        before: result.before,
        after: result.after,
      })
      .run();
    res.json({ ok: true, entry: result.after });
  });

  // ---- Citizen status page (/s/<ref>?k=…) --------------------------------------------------

  router.get('/public/status/:ref', (req, res) => {
    const ref = req.params.ref;
    const row = db
      .select()
      .from(cases)
      .where(and(eq(cases.reference, ref), eq(cases.historical, false)))
      .get();
    // Same answer for unknown references and bad tokens — no enumeration oracle.
    if (!row || !verifyStatusToken(deps.statusLinkSecret, ref, req.query.k)) {
      res.status(404).json({ error: 'Status not found. Check the link on your notice.' });
      return;
    }
    res.set('Cache-Control', 'no-store').json({
      reference: row.reference,
      firstName: firstNameOf(row.applicantName),
      status: publicStatusFor(row),
      updatedAt: row.updatedAt.toISOString(),
    });
  });

  return router;
}
