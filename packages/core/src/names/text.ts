/** Shared low-level text helpers for the name engine. Pure, deterministic. */

export interface NameToken {
  /** Lowercase letters only, e.g. "kh". */
  text: string;
  /** Human-readable form for reasons, e.g. "Kh." or "Okram". */
  display: string;
  /** The token was written with a trailing dot (an abbreviation signal). */
  dotted: boolean;
}

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
  'kumari',
  'km',
  'dr',
  'late',
  'lt',
]);

// "S/o", "D/O", "W/o", "C/o", "son of" … everything after it names a relative, not the applicant.
const RELATION =
  /(?:^|\s)(?:[sdwch]\s*\/\s*o|son\s+of|daughter\s+of|wife\s+of|husband\s+of|care\s+of)\b.*$/i;

const capitalise = (s: string) => (s ? s[0]!.toUpperCase() + s.slice(1) : s);

export function tokenize(raw: string): NameToken[] {
  const withoutRelation = raw.replace(RELATION, ' ');
  const cleaned = withoutRelation.replace(/[’'`]/g, '').replace(/[,;:\-_()/\\|]+/g, ' ');
  const parts = cleaned.split(/\s+|(?<=\.)/).filter(Boolean);

  const tokens: NameToken[] = [];
  for (const part of parts) {
    const text = part.toLowerCase().replace(/[^a-z]/g, '');
    if (!text) continue;
    const dotted = part.endsWith('.');
    const prev = tokens[tokens.length - 1];
    // Merge dotted single-letter initials: "R.K." → "rk".
    if (dotted && text.length === 1 && prev && /^([A-Z]\.)+$/.test(prev.display)) {
      prev.text += text;
      prev.display = `${prev.display}${text.toUpperCase()}.`;
      continue;
    }
    tokens.push({ text, display: dotted ? `${capitalise(text)}.` : capitalise(text), dotted });
  }
  const withoutTitles = tokens.filter((t) => !TITLES.has(t.text));
  return withoutTitles.length > 0 ? withoutTitles : tokens;
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
