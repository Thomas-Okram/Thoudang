/**
 * Packet specifications: what each document says (= ground truth), which problem is planted,
 * and what the screening outcome is INTENDED to be. `expect.ts` checks the intent against the
 * real rules engine; packets that do not behave as intended are re-rolled.
 */
import { ambiguousAbbreviations, surnamesFor, uniqueAbbreviations } from './data.js';
import {
  ageOnDate,
  category,
  formAddress,
  formDistrict,
  homeAddress,
  invalidateAadhaar,
  makeDisplaced,
  makePerson,
  nameAs,
  type PersonOptions,
  relativeName,
  sonName,
  miswrittenAadhaar,
  type NameStyle,
  type Person,
} from './people.js';
import type { Rng } from './rng.js';

export const SCENARIOS = [
  'clean',
  'name_variant',
  'ambiguous_initials',
  'age_ineligible',
  'income_ineligible',
  'missing_document',
  'blank_field',
  'missing_signature',
  'bank_holder_mismatch',
  'dob_mismatch',
  'aadhaar_last4_mismatch',
  'aadhaar_checksum_invalid',
  'duplicate',
  'displaced',
] as const;
export type Scenario = (typeof SCENARIOS)[number];

export type ExpectedStatus = 'READY' | 'NEEDS_CITIZEN_CORRECTION' | 'OFFICER_ATTENTION';

export const SCENARIO_INTENT: Record<Scenario, { status: ExpectedStatus; flag: string | null }> = {
  clean: { status: 'READY', flag: null },
  name_variant: { status: 'READY', flag: null },
  displaced: { status: 'READY', flag: null },
  ambiguous_initials: { status: 'OFFICER_ATTENTION', flag: 'NAME_AMBIGUOUS' },
  age_ineligible: { status: 'OFFICER_ATTENTION', flag: 'AGE_BELOW_MINIMUM' },
  income_ineligible: { status: 'OFFICER_ATTENTION', flag: 'INCOME_ABOVE_CEILING' },
  aadhaar_last4_mismatch: { status: 'OFFICER_ATTENTION', flag: 'AADHAAR_FORM_CARD_MISMATCH' },
  aadhaar_checksum_invalid: { status: 'OFFICER_ATTENTION', flag: 'AADHAAR_CHECKSUM_INVALID' },
  duplicate: { status: 'OFFICER_ATTENTION', flag: 'DUPLICATE_SUSPECTED' },
  missing_document: { status: 'NEEDS_CITIZEN_CORRECTION', flag: 'MISSING_DOCUMENT' },
  blank_field: { status: 'NEEDS_CITIZEN_CORRECTION', flag: 'MISSING_FIELD' },
  missing_signature: { status: 'NEEDS_CITIZEN_CORRECTION', flag: 'MISSING_SIGNATURE' },
  bank_holder_mismatch: {
    status: 'NEEDS_CITIZEN_CORRECTION',
    flag: 'BANK_HOLDER_NAME_MISMATCH',
  },
  dob_mismatch: { status: 'NEEDS_CITIZEN_CORRECTION', flag: 'DOB_MISMATCH' },
};

export const FORM_FIELDS = [
  'applicant_name',
  'father_or_husband_name',
  'address',
  'district',
  'category',
  'aadhaar_number',
  'mobile',
  'date_of_birth',
  'age',
  'marital_status_if_stated',
  'disability_if_stated',
  'annual_income',
  'bank_name',
  'branch',
  'account_number',
  'ifsc',
  'application_date',
  'signature_present',
] as const;
export type FormField = (typeof FORM_FIELDS)[number];

export type Font = 'Caveat' | 'Kalam' | 'Patrick Hand';

/** How the person (or the helper at the office) filled in the form. */
export interface Writer {
  font: Font;
  ink: string;
  size: number;
  caps: boolean;
  dateSep: '/' | '-' | '.';
  incomeStyle: 'rs-comma' | 'plain-dash' | 'rs-plain';
}

export interface FormSpec {
  /** Values exactly as written; null = blank. aadhaar_number holds the FULL number (render only). */
  fields: Record<FormField, string | null>;
  signature: 'signature' | 'thumb' | null;
  place: string;
}
export interface AadhaarSpec {
  name: string;
  /** As printed: "12/05/1948" or "1948". */
  dob: string;
  dobLabel: 'DOB' | 'Year of Birth';
  gender: 'Female' | 'Male';
  /** FULL 12-digit number — rendered on the image only, masked in truth.json. */
  number: string;
  address: string;
}
export interface PassbookSpec {
  holder: string;
  account: string;
  ifsc: string;
  bank: string;
  branch: string;
  address: string;
  cif: string;
}
export interface EpicSpec {
  number: string;
  name: string;
  relLabel: "Father's Name" | "Husband's Name";
  relative: string;
  dobOrAge: string;
}

export type NameIntent = 'same' | 'different' | 'ambiguous';

export interface PacketSpec {
  scenario: Scenario;
  /** Human-readable list of what was planted (for truth.json + manifest). */
  plants: string[];
  description: string;
  person: Person;
  writer: Writer;
  form: FormSpec | null;
  aadhaar: AadhaarSpec | null;
  passbook: PassbookSpec | null;
  epic: EpicSpec | null;
  /** Per name check (keyed "form:aadhaar", "form:passbook", "form:epic"): ground truth intent. */
  nameIntent: Partial<Record<'aadhaar' | 'passbook' | 'epic', NameIntent>>;
  duplicateOf: number | null;
}

const pad = (n: number) => String(n).padStart(2, '0');

export function formatDate(isoDate: string, sep: string): string {
  const [y, m, d] = isoDate.split('-');
  return `${d}${sep}${m}${sep}${y}`;
}

export function formatIncome(amount: number, style: Writer['incomeStyle']): string {
  if (amount === 0) return 'Nil';
  const grouped = amount.toLocaleString('en-IN');
  if (style === 'rs-comma') return `Rs. ${grouped}/-`;
  if (style === 'plain-dash') return `${amount}/-`;
  return `Rs ${amount}`;
}

export function makeWriter(rng: Rng): Writer {
  const font = rng.weighted({ Caveat: 0.4, Kalam: 0.3, 'Patrick Hand': 0.3 }) as Font;
  return {
    font,
    ink: rng.pick(['#1a3c8f', '#22378a', '#1d2f6f', '#283593', '#222222', '#2b2b33']),
    size: font === 'Caveat' ? rng.int(44, 50) : rng.int(36, 41),
    caps: rng.chance(0.25),
    dateSep: rng.pick(['/', '/', '-', '.'] as const),
    incomeStyle: rng.pick(['rs-comma', 'plain-dash', 'rs-plain'] as const),
  };
}

export function randomApplicationDate(rng: Rng): string {
  // 1 Sep – 5 Oct 2026 (before the demo; screening uses the application date for age).
  const day = rng.int(0, 34);
  const d = new Date(Date.UTC(2026, 8, 1) + day * 86_400_000);
  return d.toISOString().slice(0, 10);
}

export function eligibleAge(rng: Rng): number {
  const band = rng.weighted({ young: 0.45, mid: 0.35, old: 0.2 });
  return band === 'young' ? rng.int(61, 69) : band === 'mid' ? rng.int(70, 79) : rng.int(80, 92);
}

const spacedAadhaar = (n: string) => `${n.slice(0, 4)} ${n.slice(4, 8)} ${n.slice(8)}`;

interface BaseOptions {
  formNameStyle?: NameStyle;
  aadhaarNameStyle?: NameStyle;
  passbookNameStyle?: NameStyle;
  abbr?: string;
  epic?: boolean;
  income?: number;
}

export interface BaseDocs {
  person: Person;
  writer: Writer;
  form: FormSpec;
  aadhaar: AadhaarSpec;
  passbook: PassbookSpec;
  epic: EpicSpec | null;
}
type Docs = Pick<PacketSpec, 'person' | 'writer' | 'form' | 'aadhaar' | 'passbook' | 'epic'>;

/** A complete, consistent packet for `p`. Scenarios then mutate one thing. */
export function basePacket(
  rng: Rng,
  p: Person,
  writer: Writer,
  applicationDate: string,
  o: BaseOptions = {},
): BaseDocs {
  const age = ageOnDate(p.dob, applicationDate);
  const caps = (s: string) => (writer.caps ? s.toUpperCase() : s);
  const income =
    o.income ?? (rng.chance(0.1) ? 0 : rng.pick([6, 9, 12, 15, 18, 20, 24, 30, 36, 42, 48]) * 1000);
  const relative = relativeName(p, o.formNameStyle === 'abbrev' ? o.abbr : undefined);
  const yearOnly = rng.chance(age >= 75 ? 0.25 : 0.08);
  const [y] = p.dob.split('-');
  const maritalWord =
    p.marital === 'widowed'
      ? p.gender === 'female'
        ? 'Widow'
        : 'Widower'
      : p.marital === 'married'
        ? 'Married'
        : 'Unmarried';
  const form: FormSpec = {
    fields: {
      applicant_name: caps(nameAs(p, o.formNameStyle ?? 'canonical', o.abbr)),
      father_or_husband_name: caps(`${p.relative.late ? 'Late ' : ''}${relative}`),
      address: formAddress(p),
      district: formDistrict(p),
      category: category(rng, p),
      aadhaar_number: spacedAadhaar(p.aadhaar),
      mobile: p.mobile,
      date_of_birth: formatDate(p.dob, writer.dateSep),
      age: String(age),
      marital_status_if_stated: maritalWord,
      disability_if_stated: rng.chance(0.06) ? 'Locomotor 40%' : rng.pick(['No', 'Nil', 'No']),
      annual_income: formatIncome(income, writer.incomeStyle),
      bank_name: p.bank.name,
      branch: p.bank.branch,
      account_number: p.bank.account,
      ifsc: p.bank.ifsc,
      application_date: formatDate(applicationDate, writer.dateSep),
      signature_present: 'yes',
    },
    signature: rng.chance(0.2) ? 'thumb' : 'signature',
    place: p.reliefCamp ? p.reliefCamp.district : p.locality,
  };
  const aadhaar: AadhaarSpec = {
    name: nameAs(p, o.aadhaarNameStyle ?? 'canonical'),
    dob: yearOnly ? y! : formatDate(p.dob, '/'),
    dobLabel: yearOnly ? 'Year of Birth' : 'DOB',
    gender: p.gender === 'female' ? 'Female' : 'Male',
    number: p.aadhaar,
    address: homeAddress(p),
  };
  const passbook: PassbookSpec = {
    holder: nameAs(p, o.passbookNameStyle ?? 'canonical').toUpperCase(),
    account: p.bank.account,
    ifsc: p.bank.ifsc,
    bank: p.bank.name,
    branch: p.bank.branch,
    address: homeAddress(p),
    cif: String(rng.int(1, 9)) + Array.from({ length: 10 }, () => rng.int(0, 9)).join(''),
  };
  const withEpic = o.epic ?? rng.chance(0.5);
  let epic: EpicSpec | null = null;
  if (withEpic) {
    const ageJan = ageOnDate(p.dob, '2026-01-01');
    epic = {
      number: p.epicNumber,
      name: nameAs(p, 'canonical'),
      relLabel: p.relative.isHusband ? "Husband's Name" : "Father's Name",
      relative: relativeName(p),
      dobOrAge: rng.chance(0.7) ? `Age as on 01.01.2026: ${ageJan}` : formatDate(p.dob, '/'),
    };
  }
  return { person: p, writer, form, aadhaar, passbook, epic };
}

function intentsFor(base: { aadhaar: unknown; passbook: unknown; epic: unknown }) {
  const n: PacketSpec['nameIntent'] = {};
  if (base.aadhaar) n.aadhaar = 'same';
  if (base.passbook) n.passbook = 'same';
  if (base.epic) n.epic = 'same';
  return n;
}

export const NAME_VARIANT_KINDS = [
  'abbreviation',
  'order_swap',
  'dropped_marker',
  'ongbi_married_name',
  'maiden_name_on_passbook',
  'pangal_md',
] as const;
export type NameVariantKind = (typeof NAME_VARIANT_KINDS)[number];

/** Pins parts of a packet (used for the hand-picked demo set). */
export interface BuildOverrides {
  person?: Partial<Omit<PersonOptions, 'age' | 'applicationDate'>>;
  nameVariant?: NameVariantKind;
  /** Abbreviation for ambiguous_initials, e.g. "kh". */
  abbr?: string;
  epic?: boolean;
  /** Never add a relief-camp address unless the scenario is "displaced". */
  noDisplacedOverlay?: boolean;
}

export interface BuildContext {
  applicationDate: string;
  /** For duplicates: the original packet's spec and index. */
  original?: { spec: PacketSpec; index: number };
  overrides?: BuildOverrides;
}

type Built = Omit<PacketSpec, 'scenario'>;

const describe = (p: Person) =>
  `${p.community} ${p.gender === 'female' ? 'woman' : 'man'}, ${p.marital}`;

/** Builds one packet of the given scenario. Pure function of (rng, scenario, ctx). */
export function buildPacket(rng: Rng, scenario: Scenario, ctx: BuildContext): PacketSpec {
  const writer = makeWriter(rng.fork('writer'));
  const appDate = ctx.applicationDate;
  const ov = ctx.overrides ?? {};
  const person = (o: Partial<PersonOptions> = {}) =>
    makePerson(rng.fork('person'), {
      age: eligibleAge(rng),
      applicationDate: appDate,
      ...ov.person,
      ...o,
    });
  const finish = (
    b: Docs,
    plants: string[],
    description: string,
    nameIntent = intentsFor(b),
  ): Built => ({ ...b, plants, description, nameIntent, duplicateOf: null });

  // Relief-camp addresses also appear (priority only) in some packets of other scenarios.
  const maybeDisplaced = (p: Person) =>
    scenario !== 'displaced' && !ov.noDisplacedOverlay && rng.chance(0.08)
      ? makeDisplaced(rng, p)
      : p;

  const built = ((): Built => {
    switch (scenario) {
      case 'clean': {
        const p = maybeDisplaced(person());
        const b = basePacket(rng, p, writer, appDate, { epic: ov.epic });
        return finish(b, p.reliefCamp ? ['displaced'] : [], `Clean packet: ${describe(p)}.`);
      }
      case 'displaced': {
        const p = makeDisplaced(rng, person());
        const b = basePacket(rng, p, writer, appDate);
        return finish(
          b,
          ['displaced'],
          `Clean packet from a relief camp (${p.reliefCamp!.venue}) → higher priority only.`,
        );
      }
      case 'name_variant':
        return nameVariant(rng, writer, appDate, person, ov);
      case 'ambiguous_initials': {
        const amb = ambiguousAbbreviations();
        const abbr = ov.abbr ?? rng.pick([...amb.keys()].filter((a) => a.length <= 2));
        if (!amb.has(abbr)) throw new Error(`"${abbr}" is not an ambiguous abbreviation`);
        const p = person({ community: 'Meitei', clans: amb.get(abbr)! });
        const b = basePacket(rng, p, writer, appDate, {
          formNameStyle: 'abbrev',
          abbr,
          epic: false,
        });
        return finish(
          b,
          ['ambiguous_initials'],
          `"${b.form.fields.applicant_name}" on the form: "${abbr}" could be ${amb.get(abbr)!.join(', ')} and the packet does not disambiguate → officer.`,
          { aadhaar: 'ambiguous', passbook: 'ambiguous' },
        );
      }
      case 'age_ineligible': {
        const p = maybeDisplaced(person({ age: rng.int(50, 58) }));
        const b = basePacket(rng, p, writer, appDate);
        return finish(
          b,
          ['age_below_minimum'],
          `Applicant is ${b.form.fields.age} on the application date — below the scheme minimum → officer (never auto-rejected).`,
        );
      }
      case 'income_ineligible': {
        const p = maybeDisplaced(person());
        const income = rng.pick([72, 84, 96, 120, 150, 180]) * 1000;
        const b = basePacket(rng, p, writer, appDate, { income });
        return finish(
          b,
          ['income_above_ceiling'],
          `Declared income ${b.form.fields.annual_income} is above the configured ceiling → officer.`,
        );
      }
      case 'missing_document': {
        const p = maybeDisplaced(person());
        const b = basePacket(rng, p, writer, appDate);
        const which = rng.chance(0.6) ? 'passbook' : 'aadhaar';
        const out: Docs = which === 'passbook' ? { ...b, passbook: null } : { ...b, aadhaar: null };
        return finish(
          out,
          [`missing_${which}`],
          `The ${which === 'passbook' ? 'bank passbook' : 'Aadhaar card'} was not submitted → citizen correction.`,
        );
      }
      case 'blank_field': {
        const p = maybeDisplaced(person());
        const b = basePacket(rng, p, writer, appDate);
        const field = rng.pick([
          'address',
          'annual_income',
          'account_number',
          'ifsc',
          'date_of_birth',
        ] as const);
        b.form.fields[field] = null;
        if (field === 'address') b.form.fields.district = null;
        return finish(
          b,
          [`blank_${field}`],
          `Form field "${field}" left blank → citizen correction.`,
        );
      }
      case 'missing_signature': {
        const p = maybeDisplaced(person());
        const b = basePacket(rng, p, writer, appDate);
        b.form.fields.signature_present = 'no';
        b.form.signature = null;
        return finish(
          b,
          ['missing_signature'],
          'Form not signed (no signature or thumb impression).',
        );
      }
      case 'bank_holder_mismatch': {
        const p = maybeDisplaced(person());
        const b = basePacket(rng, p, writer, appDate);
        b.passbook.holder = sonName(rng, p).toUpperCase();
        return finish(
          b,
          ['bank_holder_is_relative'],
          `Passbook belongs to a relative ("${b.passbook.holder}"), not the applicant → citizen correction.`,
          { ...intentsFor(b), passbook: 'different' },
        );
      }
      case 'dob_mismatch': {
        const p = maybeDisplaced(person());
        const b = basePacket(rng, p, writer, appDate, { epic: ov.epic });
        const [y, m, d] = p.dob.split('-').map(Number) as [number, number, number];
        if (b.aadhaar.dobLabel === 'Year of Birth' || rng.chance(0.5)) {
          const ny = y + rng.pick([-3, -2, -1, 1, 2]);
          b.aadhaar.dob =
            b.aadhaar.dobLabel === 'Year of Birth' ? String(ny) : `${pad(d)}/${pad(m)}/${ny}`;
        } else if (d <= 12 && d !== m) {
          b.aadhaar.dob = `${pad(m)}/${pad(d)}/${y}`; // day and month swapped
        } else {
          b.aadhaar.dob = `${pad(((d + 9) % 28) + 1)}/${pad(m)}/${y}`;
        }
        return finish(
          b,
          ['dob_mismatch'],
          `Date of birth on the Aadhaar card (${b.aadhaar.dob}) differs from the form (${b.form.fields.date_of_birth}) → citizen correction.`,
        );
      }
      case 'aadhaar_last4_mismatch': {
        const p = maybeDisplaced(person());
        const b = basePacket(rng, p, writer, appDate);
        const wrong = miswrittenAadhaar(p.aadhaar);
        b.form.fields.aadhaar_number = spacedAadhaar(wrong);
        return finish(
          b,
          ['aadhaar_last4_mismatch'],
          `Aadhaar number written on the form ends ${wrong.slice(8)}, the card ends ${p.aadhaar.slice(8)} → officer.`,
        );
      }
      case 'aadhaar_checksum_invalid': {
        const p0 = maybeDisplaced(person());
        const p = { ...p0, aadhaar: invalidateAadhaar(p0.aadhaar) };
        const b = basePacket(rng, p, writer, appDate);
        return finish(
          b,
          ['aadhaar_checksum_invalid'],
          'The Aadhaar number on the card fails the Verhoeff checksum (deliberately invalid) → officer.',
        );
      }
      case 'duplicate': {
        if (!ctx.original) throw new Error('duplicate scenario needs an original packet');
        const orig = ctx.original.spec;
        const p = orig.person;
        const b = basePacket(rng, p, writer, appDate, {
          epic: orig.epic !== null && rng.chance(0.5),
        });
        return {
          ...finish(
            b,
            ['duplicate_of_earlier_packet'],
            `Same applicant as packet #${ctx.original.index + 1} (same Aadhaar, DOB and name) submitted again → officer.`,
          ),
          duplicateOf: ctx.original.index,
        };
      }
    }
  })();
  return { scenario, ...built };
}

/** Same person, name written differently on one document. */
function nameVariant(
  rng: Rng,
  writer: Writer,
  appDate: string,
  person: (o?: Partial<PersonOptions>) => Person,
  ov: BuildOverrides,
): Built {
  const finish = (b: BaseDocs, plant: string, description: string): Built => ({
    ...b,
    plants: [`name_variant:${plant}`],
    description,
    nameIntent: intentsFor(b),
    duplicateOf: null,
  });
  const kind: NameVariantKind =
    ov.nameVariant ??
    rng.weighted({
      abbreviation: 0.2,
      order_swap: 0.2,
      dropped_marker: 0.2,
      ongbi_married_name: 0.15,
      maiden_name_on_passbook: 0.15,
      pangal_md: 0.1,
    });
  switch (kind) {
    case 'abbreviation': {
      const unique = uniqueAbbreviations();
      const meitei = new Set(surnamesFor('Meitei'));
      const options = [...unique.entries()].filter(([, s]) => meitei.has(s));
      const [abbr, clan] = rng.pick(options);
      const p = person({ community: 'Meitei', clans: [clan], gender: 'male' });
      const b = basePacket(rng, p, writer, appDate, { formNameStyle: 'abbrev', abbr });
      return finish(
        b,
        'abbreviation',
        `Yumnak abbreviated on the form ("${b.form.fields.applicant_name}"); "${abbr}" stands only for ${clan} → same person.`,
      );
    }
    case 'order_swap': {
      const community = rng.weighted({ Meitei: 0.4, Naga: 0.3, 'Kuki-Zo': 0.3 });
      const p = person({ community });
      const b = basePacket(rng, p, writer, appDate, { passbookNameStyle: 'swap' });
      return finish(
        b,
        'order_swap',
        `Name order swapped on the passbook ("${b.passbook.holder}").`,
      );
    }
    case 'dropped_marker': {
      const p = person({ community: 'Meitei' });
      const b = basePacket(rng, p, writer, appDate, { passbookNameStyle: 'dropMarker' });
      return finish(
        b,
        'dropped_singh_devi',
        `Singh/Devi dropped on the passbook ("${b.passbook.holder}").`,
      );
    }
    case 'ongbi_married_name': {
      const p = person({
        community: 'Meitei',
        gender: 'female',
        marital: rng.pick(['married', 'widowed'] as const),
      });
      const b = basePacket(rng, p, writer, appDate, { formNameStyle: 'ongbi', epic: ov.epic });
      return finish(
        b,
        'ongbi_married_name',
        `Married name with "Ongbi" on the form ("${b.form.fields.applicant_name}") vs "${b.aadhaar.name}" on the card.`,
      );
    }
    case 'maiden_name_on_passbook': {
      const p = person({
        community: 'Meitei',
        gender: 'female',
        marital: rng.pick(['married', 'widowed'] as const),
      });
      const b = basePacket(rng, p, writer, appDate, {
        formNameStyle: 'ningolOngbi',
        aadhaarNameStyle: 'ongbi',
        passbookNameStyle: 'maiden',
      });
      return finish(
        b,
        'maiden_name_on_passbook',
        `Passbook still carries the maiden name ("${b.passbook.holder}"); the form gives natal clan via "Ningol" → same person.`,
      );
    }
    case 'pangal_md': {
      const p = person({ community: 'Pangal' });
      const style: NameStyle = p.gender === 'female' ? 'dropMarker' : 'mdLong';
      const b = basePacket(rng, p, writer, appDate, { aadhaarNameStyle: style });
      return finish(
        b,
        p.gender === 'female' ? 'begum_bibi' : 'md_mohammad',
        `Pangal name written differently on the Aadhaar card ("${b.aadhaar.name}").`,
      );
    }
  }
}
