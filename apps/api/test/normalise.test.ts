import { describe, expect, it } from 'vitest';
import { containsFullAadhaar } from '@thoudang/core';
import { normaliseExtraction } from '../src/extraction/normalise.js';
import { AADHAAR_LAST4, FULL_AADHAAR, PACKET, wireDoc } from './helpers.js';

const img = { width: 1000, height: 800 };

describe('normaliseExtraction — Aadhaar masking on extraction output', () => {
  it('masks the Aadhaar number immediately and keeps last 4 + checksum flag', () => {
    const doc = normaliseExtraction('aadhaar', wireDoc('aadhaar', PACKET.aadhaar), img);
    expect(doc.fields.aadhaar_number!.value).toBe(`XXXX XXXX ${AADHAAR_LAST4}`);
    expect(doc.aadhaar).toEqual({
      masked: `XXXX XXXX ${AADHAAR_LAST4}`,
      last4: AADHAAR_LAST4,
      checksumValid: true,
    });
    expect(containsFullAadhaar(JSON.stringify(doc))).toBe(false);
    expect(JSON.stringify(doc)).not.toContain(FULL_AADHAAR);
  });

  it('masks the Aadhaar number written on the application form too', () => {
    const doc = normaliseExtraction(
      'application_form',
      wireDoc('application_form', PACKET.application_form),
      img,
    );
    expect(doc.fields.aadhaar_number!.value).toBe(`XXXX XXXX ${AADHAAR_LAST4}`);
    expect(containsFullAadhaar(JSON.stringify(doc))).toBe(false);
  });

  it('redacts an Aadhaar number that leaks into notes or other free-text fields', () => {
    const wire = wireDoc(
      'aadhaar',
      { ...PACKET.aadhaar, address: `House 4 ${FULL_AADHAAR}` },
      { notes: `UID ${FULL_AADHAAR}` },
    );
    const doc = normaliseExtraction('aadhaar', wire, img);
    expect(doc.notes).toBe(`UID XXXX XXXX ${AADHAAR_LAST4}`);
    expect(containsFullAadhaar(JSON.stringify(doc))).toBe(false);
  });

  it('flags a bad checksum without leaking the number', () => {
    const bad = FULL_AADHAAR.slice(0, 11) + String((Number(FULL_AADHAAR[11]) + 1) % 10);
    const doc = normaliseExtraction(
      'aadhaar',
      wireDoc('aadhaar', { ...PACKET.aadhaar, aadhaar_number: bad }),
      img,
    );
    expect(doc.aadhaar?.checksumValid).toBe(false);
    expect(JSON.stringify(doc)).not.toContain(bad);
  });

  it('accepts a card that already prints a masked number', () => {
    const doc = normaliseExtraction(
      'aadhaar',
      wireDoc('aadhaar', { ...PACKET.aadhaar, aadhaar_number: 'xxxx xxxx 4821' }),
      img,
    );
    expect(doc.aadhaar).toEqual({ masked: 'XXXX XXXX 4821', last4: '4821', checksumValid: null });
  });

  it('a partially read number becomes a placeholder, never raw digits', () => {
    const doc = normaliseExtraction(
      'aadhaar',
      wireDoc('aadhaar', { ...PACKET.aadhaar, aadhaar_number: '2345 6789 01' }),
      img,
    );
    expect(doc.fields.aadhaar_number!.value).toBe('[unreadable Aadhaar number]');
    expect(doc.aadhaar?.last4).toBeNull();
  });

  it('leaves bank account numbers alone (12-digit accounts are legitimate)', () => {
    const doc = normaliseExtraction(
      'bank_passbook',
      wireDoc('bank_passbook', { ...PACKET.bank_passbook, account_number: '234567890123' }),
      img,
    );
    expect(doc.fields.account_number!.value).toBe('234567890123');
  });
});

describe('normaliseExtraction — field shape', () => {
  it('blank/unreadable → null; bbox validated and clamped', () => {
    const wire = wireDoc('epic', PACKET.epic);
    wire.fields.name = { value: 'garbled', status: 'unreadable', confidence: 'low', bbox: [] };
    wire.fields.relative_name = {
      value: '   ',
      status: 'present',
      confidence: 'high',
      bbox: [5, 5, 4000, 30],
    };
    wire.fields.epic_number = {
      value: 'MNP1234567',
      status: 'present',
      confidence: 'high',
      bbox: [50, 50, 10, 10],
    };
    const doc = normaliseExtraction('epic', wire, img);
    expect(doc.fields.name).toEqual({
      value: null,
      status: 'unreadable',
      confidence: 'low',
      bbox: null,
    });
    expect(doc.fields.relative_name).toMatchObject({
      value: null,
      status: 'blank',
      bbox: [5, 5, 1000, 30],
    });
    expect(doc.fields.epic_number!.bbox).toBeNull();
    expect(doc.aadhaar).toBeNull();
  });
});
