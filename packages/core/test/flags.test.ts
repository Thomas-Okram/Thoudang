import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FLAG_TITLES, flagTitle } from '../src/index.js';

describe('flag titles', () => {
  it('every flag code emitted by the rules engine has a human title', () => {
    const src = fs.readFileSync(new URL('../src/rules/screen.ts', import.meta.url), 'utf8');
    const codes = new Set([...src.matchAll(/'([A-Z][A-Z0-9_]{4,})'/g)].map((m) => m[1]!));
    // Statuses and name verdicts are string literals in the same file, not flag codes.
    for (const notAFlag of [
      'APPROVED_BY_OFFICER',
      'NEEDS_CITIZEN_CORRECTION',
      'OFFICER_ATTENTION',
      'READY',
      'SAME',
      'LIKELY_SAME',
      'AMBIGUOUS',
      'DIFFERENT',
    ]) {
      codes.delete(notAFlag);
    }
    const missing = [...codes].filter((c) => !(c in FLAG_TITLES));
    expect(missing).toEqual([]);
  });

  it('falls back to a readable title for unknown codes', () => {
    expect(flagTitle('SOMETHING_NEW')).toBe('Something new');
  });
});
