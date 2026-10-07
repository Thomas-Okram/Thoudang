import data from '../data/fairness-pairs.json';
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

export const fairnessPairs: readonly FairnessPair[] = data.pairs;

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
