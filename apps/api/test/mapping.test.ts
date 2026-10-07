import { describe, expect, it } from 'vitest';
import { screenCase } from '@thoudang/core';
import { normaliseExtraction } from '../src/extraction/normalise.js';
import type { ExtractableType } from '../src/extraction/schemas.js';
import {
  inferDisplaced,
  mergeDocuments,
  parseGender,
  parseIncome,
  parseMaritalStatus,
  parseYesNo,
  toExtractedCase,
  type DocOutcome,
} from '../src/pipeline/mapping.js';
import { AADHAAR_LAST4, PACKET, wireDoc } from './helpers.js';

const img = { width: 1000, height: 800 };
const doc = (type: ExtractableType, over: Record<string, string | null> = {}) =>
  normaliseExtraction(type, wireDoc(type, { ...PACKET[type], ...over }), img);
const extracted = (
  type: ExtractableType,
  over: Record<string, string | null> = {},
): DocOutcome => ({
  kind: 'extracted',
  type,
  doc: doc(type, over),
});
const fullPacket = (): DocOutcome[] => [
  extracted('application_form'),
  extracted('aadhaar'),
  extracted('bank_passbook'),
  extracted('epic'),
];
const RECEIVED = new Date('2026-09-25T10:00:00Z');
const TODAY = '2026-10-09';

describe('parsers', () => {
  it.each([
    ['Female', 'female'],
    ['MALE', 'male'],
    ['महिला / Female', 'female'],
    ['F', 'female'],
    ['?', null],
  ])('gender %s → %s', (raw, want) => expect(parseGender(raw)).toBe(want));

  it.each([
    ['Rs. 24,000/-', 24000],
    ['₹ 1,20,000', 120000],
    ['Nil', 0],
    ['twenty thousand', null],
  ])('income %s → %s', (raw, want) => expect(parseIncome(raw)).toBe(want));

  it('yes/no, disability and marital status', () => {
    expect(parseYesNo('No')).toBe(false);
    expect(parseYesNo('Yes – 60% locomotor')).toBe(true);
    expect(parseYesNo('maybe')).toBeNull();
    expect(parseMaritalStatus('Widow')).toBe('widowed');
    expect(parseMaritalStatus('Married')).toBe('married');
    expect(parseMaritalStatus('Unmarried')).toBe('unmarried');
  });

  it('relief-camp addresses mark internally displaced applicants (priority only)', () => {
    const v = (value: string | null) => ({
      value,
      status: 'present' as const,
      confidence: 'high' as const,
      bbox: null,
    });
    expect(inferDisplaced(v('Relief Camp, Moirang College')).value).toBe(true);
    expect(inferDisplaced(v('Wangkhei, Imphal')).value).toBe(false);
  });
});

describe('toExtractedCase → screenCase', () => {
  it('a clean synthetic packet screens READY with the facts from the documents', () => {
    const result = screenCase(toExtractedCase('c1', RECEIVED, fullPacket()), { today: TODAY });
    expect(result.flags.filter((f) => f.severity !== 'info')).toEqual([]);
    expect(result.status).toBe('READY');
    expect(result.facts).toMatchObject({
      applicantName: 'Thokchom Ibemcha Devi',
      dob: '1948-05-12',
      age: 78,
      aadhaarLast4: AADHAAR_LAST4,
    });
    expect(result.priorityReasons).toContain('Widowed');
  });

  it('EPIC "Age as on …" is never turned into a date of birth', () => {
    const c = toExtractedCase('c1', RECEIVED, fullPacket());
    expect(c.documents.epic?.status === 'ok' && c.documents.epic.fields.dob.value).toBeNull();
  });

  it('a present but unparseable date becomes a low-confidence read (officer), not a blank (citizen)', () => {
    const c = toExtractedCase('c1', RECEIVED, [
      extracted('application_form', { date_of_birth: '12th May, nineteen forty-eight' }),
      extracted('aadhaar'),
      extracted('bank_passbook'),
    ]);
    const r = screenCase(c, { today: TODAY });
    expect(r.flags.map((f) => f.code)).toContain('LOW_CONFIDENCE');
    expect(r.flags.map((f) => f.code)).not.toContain('MISSING_FIELD');
  });

  it('extraction failure for a document → EXTRACTION_FAILED → OFFICER_ATTENTION', () => {
    const outcomes: DocOutcome[] = [
      extracted('application_form'),
      { kind: 'extraction_failed', type: 'aadhaar', error: 'Claude API timed out' },
      extracted('bank_passbook'),
    ];
    const r = screenCase(toExtractedCase('c1', RECEIVED, outcomes), { today: TODAY });
    const flag = r.flags.find((f) => f.code === 'EXTRACTION_FAILED');
    expect(flag?.reason).toMatch(/extraction failed — manual review/i);
    expect(r.status).toBe('OFFICER_ATTENTION');
  });

  it('an unidentified image never produces a "missing document" notice for the citizen', () => {
    const outcomes: DocOutcome[] = [
      extracted('application_form'),
      extracted('bank_passbook'),
      { kind: 'unidentified', error: 'timeout' },
    ];
    const r = screenCase(toExtractedCase('c1', RECEIVED, outcomes), { today: TODAY });
    expect(r.flags.map((f) => f.code)).not.toContain('MISSING_DOCUMENT');
    expect(r.flags.find((f) => f.code === 'EXTRACTION_FAILED')?.reason).toMatch(/Aadhaar card/);
    expect(r.status).toBe('OFFICER_ATTENTION');
  });

  it('a genuinely missing passbook (all images identified) is a citizen correction', () => {
    const r = screenCase(
      toExtractedCase('c1', RECEIVED, [extracted('application_form'), extracted('aadhaar')]),
      { today: TODAY },
    );
    expect(r.flags.find((f) => f.code === 'MISSING_DOCUMENT')?.action).toBe('citizen');
    expect(r.status).toBe('NEEDS_CITIZEN_CORRECTION');
  });

  it('merges two images of the same type (Aadhaar front + back)', () => {
    const front = doc('aadhaar', { address: null });
    const back = doc('aadhaar', {
      name: null,
      dob_or_yob: null,
      gender: null,
      aadhaar_number: null,
    });
    const merged = mergeDocuments([front, back]);
    expect(merged.fields.name!.value).toBe('Thokchom Ibemcha Devi');
    expect(merged.fields.address!.value).toBe('Wangkhei, Imphal East, Manipur');
    expect(merged.aadhaar?.last4).toBe(AADHAAR_LAST4);
  });
});
