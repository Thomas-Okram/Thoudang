import { describe, expect, it } from 'vitest';
import {
  screenCase,
  getSchemeRules,
  FlagSchema,
  type ExtractedCase,
  type FormFields,
  type AadhaarFields,
  type PassbookFields,
  type EpicFields,
  type ScreenOptions,
  type DocResult,
} from '../src/index.js';

const TODAY = '2026-10-09';
const f = <T>(value: T | null, confidence = 0.98) => ({ value, confidence });

function form(over: Partial<FormFields> = {}): FormFields {
  return {
    applicantName: f('Thokchom Ibemcha Devi'),
    fatherOrHusbandName: f('Thokchom Tomba Singh'),
    dob: f('1948-05-12'),
    gender: f('female'),
    maritalStatus: f('married'),
    annualIncome: f(24000),
    address: f('Wangkhei Ayangpalli, Imphal East'),
    district: f('Imphal East'),
    disability: f(false),
    internallyDisplaced: f(false),
    bankAccountNumber: f('30123456789'),
    ifsc: f('SBIN0001234'),
    applicationDate: f('2026-09-20'),
    ...over,
  } as FormFields;
}
const aadhaar = (over: Partial<AadhaarFields> = {}): AadhaarFields =>
  ({
    name: f('Thokchom Ibemcha Devi'),
    dob: f('1948-05-12'),
    gender: f('female'),
    maskedNumber: f('XXXX XXXX 4821'),
    last4: f('4821'),
    checksumValid: true,
    ...over,
  }) as AadhaarFields;
const passbook = (over: Partial<PassbookFields> = {}): PassbookFields =>
  ({
    accountHolderName: f('THOKCHOM IBEMCHA DEVI'),
    accountNumber: f('30123456789'),
    ifsc: f('SBIN0001234'),
    bankName: f('State Bank of India'),
    branch: f('Imphal Main'),
    ...over,
  }) as PassbookFields;
const epic = (over: Partial<EpicFields> = {}): EpicFields =>
  ({
    name: f('Thokchom Ibemcha Devi'),
    epicNumber: f('MNP1234567'),
    relativeName: f('Thokchom Tomba Singh'),
    dob: f('1948-05-12'),
    gender: f('female'),
    ...over,
  }) as EpicFields;

const ok = <T>(fields: T): DocResult<T> => ({ status: 'ok', fields });

function makeCase(
  docs: Partial<{
    form: DocResult<FormFields> | null;
    aadhaar: DocResult<AadhaarFields> | null;
    passbook: DocResult<PassbookFields> | null;
    epic: DocResult<EpicFields> | null;
  }> = {},
): ExtractedCase {
  const pick = <T>(v: DocResult<T> | null | undefined, d: DocResult<T>) =>
    v === null ? undefined : (v ?? d);
  return {
    caseId: 'case-1',
    receivedAt: '2026-09-25T10:00:00.000Z',
    documents: {
      form: pick(docs.form, ok(form())),
      aadhaar: pick(docs.aadhaar, ok(aadhaar())),
      passbook: pick(docs.passbook, ok(passbook())),
      epic: pick(docs.epic, ok(epic())),
    },
  };
}

const opts: ScreenOptions = { today: TODAY };
const codes = (c: ExtractedCase, o: ScreenOptions = opts) =>
  screenCase(c, o).flags.map((x) => x.code);

describe('screenCase — clean packet', () => {
  it('is READY with no warn/critical flags', () => {
    const r = screenCase(makeCase(), opts);
    expect(r.status).toBe('READY');
    expect(r.flags.filter((x) => x.severity !== 'info')).toEqual([]);
  });

  it('exposes the facts the API stores on the case', () => {
    expect(screenCase(makeCase(), opts).facts).toEqual({
      applicantName: 'Thokchom Ibemcha Devi',
      dob: '1948-05-12',
      age: 78,
      aadhaarLast4: '4821',
    });
  });

  it('is deterministic', () => {
    expect(screenCase(makeCase(), opts)).toEqual(screenCase(makeCase(), opts));
  });
});

describe('required documents and fields', () => {
  it('missing passbook → MISSING_DOCUMENT, citizen correction', () => {
    const r = screenCase(makeCase({ passbook: null }), opts);
    expect(r.status).toBe('NEEDS_CITIZEN_CORRECTION');
    const flag = r.flags.find((x) => x.code === 'MISSING_DOCUMENT');
    expect(flag).toMatchObject({ severity: 'critical', action: 'citizen' });
    expect(flag?.evidence[0]).toMatchObject({ document: 'passbook' });
  });

  it('respects requiredDocuments from config', () => {
    const rules = {
      ...getSchemeRules(),
      requiredDocuments: ['form', 'aadhaar', 'passbook'] as const,
    };
    const r = screenCase(makeCase({ epic: null }), {
      ...opts,
      rules: { ...rules, requiredDocuments: [...rules.requiredDocuments] },
    });
    expect(r.flags.map((x) => x.code)).not.toContain('MISSING_DOCUMENT');
  });

  it('extraction failure → OFFICER_ATTENTION with "extraction failed"', () => {
    const r = screenCase(makeCase({ aadhaar: { status: 'failed', error: 'timeout' } }), opts);
    expect(r.status).toBe('OFFICER_ATTENTION');
    const flag = r.flags.find((x) => x.code === 'EXTRACTION_FAILED');
    expect(flag).toMatchObject({ action: 'officer' });
    expect(flag?.reason).toMatch(/extraction failed/i);
  });

  it('a confidently blank required field → MISSING_FIELD for the citizen', () => {
    const r = screenCase(makeCase({ form: ok(form({ address: f(null, 0.95) })) }), opts);
    const flag = r.flags.find((x) => x.code === 'MISSING_FIELD');
    expect(flag).toMatchObject({ severity: 'critical', action: 'citizen' });
    expect(flag?.evidence[0]).toMatchObject({ document: 'form', field: 'address', value: null });
    expect(r.status).toBe('NEEDS_CITIZEN_CORRECTION');
  });

  it('an unreadable field → LOW_CONFIDENCE for the officer, not a citizen notice', () => {
    const r = screenCase(makeCase({ form: ok(form({ address: f(null, 0.3) })) }), opts);
    expect(r.flags.map((x) => x.code)).toContain('LOW_CONFIDENCE');
    expect(r.flags.map((x) => x.code)).not.toContain('MISSING_FIELD');
    expect(r.status).toBe('OFFICER_ATTENTION');
  });

  it('low confidence on a present value → LOW_CONFIDENCE with the value as evidence', () => {
    const r = screenCase(
      makeCase({ passbook: ok(passbook({ ifsc: f('SBIN0001234', 0.5) })) }),
      opts,
    );
    const flag = r.flags.find((x) => x.code === 'LOW_CONFIDENCE');
    expect(flag?.evidence).toContainEqual({
      document: 'passbook',
      field: 'ifsc',
      value: 'SBIN0001234',
      confidence: 0.5,
    });
  });
});

describe('cross-document name checks', () => {
  it('different name on Aadhaar → NAME_MISMATCH (citizen)', () => {
    const r = screenCase(
      makeCase({ aadhaar: ok(aadhaar({ name: f('Thokchom Tombi Devi') })) }),
      opts,
    );
    const flag = r.flags.find((x) => x.code === 'NAME_MISMATCH');
    expect(flag).toMatchObject({ severity: 'critical', action: 'citizen' });
    expect(flag?.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ document: 'form', field: 'applicantName' }),
        expect.objectContaining({
          document: 'aadhaar',
          field: 'name',
          value: 'Thokchom Tombi Devi',
        }),
      ]),
    );
    expect(r.status).toBe('NEEDS_CITIZEN_CORRECTION');
  });

  it('ambiguous abbreviation → NAME_AMBIGUOUS (officer) naming the candidates', () => {
    const c = makeCase({
      form: ok(
        form({
          applicantName: f('Kh. Loken Singh'),
          fatherOrHusbandName: f(null, 0.95),
          gender: f('male'),
        }),
      ),
      aadhaar: ok(aadhaar({ name: f('Khuraijam Loken Singh'), gender: f('male') })),
      passbook: ok(passbook({ accountHolderName: f('Khuraijam Loken Singh') })),
      epic: ok(
        epic({ name: f('Khuraijam Loken Singh'), relativeName: f(null, 0.95), gender: f('male') }),
      ),
    });
    const r = screenCase(c, opts);
    const flag = r.flags.find((x) => x.code === 'NAME_AMBIGUOUS');
    expect(flag).toMatchObject({ severity: 'warn', action: 'officer' });
    expect(flag?.reason).toMatch(/Khwairakpam/);
    expect(r.status).toBe('OFFICER_ATTENTION');
  });

  it("an abbreviation is resolved by the relative's full yumnak on the packet", () => {
    const c = makeCase({
      form: ok(
        form({
          applicantName: f('Th. Ibemcha Devi'),
          fatherOrHusbandName: f('Thokchom Tomba Singh'),
        }),
      ),
    });
    const r = screenCase(c, opts);
    expect(r.flags.map((x) => x.code)).not.toContain('NAME_AMBIGUOUS');
    expect(r.status).toBe('READY');
  });

  it('likely-same name → informational NAME_VARIANT, still READY', () => {
    const r = screenCase(makeCase({ epic: ok(epic({ name: f('Ibemcha Devi') })) }), opts);
    const flag = r.flags.find((x) => x.code === 'NAME_VARIANT');
    expect(flag).toMatchObject({ severity: 'info', action: 'none' });
    expect(r.status).toBe('READY');
  });

  it('bank account holder ≠ applicant → BANK_HOLDER_NAME_MISMATCH (citizen)', () => {
    const r = screenCase(
      makeCase({ passbook: ok(passbook({ accountHolderName: f('Thokchom Tomba Singh') })) }),
      opts,
    );
    expect(r.flags.find((x) => x.code === 'BANK_HOLDER_NAME_MISMATCH')).toMatchObject({
      severity: 'critical',
      action: 'citizen',
    });
  });

  it('a citizen-facing flag built on a low-confidence read is routed to the officer instead', () => {
    const r = screenCase(
      makeCase({ aadhaar: ok(aadhaar({ name: f('Thokchom Tombi Devi', 0.4) })) }),
      opts,
    );
    const flag = r.flags.find((x) => x.code === 'NAME_MISMATCH');
    expect(flag?.action).toBe('officer');
    expect(flag?.reason).toMatch(/verify/i);
    expect(r.status).toBe('OFFICER_ATTENTION');
  });
});

describe('eligibility (from config, never a rejection)', () => {
  it('below minimum age → AGE_BELOW_MINIMUM for the officer', () => {
    const dob = f('1970-01-01');
    const r = screenCase(
      makeCase({ form: ok(form({ dob })), aadhaar: ok(aadhaar({ dob })), epic: ok(epic({ dob })) }),
      opts,
    );
    expect(r.flags.find((x) => x.code === 'AGE_BELOW_MINIMUM')).toMatchObject({
      severity: 'critical',
      action: 'officer',
    });
    expect(r.status).toBe('OFFICER_ATTENTION');
  });

  it('income above the configured ceiling → INCOME_ABOVE_CEILING for the officer', () => {
    const ceiling = getSchemeRules().annualIncomeCeiling;
    const r = screenCase(makeCase({ form: ok(form({ annualIncome: f(ceiling + 1) })) }), opts);
    expect(r.flags.find((x) => x.code === 'INCOME_ABOVE_CEILING')).toMatchObject({
      action: 'officer',
    });
  });

  it('uses custom rules when supplied', () => {
    const rules = { ...getSchemeRules(), annualIncomeCeiling: 10000 };
    expect(codes(makeCase(), { ...opts, rules })).toContain('INCOME_ABOVE_CEILING');
  });

  it('never produces a reject-like status', () => {
    const r = screenCase(makeCase({ form: ok(form({ annualIncome: f(10_000_000) })) }), opts);
    expect(['READY', 'NEEDS_CITIZEN_CORRECTION', 'OFFICER_ATTENTION']).toContain(r.status);
  });
});

describe('consistency checks', () => {
  it('DOB differs between form and Aadhaar → DOB_MISMATCH (citizen)', () => {
    const r = screenCase(makeCase({ aadhaar: ok(aadhaar({ dob: f('1949-05-12') })) }), opts);
    const flag = r.flags.find((x) => x.code === 'DOB_MISMATCH');
    expect(flag).toMatchObject({ severity: 'critical', action: 'citizen' });
    expect(flag?.evidence.map((e) => e.value)).toEqual(
      expect.arrayContaining(['1948-05-12', '1949-05-12']),
    );
  });

  it('year-only Aadhaar DOB that agrees on the year is not a mismatch', () => {
    const r = screenCase(makeCase({ aadhaar: ok(aadhaar({ dob: f('1948') })) }), opts);
    expect(r.flags.map((x) => x.code)).not.toContain('DOB_MISMATCH');
    expect(r.status).toBe('READY');
  });

  it('Aadhaar checksum invalid → AADHAAR_CHECKSUM_INVALID for the officer', () => {
    const r = screenCase(makeCase({ aadhaar: ok(aadhaar({ checksumValid: false })) }), opts);
    expect(r.flags.find((x) => x.code === 'AADHAAR_CHECKSUM_INVALID')).toMatchObject({
      severity: 'critical',
      action: 'officer',
    });
  });

  it('invalid IFSC on passbook → IFSC_INVALID (citizen)', () => {
    const r = screenCase(makeCase({ passbook: ok(passbook({ ifsc: f('SBIN1001234') })) }), opts);
    expect(r.flags.find((x) => x.code === 'IFSC_INVALID')).toMatchObject({ action: 'citizen' });
  });

  it('form and passbook disagree on account number → BANK_DETAILS_MISMATCH (citizen)', () => {
    const r = screenCase(
      makeCase({ passbook: ok(passbook({ accountNumber: f('30123456780') })) }),
      opts,
    );
    const flag = r.flags.find((x) => x.code === 'BANK_DETAILS_MISMATCH');
    expect(flag).toMatchObject({ action: 'citizen' });
    expect(flag?.evidence.map((e) => e.field)).toEqual(['bankAccountNumber', 'accountNumber']);
  });

  it('account numbers that differ only by spaces are equal', () => {
    const r = screenCase(
      makeCase({ passbook: ok(passbook({ accountNumber: f('3012 3456 789') })) }),
      opts,
    );
    expect(r.flags.map((x) => x.code)).not.toContain('BANK_DETAILS_MISMATCH');
  });

  it('EPIC with a bad format → EPIC_FORMAT_INVALID for the officer', () => {
    const r = screenCase(makeCase({ epic: ok(epic({ epicNumber: f('MN12345678') })) }), opts);
    expect(r.flags.find((x) => x.code === 'EPIC_FORMAT_INVALID')).toMatchObject({
      action: 'officer',
    });
  });
});

describe('duplicate detection', () => {
  const existing = {
    caseId: 'case-0',
    aadhaarLast4: '4821',
    dob: '1948-05-12',
    applicantName: 'Ibemcha Devi Thokchom',
  };

  it('same last-4 + DOB + matching name → DUPLICATE_SUSPECTED for the officer', () => {
    const r = screenCase(makeCase(), { ...opts, existingCases: [existing] });
    const flag = r.flags.find((x) => x.code === 'DUPLICATE_SUSPECTED');
    expect(flag).toMatchObject({ severity: 'critical', action: 'officer' });
    expect(flag?.reason).toMatch(/case-0/);
    expect(r.status).toBe('OFFICER_ATTENTION');
  });

  it('different last-4, different DOB, different name, or same case id → no duplicate', () => {
    for (const other of [
      { ...existing, aadhaarLast4: '1111' },
      { ...existing, dob: '1950-01-01' },
      { ...existing, applicantName: 'Okram Tombi Devi' },
      { ...existing, caseId: 'case-1' },
    ]) {
      expect(codes(makeCase(), { ...opts, existingCases: [other] })).not.toContain(
        'DUPLICATE_SUSPECTED',
      );
    }
  });
});

describe('priority', () => {
  it('fresh case of a 78-year-old: only days pending count', () => {
    const r = screenCase(makeCase(), opts);
    expect(r.priorityScore).toBe(14);
    expect(r.priorityReasons).toEqual(['Pending 14 days']);
  });

  it('80+, widowed, disabled, displaced, long pending → capped at 100 with reasons', () => {
    const dob = f('1940-01-01');
    const c = makeCase({
      form: ok(
        form({
          dob,
          maritalStatus: f('widowed'),
          disability: f(true),
          internallyDisplaced: f(true),
        }),
      ),
      aadhaar: ok(aadhaar({ dob })),
      epic: ok(epic({ dob })),
    });
    c.receivedAt = '2026-06-01T00:00:00.000Z';
    const r = screenCase(c, opts);
    expect(r.priorityScore).toBe(100);
    expect(r.priorityReasons).toEqual([
      'Age 86 (80+)',
      'Widowed',
      'Person with disability',
      'Internally displaced',
      'Pending 130 days',
    ]);
  });
});

describe('status precedence and flag shape', () => {
  it('a citizen-critical flag wins over officer flags', () => {
    const r = screenCase(
      makeCase({ passbook: null, epic: ok(epic({ epicNumber: f('BAD') })) }),
      opts,
    );
    expect(r.status).toBe('NEEDS_CITIZEN_CORRECTION');
  });

  it('every flag has code, severity, action, plain-English reason and evidence', () => {
    const r = screenCase(
      makeCase({
        passbook: ok(passbook({ ifsc: f('XX'), accountHolderName: f('Okram Tomba') })),
        aadhaar: ok(aadhaar({ checksumValid: false, dob: f('1950-01-01') })),
        epic: { status: 'failed', error: 'boom' },
      }),
      { ...opts, existingCases: [] },
    );
    expect(r.flags.length).toBeGreaterThan(3);
    for (const flag of r.flags) {
      expect(FlagSchema.parse(flag)).toEqual(flag);
      expect(flag.reason.length).toBeGreaterThan(10);
      expect(flag.evidence.length).toBeGreaterThan(0);
    }
  });
});

describe('fallbacks', () => {
  it('without a form, Aadhaar becomes the name anchor', () => {
    const r = screenCase(
      makeCase({
        form: null,
        passbook: ok(passbook({ accountHolderName: f('Okram Tomba Singh') })),
      }),
      opts,
    );
    expect(r.flags.map((x) => x.code)).toEqual(
      expect.arrayContaining(['MISSING_DOCUMENT', 'BANK_HOLDER_NAME_MISMATCH']),
    );
    expect(r.facts.applicantName).toBe('Thokchom Ibemcha Devi');
  });

  it('when only year-of-birth is known, age is the minimum possible and flagged as info', () => {
    const dob = f('1948');
    const r = screenCase(
      makeCase({ form: ok(form({ dob })), aadhaar: ok(aadhaar({ dob })), epic: ok(epic({ dob })) }),
      opts,
    );
    expect(r.flags.find((x) => x.code === 'DOB_YEAR_ONLY')).toMatchObject({
      severity: 'info',
      action: 'none',
    });
    expect(r.facts.age).toBe(77);
    expect(r.status).toBe('READY');
  });

  it('an unreadable application date falls back to the screening date for age', () => {
    const r = screenCase(
      makeCase({ form: ok(form({ applicationDate: f('2026-09-20', 0.2) })) }),
      opts,
    );
    expect(r.facts.age).toBe(78);
    expect(r.flags.map((x) => x.code)).toContain('LOW_CONFIDENCE');
  });

  it('says "1 day" not "1 days"', () => {
    const c = makeCase();
    c.receivedAt = '2026-10-08T09:00:00.000Z';
    expect(screenCase(c, opts).priorityReasons).toEqual(['Pending 1 day']);
  });

  it('a case with no readable name anywhere gets no name flags and no crash', () => {
    const r = screenCase(
      makeCase({
        form: ok(form({ applicantName: f(null, 0.95) })),
        aadhaar: ok(aadhaar({ name: f(null, 0.95) })),
      }),
      opts,
    );
    expect(r.facts.applicantName).toBeNull();
    expect(r.flags.filter((x) => x.code.startsWith('NAME_'))).toEqual([]);
    expect(r.status).toBe('NEEDS_CITIZEN_CORRECTION');
  });
});
