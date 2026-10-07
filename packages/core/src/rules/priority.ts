import type { PriorityConfig } from '../config.js';

export interface PriorityInputs {
  age: number | null;
  widowed: boolean;
  disability: boolean;
  internallyDisplaced: boolean;
  daysPending: number;
}

export interface PriorityResult {
  /** 0–100, higher = see sooner. */
  score: number;
  reasons: string[];
}

/** Transparent additive priority. Weights come from config/schemes.json. */
export function computePriority(input: PriorityInputs, config: PriorityConfig): PriorityResult {
  const w = config.weights;
  let score = 0;
  const reasons: string[] = [];
  if (input.age !== null && input.age >= config.advancedAge) {
    score += w.advancedAge;
    reasons.push(`Age ${input.age} (${config.advancedAge}+)`);
  }
  if (input.widowed) {
    score += w.widowed;
    reasons.push('Widowed');
  }
  if (input.disability) {
    score += w.disability;
    reasons.push('Person with disability');
  }
  if (input.internallyDisplaced) {
    score += w.internallyDisplaced;
    reasons.push('Internally displaced');
  }
  if (input.daysPending > 0) {
    score += Math.min(input.daysPending * w.perDayPending, w.maxDaysPendingPoints);
    reasons.push(`Pending ${input.daysPending} day${input.daysPending === 1 ? '' : 's'}`);
  }
  return { score: Math.min(100, Math.round(score)), reasons };
}
