import data from '../../data/gazetteer.json';
import { phoneticKey } from './text.js';

export type Community = 'Meitei' | 'Pangal' | 'Naga' | 'Kuki-Zo';

export interface GazetteerEntry {
  surname: string;
  community: Community | string;
  /** Lowercase, no dots: "kh", "th", "o", "rk". */
  abbreviations: string[];
}

export interface Gazetteer {
  readonly size: number;
  readonly entries: readonly GazetteerEntry[];
  /** Full surname lookup by romanisation-insensitive key. */
  lookup(token: string): GazetteerEntry | null;
  /** Every surname that the abbreviation could stand for (sorted, stable). */
  candidatesFor(abbreviation: string): GazetteerEntry[];
}

export function createGazetteer(entries: readonly GazetteerEntry[]): Gazetteer {
  const byKey = new Map<string, GazetteerEntry>();
  const byAbbr = new Map<string, GazetteerEntry[]>();
  for (const entry of entries) {
    byKey.set(phoneticKey(entry.surname), entry);
    for (const abbr of entry.abbreviations) {
      const k = abbr.toLowerCase();
      byAbbr.set(k, [...(byAbbr.get(k) ?? []), entry]);
    }
  }
  return {
    size: entries.length,
    entries,
    lookup: (token) => byKey.get(phoneticKey(token)) ?? null,
    candidatesFor: (abbr) => [...(byAbbr.get(abbr.toLowerCase()) ?? [])],
  };
}

/** Bundled starter list (packages/core/data/gazetteer.json). */
export const gazetteerEntries: readonly GazetteerEntry[] = data.entries;
export const defaultGazetteer: Gazetteer = createGazetteer(gazetteerEntries);
