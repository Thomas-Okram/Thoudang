import { describe, expect, it } from 'vitest';
import {
  matchNames,
  normaliseName,
  parseName,
  phoneticKey,
  NAME_MATCH_THRESHOLDS,
  defaultGazetteer,
  type NameVerdict,
} from '../src/index.js';

const MATCH: NameVerdict[] = ['SAME', 'LIKELY_SAME'];
const reasonsOf = (a: string, b: string) => matchNames(a, b).reasons.join(' | ');

describe('normalisation', () => {
  it('lowercases, strips punctuation and collapses spaces', () => {
    expect(normaliseName('  OKRAM,  Thomas   MEITEI ')).toBe('okram thomas meitei');
  });

  it('splits on dots so "O.Thomas" and "O. Thomas" are the same', () => {
    expect(normaliseName('O.Thomas')).toBe('o thomas');
    expect(normaliseName('O. Thomas')).toBe('o thomas');
  });

  it('merges dotted initials like "R.K." into one token', () => {
    expect(normaliseName('R.K. Ranjan Singh')).toBe('rk ranjan singh');
  });

  it('drops titles and the relation suffix (S/o, W/o …)', () => {
    expect(normaliseName('Shri Okram Thomas Meitei S/o Okram Tomba Singh')).toBe(
      'okram thomas meitei',
    );
    expect(normaliseName('Smt. Ibemcha Devi W/O Tomba Singh')).toBe('ibemcha devi');
  });
});

describe('phonetic key (romanisation variants)', () => {
  it.each([
    ['Thomas', 'Tomas'],
    ['Phajabati', 'Fajabati'],
    ['Sharma', 'Sarma'],
    ['Devi', 'Debi'],
    ['Wangkhem', 'Vangkhem'],
    ['Khuraijam', 'Kuraijam'],
    ['Leeta', 'Lita'],
    ['Hussain', 'Husain'],
  ])('%s ≈ %s', (a, b) => {
    expect(phoneticKey(a)).toBe(phoneticKey(b));
  });

  it('keeps genuinely different names apart', () => {
    expect(phoneticKey('Thomas')).not.toBe(phoneticKey('Tomba'));
  });
});

describe('parsing', () => {
  it('recognises yumnak, given name and optional ending', () => {
    const p = parseName('Okram Thomas Meitei');
    expect(p.family.map((f) => f.display)).toEqual(['Okram']);
    expect(p.given).toEqual(['thomas']);
    expect(p.markers).toEqual(['meitei']);
    expect(p.gender).toBe('male');
  });

  it('recognises abbreviations with their gazetteer candidates', () => {
    const p = parseName('Kh. Loken Singh');
    const abbr = p.family[0];
    expect(abbr?.kind).toBe('abbr');
    expect(abbr?.kind === 'abbr' && abbr.candidates.map((c) => c.surname)).toEqual(
      expect.arrayContaining(['Khuraijam', 'Khwairakpam', 'Khumanthem']),
    );
  });

  it('parses Ningol (natal) and Ongbi (marital) clans', () => {
    const p = parseName('Laishram Ningol Okram Ongbi Ibemcha Devi');
    expect(p.family.map((f) => [f.display, f.role])).toEqual([
      ['Laishram', 'natal'],
      ['Okram', 'marital'],
    ]);
    expect(p.given).toEqual(['ibemcha']);
    expect(p.gender).toBe('female');
  });

  it('canonicalises Md./Mohd./Mohammad', () => {
    for (const n of [
      'Md. Abdul',
      'Mohd Abdul',
      'Mohammad Abdul',
      'Mohammed Abdul',
      'Muhammad Abdul',
    ]) {
      const p = parseName(n);
      expect(p.hasMohammad).toBe(true);
      expect(p.given).toEqual(['abdul']);
    }
  });
});

describe('thresholds', () => {
  it('exports the documented thresholds as config', () => {
    expect(NAME_MATCH_THRESHOLDS).toEqual({ same: 90, likelySame: 75, ambiguous: 50 });
  });
});

describe('Meitei names', () => {
  it.each([
    ['Okram Thomas Meitei', 'Thomas Okram'],
    ['Okram Thomas Meitei', 'Thomas Singh Okram'],
    ['Thomas Okram', 'Thomas Singh Okram'],
  ])('"%s" = "%s" → SAME', (a, b) => {
    expect(matchNames(a, b).verdict).toBe('SAME');
  });

  it('explains the dropped/swapped optional ending', () => {
    expect(reasonsOf('Okram Thomas Meitei', 'Thomas Singh Okram')).toMatch(/Meitei|Singh/);
  });

  it('Meitei / Meetei spelling is equivalent', () => {
    expect(matchNames('Yumnam Joykumar Meitei', 'YUMNAM JOYKUMAR MEETEI').verdict).toBe('SAME');
  });

  it('"O.Thomas Singh" vs "Okram Thomas Singh" is AMBIGUOUS (O. could be Okram or Oinam)', () => {
    const r = matchNames('O.Thomas Singh', 'Okram Thomas Singh');
    expect(r.verdict).toBe('AMBIGUOUS');
    expect(r.reasons.join(' ')).toMatch(/Okram/);
    expect(r.reasons.join(' ')).toMatch(/Oinam/);
  });

  it('"Kh. Loken Singh" vs "Khuraijam Loken Singh" → AMBIGUOUS naming the candidates', () => {
    const r = matchNames('Kh. Loken Singh', 'Khuraijam Loken Singh');
    expect(r.verdict).toBe('AMBIGUOUS');
    const text = r.reasons.join(' ');
    expect(text).toMatch(/Khuraijam/);
    expect(text).toMatch(/Khwairakpam/);
    expect(text).toMatch(/Khumanthem/);
    expect(r.score).toBeGreaterThanOrEqual(50);
    expect(r.score).toBeLessThan(75);
  });

  it('"Th. Ibemcha Devi" vs "Thokchom Ibemcha Devi" without packet context → AMBIGUOUS (Th. is shared by Thokchom, Thounaojam, Thangjam …)', () => {
    const r = matchNames('Th. Ibemcha Devi', 'Thokchom Ibemcha Devi');
    expect(r.verdict).toBe('AMBIGUOUS');
    expect(r.reasons.join(' ')).toMatch(/Thounaojam/);
  });

  it('"Th. Ibemcha Devi" vs "Thokchom Ibemcha Devi" → SAME/LIKELY_SAME when the packet shows the full yumnak', () => {
    const r = matchNames('Th. Ibemcha Devi', 'Thokchom Ibemcha Devi', {
      knownYumnaks: ['Thokchom'],
    });
    expect(MATCH).toContain(r.verdict);
    expect(r.reasons.join(' ')).toMatch(/Th\. → Thokchom/);
  });

  it('known yumnaks that do not narrow to one candidate keep it AMBIGUOUS', () => {
    const r = matchNames('Kh. Loken Singh', 'Khuraijam Loken Singh', {
      knownYumnaks: ['Khuraijam', 'Khwairakpam'],
    });
    expect(r.verdict).toBe('AMBIGUOUS');
  });

  it('an abbreviation that does not fit the other yumnak is a mismatch', () => {
    expect(matchNames('Kh. Loken Singh', 'Laishram Loken Singh').verdict).toBe('DIFFERENT');
  });

  it('same abbreviation on both documents is a weaker but positive match', () => {
    const r = matchNames('Kh. Loken Singh', 'Kh Loken Singh');
    expect(MATCH).toContain(r.verdict);
    expect(r.reasons.join(' ')).toMatch(/abbreviat/i);
  });

  it('R.K. resolves to Rajkumar', () => {
    expect(MATCH).toContain(matchNames('R.K. Ranjan Singh', 'Rajkumar Ranjan Singh').verdict);
  });

  it('"Okram Thomas" vs "Okram Tomba" → DIFFERENT (given name dominates)', () => {
    const r = matchNames('Okram Thomas', 'Okram Tomba');
    expect(r.verdict).toBe('DIFFERENT');
    expect(r.score).toBeLessThan(50);
    expect(r.reasons.join(' ')).toMatch(/given name/i);
  });

  it('Tomba vs Tombi → DIFFERENT (final vowel marks gender)', () => {
    const r = matchNames('Okram Tomba Singh', 'Okram Tombi Devi');
    expect(r.verdict).toBe('DIFFERENT');
    expect(r.reasons.join(' ')).toMatch(/vowel/i);
  });

  it('same given name, different yumnak (men) → DIFFERENT', () => {
    expect(matchNames('Laishram Ibobi Singh', 'Yumnam Ibobi Singh').verdict).toBe('DIFFERENT');
    expect(matchNames('Okram Thomas Meitei', 'Oinam Thomas Meitei').verdict).toBe('DIFFERENT');
  });

  it('same given name, different yumnak (women) → AMBIGUOUS (yumnak can change at marriage)', () => {
    const r = matchNames('Okram Ibemcha Devi', 'Laishram Ibemcha Chanu');
    expect(r.verdict).toBe('AMBIGUOUS');
    expect(r.reasons.join(' ')).toMatch(/marriage/i);
  });

  it('minor spelling variant of a given name → match with a reason', () => {
    const r = matchNames('Ningthoujam Rameshwor Singh', 'Ningthoujam Rameshwar Singh');
    expect(MATCH).toContain(r.verdict);
    expect(r.reasons.join(' ')).toMatch(/spelling/i);
  });

  it('ph/f romanisation in a given name → SAME', () => {
    expect(matchNames('Moirangthem Phajabati Devi', 'Moirangthem Fajabati Devi').verdict).toBe(
      'SAME',
    );
  });

  it('split vs joined given name (Prem Kumar / Premkumar) → match', () => {
    expect(MATCH).toContain(
      matchNames('Huidrom Prem Kumar Singh', 'Huidrom Premkumar Singh').verdict,
    );
  });

  it('Bamon "Sharma" ending may be dropped', () => {
    expect(MATCH).toContain(matchNames('Sapam Ibomcha Sharma', 'Sapam Ibomcha').verdict);
  });

  it('Chanu ↔ Devi swap is fine', () => {
    expect(matchNames('Wahengbam Tombi Chanu', 'Wahengbam Tombi Devi').verdict).toBe('SAME');
  });

  it('Singh ↔ Devi conflict is penalised and explained', () => {
    const r = matchNames('Okram Ibemcha Singh', 'Okram Ibemcha Devi');
    expect(r.score).toBeLessThan(100);
    expect(r.reasons.join(' ')).toMatch(/gender/i);
  });

  it('yumnak missing on one document → LIKELY_SAME, not SAME', () => {
    const r = matchNames('Okram Thomas Meitei', 'Thomas Singh');
    expect(r.verdict).toBe('LIKELY_SAME');
    expect(r.reasons.join(' ')).toMatch(/yumnak/i);
  });

  it('an unknown extra word next to a missing yumnak is AMBIGUOUS', () => {
    const r = matchNames('Thomas Xyzam', 'Okram Thomas');
    expect(r.verdict).toBe('AMBIGUOUS');
    expect(r.reasons.join(' ')).toMatch(/Xyzam/i);
  });
});

describe('married-woman names (Ningol / Ongbi)', () => {
  const full = 'Laishram Ningol Okram Ongbi Ibemcha Devi';

  it('matches the pre-marriage name via the natal clan', () => {
    const r = matchNames(full, 'Laishram Ibemcha Chanu');
    expect(r.verdict).toBe('SAME');
    expect(r.reasons.join(' ')).toMatch(/Ningol|natal/i);
  });

  it('matches the post-marriage "Ongbi" name via the marital clan', () => {
    const r = matchNames(full, 'Okram Ongbi Ibemcha Devi');
    expect(r.verdict).toBe('SAME');
    expect(r.reasons.join(' ')).toMatch(/Ongbi|marital/i);
  });

  it('matches a plain married name using the marital yumnak', () => {
    expect(matchNames(full, 'Okram Ibemcha Devi').verdict).toBe('SAME');
  });

  it('different given name with the same clans → DIFFERENT', () => {
    expect(matchNames(full, 'Laishram Ningol Okram Ongbi Tombi Devi').verdict).toBe('DIFFERENT');
  });

  it('neither clan matches → not SAME', () => {
    expect(MATCH).not.toContain(matchNames(full, 'Yumnam Ibemcha Devi').verdict);
  });
});

describe('Pangal names', () => {
  it('"Md. Abdul" vs "Mohammad Abdul" → match, explained', () => {
    const r = matchNames('Md. Abdul', 'Mohammad Abdul');
    expect(MATCH).toContain(r.verdict);
    expect(r.reasons.join(' ')).toMatch(/Md\.|Mohammad/);
  });

  it('Mohd./Md. with optional "Khan" → SAME', () => {
    expect(matchNames('Mohd Abdul Rahim Khan', 'Md Abdul Rahim').verdict).toBe('SAME');
  });

  it('Begum ↔ Bibi swap → match', () => {
    expect(MATCH).toContain(matchNames('Rahima Bibi', 'Rahima Begum').verdict);
  });

  it('different given name → DIFFERENT', () => {
    expect(matchNames('Md. Abdul Rahim', 'Md. Abdul Karim').verdict).toBe('DIFFERENT');
  });

  it('family name order may vary', () => {
    expect(matchNames('Phundreimayum Md. Ismail', 'Md. Ismail Phundreimayum').verdict).toBe('SAME');
  });
});

describe('tribal names (Naga, Kuki-Zo)', () => {
  it.each([
    ['Shimray Thotso', 'Thotso Shimray'],
    ['Haokip Thangboi', 'Thangboi Haokip'],
    ['Kamei Ramkung', 'Ramkung Kamei'],
    ['Paolen Kipgen', 'KIPGEN PAOLEN'],
  ])('clan first or last: "%s" = "%s" → SAME', (a, b) => {
    expect(matchNames(a, b).verdict).toBe('SAME');
  });

  it('single-name case is not over-penalised', () => {
    const r = matchNames('Lalremsiami Hmar', 'Lalremsiami');
    expect(MATCH).toContain(r.verdict);
    expect(r.score).toBeGreaterThanOrEqual(85);
  });

  it('same clan, different given name → DIFFERENT', () => {
    expect(matchNames('Haokip Thangboi', 'Haokip Thangminlen').verdict).toBe('DIFFERENT');
  });

  it('same given name, different clan → DIFFERENT', () => {
    expect(matchNames('Paolen Kipgen', 'Paolen Singsit').verdict).toBe('DIFFERENT');
  });
});

describe('robustness', () => {
  it('is symmetric', () => {
    const pairs: [string, string][] = [
      ['Kh. Loken Singh', 'Khuraijam Loken Singh'],
      ['Laishram Ningol Okram Ongbi Ibemcha Devi', 'Laishram Ibemcha Chanu'],
      ['Okram Thomas', 'Okram Tomba'],
      ['Lalremsiami Hmar', 'Lalremsiami'],
    ];
    for (const [a, b] of pairs) {
      const ab = matchNames(a, b);
      const ba = matchNames(b, a);
      expect(ba.verdict).toBe(ab.verdict);
      expect(ba.score).toBe(ab.score);
    }
  });

  it('is deterministic', () => {
    expect(matchNames('Kh. Loken Singh', 'Khuraijam Loken Singh')).toEqual(
      matchNames('Kh. Loken Singh', 'Khuraijam Loken Singh'),
    );
  });

  it('empty input is DIFFERENT with a reason, never a crash', () => {
    const r = matchNames('', 'Okram Thomas');
    expect(r.verdict).toBe('DIFFERENT');
    expect(r.reasons.length).toBeGreaterThan(0);
  });

  it('identical strings are SAME with score 100', () => {
    expect(matchNames('Okram Thomas Meitei', 'Okram Thomas Meitei')).toMatchObject({
      verdict: 'SAME',
      score: 100,
    });
  });

  it('scores are always within 0–100', () => {
    for (const [a, b] of [
      ['a', 'b'],
      ['Okram', 'Okram'],
      ['Md', 'Md'],
    ] as const) {
      const r = matchNames(a, b);
      expect(r.score).toBeGreaterThanOrEqual(0);
      expect(r.score).toBeLessThanOrEqual(100);
    }
  });

  it('uses the bundled starter gazetteer by default', () => {
    expect(defaultGazetteer.size).toBeGreaterThanOrEqual(100);
  });
});
