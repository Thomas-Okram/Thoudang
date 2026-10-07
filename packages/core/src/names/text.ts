/** Shared low-level text helpers for the name engine. Pure, deterministic. */

export interface NameToken {
  /** Lowercase letters only, e.g. "kh". */
  text: string;
  /** Human-readable form for reasons, e.g. "Kh." or "Okram". */
  display: string;
  /** The token was written with a trailing dot (an abbreviation signal). */
  dotted: boolean;
}

/** Titles/honorifics, stripped from the start or end of a name (bank style puts "MR" last). */
const TITLES = new Set([
  'shri',
  'sri',
  'shree',
  'smt',
  'shrimati',
  'srimati',
  'mr',
  'mrs',
  'ms',
  'miss',
  'mister',
  'kumari',
  'km',
  'dr',
  'late',
  'lt',
  'mst',
  'mosammat',
  'janab',
  'haji',
  'hajee',
  'alhaj',
  'prof',
]);
/** Short titles that are only safe to drop at the very start: "Sh." (Shri), Kuki-Zo "Pu"/"Pi". */
const LEADING_ONLY_TITLES = new Set(['sh', 'pu', 'pi']);

// "S/o", "D/O", "W/o", "C/o", "Wd/o", "S/0" (OCR zero), "S.O.", "son of" … everything after it
// names a relative, not the applicant.
const RELATION =
  /(?:^|[\s,;:])(?:(?:wd|[sdwch])\s*[/\\|]\s*[o0]|[sdwc]\.[o0]\.|son\s+of|daughter\s+of|wife\s+of|widow\s+of|husband\s+of|care\s+of)(?![a-z]).*$/is;

/** Words that legitimately end in a dot glued to the next word ("Mohd.abdul" is not "Mohdabdul"). */
const DOTTED_PREFIXES = new Set([...TITLES, 'ksh', 'mohd', 'mhd']);

const capitalise = (s: string) => (s ? s[0]!.toUpperCase() + s.slice(1) : s);

/** OCR repairs on the raw string: digit look-alikes inside words, stray dots inside words. */
function repairOcr(raw: string): string {
  return (
    raw
      // 0 → o and 1 → l only when touching a letter ("0kram", "La1remsiami"); lone digits are dropped later.
      .replace(/(?<=[a-z])0|0(?=[a-z])/gi, 'o')
      .replace(/(?<=[a-z])1|1(?=[a-z])/gi, 'l')
      // "Tho.mas" → "Thomas": a dot after 3+ letters followed by a lowercase letter is noise.
      // "O.Thomas", "Kh.Loken" (short) and "Okram.Thomas" (capital follows) still split.
      .replace(/([A-Za-z]+)\.(?=[a-z])/g, (m, left: string) =>
        left.length >= 3 && !DOTTED_PREFIXES.has(left.toLowerCase()) ? left : m,
      )
  );
}

export function tokenize(raw: string): NameToken[] {
  const withoutRelation = repairOcr(raw.replace(RELATION, ' '));
  const cleaned = withoutRelation
    .replace(/[’'`]/g, '')
    .replace(/[,;:\-\u2010-\u2015_()/\\|]+/g, ' ');
  const parts = cleaned.split(/\s+|(?<=\.)/).filter(Boolean);

  const tokens: NameToken[] = [];
  for (const part of parts) {
    const text = part.toLowerCase().replace(/[^a-z]/g, '');
    if (!text) continue;
    // Only short words are abbreviations; "Thomas." is a stray full stop.
    const dotted = part.endsWith('.') && text.length <= 3;
    const prev = tokens[tokens.length - 1];
    // Merge dotted single-letter initials: "R.K." → "rk".
    if (dotted && text.length === 1 && prev && /^([A-Z]\.)+$/.test(prev.display)) {
      prev.text += text;
      prev.display = `${prev.display}${text.toUpperCase()}.`;
      continue;
    }
    tokens.push({ text, display: dotted ? `${capitalise(text)}.` : capitalise(text), dotted });
  }
  return stripTitles(tokens);
}

/** Drop titles at either end; never strip a name down to nothing. */
function stripTitles(tokens: NameToken[]): NameToken[] {
  let start = 0;
  let end = tokens.length;
  const isTitle = (t: NameToken, leading: boolean) =>
    TITLES.has(t.text) || (leading && LEADING_ONLY_TITLES.has(t.text));
  while (start < end - 1 && isTitle(tokens[start]!, true)) start++;
  while (end - 1 > start && isTitle(tokens[end - 1]!, false)) end--;
  // A lone title (e.g. "Shri") is kept so the caller still sees something to compare.
  return tokens.slice(start, end);
}

export function normaliseName(raw: string): string {
  return tokenize(raw)
    .map((t) => t.text)
    .join(' ');
}

/**
 * Romanisation-insensitive key: Meitei names are transliterated inconsistently
 * (th/t, kh/k, ph/f, sh/s, w/b/v, doubled letters, ee/i, oo/u).
 */
export function phoneticKey(raw: string): string {
  const hit = keyCache.get(raw);
  if (hit !== undefined) return hit;
  const key = computePhoneticKey(raw);
  if (keyCache.size >= KEY_CACHE_LIMIT) keyCache.clear();
  keyCache.set(raw, key);
  return key;
}

// Pure function of its input, so memoising is safe; bounded so memory cannot grow without limit.
const KEY_CACHE_LIMIT = 20_000;
const keyCache = new Map<string, string>();

function computePhoneticKey(raw: string): string {
  let s = raw.toLowerCase().replace(/[^a-z]/g, '');
  s = s
    .replace(/ph/g, 'f')
    .replace(/sh/g, 's')
    .replace(/kh/g, 'k')
    .replace(/th/g, 't')
    .replace(/bh/g, 'b')
    .replace(/dh/g, 'd')
    .replace(/gh/g, 'g')
    .replace(/[wv]/g, 'b')
    .replace(/ee/g, 'i')
    .replace(/oo/g, 'u');
  return s.replace(/(.)\1+/g, '$1');
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const curr = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j]! + 1, curr[j - 1]! + 1, prev[j - 1]! + cost);
    }
    prev = curr;
  }
  return prev[b.length]!;
}
