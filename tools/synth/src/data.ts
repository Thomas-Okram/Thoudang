/**
 * Reference lists for FICTIONAL applicants. Surnames/clans come from the core gazetteer; given
 * names and localities are common, generic choices — no real person is modelled.
 */
import { gazetteerEntries } from '@thoudang/core';

export type Community = 'Meitei' | 'Pangal' | 'Naga' | 'Kuki-Zo';

/** Rough population shares of the four communities (2011 census order of magnitude). */
export const COMMUNITY_WEIGHTS: Record<Community, number> = {
  Meitei: 0.53,
  Naga: 0.22,
  'Kuki-Zo': 0.17,
  Pangal: 0.08,
};

/** All 16 districts of Manipur with a few localities each. */
export const DISTRICTS: Record<string, string[]> = {
  'Imphal West': ['Sagolband Tera', 'Keishampat', 'Uripok', 'Singjamei', 'Kwakeithel', 'Lamphel'],
  'Imphal East': ['Wangkhei Ayangpalli', 'Khurai Lamlong', 'Porompat', 'Heingang', 'Andro'],
  Thoubal: ['Thoubal Wangma', 'Khongjom', 'Yairipok', 'Lilong', 'Wangjing'],
  Bishnupur: ['Moirang', 'Nambol', 'Kumbi', 'Ningthoukhong'],
  Kakching: ['Kakching Bazar', 'Waikhong', 'Sugnu', 'Hiyanglam'],
  Jiribam: ['Jiribam Bazar', 'Borobekra', 'Babupara'],
  Churachandpur: ['Tuibong', 'Lamka New Bazar', 'Saikot', 'Hiangtam Lamka'],
  Chandel: ['Chandel Khunou', 'Chakpikarong', 'Komkeirap'],
  Tengnoupal: ['Moreh', 'Tengnoupal', 'Machi'],
  Kangpokpi: ['Kangpokpi Bazar', 'Saikul', 'Motbung', 'Gamnom'],
  Senapati: ['Senapati Bazar', 'Mao', 'Karong', 'Tadubi'],
  Ukhrul: ['Hungpung', 'Litan', 'Phungyar', 'Shangshak'],
  Kamjong: ['Kamjong', 'Kasom Khullen', 'Chassad'],
  Tamenglong: ['Tamenglong Khullen', 'Nungba', 'Tousem'],
  Noney: ['Noney', 'Khoupum', 'Longmai'],
  Pherzawl: ['Pherzawl', 'Parbung', 'Thanlon'],
};

/** Where each community's applicants plausibly live (weights). */
export const COMMUNITY_DISTRICTS: Record<Community, Record<string, number>> = {
  Meitei: {
    'Imphal West': 5,
    'Imphal East': 5,
    Thoubal: 3,
    Bishnupur: 3,
    Kakching: 2,
    Jiribam: 1,
  },
  Pangal: { Thoubal: 4, 'Imphal East': 2, 'Imphal West': 1, Jiribam: 2 },
  Naga: { Ukhrul: 4, Senapati: 4, Tamenglong: 3, Noney: 2, Kamjong: 2, Chandel: 1 },
  'Kuki-Zo': { Churachandpur: 5, Kangpokpi: 4, Pherzawl: 2, Tengnoupal: 2, Chandel: 2 },
};

/** Generic relief-camp venues (2023 displacement). Priority only — never eligibility. */
export const RELIEF_CAMPS: Record<Community, { venue: string; district: string }[]> = {
  Meitei: [
    { venue: 'Moirang College', district: 'Bishnupur' },
    { venue: 'Community Hall, Nambol', district: 'Bishnupur' },
    { venue: 'Ideal Girls College, Akampat', district: 'Imphal East' },
    { venue: 'Kakching Khunou Hall', district: 'Kakching' },
  ],
  Pangal: [{ venue: 'Lilong Community Hall', district: 'Thoubal' }],
  Naga: [{ venue: 'Senapati Govt. School', district: 'Senapati' }],
  'Kuki-Zo': [
    { venue: 'Tuibong Community Hall', district: 'Churachandpur' },
    { venue: 'Kangpokpi College', district: 'Kangpokpi' },
    { venue: 'Saikot Church Hall', district: 'Churachandpur' },
  ],
};

export const GIVEN = {
  Meitei: {
    male: [
      'Tomba',
      'Ibomcha',
      'Ibobi',
      'Ibohal',
      'Chaoba',
      'Rajen',
      'Nabakumar',
      'Joykumar',
      'Ibotombi',
      'Manihar',
      'Gopal',
      'Nilamani',
      'Dhiren',
      'Iboyaima',
      'Loken',
      'Rameshwor',
      'Bijoy',
      'Kunjabihari',
      'Herojit',
      'Gourakishor',
      'Bimol',
      'Premchand',
    ],
    female: [
      'Ibemcha',
      'Tombi',
      'Memcha',
      'Ibemhal',
      'Sanatombi',
      'Thoibi',
      'Ibeyaima',
      'Rajani',
      'Sakhi',
      'Pramodini',
      'Shantibala',
      'Radhapyari',
      'Mema',
      'Leirik',
      'Binapani',
      'Kamala',
      'Phajabati',
      'Tamphasana',
    ],
  },
  Pangal: {
    male: [
      'Abdul Rahim',
      'Iqbal Hussain',
      'Abdul Salam',
      'Nurul Haque',
      'Abdul Karim',
      'Ismail',
      'Ibrahim',
      'Abdul Latif',
      'Sirajuddin',
      'Fazlur Rahman',
    ],
    female: ['Fatima', 'Rahima', 'Amina', 'Hasina', 'Jamila', 'Saleha', 'Rashida'],
  },
  Naga: {
    male: [
      'Thotso',
      'Ramkung',
      'Gaikhangam',
      'Shangam',
      'Ngashangva',
      'Wungnaoshang',
      'Ramgailung',
      'Kaikho',
      'Pheiga',
      'Lungshim',
      'Ningthing',
    ],
    female: [
      'Somila',
      'Hormila',
      'Ngalanchon',
      'Achon',
      'Shimreila',
      'Ngaraila',
      'Ashangla',
      'Lanthuila',
    ],
  },
  'Kuki-Zo': {
    male: [
      'Thangboi',
      'Paolen',
      'Thangkhanlal',
      'Vungzagin',
      'Thangminlen',
      'Seikholen',
      'Letkhosei',
      'Thanglienmang',
      'Mangkhosei',
      'Khaikhohen',
      'Lalboi',
    ],
    female: [
      'Hoineilhing',
      'Lalremsiami',
      'Nemneilhing',
      'Lalrinmawii',
      'Chinneihoi',
      'Kimneilhing',
      'Hatneikim',
      'Boinu',
    ],
  },
} as const satisfies Record<Community, { male: readonly string[]; female: readonly string[] }>;

/** Gazetteer surnames per community (the engine knows these). */
export function surnamesFor(community: Community): string[] {
  return gazetteerEntries.filter((e) => e.community === community).map((e) => e.surname);
}

/** Abbreviations that stand for exactly one gazetteer surname, e.g. "Rk." → Rajkumar. */
export function uniqueAbbreviations(): Map<string, string> {
  const by = new Map<string, string[]>();
  for (const e of gazetteerEntries) {
    for (const a of e.abbreviations) by.set(a, [...(by.get(a) ?? []), e.surname]);
  }
  return new Map(
    [...by.entries()].filter(([, s]) => s.length === 1).map(([a, s]) => [a, s[0]!] as const),
  );
}

/** Abbreviations shared by several surnames ("Kh.", "Th.", …) — the engine must refer these. */
export function ambiguousAbbreviations(): Map<string, string[]> {
  const by = new Map<string, string[]>();
  for (const e of gazetteerEntries) {
    for (const a of e.abbreviations) by.set(a, [...(by.get(a) ?? []), e.surname]);
  }
  return new Map([...by.entries()].filter(([, s]) => s.length > 1));
}

export const abbrDisplay = (abbr: string) => `${abbr[0]!.toUpperCase()}${abbr.slice(1)}.`;

/** Generic bank list. IFSC prefixes follow the 4-letter + "0" + 6-char format; branches are local. */
export const BANKS: { name: string; prefix: string; weight: number }[] = [
  { name: 'State Bank of India', prefix: 'SBIN', weight: 5 },
  { name: 'Manipur Rural Bank', prefix: 'MRBA', weight: 3 },
  { name: 'Punjab National Bank', prefix: 'PUNB', weight: 1 },
  { name: 'UCO Bank', prefix: 'UCBA', weight: 2 },
  { name: 'Canara Bank', prefix: 'CNRB', weight: 1 },
  { name: 'Bank of Baroda', prefix: 'BARB', weight: 1 },
  { name: 'Union Bank of India', prefix: 'UBIN', weight: 1 },
];

/** Branch name per district (usually the district HQ or a big locality). */
export const BRANCHES: Record<string, string[]> = {
  'Imphal West': ['Imphal Main', 'Sagolband', 'Uripok', 'Lamphel'],
  'Imphal East': ['Porompat', 'Khurai', 'Wangkhei'],
  Thoubal: ['Thoubal', 'Yairipok', 'Lilong'],
  Bishnupur: ['Moirang', 'Bishnupur', 'Nambol'],
  Kakching: ['Kakching', 'Sugnu'],
  Jiribam: ['Jiribam'],
  Churachandpur: ['Churachandpur', 'Lamka'],
  Chandel: ['Chandel'],
  Tengnoupal: ['Moreh'],
  Kangpokpi: ['Kangpokpi', 'Motbung'],
  Senapati: ['Senapati', 'Mao'],
  Ukhrul: ['Ukhrul'],
  Kamjong: ['Kamjong'],
  Tamenglong: ['Tamenglong'],
  Noney: ['Noney'],
  Pherzawl: ['Pherzawl'],
};

/** Synthetic EPIC prefixes (3 letters) — arbitrary, not real constituency codes. */
export const EPIC_PREFIXES = ['MNX', 'QZT', 'XMP', 'ZKR', 'YTV'];
