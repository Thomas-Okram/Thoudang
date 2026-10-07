import { describe, expect, it } from 'vitest';
import { describeAudit, modelLabel } from '../src/audit-summary.js';

const row = (action: string, after: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
  ({
    id: 1,
    caseId: 'c',
    actor: 'system:claude',
    action,
    entityType: 'document',
    entityId: 'd',
    before: null,
    after,
    reason: null,
    createdAt: new Date(),
    ...extra,
  }) as never;
const ctx = {
  officerName: () => null,
  document: () => ({ originalName: 'form.jpg', detectedType: 'application_form' as const }),
};

describe('audit summaries', () => {
  it('labels models', () => {
    expect(modelLabel('claude-sonnet-5-5')).toBe('Sonnet 5.5');
    expect(modelLabel('claude-opus-5')).toBe('Opus 5');
    expect(modelLabel('fixture-truth')).toBe('Fixture data, no AI');
  });

  it('never calls fixture data "AI extracted"', () => {
    const s = describeAudit(
      row('AI_EXTRACTION', { ok: true, model: 'fixture-truth', fieldsRead: 18, cacheHit: true }),
      ctx,
    );
    expect(s).toBe('Fixture data loaded for Application form (18 fields from truth.json — no AI)');
    expect(
      describeAudit(
        row('AI_EXTRACTION', {
          ok: true,
          model: 'claude-sonnet-5-5',
          fieldsRead: 18,
          latencyMs: 6100,
        }),
        ctx,
      ),
    ).toBe('AI extracted 18 fields from Application form (Sonnet 5.5, 6.1s)');
  });
});
