/**
 * Fictional applicants and the ways their names are written on different documents.
 */
import { verhoeffCheckDigit } from '@thoudang/core';
import {
  BANKS,
  BRANCHES,
  COMMUNITY_DISTRICTS,
  COMMUNITY_WEIGHTS,
  DISTRICTS,
  EPIC_PREFIXES,
  GIVEN,
  RELIEF_CAMPS,
  abbrDisplay,
  surnamesFor,
  type Community,
} from './data.js';
import type { Rng } from './rng.js';

export type Gender = 'male' | 'female';
export type Marital = 'married' | 'widowed' | 'unmarried';

export interface Person {
  community: Community;
  gender: Gender;
  /** Given name (may be two words for Pangal names: "Abdul Rahim"). */
  given: string;
  /** Yumnak / clan / family name. Married Meitei women: the husband's yumnak. Pangal: may be null. */
  clan: string | null;
  /** Married Meitei women: father's yumnak (used for "Ningol" and maiden names). */
  natalClan: string | null;
  /** Singh / Devi / Chanu / Begum / Bibi, or null (Naga, Kuki-Zo). */
  marker: string | null;
  marital: Marital;
  /** Father (unmarried / men) or husband (married / widowed women). */
  relative: { given: string; isHusband: boolean; late: boolean };
  /** ISO date of birth. */
  dob: string;
  district: string;
  locality: string;
  /** Present when the applicant lives in a relief camp (internally displaced). */
  reliefCamp: { venue: string; district: string } | null;
  mobile: string;
  /** 12 digits, Verhoeff-valid. Kept in memory only; truth.json stores the masked form. */
  aadhaar: string;
  bank: { name: string; ifsc: string; branch: string; account: string };
  epicNumber: string;
}

export interface PersonOptions {
  community?: Community;
  gender?: Gender;
  marital?: Marital;
  /** Restrict the clan (Meitei yumnak) to this list. */
  clans?: readonly string[];
  /** Pin the home district (a key of DISTRICTS). The random draw still happens (determinism). */
  district?: string;
  /** Age on the application date, in completed years. */
  age: number;
  applicationDate: string;
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

/** A DOB that makes the person exactly `age` (completed years) on `applicationDate`. */
export function dobForAge(rng: Rng, age: number, applicationDate: string): string {
  const app = new Date(`${applicationDate}T00:00:00Z`);
  const latest = new Date(
    Date.UTC(app.getUTCFullYear() - age, app.getUTCMonth(), app.getUTCDate()),
  );
  // Birthdays in (latest - 1 year, latest]: completed years == age.
  const offset = rng.int(0, 364);
  return iso(new Date(latest.getTime() - offset * 86_400_000));
}

export function ageOnDate(dob: string, onDate: string): number {
  const [by, bm, bd] = dob.split('-').map(Number) as [number, number, number];
  const [ry, rm, rd] = onDate.split('-').map(Number) as [number, number, number];
  let years = ry - by;
  if (rm < bm || (rm === bm && rd < bd)) years -= 1;
  return years;
}

export const digits = (rng: Rng, n: number) =>
  Array.from({ length: n }, () => String(rng.int(0, 9))).join('');

/** Fake but Verhoeff-valid Aadhaar-format number (first digit 2–9). */
export function fakeAadhaar(rng: Rng): string {
  const body = String(rng.int(2, 9)) + digits(rng, 10);
  return body + verhoeffCheckDigit(body);
}

/** Same body, wrong check digit — fails the Verhoeff checksum. */
export function invalidateAadhaar(n: string): string {
  const body = n.slice(0, 11);
  const good = Number(verhoeffCheckDigit(body));
  return body + String((good + 1 + (Number(body.at(-1)) % 8)) % 10);
}

function pickClan(rng: Rng, community: Community, clans?: readonly string[]): string | null {
  if (clans?.length) return rng.pick(clans);
  if (community === 'Pangal') return rng.chance(0.4) ? rng.pick(surnamesFor('Pangal')) : null;
  return rng.pick(surnamesFor(community));
}

function markerFor(
  rng: Rng,
  community: Community,
  gender: Gender,
  marital: Marital,
): string | null {
  if (community === 'Meitei') {
    if (gender === 'male') return 'Singh';
    return marital === 'unmarried' ? rng.pick(['Devi', 'Chanu']) : 'Devi';
  }
  if (community === 'Pangal') return gender === 'female' ? rng.pick(['Begum', 'Bibi']) : null;
  return null;
}

export function makePerson(rng: Rng, opts: PersonOptions): Person {
  const community = opts.community ?? rng.weighted(COMMUNITY_WEIGHTS);
  const gender = opts.gender ?? (rng.chance(0.56) ? 'female' : 'male');
  const marital =
    opts.marital ??
    (gender === 'female'
      ? rng.weighted({ widowed: 0.5, married: 0.42, unmarried: 0.08 })
      : rng.weighted({ married: 0.62, widowed: 0.33, unmarried: 0.05 }));
  const names = GIVEN[community];
  const given = rng.pick(gender === 'female' ? names.female : names.male);
  const clan = pickClan(rng, community, opts.clans);
  const marriedWoman = gender === 'female' && marital !== 'unmarried';
  let natalClan: string | null = null;
  if (community === 'Meitei' && marriedWoman) {
    // Meitei clan exogamy: the natal yumnak differs from the husband's.
    const others = surnamesFor('Meitei').filter((s) => s !== clan);
    natalClan = rng.pick(others);
  }
  let relGiven: string = rng.pick(names.male);
  while (relGiven === given) relGiven = rng.pick(names.male);
  const drawnDistrict = rng.weighted(COMMUNITY_DISTRICTS[community]);
  if (opts.district !== undefined && !DISTRICTS[opts.district]) {
    throw new Error(`Unknown district "${opts.district}"`);
  }
  const district = opts.district ?? drawnDistrict;
  const bankDef = BANKS[pickBankIndex(rng)]!;
  const accountLength = bankDef.prefix === 'SBIN' ? 11 : rng.pick([13, 14, 15]);
  return {
    community,
    gender,
    given,
    clan,
    natalClan,
    marker: markerFor(rng, community, gender, marital),
    marital,
    relative: {
      given: relGiven,
      isHusband: marriedWoman,
      // Elderly applicants' fathers are usually deceased; widows' husbands always are.
      late: marriedWoman ? marital === 'widowed' : rng.chance(0.85),
    },
    dob: dobForAge(rng, opts.age, opts.applicationDate),
    district,
    locality: rng.pick(DISTRICTS[district]!),
    reliefCamp: null,
    mobile: String(rng.int(6, 9)) + digits(rng, 9),
    aadhaar: fakeAadhaar(rng),
    bank: {
      name: bankDef.name,
      ifsc: `${bankDef.prefix}0${digits(rng, 6)}`,
      branch: rng.pick(BRANCHES[district]!),
      account: String(rng.int(1, 9)) + digits(rng, accountLength - 1),
    },
    epicNumber: rng.pick(EPIC_PREFIXES) + digits(rng, 7),
  };
}

function pickBankIndex(rng: Rng): number {
  const weights = Object.fromEntries(BANKS.map((b, i) => [String(i), b.weight]));
  return Number(rng.weighted(weights));
}

export function makeDisplaced(rng: Rng, p: Person): Person {
  const camp = rng.pick(RELIEF_CAMPS[p.community]);
  return { ...p, reliefCamp: camp };
}

/** The same number with two of its last four digits swapped — a typical copying slip. */
export function miswrittenAadhaar(n: string): string {
  const d = [...n];
  for (const [i, j] of [
    [9, 10],
    [10, 11],
    [8, 9],
  ] as const) {
    if (d[i] !== d[j]) {
      [d[i], d[j]] = [d[j]!, d[i]!];
      return d.join('');
    }
  }
  d[10] = String((Number(d[10]) + 3) % 10);
  return d.join('');
}

// ---------------------------------------------------------------------------------------------
// Names as written on documents
// ---------------------------------------------------------------------------------------------

export type NameStyle =
  | 'canonical'
  /** Yumnak abbreviated: "Kh. Loken Singh". */
  | 'abbrev'
  /** Given name first, clan last (Meitei) / clan first (Naga, Kuki-Zo). */
  | 'swap'
  /** Singh / Devi / Chanu dropped; Begum ↔ Bibi for Pangal women. */
  | 'dropMarker'
  /** "Okram Ongbi Ibemcha Devi" (married name with Ongbi). */
  | 'ongbi'
  /** "Laishram Ningol Okram Ongbi Ibemcha Devi" (natal + married). */
  | 'ningolOngbi'
  /** Pre-marriage name "Laishram Ibemcha Chanu". */
  | 'maiden'
  /** Pangal: "Mohammad" written in full / "Md." / family name dropped. */
  | 'mdLong'
  | 'dropFamily';

export function nameAs(p: Person, style: NameStyle, abbr?: string): string {
  const { given, clan, marker } = p;
  const join = (...parts: (string | null | undefined)[]) => parts.filter(Boolean).join(' ');
  if (p.community === 'Pangal') {
    const md = style === 'mdLong' ? 'Mohammad' : 'Md.';
    if (p.gender === 'female') {
      const m = style === 'dropMarker' ? (marker === 'Begum' ? 'Bibi' : 'Begum') : marker;
      if (style === 'swap') return join(given, m, clan);
      return join(style === 'dropFamily' ? null : clan, given, m);
    }
    if (style === 'swap') return join(md, given, clan);
    return join(style === 'dropFamily' ? null : clan, md, given);
  }
  if (p.community === 'Naga' || p.community === 'Kuki-Zo') {
    return style === 'swap' ? join(clan, given) : join(given, clan);
  }
  // Meitei
  switch (style) {
    case 'abbrev':
      if (!abbr) throw new Error('abbrev style needs an abbreviation');
      return join(abbrDisplay(abbr), given, marker);
    case 'swap':
      return join(given, marker, clan);
    case 'dropMarker':
      return join(clan, given);
    case 'ongbi':
      return join(clan, 'Ongbi', given, 'Devi');
    case 'ningolOngbi':
      return join(p.natalClan, 'Ningol', clan, 'Ongbi', given, 'Devi');
    case 'maiden':
      return join(p.natalClan, given, 'Chanu');
    default:
      return join(clan, given, marker);
  }
}

/** Father's / husband's name as written (without "Late"). */
export function relativeName(p: Person, abbr?: string): string {
  const g = p.relative.given;
  if (p.community === 'Pangal') return p.clan ? `${p.clan} Md. ${g}` : `Md. ${g}`;
  if (p.community === 'Naga' || p.community === 'Kuki-Zo') return `${g} ${p.clan}`;
  return abbr ? `${abbrDisplay(abbr)} ${g} Singh` : `${p.clan} ${g} Singh`;
}

/** A son of the applicant (same clan, different given name) — for bank-holder mismatches. */
export function sonName(rng: Rng, p: Person): string {
  const pool = GIVEN[p.community].male.filter((g) => g !== p.given && g !== p.relative.given);
  const g = rng.pick(pool);
  if (p.community === 'Pangal') return p.clan ? `${p.clan} Md. ${g}` : `Md. ${g}`;
  if (p.community === 'Naga' || p.community === 'Kuki-Zo') return `${g} ${p.clan}`;
  return `${p.clan} ${g} Singh`;
}

export function homeAddress(p: Person): string {
  return `${p.locality}, ${p.district}`;
}

export function formAddress(p: Person): string {
  return p.reliefCamp
    ? `Relief Camp, ${p.reliefCamp.venue}, ${p.reliefCamp.district}`
    : homeAddress(p);
}

export function formDistrict(p: Person): string {
  return p.reliefCamp ? p.reliefCamp.district : p.district;
}

export function category(rng: Rng, p: Person): string {
  if (p.community === 'Naga' || p.community === 'Kuki-Zo') return 'ST';
  if (p.community === 'Pangal') return 'OBC';
  return rng.weighted({ General: 0.6, OBC: 0.3, SC: 0.1 });
}
