import { defaultGazetteer, type Gazetteer } from './gazetteer.js';
import { parseName, type FamilyToken, type ParsedName } from './parse.js';
import { levenshtein, phoneticKey } from './text.js';

export type NameVerdict = 'SAME' | 'LIKELY_SAME' | 'AMBIGUOUS' | 'DIFFERENT';

export interface NameMatchResult {
  /** 0–100. */
  score: number;
  verdict: NameVerdict;
  /** Plain-English explanation, safe to show to officers. Never empty. */
  reasons: string[];
  /** Present when an abbreviated yumnak could stand for several surnames (verdict AMBIGUOUS). */
  ambiguousYumnaks?: string[];
}

export interface NameThresholds {
  same: number;
  likelySame: number;
  ambiguous: number;
}

/** SAME ≥ 90, LIKELY_SAME 75–89, AMBIGUOUS 50–74 (or any ambiguity trigger), DIFFERENT < 50. */
export const NAME_MATCH_THRESHOLDS: Readonly<NameThresholds> = Object.freeze({
  same: 90,
  likelySame: 75,
  ambiguous: 50,
});

export interface MatchContext {
  gazetteer?: Gazetteer;
  thresholds?: NameThresholds;
  /**
   * Yumnaks/clans written in full elsewhere in the packet for this applicant (e.g. the father's or
   * husband's name on the same document). Used ONLY to narrow an abbreviation like "Th." to a single
   * candidate. If it does not narrow to exactly one, the match stays AMBIGUOUS.
   */
  knownYumnaks?: string[];
}

/** Score penalties. Kept together so the scoring is auditable. */
const PENALTY = {
  givenSpelling: 8,
  extraNamePart: 12,
  familyVariant: 3,
  abbreviationResolved: 5,
  bothAbbreviated: 10,
  abbreviationUnverified: 10,
  familyMissingTribal: 10,
  familyMissingOther: 18,
  genderConflict: 15,
  mohammadOneSided: 3,
} as const;

const SINGLE_PART_CAP = 88;
const GIVEN_MISMATCH_SCORE = 20;
const GIVEN_PARTIAL_CONFLICT_SCORE = 35;
const FAMILY_CONFLICT_SCORE = 40;
const AMBIGUOUS_CEILING = 74;

const TRIBAL = new Set(['Naga', 'Kuki-Zo']);
const VOWELS = new Set(['a', 'e', 'i', 'o', 'u']);

// ---------------------------------------------------------------------------------------------
// Given names
// ---------------------------------------------------------------------------------------------

type GivenKind = 'exact' | 'variant' | 'spelling' | 'gender-vowel' | 'different';

function compareGiven(a: string, b: string): { kind: GivenKind; score: number } {
  if (a === b) return { kind: 'exact', score: 1 };
  const ka = phoneticKey(a);
  const kb = phoneticKey(b);
  if (ka === kb) return { kind: 'variant', score: 0.97 };
  if (levenshtein(ka, kb) === 1 && Math.min(ka.length, kb.length) >= 5) {
    // Meitei given names often mark gender with the final vowel: Tomba/Tombi, Chaoba/Chaobi.
    const sameStem = ka.length === kb.length && ka.slice(0, -1) === kb.slice(0, -1);
    if (sameStem && VOWELS.has(ka.at(-1)!) && VOWELS.has(kb.at(-1)!)) {
      return { kind: 'gender-vowel', score: 0 };
    }
    return { kind: 'spelling', score: 0.85 };
  }
  return { kind: 'different', score: 0 };
}

interface GivenPair {
  a: number;
  b: number;
  kind: GivenKind;
  score: number;
}

/** Greedy best-first alignment of given-name tokens, order-insensitive and deterministic. */
function alignGiven(a: string[], b: string[]) {
  const candidates: GivenPair[] = [];
  const genderVowel: GivenPair[] = [];
  a.forEach((ta, i) =>
    b.forEach((tb, j) => {
      const c = compareGiven(ta, tb);
      if (c.score > 0) candidates.push({ a: i, b: j, ...c });
      else if (c.kind === 'gender-vowel') genderVowel.push({ a: i, b: j, ...c });
    }),
  );
  candidates.sort((x, y) => y.score - x.score || x.a - y.a || x.b - y.b);
  const usedA = new Set<number>();
  const usedB = new Set<number>();
  const pairs: GivenPair[] = [];
  for (const c of candidates) {
    if (usedA.has(c.a) || usedB.has(c.b)) continue;
    usedA.add(c.a);
    usedB.add(c.b);
    pairs.push(c);
  }
  return {
    pairs,
    leftA: a.map((_, i) => i).filter((i) => !usedA.has(i)),
    leftB: b.map((_, j) => j).filter((j) => !usedB.has(j)),
    genderVowel,
  };
}

// ---------------------------------------------------------------------------------------------
// Family names (yumnak / clan / sagei)
// ---------------------------------------------------------------------------------------------

type FamilyQuality =
  | 'exact'
  | 'variant'
  | 'abbr-resolved'
  | 'abbr-unique'
  | 'abbr-both'
  | 'abbr-unverified'
  | 'abbr-ambiguous'
  | 'none';

const QUALITY_RANK: Record<FamilyQuality, number> = {
  exact: 7,
  variant: 6,
  'abbr-resolved': 5,
  'abbr-unique': 5,
  'abbr-both': 4,
  'abbr-unverified': 3,
  'abbr-ambiguous': 2,
  none: 0,
};

interface FamilyComparison {
  quality: FamilyQuality;
  a: FamilyToken;
  b: FamilyToken;
  candidates: string[];
}

function compareAbbrToFull(
  abbr: Extract<FamilyToken, { kind: 'abbr' }>,
  full: Extract<FamilyToken, { kind: 'full' }>,
  knownKeys: Set<string>,
): { quality: FamilyQuality; candidates: string[] } {
  const names = abbr.candidates.map((c) => c.surname);
  if (abbr.candidates.length === 0) {
    const fits = full.display.toLowerCase().startsWith(abbr.abbr);
    return { quality: fits ? 'abbr-unverified' : 'none', candidates: [] };
  }
  if (!abbr.candidates.some((c) => phoneticKey(c.surname) === full.key)) {
    return { quality: 'none', candidates: names };
  }
  if (abbr.candidates.length === 1) return { quality: 'abbr-unique', candidates: names };
  const narrowed = abbr.candidates.filter((c) => knownKeys.has(phoneticKey(c.surname)));
  if (narrowed.length === 1 && phoneticKey(narrowed[0]!.surname) === full.key) {
    return { quality: 'abbr-resolved', candidates: names };
  }
  return { quality: 'abbr-ambiguous', candidates: names };
}

function compareFamily(a: FamilyToken, b: FamilyToken, knownKeys: Set<string>): FamilyComparison {
  const base = { a, b, candidates: [] as string[] };
  if (a.kind === 'full' && b.kind === 'full') {
    if (a.key === b.key) return { ...base, quality: 'exact' };
    if (Math.min(a.key.length, b.key.length) >= 6 && levenshtein(a.key, b.key) <= 1) {
      return { ...base, quality: 'variant' };
    }
    return { ...base, quality: 'none' };
  }
  if (a.kind === 'abbr' && b.kind === 'abbr') {
    return { ...base, quality: a.abbr === b.abbr ? 'abbr-both' : 'none' };
  }
  const r =
    a.kind === 'abbr' && b.kind === 'full'
      ? compareAbbrToFull(a, b, knownKeys)
      : compareAbbrToFull(
          b as Extract<FamilyToken, { kind: 'abbr' }>,
          a as Extract<FamilyToken, { kind: 'full' }>,
          knownKeys,
        );
  return { ...base, ...r };
}

const familyLabel = (f: FamilyToken) => f.display;

function roleReason(f: FamilyToken): string | null {
  if (f.role === 'natal') {
    return `Matches her natal clan (${f.display} Ningol) — consistent with her name before marriage.`;
  }
  if (f.role === 'marital') {
    return `Matches her marital clan (${f.display} Ongbi) — consistent with her married name.`;
  }
  return null;
}

function communityOf(tokens: FamilyToken[]): string | null {
  for (const t of tokens) {
    if (t.kind === 'full' && t.entry) return t.entry.community;
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// matchNames
// ---------------------------------------------------------------------------------------------

const quote = (s: string) => `'${s}'`;
const list = (xs: string[]) => xs.join(', ');

/**
 * Deterministic, explainable, Manipur-aware person-name comparison. No AI.
 * Symmetric: matchNames(a, b) and matchNames(b, a) give the same score and verdict.
 */
export function matchNames(a: string, b: string, ctx: MatchContext = {}): NameMatchResult {
  const gazetteer = ctx.gazetteer ?? defaultGazetteer;
  const t = ctx.thresholds ?? NAME_MATCH_THRESHOLDS;
  const A = parseName(a, gazetteer);
  const B = parseName(b, gazetteer);

  if (!A.normalised || !B.normalised) {
    return {
      score: 0,
      verdict: 'DIFFERENT',
      reasons: ['One of the names is empty or unreadable, so they cannot be compared.'],
    };
  }

  const reasons: string[] = [];
  const ambiguity: string[] = [];
  let score = 100;
  let hardDifferent = false;
  let ambiguousYumnaks: string[] | undefined;

  // --- Given names (dominant) ---------------------------------------------------------------
  const g = alignGiven(A.given, B.given);
  let { leftA, leftB } = g;
  const joinedA = phoneticKey(A.given.join(''));
  const joinedB = phoneticKey(B.given.join(''));
  let matchedGivenParts = g.pairs.length;

  if ((leftA.length || leftB.length) && A.given.length && B.given.length && joinedA === joinedB) {
    reasons.push(
      `Given name is split differently (${quote(A.givenDisplay.join(' '))} vs ${quote(B.givenDisplay.join(' '))}) but spells the same.`,
    );
    leftA = [];
    leftB = [];
    matchedGivenParts = Math.max(A.given.length, B.given.length);
  } else if (A.given.length === 0 && B.given.length === 0) {
    ambiguity.push(
      'No given name could be identified in either name — only family names to compare.',
    );
  } else if (A.given.length === 0 || B.given.length === 0) {
    ambiguity.push('The given name is missing on one document.');
  } else if (g.pairs.length === 0) {
    hardDifferent = true;
    score = GIVEN_MISMATCH_SCORE;
    reasons.push(
      `Given names differ: ${quote(A.givenDisplay.join(' '))} vs ${quote(B.givenDisplay.join(' '))}. A given-name mismatch outweighs matching family names.`,
    );
  } else {
    for (const p of g.pairs) {
      const da = A.givenDisplay[p.a]!;
      const db = B.givenDisplay[p.b]!;
      if (p.kind === 'variant')
        reasons.push(`${quote(da)} and ${quote(db)} are romanisation variants of the same name.`);
      if (p.kind === 'spelling') {
        score -= PENALTY.givenSpelling;
        reasons.push(`${quote(da)} vs ${quote(db)}: minor spelling difference.`);
      }
    }
    if (leftA.length && leftB.length) {
      hardDifferent = true;
      score = Math.min(score, GIVEN_PARTIAL_CONFLICT_SCORE);
      reasons.push(
        `Given names differ: ${list(leftA.map((i) => quote(A.givenDisplay[i]!)))} vs ${list(leftB.map((j) => quote(B.givenDisplay[j]!)))}. A given-name mismatch outweighs everything else.`,
      );
    }
  }
  for (const p of g.genderVowel) {
    if ((leftA.includes(p.a) && leftB.includes(p.b)) || g.pairs.length === 0) {
      reasons.push(
        `${quote(A.givenDisplay[p.a]!)} vs ${quote(B.givenDisplay[p.b]!)}: the final vowel differs — in Meitei names this usually marks a different person (e.g. Tomba/Tombi).`,
      );
    }
  }

  // One-sided extra given-name parts (may turn out to be an unknown family name).
  const extrasA = leftB.length ? [] : leftA.map((i) => A.givenDisplay[i]!);
  const extrasB = leftA.length ? [] : leftB.map((j) => B.givenDisplay[j]!);
  let extrasConsumed = false;

  // --- Family names ------------------------------------------------------------------------
  const knownKeys = new Set((ctx.knownYumnaks ?? []).map((y) => phoneticKey(y)));
  if (A.family.length && B.family.length) {
    let best: FamilyComparison | null = null;
    for (const fa of A.family) {
      for (const fb of B.family) {
        const c = compareFamily(fa, fb, knownKeys);
        if (!best || QUALITY_RANK[c.quality] > QUALITY_RANK[best.quality]) best = c;
      }
    }
    const famA = list(A.family.map(familyLabel));
    const famB = list(B.family.map(familyLabel));
    if (!best || best.quality === 'none') {
      if (!hardDifferent) {
        if (A.gender === 'female' || B.gender === 'female') {
          ambiguity.push(
            `Family name differs (${famA} vs ${famB}), but a woman's yumnak can change at marriage (Ningol/Ongbi). Check marriage evidence before deciding.`,
          );
        } else {
          hardDifferent = true;
          score = Math.min(score, FAMILY_CONFLICT_SCORE);
          reasons.push(
            matchedGivenParts > 0
              ? `Same given name but a different family name/clan (${famA} vs ${famB}).`
              : `Family names differ (${famA} vs ${famB}).`,
          );
        }
      } else {
        reasons.push(`Family names also differ (${famA} vs ${famB}).`);
      }
    } else {
      const abbr = best.a.kind === 'abbr' ? best.a : best.b.kind === 'abbr' ? best.b : null;
      const full = best.a.kind === 'full' ? best.a : best.b.kind === 'full' ? best.b : null;
      switch (best.quality) {
        case 'exact':
          break;
        case 'variant':
          score -= PENALTY.familyVariant;
          reasons.push(
            `Family name spelled slightly differently (${best.a.display} / ${best.b.display}).`,
          );
          break;
        case 'abbr-unique':
          score -= PENALTY.abbreviationResolved;
          reasons.push(
            `${abbr?.display} is the abbreviation of ${full?.display} (only one surname in the gazetteer fits).`,
          );
          break;
        case 'abbr-resolved':
          score -= PENALTY.abbreviationResolved;
          reasons.push(
            `${abbr?.display} → ${full?.display}: could be ${list(best.candidates)}, but the full yumnak ${full?.display} appears elsewhere in the packet.`,
          );
          break;
        case 'abbr-both':
          score -= PENALTY.bothAbbreviated;
          reasons.push(
            `Both documents abbreviate the family name as ${best.a.display}; the full yumnak is not shown.`,
          );
          break;
        case 'abbr-unverified':
          score -= PENALTY.abbreviationUnverified;
          reasons.push(
            `${abbr?.display} is consistent with ${full?.display}, but it is not a known abbreviation in the gazetteer.`,
          );
          break;
        case 'abbr-ambiguous':
          ambiguousYumnaks = best.candidates;
          ambiguity.push(
            `${abbr?.display} could stand for ${list(best.candidates)} — the documents do not show which. Officer to confirm the yumnak.`,
          );
          break;
      }
      const roleNote = roleReason(best.a) ?? roleReason(best.b);
      if (roleNote) reasons.push(roleNote);
    }
  } else if (A.family.length || B.family.length) {
    const withFamily = A.family.length ? A : B;
    const extras = A.family.length ? extrasB : extrasA;
    const fam = list(withFamily.family.map(familyLabel));
    if (extras.length) {
      extrasConsumed = true;
      const abbrs = withFamily.family.filter((f) => f.kind === 'abbr');
      const fitting = extras.filter((x) =>
        abbrs.some((f) => x.toLowerCase().startsWith(f.kind === 'abbr' ? f.abbr : '')),
      );
      if (fitting.length && !hardDifferent) {
        score -= PENALTY.abbreviationUnverified;
        reasons.push(
          `${list(abbrs.map(familyLabel))} is consistent with ${quote(fitting[0]!)}, which is not in the gazetteer.`,
        );
      } else {
        ambiguity.push(
          `${list(extras.map(quote))} is not in the gazetteer — it may be a family name different from ${fam}.`,
        );
      }
    } else {
      const community = communityOf(withFamily.family);
      if (community && TRIBAL.has(community)) {
        score -= PENALTY.familyMissingTribal;
        reasons.push(
          `Clan name ${fam} appears on only one document (common for single-name records).`,
        );
      } else {
        score -= PENALTY.familyMissingOther;
        reasons.push(`Yumnak/family name ${fam} appears on only one document.`);
      }
    }
  } else if (!hardDifferent && matchedGivenParts <= 1 && !ambiguity.length) {
    score = Math.min(score, SINGLE_PART_CAP);
    reasons.push('Only one name part could be compared and no family name is present.');
  }

  if (!extrasConsumed && !hardDifferent) {
    for (const x of [...extrasA, ...extrasB]) {
      score -= PENALTY.extraNamePart;
      reasons.push(`${quote(x)} appears in only one of the two names.`);
    }
  }

  // --- Optional endings & prefixes ------------------------------------------------------------
  if (A.gender && B.gender && A.gender !== B.gender) {
    score -= PENALTY.genderConflict;
    reasons.push(
      `Gender endings disagree (${list(A.markerDisplay) || 'Ningol/Ongbi'} vs ${list(B.markerDisplay) || 'Ningol/Ongbi'}).`,
    );
  } else {
    const ma = [...new Set(A.markers)].sort().join(',');
    const mb = [...new Set(B.markers)].sort().join(',');
    if (ma !== mb) {
      reasons.push(
        `Optional endings differ or were dropped (${list(A.markerDisplay) || 'none'} vs ${list(B.markerDisplay) || 'none'}) — treated as equivalent.`,
      );
    } else if (A.markerDisplay.join() !== B.markerDisplay.join()) {
      reasons.push(
        `${list(A.markerDisplay)} and ${list(B.markerDisplay)} are spelling variants of the same ending.`,
      );
    }
  }
  if (A.hasMohammad && B.hasMohammad) {
    if (A.mohammadDisplay !== B.mohammadDisplay) {
      reasons.push(
        `${quote(A.mohammadDisplay!)} and ${quote(B.mohammadDisplay!)} are equivalent (Md./Mohd./Mohammad).`,
      );
    }
  } else if (A.hasMohammad || B.hasMohammad) {
    score -= PENALTY.mohammadOneSided;
    reasons.push(
      `The ${quote((A.mohammadDisplay ?? B.mohammadDisplay)!)} prefix appears on only one document.`,
    );
  }

  // --- Verdict -------------------------------------------------------------------------------
  score = Math.max(0, Math.min(100, Math.round(score)));
  let verdict: NameVerdict;
  if (hardDifferent || score < t.ambiguous) {
    verdict = 'DIFFERENT';
    score = Math.min(score, t.ambiguous - 1);
  } else if (ambiguity.length) {
    verdict = 'AMBIGUOUS';
    score = Math.max(t.ambiguous, Math.min(score, AMBIGUOUS_CEILING));
    reasons.unshift(...ambiguity);
  } else if (score >= t.same) {
    verdict = 'SAME';
  } else if (score >= t.likelySame) {
    verdict = 'LIKELY_SAME';
  } else {
    verdict = 'AMBIGUOUS';
  }
  if (!reasons.length) reasons.push('All name parts match.');
  return verdict === 'AMBIGUOUS' && ambiguousYumnaks
    ? { score, verdict, reasons, ambiguousYumnaks }
    : { score, verdict, reasons };
}

export type { ParsedName };
