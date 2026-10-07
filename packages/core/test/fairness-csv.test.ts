import { describe, expect, it } from 'vitest';
import {
  evaluateFairness,
  fairnessDevPairs,
  fairnessPairs,
  parseFairnessCsv,
} from '../src/index.js';

describe('held-out fairness CSV', () => {
  it('parses name_a,name_b,community,expected_same with quotes, CRLF and loose booleans', () => {
    const csv = [
      'name_a,name_b,community,expected_same',
      'Okram Thomas,Thomas Okram,Meitei,true',
      '"Md. Abdul, Rahim",Mohammad Abdul Rahim,pangal,yes',
      'Haokip Thangboi,Haokip Thangminlen,Kuki-Zo,0',
      'Shimray Thotso,Thotso Shimray,NAGA,1',
      'Lalremsiami,Lalremsiami Hmar,kuki zo,Y',
      '',
    ].join('\r\n');
    const { pairs, errors } = parseFairnessCsv(csv);
    expect(errors).toEqual([]);
    expect(pairs).toEqual([
      { a: 'Okram Thomas', b: 'Thomas Okram', community: 'Meitei', samePerson: true },
      { a: 'Md. Abdul, Rahim', b: 'Mohammad Abdul Rahim', community: 'Pangal', samePerson: true },
      { a: 'Haokip Thangboi', b: 'Haokip Thangminlen', community: 'Kuki-Zo', samePerson: false },
      { a: 'Shimray Thotso', b: 'Thotso Shimray', community: 'Naga', samePerson: true },
      { a: 'Lalremsiami', b: 'Lalremsiami Hmar', community: 'Kuki-Zo', samePerson: true },
    ]);
  });

  it('reports row-level errors instead of guessing', () => {
    const { pairs, errors } = parseFairnessCsv(
      'name_a,name_b,community,expected_same\nA,B,Martian,true\nA,B,Meitei,maybe\n,B,Meitei,true',
    );
    expect(pairs).toEqual([]);
    expect(errors).toEqual([
      'Row 2: unknown community "Martian" (use Meitei, Pangal, Naga or Kuki-Zo)',
      'Row 3: expected_same must be true/false (got "maybe")',
      'Row 4: name_a and name_b are required',
    ]);
  });

  it('requires the header', () => {
    expect(parseFairnessCsv('a,b,c,d\nx,y,Meitei,true').errors[0]).toMatch(/header/);
  });

  it('per-community metrics work on parsed pairs', () => {
    const { pairs } = parseFairnessCsv(
      'name_a,name_b,community,expected_same\nOkram Thomas,Okram Tomba,Meitei,false\nOkram Thomas,Thomas Okram,Meitei,true',
    );
    const r = evaluateFairness(pairs);
    expect(r.rows).toEqual([
      expect.objectContaining({
        community: 'Meitei',
        pairs: 2,
        correct: 2,
        falseMatches: 0,
        accuracy: 1,
      }),
    ]);
  });

  it('the development set is still exported (renamed to fairness-dev.json)', () => {
    expect(fairnessDevPairs.length).toBe(58);
    expect(fairnessPairs).toBe(fairnessDevPairs);
  });
});
