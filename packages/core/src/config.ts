import { z } from 'zod';
import raw from '../config/schemes.json';
import { DocTypeSchema } from './types.js';

const SchemeSchema = z.object({
  name: z.string(),
  minAge: z.number().int().positive(),
  annualIncomeCeiling: z.number().nonnegative(),
  requiredDocuments: z.array(DocTypeSchema).min(1),
  optionalDocuments: z.array(DocTypeSchema).default([]),
  verified: z.boolean(),
  sourceNote: z.string(),
});

const SchemeConfigSchema = z.object({
  defaultScheme: z.string(),
  schemes: z.record(z.string(), SchemeSchema),
  screening: z.object({ minFieldConfidence: z.number().min(0).max(1) }),
  priority: z.object({
    advancedAge: z.number().int().positive(),
    weights: z.object({
      advancedAge: z.number(),
      widowed: z.number(),
      disability: z.number(),
      internallyDisplaced: z.number(),
      perDayPending: z.number(),
      maxDaysPendingPoints: z.number(),
    }),
  }),
});

export type SchemeConfig = z.infer<typeof SchemeConfigSchema>;
export type SchemeRules = z.infer<typeof SchemeSchema> & { code: string };
export type PriorityConfig = SchemeConfig['priority'];

/** Parsed and validated at import time — a malformed config fails fast, not mid-demo. */
export const schemeConfig: SchemeConfig = SchemeConfigSchema.parse(raw);

export function getSchemeRules(code: string = schemeConfig.defaultScheme): SchemeRules {
  const scheme = schemeConfig.schemes[code];
  if (!scheme) throw new Error(`Unknown scheme code: ${code}`);
  return { ...scheme, code };
}
