import { describe, expect, it } from 'vitest';
import gazetteerJson from '../data/gazetteer.json';
import {
  ambiguousAbbreviations,
  createGazetteer,
  defaultGazetteer,
  gazetteerEntries,
  matchNames,
  phoneticKey,
  type NameVerdict,
} from '../src/index.js';

const MATCH: NameVerdict[] = ['SAME', 'LIKELY_SAME'];
const byCommunity = (c: string) => gazetteerEntries.filter((e) => e.community === c);

/** "th" → "Th.", "rk" → "R.K." (how the abbreviation is written on documents). */
const written = (abbr: string) =>
  abbr === 'rk' ? 'R.K.' : `${abbr[0]!.toUpperCase()}${abbr.slice(1)}.`;

describe('gazetteer data', () => {
  it('has 300+ entries and keeps the department-review note', () => {
    expect(gazetteerEntries.length).toBeGreaterThanOrEqual(300);
    expect(gazetteerJson._note).toMatch(/starter list/i);
    expect(gazetteerJson._note).toMatch(/department review needed/i);
  });

  it('marks every entry with source and confidence', () => {
    for (const e of gazetteerEntries) {
      expect(e.source, e.surname).toBe('general-knowledge');
      expect(['high', 'medium', 'low'], e.surname).toContain(e.confidence);
    }
  });

  it('covers every community in Manipur', () => {
    expect(byCommunity('Meitei').length).toBeGreaterThanOrEqual(120);
    expect(byCommunity('Pangal').length).toBeGreaterThanOrEqual(25);
    expect(byCommunity('Naga').length).toBeGreaterThanOrEqual(30);
    expect(byCommunity('Kuki-Zo').length).toBeGreaterThanOrEqual(40);
    expect(byCommunity('Nepali').length).toBeGreaterThanOrEqual(25);
    expect(gazetteerEntries.filter((e) => e.subgroup === 'Bamon').length).toBeGreaterThan(5);
  });

  it('records the tribe of every Naga and Kuki-Zo clan', () => {
    for (const e of [...byCommunity('Naga'), ...byCommunity('Kuki-Zo')]) {
      expect(e.tribe, e.surname).toBeTruthy();
    }
  });

  it('has unique surnames (the DB column is UNIQUE)', () => {
    const names = gazetteerEntries.map((e) => e.surname);
    expect(new Set(names).size).toBe(names.length);
  });

  it('never maps two different entries to the same romanisation key', () => {
    const seen = new Map<string, string>();
    for (const e of gazetteerEntries) {
      for (const s of [e.surname, ...(e.variants ?? [])]) {
        const k = phoneticKey(s);
        const owner = seen.get(k);
        expect(owner === undefined || owner === e.surname, `${s} vs ${owner}`).toBe(true);
        seen.set(k, e.surname);
      }
    }
  });

  it('gives abbreviations only to Meitei yumnaks, using the first letter or digraph', () => {
    for (const e of gazetteerEntries) {
      if (e.community !== 'Meitei') {
        expect(e.abbreviations, e.surname).toEqual([]);
        continue;
      }
      const s = e.surname.toLowerCase();
      const digraph = ['th', 'kh', 'ng', 'ch', 'ph'].find((d) => s.startsWith(d));
      expect(e.abbreviations.length, e.surname).toBeGreaterThan(0);
      if (e.surname !== 'Rajkumar' && e.surname !== 'Ningombam') {
        expect(e.abbreviations, e.surname).toContain(digraph ?? s[0]);
      }
    }
  });

  it('finds surnames by their recorded variant spellings', () => {
    expect(defaultGazetteer.lookup('Khetrimayum')?.surname).toBe('Kshetrimayum');
    expect(defaultGazetteer.lookup('Rajkumari')?.surname).toBe('Rajkumar');
    expect(defaultGazetteer.lookup('CHETTRI')?.surname).toBe('Chhetri');
  });

  it('createGazetteer: first entry wins on a key collision', () => {
    const g = createGazetteer([
      { surname: 'Thoudam', community: 'Meitei', abbreviations: ['th'] },
      { surname: 'Toudam', community: 'Other', abbreviations: [] },
    ]);
    expect(g.lookup('Toudam')?.community).toBe('Meitei');
  });
});

describe('abbreviation ambiguity map', () => {
  const map = defaultGazetteer.abbreviationMap();
  const ambiguous = ambiguousAbbreviations(defaultGazetteer);

  it('is recomputed from the expanded list', () => {
    const fromData = new Map<string, string[]>();
    for (const e of gazetteerEntries)
      for (const a of e.abbreviations) fromData.set(a, [...(fromData.get(a) ?? []), e.surname]);
    expect(Object.fromEntries(map)).toEqual(Object.fromEntries(fromData));
  });

  it('lists the well-known shared abbreviations as ambiguous', () => {
    for (const a of ['th', 'kh', 'o', 'l', 's', 'm', 'n', 'ng', 'ch', 'ph', 'y', 'w', 'k', 'a']) {
      expect(ambiguous.get(a)?.length, a).toBeGreaterThan(1);
    }
    expect(ambiguous.get('th')).toEqual(
      expect.arrayContaining(['Thokchom', 'Thounaojam', 'Thangjam', 'Thoudam', 'Thiyam']),
    );
  });

  it('keeps R.K. (Rajkumar) and Ksh. (Kshetrimayum) unique', () => {
    expect(map.get('rk')).toEqual(['Rajkumar']);
    expect(map.get('ksh')).toEqual(['Kshetrimayum']);
  });

  describe.each([...ambiguous].map(([abbr, names]) => ({ abbr, names })))(
    'every candidate of "$abbr" is AMBIGUOUS unless disambiguated',
    ({ abbr, names }) => {
      it(`${written(abbr)} Tomba Singh vs each full yumnak`, () => {
        for (const surname of names) {
          const r = matchNames(`${written(abbr)} Tomba Singh`, `${surname} Tomba Singh`);
          expect(r.verdict, surname).toBe('AMBIGUOUS');
          expect(r.ambiguousYumnaks, surname).toEqual([...names]);
        }
      });

      it(`${written(abbr)} resolves when the packet shows exactly one full yumnak`, () => {
        for (const surname of names) {
          const r = matchNames(`${written(abbr)} Tomba Singh`, `${surname} Tomba Singh`, {
            knownYumnaks: [surname],
          });
          expect(MATCH, surname).toContain(r.verdict);
        }
      });
    },
  );

  it('unique abbreviations match without packet context', () => {
    const unique = [...map].filter(([, names]) => names.length === 1);
    expect(unique.length).toBeGreaterThan(0);
    for (const [abbr, [surname]] of unique) {
      const r = matchNames(`${written(abbr)} Tomba Singh`, `${surname} Tomba Singh`);
      expect(MATCH, abbr).toContain(r.verdict);
    }
  });
});
