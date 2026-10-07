/**
 * Plans a synthetic set: allocates scenarios to packets (exact quotas from the mix), pairs
 * duplicates with an earlier original, builds every spec and checks it against the rules engine.
 * No images here — this part is fast and fully unit-tested.
 */
import type { DuplicateCandidate } from '@thoudang/core';
import { createRng, type Rng } from './rng.js';
import {
  SCENARIOS,
  SCENARIO_INTENT,
  buildPacket,
  randomApplicationDate,
  type BuildOverrides,
  type PacketSpec,
  type Scenario,
} from './spec.js';
import { expectScreening, nameChecks, verdictFits, type Expectation } from './truth.js';

/** The day the expected statuses are computed for (live demo day). */
export const SCREENING_DAY = '2026-10-09';

export type Mix = Record<Scenario, number>;

/** Default planted-problem mix (~35% clean). Keys = scenarios; values are relative weights. */
export const DEFAULT_MIX: Mix = {
  clean: 0.35,
  name_variant: 0.15,
  ambiguous_initials: 0.05,
  age_ineligible: 0.04,
  income_ineligible: 0.04,
  missing_document: 0.05,
  blank_field: 0.05,
  missing_signature: 0.04,
  bank_holder_mismatch: 0.04,
  dob_mismatch: 0.05,
  aadhaar_last4_mismatch: 0.04,
  aadhaar_checksum_invalid: 0.02,
  duplicate: 0.04,
  displaced: 0.04,
};

/** Scenarios whose packets may serve as the original of a duplicate (clean, unambiguous names). */
const ORIGIN_SCENARIOS: ReadonlySet<Scenario> = new Set(['clean', 'displaced']);

export function parseMix(partial: Record<string, unknown>): Mix {
  const mix = { ...DEFAULT_MIX };
  for (const [k, v] of Object.entries(partial)) {
    if (!(SCENARIOS as readonly string[]).includes(k)) {
      throw new Error(`Unknown scenario in mix: "${k}". Known: ${SCENARIOS.join(', ')}`);
    }
    if (typeof v !== 'number' || v < 0 || !Number.isFinite(v)) {
      throw new Error(`Mix weight for "${k}" must be a non-negative number`);
    }
    mix[k as Scenario] = v;
  }
  if (Object.values(mix).every((v) => v === 0)) throw new Error('Mix weights are all zero');
  return mix;
}

/** Largest-remainder allocation: exact counts that sum to `count`. Deterministic tie-break. */
export function allocate(mix: Mix, count: number): Record<Scenario, number> {
  const total = Object.values(mix).reduce((a, b) => a + b, 0);
  const raw = SCENARIOS.map((s) => ({ s, x: (mix[s] / total) * count }));
  const out = Object.fromEntries(raw.map(({ s, x }) => [s, Math.floor(x)])) as Record<
    Scenario,
    number
  >;
  let left = count - Object.values(out).reduce((a, b) => a + b, 0);
  const byRemainder = [...raw].sort(
    (a, b) =>
      b.x - Math.floor(b.x) - (a.x - Math.floor(a.x)) ||
      SCENARIOS.indexOf(a.s) - SCENARIOS.indexOf(b.s),
  );
  for (const { s } of byRemainder) {
    if (left <= 0) break;
    out[s] += 1;
    left -= 1;
  }
  // A duplicate needs an original — each one consumes a clean/displaced packet.
  const origins = out.clean + out.displaced;
  if (out.duplicate > origins) {
    out.clean += out.duplicate - origins;
    out.duplicate = origins;
  }
  return out;
}

/** Orders the packets and assigns every duplicate an earlier, unused original. */
export function arrange(
  rng: Rng,
  quotas: Record<Scenario, number>,
): { scenario: Scenario; originalOf: number | null }[] {
  const list = rng.shuffle(SCENARIOS.flatMap((s) => Array<Scenario>(quotas[s]).fill(s)));
  const used = new Set<number>();
  const originalOf: (number | null)[] = list.map(() => null);
  for (let i = 0; i < list.length; i++) {
    if (list[i] !== 'duplicate') continue;
    const earlier = list
      .map((s, j) => j)
      .filter((j) => j < i && ORIGIN_SCENARIOS.has(list[j]!) && !used.has(j));
    let orig: number;
    if (earlier.length) {
      orig = rng.pick(earlier);
    } else {
      const later = list.findIndex((s, j) => j > i && ORIGIN_SCENARIOS.has(s) && !used.has(j));
      if (later < 0) throw new Error('No original available for a duplicate packet');
      [list[i], list[later]] = [list[later]!, list[i]!];
      // Position i now holds the original; the duplicate moved to `later` and is handled there.
      continue;
    }
    used.add(orig);
    originalOf[i] = orig;
  }
  // Second pass for duplicates moved forward by a swap.
  for (let i = 0; i < list.length; i++) {
    if (list[i] !== 'duplicate' || originalOf[i] !== null) continue;
    const earlier = list
      .map((s, j) => j)
      .filter((j) => j < i && ORIGIN_SCENARIOS.has(list[j]!) && !used.has(j));
    if (!earlier.length) throw new Error('No original available for a duplicate packet');
    const orig = rng.pick(earlier);
    used.add(orig);
    originalOf[i] = orig;
  }
  return list.map((scenario, i) => ({ scenario, originalOf: originalOf[i] ?? null }));
}

export interface PlannedPacket {
  index: number;
  id: string;
  scenario: Scenario;
  spec: PacketSpec;
  expectation: Expectation;
  attempts: number;
  rng: Rng;
}

/** Why a candidate spec does not behave as intended (null = fine). */
export function intentProblem(spec: PacketSpec, exp: Expectation): string | null {
  const intent = SCENARIO_INTENT[spec.scenario];
  if (exp.status !== intent.status) return `status ${exp.status}, intended ${intent.status}`;
  if (intent.flag && !exp.flags.some((f) => f.code === intent.flag))
    return `missing flag ${intent.flag}`;
  if (intent.status === 'READY' && exp.flags.some((f) => f.action !== 'none')) {
    return `unexpected actionable flag ${exp.flags.find((f) => f.action !== 'none')!.code}`;
  }
  if (spec.scenario !== 'duplicate' && exp.flags.some((f) => f.code === 'DUPLICATE_SUSPECTED')) {
    return 'accidental duplicate';
  }
  for (const check of nameChecks(spec)) {
    const doc = check.b.split('.')[0] as 'aadhaar' | 'passbook' | 'epic';
    if (!verdictFits(spec.nameIntent[doc], check.expected)) {
      return `name check ${check.b} → ${check.expected} (intent ${spec.nameIntent[doc] ?? 'same'})`;
    }
  }
  return null;
}

export interface PlanOptions {
  count: number;
  seed: number;
  mix?: Mix;
  idPrefix?: string;
  /** Explicit scenario order + per-packet overrides (demo set). Replaces count/mix. */
  scenarios?: {
    scenario: Scenario;
    originalOf: number | null;
    overrides?: BuildOverrides;
    /** Folder name; default `<idPrefix>-NNN`. */
    id?: string;
  }[];
  maxAttempts?: number;
}

export function plan(opts: PlanOptions): PlannedPacket[] {
  const root = createRng(opts.seed);
  const order: NonNullable<PlanOptions['scenarios']> =
    opts.scenarios ?? arrange(root.fork('arrange'), allocate(opts.mix ?? DEFAULT_MIX, opts.count));
  const width = Math.max(3, String(order.length).length);
  const prefix = opts.idPrefix ?? 'synth';
  const out: PlannedPacket[] = [];
  const existing: DuplicateCandidate[] = [];
  for (const [index, entry] of order.entries()) {
    const { scenario, originalOf } = entry;
    const { overrides, id: fixedId } = entry;
    const id = fixedId ?? `${prefix}-${String(index + 1).padStart(width, '0')}`;
    const prng = root.fork(`packet-${index}`);
    const applicationDate = randomApplicationDate(prng.fork('date'));
    const original = originalOf !== null ? out[originalOf] : undefined;
    if (originalOf !== null && !original)
      throw new Error(`Original ${originalOf} not planned before ${id}`);
    let accepted: PlannedPacket | null = null;
    const problems: string[] = [];
    for (let attempt = 0; attempt < (opts.maxAttempts ?? 40) && !accepted; attempt++) {
      const arng = prng.fork(`attempt-${attempt}`);
      const spec = buildPacket(arng.fork('spec'), scenario, {
        applicationDate,
        original: original ? { spec: original.spec, index: original.index } : undefined,
        overrides,
      });
      const expectation = expectScreening(spec, {
        caseId: id,
        today: SCREENING_DAY,
        existingCases: existing,
      });
      const problem = intentProblem(spec, expectation);
      if (problem) {
        problems.push(problem);
        continue;
      }
      accepted = {
        index,
        id,
        scenario,
        spec,
        expectation,
        attempts: attempt + 1,
        rng: arng.fork('render'),
      };
    }
    if (!accepted) {
      throw new Error(
        `Could not build a "${scenario}" packet for ${id}: ${[...new Set(problems)].join('; ')}`,
      );
    }
    out.push(accepted);
    existing.push({
      caseId: id,
      aadhaarLast4: accepted.expectation.facts.aadhaarLast4,
      dob: accepted.expectation.facts.dob,
      applicantName: accepted.expectation.facts.applicantName,
    });
  }
  return out;
}
