import { describe, expect, it } from 'vitest';
import {
  explainMatch,
  fairnessDevPairs,
  identityMatrix,
  matchNames,
  normaliseName,
  parseName,
  type NameVerdict,
} from '../src/index.js';

const MATCH: NameVerdict[] = ['SAME', 'LIKELY_SAME'];
const text = (a: string, b: string) => matchNames(a, b).reasons.join(' | ');

describe('ALL-CAPS bank style', () => {
  it('"OKRAM THOMAS MEITEI" = "Okram Thomas Meitei" with score 100', () => {
    expect(matchNames('OKRAM THOMAS MEITEI', 'Okram Thomas Meitei')).toMatchObject({
      verdict: 'SAME',
      score: 100,
    });
  });

  it('bank order "THOMAS MEITEI OKRAM" → SAME', () => {
    expect(matchNames('THOMAS MEITEI OKRAM', 'Okram Thomas Meitei').verdict).toBe('SAME');
  });

  it('"O. THOMAS MEITEI" stays AMBIGUOUS between Okram and Oinam', () => {
    const r = matchNames('O. THOMAS MEITEI', 'OKRAM THOMAS SINGH');
    expect(r.verdict).toBe('AMBIGUOUS');
    expect(r.ambiguousYumnaks).toEqual(expect.arrayContaining(['Okram', 'Oinam']));
  });

  it('"RK RANJAN SINGH" (no dots) → Rajkumar', () => {
    expect(MATCH).toContain(matchNames('RK RANJAN SINGH', 'Rajkumar Ranjan Singh').verdict);
  });

  it('"TH.IBEMCHA DEVI" (no space) resolves with a known yumnak', () => {
    const r = matchNames('TH.IBEMCHA DEVI', 'Thokchom Ibemcha Devi', {
      knownYumnaks: ['Thokchom'],
    });
    expect(MATCH).toContain(r.verdict);
  });

  it.each([
    ['OKRAM IBEMCHA CHAN', 'Okram Ibemcha Chanu'],
    ['OKRAM THOMAS MEIT', 'Okram Thomas Meitei'],
    ['LAISHRAM IBOBI SING', 'Laishram Ibobi Singh'],
  ])('a truncated ending "%s" (bank field limit) = "%s"', (a, b) => {
    expect(matchNames(a, b).verdict).toBe('SAME');
  });

  it('a short final word is not mistaken for a truncated ending', () => {
    expect(parseName('Okram Dev').given).toEqual(['dev']);
    expect(parseName('Huidrom Prem Dev').given).toEqual(['prem', 'dev']);
    expect(parseName('Huidrom Prem Dev').gender).toBeNull();
  });

  it('reasons show names in title case, not shouting capitals', () => {
    expect(text('OKRAM THOMAS', 'OKRAM TOMBA')).toMatch(/'Thomas' vs 'Tomba'/);
  });
});

describe('honorifics and titles', () => {
  it.each([
    ['Shri Okram Thomas Meitei', 'Okram Thomas Meitei'],
    ['Shri. Okram Thomas Meitei', 'Okram Thomas Meitei'],
    ['Sri Okram Thomas Meitei', 'Okram Thomas Meitei'],
    ['Sh. Okram Thomas Meitei', 'Okram Thomas Meitei'],
    ['Smt. Okram Ibemcha Devi', 'Okram Ibemcha Devi'],
    ['SMT OKRAM IBEMCHA DEVI', 'Okram Ibemcha Devi'],
    ['Mrs Okram Ibemcha Devi', 'Okram Ibemcha Devi'],
    ['Mr. Okram Thomas', 'Okram Thomas'],
    ['Dr. Okram Thomas Singh', 'Okram Thomas Singh'],
    ['Late Okram Tomba Singh', 'Okram Tomba Singh'],
    ['Lt. Okram Tomba Singh', 'Okram Tomba Singh'],
    ['Pu Paolen Kipgen', 'Paolen Kipgen'],
    ['Pi Hoineilhing Sitlhou', 'Hoineilhing Sitlhou'],
    ['Mst. Rahima Begum', 'Rahima Begum'],
    ['Haji Md. Abdul Rahim', 'Md. Abdul Rahim'],
    ['Shri Thangboi Haokip', 'Thangboi Haokip'],
    ['OKRAM THOMAS MR', 'Okram Thomas'],
  ])('"%s" scores exactly like "%s" (title ignored)', (a, b) => {
    const r = matchNames(a, b);
    expect(r).toMatchObject({ verdict: matchNames(b, b).verdict, score: matchNames(b, b).score });
    expect(MATCH).toContain(r.verdict);
  });

  it('Md. is kept as the Mohammad prefix, not dropped as a title', () => {
    const p = parseName('Md. Abdul Rahim');
    expect(p.hasMohammad).toBe(true);
    expect(MATCH).toContain(matchNames('Md. Abdul Rahim', 'Mohammad Abdul Rahim').verdict);
  });

  it('"Sh." in the middle of a name is not a title', () => {
    expect(normaliseName('Okram Sh. Thomas')).toBe('okram sh thomas');
  });

  it('a name that is only a title still compares without crashing', () => {
    expect(matchNames('Shri', 'Okram Thomas').verdict).toBe('DIFFERENT');
  });
});

describe('S/O, W/O, D/O fragments leaking into the name field', () => {
  it.each([
    'Okram Thomas Meitei S/O Okram Tomba Singh',
    'Okram Thomas Meitei S/0 Okram Tomba Singh',
    'Okram Thomas Meitei S/o: Okram Tomba Singh',
    'Okram Thomas Meitei, S.O. Okram Tomba Singh',
    'Okram Thomas Meitei S\\O Okram Tomba',
    'Okram Thomas Meitei C/O Okram Tomba Singh',
    'Okram Thomas Meitei son of Okram Tomba Singh',
    'Okram Thomas Meitei S/O',
    'OKRAM THOMAS MEITEI S/O LATE OKRAM TOMBA SINGH',
  ])('"%s" → SAME as "Okram Thomas Meitei"', (a) => {
    expect(matchNames(a, 'Okram Thomas Meitei').verdict).toBe('SAME');
  });

  it.each([
    'Okram Ibemcha Devi W/O Okram Tomba Singh',
    'Okram Ibemcha Devi WD/O Late Okram Tomba Singh',
    'Okram Ibemcha Devi D/O Okram Tomba Singh',
    'Okram Ibemcha Devi d/0 Okram Tomba',
    'Okram Ibemcha Devi wife of Okram Tomba Singh',
    'Okram Ibemcha Devi widow of Okram Tomba Singh',
  ])('"%s" → SAME as "Okram Ibemcha Devi"', (a) => {
    expect(matchNames(a, 'Okram Ibemcha Devi').verdict).toBe('SAME');
  });

  it('an abbreviation like "Ch." is not mistaken for C/O', () => {
    expect(normaliseName('Ch. Ibomcha Singh')).toBe('ch ibomcha singh');
  });

  it('a field that holds only the relation fragment is unreadable, not a match', () => {
    const r = matchNames('S/O Okram Tomba Singh', 'Okram Thomas Meitei');
    expect(r.verdict).toBe('DIFFERENT');
    expect(r.reasons.join(' ')).toMatch(/empty or unreadable/);
  });
});

describe('OCR-ish noise', () => {
  it.each([
    ['0kram Thomas Meitei', 'Okram Thomas Meitei'],
    ['OKRAM TH0MAS MEITEI', 'Okram Thomas Meitei'],
    ['La1remsiami Hmar', 'Lalremsiami Hmar'],
    ['Okram Thomas. Meitei', 'Okram Thomas Meitei'],
    ['.Okram Thomas Meitei.', 'Okram Thomas Meitei'],
    ['Okram  Thomas ,, Meitei', 'Okram Thomas Meitei'],
    ['Okram Thomas Meitei 1', 'Okram Thomas Meitei'],
    ['Tho.mas Okram', 'Thomas Okram'],
  ])('"%s" = "%s" → SAME', (a, b) => {
    expect(matchNames(a, b).verdict).toBe('SAME');
  });

  it('a stray dot after a full word does not make it an abbreviation', () => {
    const p = parseName('Okram. Thomas');
    expect(p.family).toMatchObject([{ kind: 'full', display: 'Okram' }]);
    expect(text('Okram. Thomas', 'Okram Thomas')).not.toMatch(/Okram\./);
  });

  it('"O.Thomas" still splits into an abbreviation and a given name', () => {
    expect(normaliseName('O.Thomas')).toBe('o thomas');
    expect(normaliseName('Okram.Thomas')).toBe('okram thomas');
  });

  it('a one-letter OCR slip in a given name is referred to an officer, never auto-matched', () => {
    const r = matchNames('Okram lbemcha Devi', 'Okram Ibemcha Devi');
    expect(r.verdict).toBe('AMBIGUOUS');
    expect(r.reasons[0]).toMatch(/Given names differ slightly/);
  });
});

describe('hyphenated names', () => {
  it.each([
    ['Huidrom Prem-Kumar Singh', 'Huidrom Premkumar Singh'],
    ['Huidrom Prem-Kumar Singh', 'Huidrom Prem Kumar Singh'],
    ['Huidrom Prem–Kumar Singh', 'Huidrom Prem Kumar Singh'],
    ['Okram-Thomas Meitei', 'Okram Thomas Meitei'],
    ['Lal-remsiami Hmar', 'Lalremsiami Hmar'],
  ])('"%s" ≈ "%s"', (a, b) => {
    expect(MATCH).toContain(matchNames(a, b).verdict);
  });
});

describe('tribal and Nepali names: "Th." / "Ng." are given-name initials, not Meitei yumnaks', () => {
  it('"Th. Muivah" vs "Thuingaleng Muivah" → LIKELY_SAME via the initial', () => {
    const r = matchNames('Th. Muivah', 'Thuingaleng Muivah');
    expect(r.verdict).toBe('LIKELY_SAME');
    expect(r.reasons.join(' ')).toMatch(/initial/i);
    expect(r.reasons.join(' ')).not.toMatch(/Thokchom|Thounaojam/);
    expect(r.ambiguousYumnaks).toBeUndefined();
  });

  it('parses "Th. Muivah" as initial + clan', () => {
    const p = parseName('Th. Muivah');
    expect(p.family.map((f) => f.display)).toEqual(['Muivah']);
    expect(p.given).toEqual(['th']);
  });

  it('"Ng. Haokip" vs "Ngamkhohao Haokip" → LIKELY_SAME', () => {
    expect(matchNames('Ng. Haokip', 'Ngamkhohao Haokip').verdict).toBe('LIKELY_SAME');
  });

  it('an initial that does not fit the given name → DIFFERENT', () => {
    expect(matchNames('Th. Muivah', 'Somila Muivah').verdict).toBe('DIFFERENT');
  });

  it('"R.B. Thapa" vs "Ram Bahadur Thapa" → LIKELY_SAME (initials split per given name)', () => {
    expect(matchNames('R.B. Thapa', 'Ram Bahadur Thapa').verdict).toBe('LIKELY_SAME');
  });

  it('clan names starting with Ng/Th are full clans, not abbreviations', () => {
    expect(parseName('Thangkhanlal Ngaihte').family).toMatchObject([
      { kind: 'full', display: 'Ngaihte' },
    ]);
    expect(parseName('Ram Bahadur Thapa').family).toMatchObject([
      { kind: 'full', display: 'Thapa' },
    ]);
  });

  it('Meitei context is unchanged: "Th. Ibemcha Devi" stays a yumnak abbreviation', () => {
    expect(matchNames('Th. Ibemcha Devi', 'Thokchom Ibemcha Devi').verdict).toBe('AMBIGUOUS');
  });

  it('Nepali surname conflict → DIFFERENT', () => {
    expect(matchNames('Ram Bahadur Thapa', 'Ram Bahadur Gurung').verdict).toBe('DIFFERENT');
  });

  it('Nepali surname dropped on one document → LIKELY_SAME', () => {
    expect(matchNames('Ram Bahadur Thapa', 'Ram Bahadur').verdict).toBe('LIKELY_SAME');
  });

  it('Chhetri / Chettri spellings are the same surname', () => {
    expect(matchNames('Dil Kumari Chhetri', 'Dil Kumari Chettri').verdict).toBe('SAME');
  });
});

describe('abbreviation vs a yumnak missing from the gazetteer', () => {
  it('"Kh." vs an unknown Kh- yumnak → AMBIGUOUS (not DIFFERENT)', () => {
    const r = matchNames('Kh. Loken Singh', 'Khutembam Loken Singh');
    expect(r.verdict).toBe('AMBIGUOUS');
    expect(r.reasons.join(' ')).toMatch(/not in the gazetteer/);
  });

  it('"Kh." vs a yumnak that does not start with Kh is still DIFFERENT', () => {
    expect(matchNames('Kh. Loken Singh', 'Laishram Loken Singh').verdict).toBe('DIFFERENT');
  });
});

describe('single-word names', () => {
  it('"Thomas" = "Thomas" → LIKELY_SAME (only one part to compare)', () => {
    expect(matchNames('Thomas', 'Thomas').verdict).toBe('LIKELY_SAME');
  });

  it('"THOMAS" vs "Okram Thomas Meitei" → LIKELY_SAME', () => {
    expect(matchNames('THOMAS', 'Okram Thomas Meitei').verdict).toBe('LIKELY_SAME');
  });

  it('"Thomas" vs "Tomba" → DIFFERENT', () => {
    expect(matchNames('Thomas', 'Tomba').verdict).toBe('DIFFERENT');
  });

  it('a lone yumnak vs a full name → AMBIGUOUS (given name missing)', () => {
    expect(matchNames('Okram', 'Okram Thomas').verdict).toBe('AMBIGUOUS');
  });

  it('a lone abbreviation never auto-matches', () => {
    expect(MATCH).not.toContain(matchNames('O.', 'Okram Thomas').verdict);
  });

  it('"Lalremsiami" = "Lalremsiami" → LIKELY_SAME', () => {
    expect(matchNames('Lalremsiami', 'LALREMSIAMI').verdict).toBe('LIKELY_SAME');
  });
});

// ---------------------------------------------------------------------------------------------
// explainMatch
// ---------------------------------------------------------------------------------------------

const HARD_CASES: [string, string][] = [
  ['Kh. Loken Singh', 'Khuraijam Loken Singh'],
  ['S. Tomba Singh', 'Sapam Tomba Singh'],
  ['O.Thomas Singh', 'Okram Thomas Singh'],
  ['Okram Thomas', 'Okram Tomba'],
  ['Okram Tomba Singh', 'Okram Tombi Devi'],
  ['Okram Ibemcha Devi', 'Laishram Ibemcha Chanu'],
  ['Laishram Ningol Okram Ongbi Ibemcha Devi', 'Laishram Ibemcha Chanu'],
  ['Laishram Ningol Okram Ongbi Ibemcha Devi', 'Okram Ongbi Ibemcha Devi'],
  ['Huidrom Prem Kumar Singh', 'Huidrom Premkumar Singh'],
  ['Thomas Xyzam', 'Okram Thomas'],
  ['Th. Muivah', 'Thuingaleng Muivah'],
  ['Kh. Loken Singh', 'Khutembam Loken Singh'],
  ['Okram Ibemcha Singh', 'Okram Ibemcha Devi'],
  ['Md. Abdul', 'Mohammad Abdul'],
  ['Md. Abdul Rahim', 'Abdul Rahim'],
  ['Lalremsiami Hmar', 'Lalremsiami'],
  ['Okram Thomas Meitei', 'Thomas Singh'],
  ['Thomas', 'Thomas'],
  ['', 'Okram Thomas'],
  ['Okram', 'Okram'],
  ['R.K. Ranjan Singh', 'Rajkumar Ranjan Singh'],
  ['Th. Ibemcha Devi', 'Thokchom Ibemcha Devi'],
  ['Kh. Loken Singh', 'Kh Loken Singh'],
  ['Ningthoujam Rameshwor Singh', 'Ningthoujam Rameshwar Singh'],
  ['Moirangthem Phajabati Devi', 'Moirangthem Fajabati Devi'],
  ['Shanti Rai Chhetri Gurung Thapa Lama', 'Shanti Limbu Tamang Magar Pradhan Bista'],
];

const words = (s: string) => s.split(/\s+/).filter(Boolean).length;

describe('explainMatch', () => {
  it('agrees with matchNames on verdict, score and candidates', () => {
    for (const [a, b] of HARD_CASES) {
      const m = matchNames(a, b);
      const e = explainMatch(a, b);
      expect(e.verdict).toBe(m.verdict);
      expect(e.score).toBe(m.score);
      expect(e.details).toEqual(m.reasons);
      expect(e.ambiguousYumnaks).toEqual(m.ambiguousYumnaks);
    }
  });

  it('gives a short plain-English point for every case (≤ 12 words each)', () => {
    const all: [string, string][] = [
      ...HARD_CASES,
      ...fairnessDevPairs.map((p) => [p.a, p.b] as [string, string]),
    ];
    for (const [a, b] of all) {
      const e = explainMatch(a, b);
      expect(e.points.length, `${a} / ${b}`).toBeGreaterThan(0);
      for (const p of e.points) {
        expect(words(p), `"${p}" (${a} / ${b})`).toBeLessThanOrEqual(12);
        expect(p, `${a} / ${b}`).toMatch(/^[A-Z'"]/);
      }
    }
  });

  it.each([
    ['Okram Thomas Meitei', 'Okram Thomas Meitei', /^Same person/],
    ['Okram Thomas Meitei', 'Thomas Singh', /^Probably the same person/],
    ['Kh. Loken Singh', 'Khuraijam Loken Singh', /officer/i],
    ['Okram Thomas', 'Okram Tomba', /^Different person/],
  ])('headline for "%s" vs "%s"', (a, b, re) => {
    const h = explainMatch(a, b).headline;
    expect(h).toMatch(re);
    expect(words(h)).toBeLessThanOrEqual(12);
  });

  it('shortens long candidate lists ("+N more")', () => {
    const e = explainMatch('S. Tomba Singh', 'Sapam Tomba Singh');
    const p = e.points.find((x) => x.startsWith('S.'));
    expect(p).toMatch(/\+\d+ more/);
    expect(e.ambiguousYumnaks!.length).toBeGreaterThan(5);
  });

  it('says what to do when the yumnak is ambiguous', () => {
    expect(explainMatch('Kh. Loken Singh', 'Khuraijam Loken Singh').points.join(' ')).toMatch(
      /confirm/i,
    );
  });

  it('explains a given-name mismatch first', () => {
    expect(explainMatch('Okram Thomas', 'Okram Tomba').points[0]).toBe(
      "Given names differ: 'Thomas' vs 'Tomba'.",
    );
  });

  it('identityMatrix pairs carry the short points and headline', () => {
    const m = identityMatrix([
      { key: 'form', value: 'Kh. Loken Singh' },
      { key: 'aadhaar', value: 'Khuraijam Loken Singh' },
    ]);
    expect(m.pairs[0]!.points.length).toBeGreaterThan(0);
    expect(m.pairs[0]!.headline).toMatch(/officer/i);
  });
});

describe('symmetry over the new cases', () => {
  it('matchNames(a, b) and matchNames(b, a) agree on verdict, score and candidates', () => {
    const extra: [string, string][] = [
      ['R.B. Thapa', 'Ram Bahadur Thapa'],
      ['Ng. Haokip', 'Ngamkhohao Haokip'],
      ['OKRAM THOMAS MEIT', 'Okram Thomas Meitei'],
      ['Okram Thomas Meitei S/0 Okram Tomba', 'Okram Thomas Meitei'],
      ['0kram Thomas Meitei', 'Okram Thomas Meitei'],
    ];
    for (const [a, b] of [...HARD_CASES, ...extra]) {
      const ab = matchNames(a, b);
      const ba = matchNames(b, a);
      expect([ba.verdict, ba.score], `${a} / ${b}`).toEqual([ab.verdict, ab.score]);
      expect(new Set(ba.ambiguousYumnaks), `${a} / ${b}`).toEqual(new Set(ab.ambiguousYumnaks));
    }
  });
});

describe('performance', () => {
  it('10,000 comparisons run in under 1 second', () => {
    const names = [...fairnessDevPairs.flatMap((p) => [p.a, p.b]), ...HARD_CASES.flat()].filter(
      Boolean,
    );
    // Warm up the JIT so the measurement reflects steady-state speed.
    for (let i = 0; i < 500; i++)
      matchNames(names[i % names.length]!, names[(i * 7) % names.length]!);
    const start = performance.now();
    for (let i = 0; i < 10_000; i++) {
      matchNames(names[i % names.length]!, names[(i * 31 + 7) % names.length]!);
    }
    const ms = performance.now() - start;
    console.log(`\nName engine: 10,000 comparisons in ${ms.toFixed(0)} ms\n`);
    expect(ms).toBeLessThan(1000);
  });

  it('10,000 comparisons of distinct, never-seen names run in under 1 second', () => {
    const yumnaks = ['Okram', 'Th.', 'Laishram', 'Kh.', 'Haokip', 'Shimray', 'Thapa', 'O.'];
    const given = ['Tomba', 'Ibemcha', 'Thangboi', 'Somila', 'Ram', 'Loken', 'Rahim', 'Ibobi'];
    const endings = ['Singh', 'Devi', 'Chanu', '', 'Meitei'];
    const name = (i: number) =>
      `${yumnaks[i % 8]} ${given[(i >> 3) % 8]}${i} ${endings[i % 5]}`.trim();
    const start = performance.now();
    for (let i = 0; i < 10_000; i++) matchNames(name(i + 1_000_000), name(i + 2_000_000));
    const ms = performance.now() - start;
    console.log(`\nName engine: 10,000 distinct comparisons in ${ms.toFixed(0)} ms\n`);
    expect(ms).toBeLessThan(1000);
  });
});
