import { describe, expect, it } from 'vitest';
import {
  explainMatch,
  levenshtein,
  matchNames,
  phoneticKey,
  ROMANISATION_VARIANTS,
  type NameVerdict,
} from '../src/index.js';

/**
 * The given-name rule: two given names match ONLY when they are equal after normalisation or equal
 * under the explicit romanisation-variant table. Edit-distance similarity alone may never yield
 * SAME / LIKELY_SAME. Examples here are new — none come from either fairness set.
 */
const MATCH: NameVerdict[] = ['SAME', 'LIKELY_SAME'];
const text = (a: string, b: string) => matchNames(a, b).reasons.join(' | ');

describe('near-miss given names → AMBIGUOUS (officer to confirm), never a match', () => {
  it.each([
    // [name a, name b, given a, given b]
    ['Yumnam Ibomcha Singh', 'Yumnam Ibocha Singh', 'Ibomcha', 'Ibocha'],
    ['Thingbaijam Dhiren Singh', 'Thingbaijam Dhiresh Singh', 'Dhiren', 'Dhiresh'],
    ['Haobam Ibochouba Singh', 'Haobam Ibochaoba Singh', 'Ibochouba', 'Ibochaoba'],
    ['Sagolsem Bimol Singh', 'Sagolsem Bimal Singh', 'Bimol', 'Bimal'],
    ['Phundreimayum Md. Nasir', 'Phundreimayum Md. Basir', 'Nasir', 'Basir'],
    ['Thangjalal Haokip', 'Thangjalam Haokip', 'Thangjalal', 'Thangjalam'],
    ['Akhui Kamei', 'Akhoi Kamei', 'Akhui', 'Akhoi'],
  ])('"%s" vs "%s"', (a, b, ga, gb) => {
    for (const [x, y] of [
      [a, b],
      [b, a],
    ] as const) {
      const r = matchNames(x, y);
      expect(r.verdict).toBe('AMBIGUOUS');
      expect(r.score).toBeLessThan(75);
    }
    const reasons = text(a, b);
    expect(reasons).toMatch(/Given names differ slightly/);
    expect(reasons).toContain(`(${ga} vs ${gb})`);
    expect(reasons).toMatch(/officer to confirm/);
    expect(explainMatch(a, b).points[0]).toBe(
      `Given names differ slightly (${ga} vs ${gb}) — officer to confirm.`,
    );
  });

  it('stays unresolved when the family name is abbreviated, missing or in a different order', () => {
    for (const [a, b] of [
      ['Y. Ibomcha Singh', 'Yumnam Ibocha Singh'],
      ['Ibomcha Singh', 'Yumnam Ibocha Singh'],
      ['Ibomcha Singh Yumnam', 'YUMNAM IBOCHA SINGH'],
      ['Ibomcha', 'Ibocha'],
    ] as const) {
      expect(MATCH).not.toContain(matchNames(a, b).verdict);
    }
  });

  it('a near-miss plus a different yumnak (men) is DIFFERENT, not a match', () => {
    const r = matchNames('Yumnam Ibomcha Singh', 'Oinam Ibocha Singh');
    expect(r.verdict).toBe('DIFFERENT');
  });

  it('a near-miss next to a matching second given name is still referred', () => {
    const r = matchNames('Huidrom Prem Bimol Singh', 'Huidrom Prem Bimal Singh');
    expect(r.verdict).toBe('AMBIGUOUS');
    expect(r.reasons.join(' ')).toMatch(/Bimol vs Bimal/);
  });

  it('…even when one spelling is also a sagei, so it parses as a family name (Salim / Salam)', () => {
    for (const [a, b] of [
      ['Phundreimayum Md. Abdul Salim', 'Phundreimayum Md. Abdul Salam'],
      ['Phundreimayum Md. Abdul Salam', 'Phundreimayum Md. Abdul Salim'],
    ] as const) {
      const r = matchNames(a, b);
      expect(r.verdict).toBe('AMBIGUOUS');
      expect(r.reasons[0]).toMatch(/Given names differ slightly/);
    }
  });

  it('given names far apart are DIFFERENT, not AMBIGUOUS', () => {
    expect(matchNames('Yumnam Ibomcha Singh', 'Yumnam Nabakishore Singh').verdict).toBe(
      'DIFFERENT',
    );
    // Short names: two edits in three letters is a different name, not a near-miss.
    expect(matchNames('Md. Ali Khan', 'Md. Abu Khan').verdict).toBe('DIFFERENT');
  });

  it('gender-marking final vowel stays DIFFERENT (Chaoba / Chaobi)', () => {
    expect(matchNames('Yumnam Chaoba Singh', 'Yumnam Chaobi Devi').verdict).toBe('DIFFERENT');
  });
});

describe('property: edit-distance similarity alone never matches a given name', () => {
  // Every pair below is 1–2 edits apart on the romanisation key and NOT equal under the table.
  const nearPairs: [string, string][] = [
    ['Ibomcha', 'Ibocha'],
    ['Dhiren', 'Dhiresh'],
    ['Bimol', 'Bimal'],
    ['Premjit', 'Premji'],
    ['Sanajaoba', 'Sanajauba'],
    ['Lalthanzami', 'Lalthansami'],
    ['Ngamkhohao', 'Ngamkhoha'],
    ['Rashida', 'Rashidan'],
  ];
  it.each(nearPairs)('%s / %s', (ga, gb) => {
    const d = levenshtein(phoneticKey(ga), phoneticKey(gb));
    expect(d).toBeGreaterThan(0);
    expect(d).toBeLessThanOrEqual(2);
    for (const [fa, fb] of [
      ['Yumnam', 'Yumnam'],
      ['', ''],
      ['Kh.', 'Khundrakpam'],
      ['Haokip', 'Haokip'],
    ] as const) {
      const a = `${fa} ${ga}`.trim();
      const b = `${fb} ${gb}`.trim();
      expect(MATCH, `${a} vs ${b}`).not.toContain(matchNames(a, b).verdict);
    }
  });
});

describe('romanisation-variant table → still SAME', () => {
  it.each([
    ['Konsam Ibemchaa Devi', 'Konsam Ibemcha Devi'],
    ['Sorokhaibam Thoibaa Singh', 'Sorokhaibam Thoiba Singh'],
    ['Sagolsem Shanti Devi', 'Sagolsem Santi Devi'],
    ['Laisram Phulen Singh', 'Laisram Fulen Singh'],
    ['Ngangom Biren Singh', 'Ngangom Viren Singh'],
    ['Ngangom Wiren Singh', 'Ngangom Viren Singh'],
    ['Huidrom Reeta Devi', 'Huidrom Rita Devi'],
    ['Ningthoujam Rameshwor Singh', 'Ningthoujam Rameshwar Singh'],
  ])('"%s" = "%s"', (a, b) => {
    const r = matchNames(a, b);
    expect(r.verdict).toBe('SAME');
    expect(r.reasons.join(' ')).toMatch(/romanisation variants/);
  });

  it('every rule in the table carries an example note', () => {
    expect(ROMANISATION_VARIANTS.length).toBeGreaterThan(5);
    for (const v of ROMANISATION_VARIANTS) expect(v.note).toMatch(/\w/);
  });
});

describe('fuzzy matching is still allowed for family names and suffixes', () => {
  it('a one-letter slip in a long yumnak, same given name → match', () => {
    const r = matchNames('Moirangthen Ongbi Bembem Devi', 'Moirangthem Ongbi Bembem Devi');
    expect(MATCH).toContain(r.verdict);
    expect(r.reasons.join(' ')).toMatch(/Family name spelled slightly differently/);
  });

  it('two spellings of ONE gazetteer yumnak match (Khetrimayum / Kshetrimayum)', () => {
    expect(matchNames('Khetrimayum Ibobi Singh', 'Kshetrimayum Ibobi Singh').verdict).toBe('SAME');
  });

  it('two DIFFERENT gazetteer clans one letter apart are referred, not merged', () => {
    for (const [a, b] of [
      ['Wangjam Ibobi Singh', 'Thangjam Ibobi Singh'],
      ['Ngamkhohao Gangte', 'Ngamkhohao Mangte'],
    ] as const) {
      const r = matchNames(a, b);
      expect(r.verdict).toBe('AMBIGUOUS');
      expect(r.reasons[0]).toMatch(/Family names differ slightly/);
    }
  });

  it('suffix spelling variants still match (Meitei / Meetei, Chanu / Devi)', () => {
    expect(matchNames('Wangkhem Ibobi Meitei', 'Wangkhem Ibobi Meetei').verdict).toBe('SAME');
    expect(matchNames('Wangkhem Bembem Chanu', 'Wangkhem Bembem Devi').verdict).toBe('SAME');
  });
});
