import data from '../../data/gazetteer.json';
import { phoneticKey } from './text.js';

export type Community = 'Meitei' | 'Pangal' | 'Naga' | 'Kuki-Zo' | 'Nepali';
export type GazetteerConfidence = 'high' | 'medium' | 'low';

export interface GazetteerEntry {
  surname: string;
  community: Community | string;
  /** Lowercase, no dots: "kh", "th", "o", "rk". Only Meitei yumnaks carry abbreviations. */
  abbreviations: string[];
  /** Alternative romanisations that the phonetic key does not already cover. */
  variants?: string[];
  /** e.g. "Bamon" for Meitei Brahmin yumnaks. */
  subgroup?: string;
  /** Naga / Kuki-Zo tribe, e.g. "Tangkhul", "Thadou". */
  tribe?: string;
  /** Meitei salai (clan), only where known. */
  salai?: string;
  /** Where the entry came from, e.g. "general-knowledge" (starter list) or "department". */
  source?: string;
  confidence?: GazetteerConfidence | string;
}

/** Communities whose clan names never take the Meitei "Th." / "Kh." initial convention. */
export const NON_MEITEI_CLAN_COMMUNITIES: ReadonlySet<string> = new Set([
  'Naga',
  'Kuki-Zo',
  'Nepali',
]);

export interface Gazetteer {
  readonly size: number;
  readonly entries: readonly GazetteerEntry[];
  /** Full surname lookup by romanisation-insensitive key (variants included). */
  lookup(token: string): GazetteerEntry | null;
  /** Every surname that the abbreviation could stand for (gazetteer order, stable). */
  candidatesFor(abbreviation: string): GazetteerEntry[];
  /** abbreviation → candidate surnames, for every abbreviation in the gazetteer. */
  abbreviationMap(): ReadonlyMap<string, readonly string[]>;
}

export function createGazetteer(entries: readonly GazetteerEntry[]): Gazetteer {
  const byKey = new Map<string, GazetteerEntry>();
  const byAbbr = new Map<string, GazetteerEntry[]>();
  for (const entry of entries) {
    for (const spelling of [entry.surname, ...(entry.variants ?? [])]) {
      const key = phoneticKey(spelling);
      // First entry wins so the order of the source list is authoritative.
      if (!byKey.has(key)) byKey.set(key, entry);
    }
    for (const abbr of entry.abbreviations) {
      const k = abbr.toLowerCase();
      byAbbr.set(k, [...(byAbbr.get(k) ?? []), entry]);
    }
  }
  const abbrMap = new Map(
    [...byAbbr].map(([k, v]) => [k, Object.freeze(v.map((e) => e.surname))] as const),
  );
  return {
    size: entries.length,
    entries,
    lookup: (token) => byKey.get(phoneticKey(token)) ?? null,
    candidatesFor: (abbr) => [...(byAbbr.get(abbr.toLowerCase()) ?? [])],
    abbreviationMap: () => abbrMap,
  };
}

/** Abbreviations that could stand for more than one surname → always AMBIGUOUS on their own. */
export function ambiguousAbbreviations(gazetteer: Gazetteer): Map<string, readonly string[]> {
  return new Map([...gazetteer.abbreviationMap()].filter(([, names]) => names.length > 1));
}

/** Bundled starter list (packages/core/data/gazetteer.json) — department review needed. */
export const gazetteerEntries: readonly GazetteerEntry[] = data.entries;
export const defaultGazetteer: Gazetteer = createGazetteer(gazetteerEntries);
