import { defaultGazetteer, type Gazetteer, type GazetteerEntry } from './gazetteer.js';
import { phoneticKey, tokenize, type NameToken } from './text.js';

export type FamilyRole = 'family' | 'natal' | 'marital';
export type Gender = 'male' | 'female';

export type FamilyToken =
  | { kind: 'full'; display: string; key: string; role: FamilyRole; entry: GazetteerEntry | null }
  | { kind: 'abbr'; display: string; abbr: string; role: FamilyRole; candidates: GazetteerEntry[] };

export interface ParsedName {
  input: string;
  normalised: string;
  family: FamilyToken[];
  /** Given-name tokens (lowercase) — includes unknown words that are not in the gazetteer. */
  given: string[];
  givenDisplay: string[];
  /** Canonical optional endings present: singh, meitei, devi, chanu, leima, sharma, begum, bibi, khan. */
  markers: string[];
  markerDisplay: string[];
  gender: Gender | null;
  hasMohammad: boolean;
  mohammadDisplay: string | null;
}

/** Optional endings that may be dropped or swapped between documents. */
const MARKERS: Record<string, { canonical: string; gender: Gender | null }> = {
  singh: { canonical: 'singh', gender: 'male' },
  meitei: { canonical: 'meitei', gender: 'male' },
  meetei: { canonical: 'meitei', gender: 'male' },
  devi: { canonical: 'devi', gender: 'female' },
  debi: { canonical: 'devi', gender: 'female' },
  chanu: { canonical: 'chanu', gender: 'female' },
  leima: { canonical: 'leima', gender: 'female' },
  sharma: { canonical: 'sharma', gender: null },
  sarma: { canonical: 'sharma', gender: null },
  begum: { canonical: 'begum', gender: 'female' },
  bibi: { canonical: 'bibi', gender: 'female' },
  khan: { canonical: 'khan', gender: null },
};

const MOHAMMAD = new Set([
  'md',
  'mohd',
  'mohammad',
  'mohammed',
  'muhammad',
  'muhammed',
  'mohamad',
  'mohamed',
  'mhd',
]);

const isAbbreviationShape = (t: NameToken) =>
  t.text.length <= 2 || (t.dotted && t.text.length <= 3);

export function parseName(raw: string, gazetteer: Gazetteer = defaultGazetteer): ParsedName {
  const tokens = tokenize(raw);
  const forcedRole = new Map<number, FamilyRole>();
  tokens.forEach((t, i) => {
    if (i === 0) return;
    if (t.text === 'ningol') forcedRole.set(i - 1, 'natal');
    if (t.text === 'ongbi') forcedRole.set(i - 1, 'marital');
  });
  const hasMaritalMarker = tokens.some((t) => t.text === 'ningol' || t.text === 'ongbi');

  const parsed: ParsedName = {
    input: raw,
    normalised: tokens.map((t) => t.text).join(' '),
    family: [],
    given: [],
    givenDisplay: [],
    markers: [],
    markerDisplay: [],
    gender: null,
    hasMohammad: false,
    mohammadDisplay: null,
  };
  const genders = new Set<Gender>();
  if (hasMaritalMarker) genders.add('female');

  const asFamily = (t: NameToken, role: FamilyRole): FamilyToken => {
    if (isAbbreviationShape(t)) {
      return {
        kind: 'abbr',
        display: t.dotted ? t.display : `${t.display}.`,
        abbr: t.text,
        role,
        candidates: gazetteer.candidatesFor(t.text),
      };
    }
    return {
      kind: 'full',
      display: t.display,
      key: phoneticKey(t.text),
      role,
      entry: gazetteer.lookup(t.text),
    };
  };

  tokens.forEach((t, i) => {
    if (t.text === 'ningol' || t.text === 'ongbi') return;
    const role = forcedRole.get(i);
    if (role) {
      parsed.family.push(asFamily(t, role));
      return;
    }
    if (MOHAMMAD.has(t.text)) {
      parsed.hasMohammad = true;
      parsed.mohammadDisplay = t.display;
      return;
    }
    const marker = MARKERS[t.text];
    if (marker && tokens.length > 1) {
      parsed.markers.push(marker.canonical);
      parsed.markerDisplay.push(t.display);
      if (marker.gender) genders.add(marker.gender);
      return;
    }
    const entry = gazetteer.lookup(t.text);
    if (entry && t.text.length > 2) {
      parsed.family.push({
        kind: 'full',
        display: entry.surname,
        key: phoneticKey(t.text),
        role: 'family',
        entry,
      });
      return;
    }
    if (isAbbreviationShape(t)) {
      parsed.family.push(asFamily(t, 'family'));
      return;
    }
    parsed.given.push(t.text);
    parsed.givenDisplay.push(t.display);
  });

  parsed.gender = genders.size === 1 ? [...genders][0]! : null;
  return parsed;
}
