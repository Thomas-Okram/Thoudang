import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { CaseProgressCard } from '../CaseProgressCard';
import type { CaseProgress } from '../../lib/progress';

const DONE: CaseProgress = {
  caseId: 'c1',
  reference: 'THD-2026-0009',
  stage: 'done',
  status: 'READY',
  startedAt: 1000,
  finishedAt: 1040,
  docs: {
    d1: {
      id: 'd1',
      name: 'form.jpg',
      stage: 'extracted',
      type: 'application_form',
      cacheHit: true,
    },
  },
};

const states = () =>
  Array.from(
    screen.getByRole('list', { name: 'Screening progress' }).querySelectorAll('li'),
    (li) => li.getAttribute('data-state'),
  );

describe('CaseProgressCard', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('an instant (cached) run still ticks through every stage, one at a time', () => {
    render(
      <MemoryRouter>
        <CaseProgressCard c={DONE} />
      </MemoryRouter>,
    );
    expect(states()).toEqual(['active', 'pending', 'pending', 'pending', 'pending']);
    expect(screen.queryByRole('link', { name: /Open case/ })).toBeNull();
    const seen: string[] = [];
    for (let i = 0; i < 30; i++) {
      act(() => vi.advanceTimersByTime(100));
      const now = states().join();
      if (seen.at(-1) !== now) seen.push(now);
    }
    // Each intermediate frame completes exactly one more stage.
    expect(seen).toEqual([
      'active,pending,pending,pending,pending',
      'done,active,pending,pending,pending',
      'done,done,active,pending,pending',
      'done,done,done,active,pending',
      'done,done,done,done,active',
      'done,done,done,done,done',
    ]);
    expect(states()).toEqual(['done', 'done', 'done', 'done', 'done']);
    expect(screen.getByRole('link', { name: /Open case/ }).getAttribute('href')).toBe('/cases/c1');
  });

  it('shows the real elapsed time, not the paced animation time', () => {
    render(
      <MemoryRouter>
        <CaseProgressCard c={DONE} />
      </MemoryRouter>,
    );
    expect(screen.getByLabelText('Elapsed 0.0 seconds')).toBeTruthy();
  });
});
