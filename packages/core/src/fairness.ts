import data from '../data/fairness-dev.json';
import { matchNames, type MatchContext, type NameVerdict } from './names/index.js';

export interface FairnessPair {
  community: string;
  a: string;
  b: string;
  /** Ground truth: are these the same person? */
  samePerson: boolean;
  note?: string;
}

export interface FairnessRow {
  community: string;
  pairs: number;
  /** Pairs the engine decided on its own (SAME / LIKELY_SAME / DIFFERENT). */
  decided: number;
  correct: number;
  /** correct / decided — accuracy when the engine does not refer to an officer. */
  accuracy: number;
  /** AMBIGUOUS verdicts, routed to an officer instead of auto-decided. */
  referred: number;
  referralRate: number;
  /** Different people auto-matched — the dangerous error. */
  falseMatches: number;
  /** Same person auto-marked DIFFERENT — causes an unnecessary citizen correction. */
  falseNonMatches: number;
}

export interface FairnessDetail extends FairnessPair {
  verdict: NameVerdict;
  score: number;
  outcome: 'correct' | 'referred' | 'false-match' | 'false-non-match';
}

export interface FairnessReport {
  rows: FairnessRow[];
  overall: FairnessRow;
  details: FairnessDetail[];
}

/** Development set — written alongside the engine (seen during build; in-sample). */
export const fairnessDevPairs: readonly FairnessPair[] = data.pairs;
/** @deprecated use fairnessDevPairs */
export const fairnessPairs = fairnessDevPairs;

export const COMMUNITIES = ['Meitei', 'Pangal', 'Naga', 'Kuki-Zo'] as const;

const COMMUNITY_ALIASES: Record<string, (typeof COMMUNITIES)[number]> = {
  meitei: 'Meitei',
  meetei: 'Meitei',
  pangal: 'Pangal',
  naga: 'Naga',
  'kuki-zo': 'Kuki-Zo',
  'kuki zo': 'Kuki-Zo',
  kukizo: 'Kuki-Zo',
  kuki: 'Kuki-Zo',
  zo: 'Kuki-Zo',
};
const TRUE = new Set(['true', 'yes', 'y', '1', 'same']);
const FALSE = new Set(['false', 'no', 'n', '0', 'different']);

/** Minimal RFC-4180 CSV: quoted fields, escaped quotes, commas inside quotes, CRLF. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((x) => x.trim() !== ''));
}

/**
 * Held-out pairs from staff: CSV with header name_a,name_b,community,expected_same.
 * Invalid rows are reported, never guessed.
 */
export function parseFairnessCsv(text: string): { pairs: FairnessPair[]; errors: string[] } {
  const rows = parseCsv(text.replace(/^\uFEFF/, ''));
  const header = (rows[0] ?? []).map((h) => h.trim().toLowerCase());
  const col = (name: string) => header.indexOf(name);
  const need = ['name_a', 'name_b', 'community', 'expected_same'];
  if (need.some((n) => col(n) < 0)) {
    return { pairs: [], errors: [`The first row must be the header: ${need.join(',')}`] };
  }
  const pairs: FairnessPair[] = [];
  const errors: string[] = [];
  rows.slice(1).forEach((r, i) => {
    const line = i + 2;
    const a = (r[col('name_a')] ?? '').trim();
    const b = (r[col('name_b')] ?? '').trim();
    const rawCommunity = (r[col('community')] ?? '').trim();
    const rawSame = (r[col('expected_same')] ?? '').trim().toLowerCase();
    if (!a || !b) return errors.push(`Row ${line}: name_a and name_b are required`);
    const community = COMMUNITY_ALIASES[rawCommunity.toLowerCase()];
    if (!community)
      return errors.push(
        `Row ${line}: unknown community "${rawCommunity}" (use Meitei, Pangal, Naga or Kuki-Zo)`,
      );
    if (!TRUE.has(rawSame) && !FALSE.has(rawSame))
      return errors.push(`Row ${line}: expected_same must be true/false (got "${rawSame}")`);
    pairs.push({ a, b, community, samePerson: TRUE.has(rawSame) });
  });
  return { pairs: errors.length ? [] : pairs, errors };
}

const ratio = (n: number, d: number) => (d === 0 ? 1 : n / d);

function summarise(community: string, details: FairnessDetail[]): FairnessRow {
  const count = (o: FairnessDetail['outcome']) => details.filter((d) => d.outcome === o).length;
  const referred = count('referred');
  const correct = count('correct');
  const decided = details.length - referred;
  return {
    community,
    pairs: details.length,
    decided,
    correct,
    accuracy: ratio(correct, decided),
    referred,
    referralRate: details.length ? referred / details.length : 0,
    falseMatches: count('false-match'),
    falseNonMatches: count('false-non-match'),
  };
}

/** Runs the name engine over labelled pairs and reports accuracy per community, in first-seen order. */
export function evaluateFairness(
  pairs: readonly FairnessPair[],
  ctx: MatchContext = {},
): FairnessReport {
  const details: FairnessDetail[] = pairs.map((p) => {
    const { verdict, score } = matchNames(p.a, p.b, ctx);
    const predictedSame = verdict === 'SAME' || verdict === 'LIKELY_SAME';
    let outcome: FairnessDetail['outcome'];
    if (verdict === 'AMBIGUOUS') outcome = 'referred';
    else if (predictedSame === p.samePerson) outcome = 'correct';
    else outcome = predictedSame ? 'false-match' : 'false-non-match';
    return { ...p, verdict, score, outcome };
  });
  const communities = [...new Set(pairs.map((p) => p.community))];
  return {
    rows: communities.map((c) =>
      summarise(
        c,
        details.filter((d) => d.community === c),
      ),
    ),
    overall: summarise('All', details),
    details,
  };
}

const pct = (x: number) => `${(x * 100).toFixed(0)}%`;

/** Markdown table — used in test output and the Trust Report. */
export function formatFairnessTable(report: FairnessReport): string {
  const header = [
    '| Community | Pairs | Auto-decided | Accuracy (decided) | Referred to officer | False matches | False non-matches |',
    '|---|---:|---:|---:|---:|---:|---:|',
  ];
  const line = (r: FairnessRow) =>
    `| ${r.community} | ${r.pairs} | ${r.decided} | ${pct(r.accuracy)} | ${r.referred} (${pct(r.referralRate)}) | ${r.falseMatches} | ${r.falseNonMatches} |`;
  return [...header, ...report.rows.map(line), line(report.overall)].join('\n');
}
