import fs from 'node:fs';
import { sql } from 'drizzle-orm';
import {
  evaluateFairness,
  fairnessDevPairs,
  gazetteerEntries,
  getSchemeRules,
  type FairnessPair,
  type FairnessReport,
} from '@thoudang/core';
import type { Db } from './db/client.js';
import { auditLog, CASE_STATUSES, cases, documents, extractions, flags } from './db/schema.js';
import type { AppConfig } from './env.js';
import type { ExtractedDocument } from './extraction/schemas.js';
import type { TemplateStore } from './notices.js';
import { redactionFor } from './services/redact.js';
import type { EvalSummary } from './eval/score.js';
import type { LeakScanResult } from './leak-scan.js';

interface EvalReportFile {
  generatedAt: string;
  model: string;
  mode: string;
  labelled?: boolean;
  dataset: string;
  summary: EvalSummary;
}

function readJson<T>(file: string): T | null {
  try {
    return fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, 'utf8')) as T) : null;
  } catch {
    return null;
  }
}

const fairnessView = (label: string, description: string, pairs: readonly FairnessPair[]) => {
  const r: FairnessReport = evaluateFairness(pairs);
  return { label, description, pairs: pairs.length, rows: r.rows, overall: r.overall };
};

export function trustReport(
  db: Db,
  config: AppConfig,
  templates: TemplateStore,
  lastLeakScan: LeakScanResult | null,
) {
  // 1. Extraction accuracy (latest `npm run eval`)
  const report = readJson<EvalReportFile>(config.evalReportPath);
  const evaluation = report
    ? {
        available: true as const,
        generatedAt: report.generatedAt,
        model: report.model,
        mode: report.mode,
        labelled: Boolean(report.labelled),
        packets: report.summary.packets,
        fieldsScored: report.summary.fieldsScored,
        fieldAccuracy: report.summary.fieldAccuracy,
        classificationAccuracy: report.summary.classificationAccuracy,
        statusAccuracy: report.summary.statusAccuracy,
        nameVerdictAccuracy: report.summary.nameVerdictAccuracy,
        byDocType: report.summary.byDocType,
        byField: report.summary.byField,
        byConfidence: report.summary.byConfidence,
        latency: report.summary.latency,
        cost: {
          ...report.summary.cost,
          perApplicationInr: Number(
            (report.summary.cost.avgPerPacketUsd * config.pricing.usdToInr).toFixed(2),
          ),
          usdToInr: config.pricing.usdToInr,
        },
      }
    : {
        available: false as const,
        howTo:
          'Run `npm run eval -- --dir ./eval-data` with ANTHROPIC_API_KEY set; the report appears here.',
      };

  // 2. Name-engine fairness — development vs held-out
  const holdoutFile = readJson<{ pairs: FairnessPair[]; source?: string; createdAt?: string }>(
    config.fairnessHoldoutPath,
  );
  const fairness = {
    dev: fairnessView(
      'Development set',
      'Seen during build — written alongside the engine (in-sample).',
      fairnessDevPairs,
    ),
    holdout: holdoutFile?.pairs?.length
      ? {
          ...fairnessView(
            'Held-out set',
            `Written by department staff${holdoutFile.source ? ` (${holdoutFile.source})` : ''} — never used to tune the engine.`,
            holdoutFile.pairs,
          ),
          createdAt: holdoutFile.createdAt ?? null,
        }
      : null,
  };

  // 3. Safeguards with live proof
  const auditEntries =
    db
      .select({ n: sql<number>`count(*)` })
      .from(auditLog)
      .get()?.n ?? 0;
  // Officer-decision numbers come from LIVE cases only (synthetic history is excluded).
  const liveIds = new Set(
    db
      .select({ id: cases.id, historical: cases.historical })
      .from(cases)
      .all()
      .filter((c) => !c.historical)
      .map((c) => c.id),
  );
  const flagRows = db
    .select()
    .from(flags)
    .all()
    .filter((f) => liveIds.has(f.caseId));
  const decided = flagRows.filter((f) => f.resolution !== 'OPEN' && f.severity !== 'info');
  const overridden = decided.filter((f) => f.resolution === 'OVERRIDDEN').length;
  const approvals = db
    .select()
    .from(auditLog)
    .all()
    .filter((a) => a.action === 'OFFICER_APPROVE');
  const docRows = db.select().from(documents).all();
  const extRows = db.select().from(extractions).all();
  let redacted = 0;
  for (const d of docRows) {
    const ext = extRows
      .filter((e) => e.documentId === d.id && e.stage === 'extract' && e.status === 'OK')
      .at(-1);
    if (
      d.processedPath &&
      redactionFor(d.detectedType, (ext?.result as unknown as ExtractedDocument) ?? null, {
        width: d.widthPx,
        height: d.heightPx,
      }).mode !== 'none'
    )
      redacted += 1;
  }
  const set = templates.load();
  const entries = [...set.templates, ...set.blocks];
  const reviewed = entries.filter((e) => e.reviewed).length;
  const liveCases = db
    .select()
    .from(cases)
    .all()
    .filter((c) => !c.historical);
  const historical =
    db
      .select({ n: sql<number>`count(*)` })
      .from(cases)
      .where(sql`historical = 1`)
      .get()?.n ?? 0;
  const rules = getSchemeRules();

  const safeguards = {
    statuses: [...CASE_STATUSES],
    rejectStatusExists: (CASE_STATUSES as readonly string[]).some((s) => /REJECT/i.test(s)),
    leakScan: lastLeakScan,
    imagesRedacted: redacted,
    imagesTotal: docRows.length,
    auditEntries,
    approvals: approvals.length,
    approvalsByDswoOnly: approvals.every(
      (a) => a.actor === 'officer:dswo-imphal-west' || a.actor.startsWith('officer:dswo'),
    ),
    flagsDecidedByOfficers: decided.length,
    overrideRate: decided.length ? overridden / decided.length : null,
    notices: { aiCalls: 0, templates: entries.length, reviewed },
    syntheticOnly: { liveCases: liveCases.length, historicalSynthetic: historical },
  };

  // 5. Known limitations (computed where possible)
  const limitations = [
    `Scheme thresholds are unverified with the department (minimum age ${rules.minAge}, income ceiling ₹${rules.annualIncomeCeiling.toLocaleString('en-IN')}; config marked verified: ${rules.verified}).`,
    `The name gazetteer is a starter list of ${gazetteerEntries.length} surnames and needs department review (abbreviations especially).`,
    `Manipuri notice templates: ${reviewed} of ${entries.length} reviewed by a native speaker; Meetei Mayek is auto-transliterated unless a reviewer wrote it.`,
    evaluation.available
      ? `Handwriting/extraction accuracy is measured on ${evaluation.packets} synthetic packet(s) only (${evaluation.fieldsScored} fields).`
      : 'Extraction accuracy has not been measured yet — no eval report.',
    fairness.holdout
      ? `Name-engine fairness has a held-out set of ${fairness.holdout.pairs} pairs; the development set (${fairness.dev.pairs} pairs) is in-sample.`
      : `Name-engine fairness is measured only on the development set (${fairness.dev.pairs} pairs, in-sample) — add a held-out set.`,
    'Status links are signed but have no expiry; the prototype has no passwords (demo officer switcher).',
    'All data is synthetic (SPECIMEN). Not tested on real applications.',
  ];

  return { generatedAt: new Date().toISOString(), evaluation, fairness, safeguards, limitations };
}
