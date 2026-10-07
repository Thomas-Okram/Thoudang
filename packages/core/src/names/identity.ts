import { defaultGazetteer, type Gazetteer } from './gazetteer.js';
import { explainMatch, type NameVerdict } from './match.js';
import { parseName } from './parse.js';

/** Full yumnaks written in relatives' names (father/husband) — used to disambiguate "Th." etc. */
export function knownYumnaksFrom(
  relativeNames: (string | null | undefined)[],
  gazetteer: Gazetteer = defaultGazetteer,
): string[] {
  const out = new Set<string>();
  for (const n of relativeNames) {
    if (!n) continue;
    for (const t of parseName(n, gazetteer).family) if (t.kind === 'full') out.add(t.display);
  }
  return [...out];
}

export interface IdentityEntry {
  /** Caller's identifier, e.g. a document id or "form". */
  key: string;
  value: string;
}

export interface IdentityPair {
  a: string;
  b: string;
  verdict: NameVerdict;
  score: number;
  reasons: string[];
  /** One-line verdict for officers, e.g. "Unclear — an officer should check before deciding." */
  headline: string;
  /** Short plain-English versions of `reasons` (≤ 12 words each). */
  points: string[];
  /** Candidate yumnaks when an abbreviation is ambiguous; empty otherwise. */
  candidates: string[];
}

/** Every pairwise name comparison across a packet, in input order (a before b). */
export function identityMatrix(
  entries: IdentityEntry[],
  opts: { relativeNames?: (string | null | undefined)[]; gazetteer?: Gazetteer } = {},
): { pairs: IdentityPair[]; knownYumnaks: string[] } {
  const gazetteer = opts.gazetteer ?? defaultGazetteer;
  const knownYumnaks = knownYumnaksFrom(opts.relativeNames ?? [], gazetteer);
  const pairs: IdentityPair[] = [];
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const a = entries[i]!;
      const b = entries[j]!;
      const r = explainMatch(a.value, b.value, { gazetteer, knownYumnaks });
      pairs.push({
        a: a.key,
        b: b.key,
        verdict: r.verdict,
        score: r.score,
        reasons: r.details,
        headline: r.headline,
        points: r.points,
        candidates: r.ambiguousYumnaks ?? [],
      });
    }
  }
  return { pairs, knownYumnaks };
}
