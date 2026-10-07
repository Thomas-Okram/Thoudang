import { z } from 'zod';
import { matchNames, parseDate, type NameVerdict } from '@thoudang/core';
import type { DetectedType } from '../db/schema.js';
import { parseIncome } from '../pipeline/mapping.js';

/** truth.json — one per packet folder. Only the fields you list are scored. */
export const TruthSchema = z.object({
  _note: z.string().optional(),
  expected_status: z.enum(['READY', 'NEEDS_CITIZEN_CORRECTION', 'OFFICER_ATTENTION']),
  documents: z.record(
    z.string(), // image file name in the packet folder
    z.object({
      type: z.enum(['application_form', 'aadhaar', 'bank_passbook', 'epic', 'other']),
      /** Expected transcription; null = field is blank on the document. Aadhaar as "XXXX XXXX 1234". */
      fields: z.record(z.string(), z.string().nullable()).default({}),
    }),
  ),
  name_checks: z
    .array(
      z.object({
        a: z.string(), // "form.jpg:applicant_name"
        b: z.string(), // "aadhaar.jpg:name"
        expected: z.enum(['SAME', 'LIKELY_SAME', 'AMBIGUOUS', 'DIFFERENT']),
      }),
    )
    .default([]),
});
export type Truth = z.infer<typeof TruthSchema>;

const DATE_FIELDS = new Set(['date_of_birth', 'dob_or_yob', 'application_date']);
const DIGIT_FIELDS = new Set(['account_number', 'mobile']);

const loose = (s: string) =>
  s
    .toLowerCase()
    .replace(/[.,:;'"`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

/** Field-aware equality: dates by calendar value, numbers by digits, text case/punctuation-insensitive. */
export function fieldMatches(
  field: string,
  expected: string | null,
  actual: string | null,
): boolean {
  if (expected === null || actual === null) return expected === actual;
  if (DATE_FIELDS.has(field)) {
    const e = parseDate(expected.replace(/^.*?(\d)/, '$1'));
    const a = parseDate(actual.replace(/^.*?(\d)/, '$1'));
    if (e && a) return e.iso === a.iso;
  }
  if (DIGIT_FIELDS.has(field)) return expected.replace(/\D/g, '') === actual.replace(/\D/g, '');
  if (field === 'annual_income') return parseIncome(expected) === parseIncome(actual);
  if (field === 'aadhaar_number')
    return expected.replace(/\s/g, '').toUpperCase() === actual.replace(/\s/g, '').toUpperCase();
  return loose(expected) === loose(actual);
}

export interface ExtractedForEval {
  fileName: string;
  detectedType: DetectedType | null;
  fields: Record<string, { value: string | null; confidence: 'high' | 'medium' | 'low' }> | null;
}

export interface FieldResult {
  packet: string;
  document: string;
  docType: string;
  field: string;
  expected: string | null;
  actual: string | null;
  confidence: string | null;
  correct: boolean;
}

export interface PacketScore {
  packet: string;
  classification: { file: string; expected: string; actual: string | null; correct: boolean }[];
  fields: FieldResult[];
  status: { expected: string; actual: string; correct: boolean };
  names: {
    a: string;
    b: string;
    expected: NameVerdict;
    actual: NameVerdict | null;
    correct: boolean;
  }[];
}

export function scorePacket(
  packet: string,
  truth: Truth,
  extracted: ExtractedForEval[],
  actualStatus: string,
): PacketScore {
  const byFile = new Map(extracted.map((e) => [e.fileName, e]));
  const classification = Object.entries(truth.documents).map(([file, t]) => {
    const actual = byFile.get(file)?.detectedType ?? null;
    return { file, expected: t.type, actual, correct: actual === t.type };
  });
  const fields: FieldResult[] = [];
  for (const [file, t] of Object.entries(truth.documents)) {
    const got = byFile.get(file)?.fields ?? null;
    for (const [field, expected] of Object.entries(t.fields)) {
      const v = got?.[field];
      const actual = v?.value ?? null;
      fields.push({
        packet,
        document: file,
        docType: t.type,
        field,
        expected,
        actual,
        confidence: v?.confidence ?? null,
        correct: Boolean(got) && fieldMatches(field, expected, actual),
      });
    }
  }
  const valueOf = (ref: string) => {
    const [file, field] = ref.split(':');
    return byFile.get(file ?? '')?.fields?.[field ?? '']?.value ?? null;
  };
  const names = truth.name_checks.map((n) => {
    const a = valueOf(n.a);
    const b = valueOf(n.b);
    const actual = a && b ? matchNames(a, b).verdict : null;
    return { a: n.a, b: n.b, expected: n.expected, actual, correct: actual === n.expected };
  });
  return {
    packet,
    classification,
    fields,
    status: {
      expected: truth.expected_status,
      actual: actualStatus,
      correct: truth.expected_status === actualStatus,
    },
    names,
  };
}

const rate = (xs: { correct: boolean }[]) =>
  xs.length ? xs.filter((x) => x.correct).length / xs.length : null;

function groupRate<T extends { correct: boolean }>(xs: T[], key: (x: T) => string) {
  const groups = new Map<string, T[]>();
  for (const x of xs) groups.set(key(x), [...(groups.get(key(x)) ?? []), x]);
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, list]) => ({ key: k, n: list.length, accuracy: rate(list) ?? 0 }));
}

export interface UsageStats {
  packets: number;
  apiCalls: number;
  cacheHits: number;
  inputTokens: number;
  outputTokens: number;
  apiLatencyMs: number[];
  packetWallMs: number[];
}

export function summarise(
  scores: PacketScore[],
  usage: UsageStats,
  pricing: { inputPerMTok: number; outputPerMTok: number },
) {
  const fields = scores.flatMap((s) => s.fields);
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  const costUsd =
    (usage.inputTokens / 1e6) * pricing.inputPerMTok +
    (usage.outputTokens / 1e6) * pricing.outputPerMTok;
  return {
    packets: scores.length,
    fieldAccuracy: rate(fields),
    fieldsScored: fields.length,
    byDocType: groupRate(fields, (f) => f.docType),
    byField: groupRate(fields, (f) => `${f.docType}.${f.field}`),
    byConfidence: groupRate(
      fields.filter((f) => f.confidence),
      (f) => f.confidence!,
    ),
    classificationAccuracy: rate(scores.flatMap((s) => s.classification)),
    statusAccuracy: rate(scores.map((s) => s.status)),
    nameVerdictAccuracy: rate(scores.flatMap((s) => s.names)),
    latency: {
      avgApiCallMs: Math.round(avg(usage.apiLatencyMs)),
      avgPacketWallMs: Math.round(avg(usage.packetWallMs)),
    },
    cost: {
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      totalUsd: Number(costUsd.toFixed(4)),
      avgPerPacketUsd: Number((usage.packets ? costUsd / usage.packets : 0).toFixed(4)),
      pricing,
    },
    calls: { api: usage.apiCalls, cacheHits: usage.cacheHits },
    errors: fields.filter((f) => !f.correct),
  };
}
export type EvalSummary = ReturnType<typeof summarise>;

const pct = (x: number | null) => (x === null ? '—' : `${(x * 100).toFixed(1)}%`);

/** Plain-text report for the terminal (and copy-paste into the Trust Report). */
export function formatReport(s: EvalSummary): string {
  const lines = [
    `Packets: ${s.packets}   Fields scored: ${s.fieldsScored}`,
    `Field accuracy:          ${pct(s.fieldAccuracy)}`,
    `Classification accuracy: ${pct(s.classificationAccuracy)}`,
    `Status accuracy:         ${pct(s.statusAccuracy)}`,
    `Name-verdict accuracy:   ${pct(s.nameVerdictAccuracy)}`,
    `Avg latency: ${s.latency.avgApiCallMs} ms per Claude call, ${s.latency.avgPacketWallMs} ms per packet (wall clock)`,
    `Cost: $${s.cost.totalUsd} total, $${s.cost.avgPerPacketUsd} per packet (${s.cost.inputTokens} in / ${s.cost.outputTokens} out tokens; ${s.calls.api} API calls, ${s.calls.cacheHits} cache hits)`,
    '',
    'By document type:',
    ...s.byDocType.map((r) => `  ${r.key.padEnd(18)} ${pct(r.accuracy).padStart(7)}  (n=${r.n})`),
    '',
    'By stated confidence (calibration):',
    ...s.byConfidence.map(
      (r) => `  ${r.key.padEnd(18)} ${pct(r.accuracy).padStart(7)}  (n=${r.n})`,
    ),
    '',
    'By field:',
    ...s.byField.map((r) => `  ${r.key.padEnd(42)} ${pct(r.accuracy).padStart(7)}  (n=${r.n})`),
  ];
  if (s.errors.length) {
    lines.push('', `Mismatches (${s.errors.length}):`);
    for (const e of s.errors.slice(0, 40)) {
      lines.push(
        `  ${e.packet}/${e.document} ${e.field}: expected ${JSON.stringify(e.expected)} got ${JSON.stringify(e.actual)} [${e.confidence ?? '—'}]`,
      );
    }
  }
  return lines.join('\n');
}
