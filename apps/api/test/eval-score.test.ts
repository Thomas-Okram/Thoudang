import { describe, expect, it } from 'vitest';
import {
  fieldMatches,
  formatReport,
  scorePacket,
  summarise,
  TruthSchema,
} from '../src/eval/score.js';

const truth = TruthSchema.parse({
  expected_status: 'OFFICER_ATTENTION',
  documents: {
    'form.jpg': {
      type: 'application_form',
      fields: {
        applicant_name: 'Kh. Loken Singh',
        date_of_birth: '03/02/1950',
        annual_income: 'Rs. 30,000/-',
        district: null,
      },
    },
    'aadhaar.jpg': {
      type: 'aadhaar',
      fields: { name: 'Khuraijam Loken Singh', aadhaar_number: 'XXXX XXXX 1234' },
    },
  },
  name_checks: [{ a: 'form.jpg:applicant_name', b: 'aadhaar.jpg:name', expected: 'AMBIGUOUS' }],
});

describe('eval scoring', () => {
  it('compares fields by meaning, not formatting', () => {
    expect(fieldMatches('date_of_birth', '03/02/1950', '1950-02-03')).toBe(true);
    expect(fieldMatches('annual_income', 'Rs. 30,000/-', '30000')).toBe(true);
    expect(fieldMatches('account_number', '3012 3456 789', '30123456789')).toBe(true);
    expect(fieldMatches('applicant_name', 'Kh. Loken Singh', 'KH LOKEN SINGH')).toBe(true);
    expect(fieldMatches('applicant_name', 'Kh. Loken Singh', 'Khuraijam Loken Singh')).toBe(false);
    expect(fieldMatches('district', null, null)).toBe(true);
    expect(fieldMatches('district', null, 'Imphal')).toBe(false);
  });

  it('scores a packet and summarises accuracy, latency and cost', () => {
    const score = scorePacket(
      'p1',
      truth,
      [
        {
          fileName: 'form.jpg',
          detectedType: 'application_form',
          fields: {
            applicant_name: { value: 'Kh. Loken Singh', confidence: 'high' },
            date_of_birth: { value: '03/02/1950', confidence: 'high' },
            annual_income: { value: '30,000', confidence: 'medium' },
            district: { value: 'Imphal West', confidence: 'low' },
          },
        },
        {
          fileName: 'aadhaar.jpg',
          detectedType: 'aadhaar',
          fields: {
            name: { value: 'Khuraijam Loken Singh', confidence: 'high' },
            aadhaar_number: { value: 'XXXX XXXX 1234', confidence: 'high' },
          },
        },
      ],
      'OFFICER_ATTENTION',
    );
    expect(score.fields.filter((f) => !f.correct).map((f) => f.field)).toEqual(['district']);
    expect(score.names[0]).toMatchObject({ actual: 'AMBIGUOUS', correct: true });
    const summary = summarise(
      [score],
      {
        packets: 1,
        apiCalls: 4,
        cacheHits: 0,
        inputTokens: 1_000_000,
        outputTokens: 100_000,
        apiLatencyMs: [1000, 3000],
        packetWallMs: [9000],
      },
      { inputPerMTok: 2, outputPerMTok: 10 },
    );
    expect(summary.fieldAccuracy).toBeCloseTo(5 / 6);
    expect(summary.statusAccuracy).toBe(1);
    expect(summary.classificationAccuracy).toBe(1);
    expect(summary.cost.totalUsd).toBe(3);
    expect(summary.latency).toEqual({ avgApiCallMs: 2000, avgPacketWallMs: 9000 });
    expect(summary.byConfidence.find((r) => r.key === 'low')).toEqual({
      key: 'low',
      n: 1,
      accuracy: 0,
    });
    expect(formatReport(summary)).toContain('Field accuracy:          83.3%');
  });

  it('a missing document scores its fields as wrong', () => {
    const s = scorePacket('p2', truth, [], 'READY');
    expect(s.fields.every((f) => !f.correct)).toBe(true);
    expect(s.status.correct).toBe(false);
  });
});
