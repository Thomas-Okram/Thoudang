/**
 * The hand-picked live-demo set (demo-packets/): good captures, one story per packet.
 * Order matters — demo-06 is a resubmission of demo-01 and is only flagged as a duplicate when
 * demo-01 was processed first.
 */
import type { PlanOptions } from './plan.js';

export const DEMO_SEED = 9102026;

export const DEMO_PACKETS: NonNullable<PlanOptions['scenarios']> = [
  {
    id: 'demo-01-clean',
    scenario: 'clean',
    originalOf: null,
    overrides: {
      person: { community: 'Meitei', gender: 'male', marital: 'widowed' },
      epic: true,
      noDisplacedOverlay: true,
    },
  },
  {
    id: 'demo-02-clean',
    scenario: 'clean',
    originalOf: null,
    overrides: {
      person: { community: 'Kuki-Zo', gender: 'female', marital: 'widowed' },
      epic: false,
      noDisplacedOverlay: true,
    },
  },
  {
    id: 'demo-03-ongbi-married-name',
    scenario: 'name_variant',
    originalOf: null,
    overrides: { nameVariant: 'ongbi_married_name', epic: true, noDisplacedOverlay: true },
  },
  {
    id: 'demo-04-kh-ambiguous',
    scenario: 'ambiguous_initials',
    originalOf: null,
    overrides: { abbr: 'kh', person: { gender: 'male' }, noDisplacedOverlay: true },
  },
  {
    id: 'demo-05-dob-mismatch',
    scenario: 'dob_mismatch',
    originalOf: null,
    overrides: { person: { community: 'Naga' }, epic: false, noDisplacedOverlay: true },
  },
  {
    id: 'demo-06-duplicate-of-01',
    scenario: 'duplicate',
    originalOf: 0,
    overrides: { noDisplacedOverlay: true },
  },
];
