import { describe, expect, it } from 'vitest';
import { containsFullAadhaar, identityMatrix, matchNames, verhoeffValidate } from '@thoudang/core';
import { DISTRICTS } from '../src/data.js';
import { DEMO_PACKETS, DEMO_SEED } from '../src/demo.js';
import { DEFAULT_MIX, allocate, arrange, parseMix, plan } from '../src/plan.js';
import { createRng } from '../src/rng.js';
import { SCENARIOS, SCENARIO_INTENT } from '../src/spec.js';
import { buildTruth, nameChecks } from '../src/truth.js';
import { TruthSchema } from '../../../apps/api/src/eval/score.js';

const big = plan({ count: 200, seed: 7 });
const forty = plan({ count: 40, seed: 20261009 });

describe('allocation of planted problems', () => {
  it('allocates exact quotas that sum to the count', () => {
    for (const n of [1, 7, 40, 133]) {
      const q = allocate(DEFAULT_MIX, n);
      expect(Object.values(q).reduce((a, b) => a + b, 0)).toBe(n);
    }
  });

  it('default mix: ~35% clean and every scenario present in a 40-packet set', () => {
    const counts = Object.fromEntries(
      SCENARIOS.map((s) => [s, forty.filter((p) => p.scenario === s).length]),
    );
    expect(counts.clean).toBe(14);
    for (const s of SCENARIOS) expect(counts[s], s).toBeGreaterThanOrEqual(1);
  });

  it('distribution follows the mix within rounding on a large set', () => {
    for (const s of SCENARIOS) {
      const share = big.filter((p) => p.scenario === s).length / big.length;
      expect(Math.abs(share - DEFAULT_MIX[s]), s).toBeLessThanOrEqual(0.005 + 1e-9);
    }
  });

  it('mix is configurable and validated', () => {
    const mix = parseMix({ clean: 1, duplicate: 0 });
    expect(mix.clean).toBe(1);
    expect(mix.duplicate).toBe(0);
    expect(() => parseMix({ nope: 1 })).toThrow(/Unknown scenario/);
    expect(() => parseMix({ clean: -1 })).toThrow();
    const onlyClean = parseMix(
      Object.fromEntries(SCENARIOS.map((s) => [s, s === 'clean' ? 1 : 0])),
    );
    expect(plan({ count: 5, seed: 1, mix: onlyClean }).every((p) => p.scenario === 'clean')).toBe(
      true,
    );
  });

  it('every duplicate has an earlier clean/displaced original, used at most once', () => {
    for (let seed = 0; seed < 30; seed++) {
      const order = arrange(createRng(seed), allocate({ ...DEFAULT_MIX, duplicate: 0.3 }, 20));
      const used = new Set<number>();
      order.forEach((o, i) => {
        if (o.scenario !== 'duplicate') return;
        expect(o.originalOf).not.toBeNull();
        expect(o.originalOf!).toBeLessThan(i);
        expect(['clean', 'displaced']).toContain(order[o.originalOf!]!.scenario);
        expect(used.has(o.originalOf!)).toBe(false);
        used.add(o.originalOf!);
      });
    }
  });
});

describe('planned packets behave as intended under the real rules engine', () => {
  it('expected status and planted flag match the scenario intent', () => {
    for (const p of [...big, ...forty]) {
      const intent = SCENARIO_INTENT[p.scenario];
      expect(p.expectation.status, `${p.id} ${p.scenario}`).toBe(intent.status);
      if (intent.flag) expect(p.expectation.flags.map((f) => f.code)).toContain(intent.flag);
    }
  });

  it('name verdicts agree with the ground truth (same person / different / ambiguous)', () => {
    for (const p of big) {
      for (const c of nameChecks(p.spec)) {
        if (!c.same_person) expect(c.expected).toBe('DIFFERENT');
        else if (p.scenario === 'ambiguous_initials') expect(c.expected).toBe('AMBIGUOUS');
        else expect(['SAME', 'LIKELY_SAME']).toContain(c.expected);
      }
    }
  });

  it('duplicates share Aadhaar, DOB and name with their original', () => {
    const dups = big.filter((p) => p.scenario === 'duplicate');
    expect(dups.length).toBeGreaterThan(0);
    for (const d of dups) {
      const o = big[d.spec.duplicateOf!]!;
      expect(o.index).toBeLessThan(d.index);
      expect(d.spec.person.aadhaar).toBe(o.spec.person.aadhaar);
      expect(d.expectation.facts.dob).toBe(o.expectation.facts.dob);
      expect(o.expectation.flags.map((f) => f.code)).not.toContain('DUPLICATE_SUSPECTED');
    }
  });

  it('is deterministic for a seed and varies across seeds', () => {
    const a = plan({ count: 25, seed: 99 }).map((p) => buildTruth(p.spec, p.expectation, {}));
    const b = plan({ count: 25, seed: 99 }).map((p) => buildTruth(p.spec, p.expectation, {}));
    const c = plan({ count: 25, seed: 100 }).map((p) => buildTruth(p.spec, p.expectation, {}));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(c));
  });
});

describe('people and identifiers', () => {
  it('Aadhaar numbers are Verhoeff-valid, except where invalidity is planted', () => {
    for (const p of big) {
      const valid = verhoeffValidate(p.spec.person.aadhaar);
      expect(valid, p.id).toBe(p.scenario !== 'aadhaar_checksum_invalid');
      expect(p.expectation.checksumValid).toBe(p.spec.aadhaar ? valid : null);
      expect(p.spec.person.aadhaar).toMatch(/^[2-9]\d{11}$/);
    }
  });

  it('Aadhaar last-4 mismatch is planted on the form only', () => {
    for (const p of big.filter((x) => x.scenario === 'aadhaar_last4_mismatch')) {
      const formN = p.spec.form!.fields.aadhaar_number!.replace(/\s/g, '');
      expect(formN.slice(-4)).not.toBe(p.spec.aadhaar!.number.slice(-4));
      expect(formN.slice(0, 8)).toBe(p.spec.aadhaar!.number.slice(0, 8));
    }
  });

  it('truth.json never contains a full Aadhaar number and parses with the eval harness schema', () => {
    for (const p of big) {
      const truth = buildTruth(p.spec, p.expectation, {});
      expect(containsFullAadhaar(JSON.stringify(truth)), p.id).toBe(false);
      expect(() => TruthSchema.parse(truth)).not.toThrow();
      for (const doc of Object.values(truth.documents)) {
        const n = doc.fields.aadhaar_number;
        if (n) expect(n).toMatch(/^XXXX XXXX \d{4}$/);
      }
    }
  });

  it('covers all four communities in plausible proportions and only real districts', () => {
    const share = (c: string) =>
      big.filter((p) => p.spec.person.community === c).length / big.length;
    expect(share('Meitei')).toBeGreaterThan(0.4);
    expect(share('Naga')).toBeGreaterThan(0.08);
    expect(share('Kuki-Zo')).toBeGreaterThan(0.08);
    expect(share('Pangal')).toBeGreaterThan(0.02);
    const districts = new Set(Object.keys(DISTRICTS));
    expect(districts.size).toBe(16);
    for (const p of big) {
      expect(districts.has(p.spec.person.district)).toBe(true);
      if (p.spec.person.reliefCamp)
        expect(districts.has(p.spec.person.reliefCamp.district)).toBe(true);
    }
    expect(big.some((p) => p.spec.form?.fields.address?.startsWith('Relief Camp'))).toBe(true);
  });
});

describe('demo set', () => {
  const demo = plan({ count: 0, seed: DEMO_SEED, scenarios: DEMO_PACKETS });
  type Planned = (typeof demo)[number];
  const byId = (id: string) => demo.find((p) => p.id === id)!;
  const names = (p: Planned) => ({
    form: p.spec.form!.fields.applicant_name,
    father: p.spec.form!.fields.father_or_husband_name,
    aadhaar: p.spec.aadhaar!.name,
    passbook: p.spec.passbook!.holder,
  });
  /** The case page's identity card: every pair, with the form's relative name as context. */
  const matrix = (p: Planned) =>
    identityMatrix(
      [
        { key: 'form', value: names(p).form! },
        { key: 'aadhaar', value: names(p).aadhaar },
        { key: 'passbook', value: names(p).passbook },
      ],
      { relativeNames: [names(p).father] },
    );

  it('has the seven hand-picked stories in folder (= processing) order', () => {
    expect(demo.map((p) => p.id)).toEqual(DEMO_PACKETS.map((d) => d.id));
    expect(demo.map((p) => [p.id, p.expectation.status])).toEqual([
      ['demo-01-clean', 'READY'],
      ['demo-02-clean', 'READY'],
      ['demo-03-ongbi-married-name', 'READY'],
      ['demo-04-kh-loken-ambiguous', 'OFFICER_ATTENTION'],
      ['demo-05-dob-mismatch', 'NEEDS_CITIZEN_CORRECTION'],
      ['demo-06-duplicate-of-01', 'OFFICER_ATTENTION'],
      ['demo-07-thomas-o-resolved-by-father', 'READY'],
    ]);
    expect(demo[2]!.spec.form!.fields.applicant_name).toMatch(/ Ongbi /i);
    expect(demo[4]!.expectation.flags.map((f) => f.code)).toContain('DOB_MISMATCH');
    expect(demo[5]!.expectation.flags.map((f) => f.code)).toContain('DUPLICATE_SUSPECTED');
    expect(demo[5]!.spec.duplicateOf).toBe(0);
  });

  it('Thomas packet: "O." is resolved to Okram by the father\'s full yumnak on the form', () => {
    const p = byId('demo-07-thomas-o-resolved-by-father');
    expect(names(p)).toEqual({
      form: 'O. Thomas Meitei',
      father: 'Okram Ibomcha Singh',
      aadhaar: 'Okram Thomas Meitei',
      passbook: 'THOMAS OKRAM',
    });
    expect(p.spec.epic).toBeNull();
    expect(p.spec.person).toMatchObject({
      community: 'Meitei',
      gender: 'male',
      district: 'Imphal West',
    });
    expect(p.expectation.flags.filter((f) => f.action !== 'none')).toEqual([]);
    const m = matrix(p);
    expect(m.knownYumnaks).toEqual(['Okram']);
    expect(m.pairs.map((x) => x.verdict)).toEqual(['SAME', 'SAME', 'SAME']);
    // Without the father's name the same names are ambiguous (Okram / Oinam).
    expect(matchNames(names(p).form!, names(p).aadhaar).verdict).toBe('AMBIGUOUS');
    expect(nameChecks(p.spec).map((c) => [c.expected, c.same_person])).toEqual([
      ['AMBIGUOUS', true],
      ['AMBIGUOUS', true],
    ]);
  });

  it('Kh. Loken Singh packet: nothing in the packet narrows "Kh." → ambiguous → officer', () => {
    const p = byId('demo-04-kh-loken-ambiguous');
    expect(names(p)).toEqual({
      form: 'Kh. Loken Singh',
      father: null,
      aadhaar: 'Khuraijam Loken Singh',
      passbook: 'KHURAIJAM LOKEN SINGH',
    });
    const m = matrix(p);
    expect(m.knownYumnaks).toEqual([]);
    expect(m.pairs.map((x) => x.verdict)).toEqual(['AMBIGUOUS', 'AMBIGUOUS', 'SAME']);
    expect(m.pairs[0]!.candidates).toEqual(expect.arrayContaining(['Khuraijam', 'Khwairakpam']));
    expect(p.expectation.flags.map((f) => f.code)).toContain('NAME_AMBIGUOUS');
  });
});
