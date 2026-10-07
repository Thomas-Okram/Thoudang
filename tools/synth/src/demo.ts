/**
 * The hand-picked live-demo set (demo-packets/): good captures, one story per packet.
 * Folder order = processing order:
 *  - demo-06 is a resubmission of demo-01 and is only flagged as a duplicate when demo-01 was
 *    processed first;
 *  - demo-07 (the "Thomas" packet) is the one uploaded LIVE on stage, after demo-01…06 have been
 *    primed into the queue. Never create a case for it before the demo, or the live upload is
 *    (correctly) flagged as a duplicate.
 * The two name stories (demo-04, demo-07) pin the exact names written on the documents; see
 * docs/pitch/SCRIPT.md.
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
    // "Kh." could be Khuraijam, Khwairakpam, … and the father's name is left blank, so nothing
    // in the packet narrows it → AMBIGUOUS → Officer attention.
    id: 'demo-04-kh-loken-ambiguous',
    scenario: 'ambiguous_initials',
    originalOf: null,
    overrides: {
      abbr: 'kh',
      person: { community: 'Meitei', gender: 'male', clans: ['Khuraijam'] },
      names: {
        applicant: 'Kh. Loken Singh',
        relative: null,
        aadhaar: 'Khuraijam Loken Singh',
        passbook: 'KHURAIJAM LOKEN SINGH',
      },
      noDisplacedOverlay: true,
    },
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
  {
    // "O." alone could be Okram or Oinam; the father's FULL yumnak on the form (Okram) resolves
    // it (core knownYumnaks) → SAME on every pair → READY.
    id: 'demo-07-thomas-o-resolved-by-father',
    scenario: 'name_variant',
    originalOf: null,
    overrides: {
      nameVariant: 'abbreviation_resolved_by_relative',
      abbr: 'o',
      person: {
        community: 'Meitei',
        gender: 'male',
        marital: 'married',
        clans: ['Okram'],
        district: 'Imphal West',
      },
      names: {
        applicant: 'O. Thomas Meitei',
        relative: 'Okram Ibomcha Singh',
        aadhaar: 'Okram Thomas Meitei',
        passbook: 'THOMAS OKRAM',
      },
      epic: false,
      noDisplacedOverlay: true,
    },
  },
];
