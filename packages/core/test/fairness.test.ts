import { describe, expect, it } from 'vitest';
import { evaluateFairness, fairnessPairs, formatFairnessTable } from '../src/index.js';

const COMMUNITIES = ['Meitei', 'Pangal', 'Naga', 'Kuki-Zo'];

describe('name-engine fairness across communities', () => {
  const report = evaluateFairness(fairnessPairs);

  it('prints the per-community summary table (Trust Report)', () => {
    console.log(
      `\nName-engine fairness (synthetic labelled pairs)\n${formatFairnessTable(report)}\n`,
    );
    expect(report.rows.map((r) => r.community)).toEqual(COMMUNITIES);
  });

  it('has enough matched and unmatched pairs in every community', () => {
    for (const c of COMMUNITIES) {
      const pairs = fairnessPairs.filter((p) => p.community === c);
      expect(pairs.length).toBeGreaterThanOrEqual(12);
      expect(pairs.some((p) => p.samePerson)).toBe(true);
      expect(pairs.some((p) => !p.samePerson)).toBe(true);
    }
  });

  it('never auto-matches two different people (zero false matches)', () => {
    for (const row of report.rows) expect(row.falseMatches).toBe(0);
  });

  it('reaches >= 90% accuracy on decided pairs in every community', () => {
    for (const row of report.rows) expect(row.accuracy).toBeGreaterThanOrEqual(0.9);
  });

  it('keeps the accuracy gap between communities within 10 points', () => {
    const accs = report.rows.map((r) => r.accuracy);
    expect(Math.max(...accs) - Math.min(...accs)).toBeLessThanOrEqual(0.1);
  });

  it('refers at most 25% of pairs to an officer in any community', () => {
    for (const row of report.rows) expect(row.referralRate).toBeLessThanOrEqual(0.25);
  });

  it('overall totals add up', () => {
    const total = report.rows.reduce((n, r) => n + r.pairs, 0);
    expect(report.overall.pairs).toBe(total);
    expect(report.overall.pairs).toBe(fairnessPairs.length);
  });
});
