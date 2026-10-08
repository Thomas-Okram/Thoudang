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
  /** Results replayed from truth.json (dev:fixtures) — not an accuracy measurement. */
  fixture?: boolean;
  mode: string;
  labelled?: boolean;
  dataset: string;
  summary: EvalSummary;
}

interface HoldoutFile {
  pairs: FairnessPair[];
  source?: string;
  createdAt?: string;
  /** "seen" once the set's results have influenced the engine (it is then no longer held out). */
  status?: 'blind' | 'seen';
  seenOn?: string;
  /** Snapshot of the scores before the fix the set motivated (kept for an honest before/after). */
  preFix?: { engine: string; overall: FairnessReport['overall'] };
}

function readJson<T>(file: string): T | null {
  try {
    return fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, 'utf8')) as T) : null;
  } catch {
    return null;
  }
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const pctText = (x: number) => `${Math.round(x * 100)}%`;

const fairnessView = (label: string, description: string, pairs: readonly FairnessPair[]) => {
  const r: FairnessReport = evaluateFairness(pairs);
  // Every pair the engine got wrong, worst kind first — fictional names, shown for transparency.
  const errors = r.details
    .filter((d) => d.outcome === 'false-match' || d.outcome === 'false-non-match')
    .sort((x, y) => (x.outcome === y.outcome ? 0 : x.outcome === 'false-match' ? -1 : 1))
    .map((d) => ({
      community: d.community,
      a: d.a,
      b: d.b,
      verdict: d.verdict,
      score: d.score,
      kind: d.outcome as 'false-match' | 'false-non-match',
    }));
  return { label, description, pairs: pairs.length, rows: r.rows, overall: r.overall, errors };
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
        fixture: Boolean(report.fixture),
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

  // 2. Name-engine fairness — development vs held-out v1 (seen, pre-fix) vs held-out v2 (blind)
  const holdoutFile = readJson<HoldoutFile>(config.fairnessHoldoutPath);
  const holdoutV2File = readJson<HoldoutFile>(config.fairnessHoldoutV2Path);
  const v1Seen = holdoutFile?.status === 'seen';
  const fairness = {
    dev: fairnessView(
      'Development set',
      'Seen during build — written alongside the engine (in-sample).',
      fairnessDevPairs,
    ),
    holdout: holdoutFile?.pairs?.length
      ? {
          ...fairnessView(
            v1Seen ? 'Holdout v1 (pre-fix)' : 'Held-out set',
            v1Seen
              ? `Written blind${holdoutFile.source ? ` (${holdoutFile.source})` : ''}, but no longer held out: its 9 false matches led to the given-name rule on ${holdoutFile.seenOn ?? '8 Oct'}, so the "now" numbers below are in-sample. Labels unchanged. A fresh blind set (holdout v2) is the honest measurement.`
              : `Written blind — without seeing the engine's code or output${holdoutFile.source ? ` (${holdoutFile.source})` : ''} — and never used to tune it. Labels: same / different / ambiguous.`,
            holdoutFile.pairs,
          ),
          createdAt: holdoutFile.createdAt ?? null,
          seen: v1Seen,
          preFix: holdoutFile.preFix
            ? { engine: holdoutFile.preFix.engine, overall: holdoutFile.preFix.overall }
            : null,
        }
      : null,
    holdoutV2: holdoutV2File?.pairs?.length
      ? {
          ...fairnessView(
            'Holdout v2 (blind)',
            `Written blind by department staff after the given-name fix${holdoutV2File.source ? ` (${holdoutV2File.source})` : ''} — never used to tune the engine. Labels: same / different / ambiguous.`,
            holdoutV2File.pairs,
          ),
          createdAt: holdoutV2File.createdAt ?? null,
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
    fairness.holdoutV2
      ? `Name-engine fairness: blind holdout v2 has ${fairness.holdoutV2.pairs} pairs (${plural(fairness.holdoutV2.overall.falseMatches, 'false match', 'false matches')}, ${pctText(fairness.holdoutV2.overall.referralRate)} referred to an officer).`
      : fairness.holdout?.seen
        ? `No blind name-engine number yet: holdout v1 (${fairness.holdout.pairs} pairs) is seen — it motivated the given-name fix${fairness.holdout.preFix ? ` (${fairness.holdout.preFix.overall.falseMatches} → ${fairness.holdout.overall.falseMatches} false matches, referrals ${pctText(fairness.holdout.preFix.overall.referralRate)} → ${pctText(fairness.holdout.overall.referralRate)})` : ''}. Holdout v2 is being written by department staff.`
        : fairness.holdout
          ? `Name-engine fairness has a held-out set of ${fairness.holdout.pairs} pairs (${plural(fairness.holdout.overall.falseMatches, 'false match', 'false matches')}); the development set (${fairness.dev.pairs} pairs) is in-sample.`
          : `Name-engine fairness is measured only on the development set (${fairness.dev.pairs} pairs, in-sample) — add a held-out set.`,
    'Status links are signed but have no expiry. Officers sign in with a 4-digit PIN (demo PINs) — no SSO / two-factor yet.',
    'All data is synthetic (SPECIMEN). Not tested on real applications.',
  ];

  return { generatedAt: new Date().toISOString(), evaluation, fairness, safeguards, limitations };
}
