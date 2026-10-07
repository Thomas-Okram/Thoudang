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
  givenInitial: 12,
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

type GivenKind = 'exact' | 'variant' | 'spelling' | 'initial' | 'gender-vowel' | 'different';

function compareGiven(
  a: string,
  b: string,
  aInitial = false,
  bInitial = false,
): { kind: GivenKind; score: number } {
  if (a === b) return { kind: 'exact', score: 1 };
  if (aInitial !== bInitial) {
    // "Th." vs "Thuingaleng": an initial fits a full given name that starts with it.
    const [initial, full] = aInitial ? [a, b] : [b, a];
    return full.startsWith(initial)
      ? { kind: 'initial', score: 0.6 }
      : { kind: 'different', score: 0 };
  }
  if (aInitial && bInitial) return { kind: 'different', score: 0 };
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
function alignGiven(A: ParsedName, B: ParsedName) {
  const a = A.given;
  const b = B.given;
  const candidates: GivenPair[] = [];
  const genderVowel: GivenPair[] = [];
  a.forEach((ta, i) =>
    b.forEach((tb, j) => {
      const c = compareGiven(ta, tb, A.givenInitial[i], B.givenInitial[j]);
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
  | 'abbr-unknown-full'
  | 'none';

const QUALITY_RANK: Record<FamilyQuality, number> = {
  exact: 7,
  variant: 6,
  'abbr-resolved': 5,
  'abbr-unique': 5,
  'abbr-both': 4,
  'abbr-unverified': 3,
  'abbr-ambiguous': 2,
  'abbr-unknown-full': 2,
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
    // A yumnak missing from the (starter) gazetteer that still fits the abbreviation: refer it.
    const fits = !full.entry && full.display.toLowerCase().startsWith(abbr.abbr);
    return fits
      ? { quality: 'abbr-unknown-full', candidates: [full.display, ...names] }
      : { quality: 'none', candidates: names };
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

/** A reason in two registers: the full sentence and a short (≤ 12 words) version for officers. */
interface Note {
  long: string;
  short: string;
}

function roleReason(f: FamilyToken): Note | null {
  if (f.role === 'natal') {
    return {
      long: `Matches her natal clan (${f.display} Ningol) — consistent with her name before marriage.`,
      short: `Matches her clan before marriage (${f.display} Ningol).`,
    };
  }
  if (f.role === 'marital') {
    return {
      long: `Matches her marital clan (${f.display} Ongbi) — consistent with her married name.`,
      short: `Matches her married clan (${f.display} Ongbi).`,
    };
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
/** At most `n` items, then "+N more" ("X…" when n = 1) — keeps short reasons short. */
const brief = (xs: string[], n = 2) => {
  if (xs.length <= n) return xs.join(', ');
  return n === 1 ? `${xs[0]}…` : `${xs.slice(0, n).join(', ')} +${xs.length - n} more`;
};
/** At most two words of a (multi-word) name, for short reasons. */
const briefName = (s: string) => {
  const w = s.split(' ');
  return w.length > 2 ? `${w.slice(0, 2).join(' ')}…` : s;
};

interface Evaluation {
  result: NameMatchResult;
  points: string[];
}

// Parsed names are cached per gazetteer: duplicate checks compare one applicant against many
// stored cases, so the same strings are parsed over and over. Cached objects are never mutated.
const PARSE_CACHE_LIMIT = 10_000;
const parseCache = new WeakMap<Gazetteer, Map<string, ParsedName>>();

function parseCached(raw: string, gazetteer: Gazetteer): ParsedName {
  let cache = parseCache.get(gazetteer);
  if (!cache) parseCache.set(gazetteer, (cache = new Map()));
  const hit = cache.get(raw);
  if (hit) return hit;
  const parsed = parseName(raw, gazetteer);
  if (cache.size >= PARSE_CACHE_LIMIT) cache.clear();
  cache.set(raw, parsed);
  return parsed;
}

function evaluate(a: string, b: string, ctx: MatchContext): Evaluation {
  const gazetteer = ctx.gazetteer ?? defaultGazetteer;
  const t = ctx.thresholds ?? NAME_MATCH_THRESHOLDS;
  const A = parseCached(a, gazetteer);
  const B = parseCached(b, gazetteer);

  if (!A.normalised || !B.normalised) {
    return {
      result: {
        score: 0,
        verdict: 'DIFFERENT',
        reasons: ['One of the names is empty or unreadable, so they cannot be compared.'],
      },
      points: ['One name is empty or unreadable.'],
    };
  }

  const reasons: Note[] = [];
  const ambiguity: Note[] = [];
  const say = (long: string, short: string) => reasons.push({ long, short });
  const unsure = (long: string, short: string) => ambiguity.push({ long, short });
  let score = 100;
  let hardDifferent = false;
  let ambiguousYumnaks: string[] | undefined;

  // --- Given names (dominant) ---------------------------------------------------------------
  const g = alignGiven(A, B);
  let { leftA, leftB } = g;
  const joinedA = phoneticKey(A.given.join(''));
  const joinedB = phoneticKey(B.given.join(''));
  let matchedGivenParts = g.pairs.length;
  const givenA = briefName(A.givenDisplay.join(' '));
  const givenB = briefName(B.givenDisplay.join(' '));

  if ((leftA.length || leftB.length) && A.given.length && B.given.length && joinedA === joinedB) {
    say(
      `Given name is split differently (${quote(A.givenDisplay.join(' '))} vs ${quote(B.givenDisplay.join(' '))}) but spells the same.`,
      'Given name is split differently but spelled the same.',
    );
    leftA = [];
    leftB = [];
    matchedGivenParts = Math.max(A.given.length, B.given.length);
  } else if (A.given.length === 0 && B.given.length === 0) {
    unsure(
      'No given name could be identified in either name — only family names to compare.',
      'No given name found; only family names compared.',
    );
  } else if (A.given.length === 0 || B.given.length === 0) {
    unsure('The given name is missing on one document.', 'Given name is missing on one document.');
  } else if (g.pairs.length === 0) {
    hardDifferent = true;
    score = GIVEN_MISMATCH_SCORE;
    say(
      `Given names differ: ${quote(A.givenDisplay.join(' '))} vs ${quote(B.givenDisplay.join(' '))}. A given-name mismatch outweighs matching family names.`,
      `Given names differ: ${quote(givenA)} vs ${quote(givenB)}.`,
    );
  } else {
    let initialPenalised = false;
    for (const p of g.pairs) {
      const da = A.givenDisplay[p.a]!;
      const db = B.givenDisplay[p.b]!;
      if (p.kind === 'variant')
        say(
          `${quote(da)} and ${quote(db)} are romanisation variants of the same name.`,
          `${da} / ${db}: same name, spelled differently.`,
        );
      if (p.kind === 'spelling') {
        score -= PENALTY.givenSpelling;
        say(
          `${quote(da)} vs ${quote(db)}: minor spelling difference.`,
          `${da} / ${db}: small spelling difference.`,
        );
      }
      if (p.kind === 'initial') {
        if (!initialPenalised) score -= PENALTY.givenInitial;
        initialPenalised = true;
        const [initial, full] = A.givenInitial[p.a] ? [da, db] : [db, da];
        say(
          `${initial} is the initial of the given name ${quote(full)} (Naga/Kuki-Zo/Nepali style) — consistent, but the full given name is shown on one document only.`,
          `${initial} is the initial of ${full}.`,
        );
      }
    }
    if (leftA.length && leftB.length) {
      hardDifferent = true;
      score = Math.min(score, GIVEN_PARTIAL_CONFLICT_SCORE);
      const la = leftA.map((i) => A.givenDisplay[i]!);
      const lb = leftB.map((j) => B.givenDisplay[j]!);
      say(
        `Given names differ: ${list(la.map(quote))} vs ${list(lb.map(quote))}. A given-name mismatch outweighs everything else.`,
        `Given names differ: ${brief(la.map(quote), 1)} vs ${brief(lb.map(quote), 1)}.`,
      );
    }
  }
  for (const p of g.genderVowel) {
    if ((leftA.includes(p.a) && leftB.includes(p.b)) || g.pairs.length === 0) {
      const da = A.givenDisplay[p.a]!;
      const db = B.givenDisplay[p.b]!;
      say(
        `${quote(da)} vs ${quote(db)}: the final vowel differs — in Meitei names this usually marks a different person (e.g. Tomba/Tombi).`,
        `${da} / ${db}: last vowel differs, usually a different person.`,
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
    const shortA = brief(A.family.map(familyLabel), 1);
    const shortB = brief(B.family.map(familyLabel), 1);
    if (!best || best.quality === 'none') {
      if (!hardDifferent) {
        if (A.gender === 'female' || B.gender === 'female') {
          unsure(
            `Family name differs (${famA} vs ${famB}), but a woman's yumnak can change at marriage (Ningol/Ongbi). Check marriage evidence before deciding.`,
            `Family name differs (${shortA} vs ${shortB}); may have changed at marriage.`,
          );
        } else {
          hardDifferent = true;
          score = Math.min(score, FAMILY_CONFLICT_SCORE);
          if (matchedGivenParts > 0) {
            say(
              `Same given name but a different family name/clan (${famA} vs ${famB}).`,
              `Same given name, different family name: ${shortA} vs ${shortB}.`,
            );
          } else {
            say(
              `Family names differ (${famA} vs ${famB}).`,
              `Family names differ: ${shortA} vs ${shortB}.`,
            );
          }
        }
      } else {
        say(`Family names also differ (${famA} vs ${famB}).`, 'Family names also differ.');
      }
    } else {
      const abbr = best.a.kind === 'abbr' ? best.a : best.b.kind === 'abbr' ? best.b : null;
      const full = best.a.kind === 'full' ? best.a : best.b.kind === 'full' ? best.b : null;
      switch (best.quality) {
        case 'exact':
          break;
        case 'variant':
          score -= PENALTY.familyVariant;
          say(
            `Family name spelled slightly differently (${best.a.display} / ${best.b.display}).`,
            `Family name spelled slightly differently: ${best.a.display} / ${best.b.display}.`,
          );
          break;
        case 'abbr-unique':
          score -= PENALTY.abbreviationResolved;
          say(
            `${abbr?.display} is the abbreviation of ${full?.display} (only one surname in the gazetteer fits).`,
            `${abbr?.display} = ${full?.display}, the only surname it can stand for.`,
          );
          break;
        case 'abbr-resolved':
          score -= PENALTY.abbreviationResolved;
          say(
            `${abbr?.display} → ${full?.display}: could be ${list(best.candidates)}, but the full yumnak ${full?.display} appears elsewhere in the packet.`,
            `${abbr?.display} = ${full?.display}, written in full elsewhere in the packet.`,
          );
          break;
        case 'abbr-both':
          score -= PENALTY.bothAbbreviated;
          say(
            `Both documents abbreviate the family name as ${best.a.display}; the full yumnak is not shown.`,
            `Both documents abbreviate the family name as ${best.a.display}.`,
          );
          break;
        case 'abbr-unverified':
          score -= PENALTY.abbreviationUnverified;
          say(
            `${abbr?.display} is consistent with ${full?.display}, but it is not a known abbreviation in the gazetteer.`,
            `${abbr?.display} fits ${full?.display}, but is not a known abbreviation.`,
          );
          break;
        case 'abbr-ambiguous':
          ambiguousYumnaks = best.candidates;
          unsure(
            `${abbr?.display} could stand for ${list(best.candidates)} — the documents do not show which. Officer to confirm the yumnak.`,
            `${abbr?.display} could be ${brief(best.candidates, 3)}; officer to confirm.`,
          );
          break;
        case 'abbr-unknown-full':
          ambiguousYumnaks = best.candidates;
          unsure(
            `${abbr?.display} is consistent with ${full?.display}, but ${full?.display} is not in the gazetteer and ${abbr?.display} could also stand for ${list(best.candidates.slice(1))}. Officer to confirm the yumnak.`,
            `${abbr?.display} fits ${full?.display} (not in the gazetteer); officer to confirm.`,
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
    const famShort = brief(withFamily.family.map(familyLabel), 1);
    if (extras.length) {
      extrasConsumed = true;
      const abbrs = withFamily.family.filter((f) => f.kind === 'abbr');
      const fitting = extras.filter((x) =>
        abbrs.some((f) => x.toLowerCase().startsWith(f.kind === 'abbr' ? f.abbr : '')),
      );
      const known = abbrs.flatMap((f) => (f.kind === 'abbr' ? f.candidates : []));
      if (fitting.length && !hardDifferent && known.length) {
        // "Kh." vs "Khutembam": fits, but Kh. is also Khuraijam, Khumanthem … — refer it.
        const names = [fitting[0]!, ...known.map((c) => c.surname)];
        ambiguousYumnaks = names;
        unsure(
          `${list(abbrs.map(familyLabel))} is consistent with ${quote(fitting[0]!)}, but ${quote(fitting[0]!)} is not in the gazetteer and ${list(abbrs.map(familyLabel))} could also stand for ${list(names.slice(1))}. Officer to confirm the yumnak.`,
          `${abbrs[0]!.display} fits ${fitting[0]} (not in the gazetteer); officer to confirm.`,
        );
      } else if (fitting.length && !hardDifferent) {
        score -= PENALTY.abbreviationUnverified;
        say(
          `${list(abbrs.map(familyLabel))} is consistent with ${quote(fitting[0]!)}, which is not in the gazetteer.`,
          `${abbrs[0]!.display} fits ${quote(fitting[0]!)}, which is not in the gazetteer.`,
        );
      } else {
        unsure(
          `${list(extras.map(quote))} is not in the gazetteer — it may be a family name different from ${fam}.`,
          `${quote(extras[0]!)} is unknown; may be a different family name.`,
        );
      }
    } else {
      const community = communityOf(withFamily.family);
      if (community && TRIBAL.has(community)) {
        score -= PENALTY.familyMissingTribal;
        say(
          `Clan name ${fam} appears on only one document (common for single-name records).`,
          `Clan name ${famShort} is on one document only (common).`,
        );
      } else {
        score -= PENALTY.familyMissingOther;
        say(
          `Yumnak/family name ${fam} appears on only one document.`,
          `Family name ${famShort} is on one document only.`,
        );
      }
    }
  } else if (!hardDifferent && matchedGivenParts <= 1 && !ambiguity.length) {
    score = Math.min(score, SINGLE_PART_CAP);
    say(
      'Only one name part could be compared and no family name is present.',
      'Only one name part to compare; no family name.',
    );
  }

  if (!extrasConsumed && !hardDifferent) {
    for (const x of [...extrasA, ...extrasB]) {
      score -= PENALTY.extraNamePart;
      say(
        `${quote(x)} appears in only one of the two names.`,
        `${quote(x)} appears in only one name.`,
      );
    }
  }

  // --- Optional endings & prefixes ------------------------------------------------------------
  const endA = brief(A.markerDisplay, 1) || 'none';
  const endB = brief(B.markerDisplay, 1) || 'none';
  if (A.gender && B.gender && A.gender !== B.gender) {
    score -= PENALTY.genderConflict;
    say(
      `Gender endings disagree (${list(A.markerDisplay) || 'Ningol/Ongbi'} vs ${list(B.markerDisplay) || 'Ningol/Ongbi'}).`,
      `Gender endings disagree: ${brief(A.markerDisplay, 1) || 'Ningol/Ongbi'} vs ${brief(B.markerDisplay, 1) || 'Ningol/Ongbi'}.`,
    );
  } else {
    const ma = [...new Set(A.markers)].sort().join(',');
    const mb = [...new Set(B.markers)].sort().join(',');
    if (ma !== mb) {
      say(
        `Optional endings differ or were dropped (${list(A.markerDisplay) || 'none'} vs ${list(B.markerDisplay) || 'none'}) — treated as equivalent.`,
        `Optional ending differs (${endA} / ${endB}); not a problem.`,
      );
    } else if (A.markerDisplay.join() !== B.markerDisplay.join()) {
      say(
        `${list(A.markerDisplay)} and ${list(B.markerDisplay)} are spelling variants of the same ending.`,
        `${endA} / ${endB}: same ending, spelled differently.`,
      );
    }
  }
  if (A.hasMohammad && B.hasMohammad) {
    if (A.mohammadDisplay !== B.mohammadDisplay) {
      say(
        `${quote(A.mohammadDisplay!)} and ${quote(B.mohammadDisplay!)} are equivalent (Md./Mohd./Mohammad).`,
        `${A.mohammadDisplay} / ${B.mohammadDisplay}: both mean Mohammad.`,
      );
    }
  } else if (A.hasMohammad || B.hasMohammad) {
    score -= PENALTY.mohammadOneSided;
    const md = (A.mohammadDisplay ?? B.mohammadDisplay)!;
    say(
      `The ${quote(md)} prefix appears on only one document.`,
      `${quote(md)} prefix is on one document only.`,
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
  if (!reasons.length) say('All name parts match.', 'All name parts match.');
  const longReasons = reasons.map((r) => r.long);
  return {
    result:
      verdict === 'AMBIGUOUS' && ambiguousYumnaks
        ? { score, verdict, reasons: longReasons, ambiguousYumnaks }
        : { score, verdict, reasons: longReasons },
    points: reasons.map((r) => r.short),
  };
}

/**
 * Deterministic, explainable, Manipur-aware person-name comparison. No AI.
 * Symmetric: matchNames(a, b) and matchNames(b, a) give the same score and verdict.
 */
export function matchNames(a: string, b: string, ctx: MatchContext = {}): NameMatchResult {
  return evaluate(a, b, ctx).result;
}

// ---------------------------------------------------------------------------------------------
// explainMatch — the same decision, worded for an officer at a glance
// ---------------------------------------------------------------------------------------------

export interface MatchExplanation {
  verdict: NameVerdict;
  score: number;
  /** One line for the verdict, e.g. "Unclear — an officer should check before deciding." */
  headline: string;
  /** Short plain-English points (≤ 12 words each), same order as `details`. */
  points: string[];
  /** The full sentences (identical to matchNames().reasons). */
  details: string[];
  ambiguousYumnaks?: string[];
}

const HEADLINES: Record<NameVerdict, string> = {
  SAME: 'Same person — the names match.',
  LIKELY_SAME: 'Probably the same person — small differences, see below.',
  AMBIGUOUS: 'Unclear — an officer should check before deciding.',
  DIFFERENT: 'Different person — the names do not match.',
};

export function explainMatch(a: string, b: string, ctx: MatchContext = {}): MatchExplanation {
  const { result, points } = evaluate(a, b, ctx);
  const unreadable = result.score === 0 && points[0] === 'One name is empty or unreadable.';
  return {
    verdict: result.verdict,
    score: result.score,
    headline: unreadable ? 'Cannot compare — a name is missing.' : HEADLINES[result.verdict],
    points,
    details: result.reasons,
    ...(result.ambiguousYumnaks ? { ambiguousYumnaks: result.ambiguousYumnaks } : {}),
  };
}

export type { ParsedName };
