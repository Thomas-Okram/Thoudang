/**
 * Deterministic Bengali-script → Meetei Mayek transliteration for Manipuri (Meiteilon) text.
 *
 * Best-effort orthographic mapping, not a linguistic engine:
 * - consonants and independent vowels map 1:1 from a table;
 * - vowel signs map to Meetei Mayek vowel signs;
 * - a bare consonant at the end of a word becomes its lonsum (final) form when one exists
 *   (লাইক → ꯂꯥꯏꯛ);
 * - a consonant cluster written with hasanta (্):
 *     · inside a word → the first consonant closes the previous syllable as a lonsum
 *       (ইম্ফাল → ꯏꯝꯐꯥꯜ, ওক্রম → ꯑꯣꯛꯔꯝ);
 *     · at the start of a word, or before r/l/y/w when the consonant has no lonsum form →
 *       apun iyek (꯭) joins the two (প্রধান → ꯄ꯭ꯔꯙꯥꯟ, লাইশ্রম → ꯂꯥꯏꯁ꯭ꯔꯝ);
 *     · otherwise the plain letter (অর্জি → ꯑꯔꯖꯤ).
 * Without a hasanta, a mid-word consonant keeps its inherent vowel (মণিপুর → ꯃꯅꯤꯄꯨꯔ), so
 * template authors should write clusters with ্. Anything that is not Bengali script (Latin
 * names, digits, {placeholders}, punctuation) passes through unchanged.
 */

const CONSONANT: Record<string, string> = {
  ক: 'ꯀ',
  খ: 'ꯈ',
  গ: 'ꯒ',
  ঘ: 'ꯘ',
  ঙ: 'ꯉ',
  চ: 'ꯆ',
  ছ: 'ꯆ',
  জ: 'ꯖ',
  ঝ: 'ꯓ',
  ঞ: 'ꯅ',
  ট: 'ꯇ',
  ঠ: 'ꯊ',
  ড: 'ꯗ',
  ঢ: 'ꯙ',
  ণ: 'ꯅ',
  ত: 'ꯇ',
  থ: 'ꯊ',
  দ: 'ꯗ',
  ধ: 'ꯙ',
  ন: 'ꯅ',
  প: 'ꯄ',
  ফ: 'ꯐ',
  ব: 'ꯕ',
  ভ: 'ꯚ',
  ম: 'ꯃ',
  য: 'ꯌ',
  র: 'ꯔ',
  ৰ: 'ꯔ',
  ল: 'ꯂ',
  ৱ: 'ꯋ',
  শ: 'ꯁ',
  ষ: 'ꯁ',
  স: 'ꯁ',
  হ: 'ꯍ',
  য়: 'ꯌ',
  ড়: 'ꯔ',
  ঢ়: 'ꯔ',
};

/** Final (lonsum) forms. */
const LONSUM: Record<string, string> = {
  ক: 'ꯛ',
  ল: 'ꯜ',
  ম: 'ꯝ',
  প: 'ꯞ',
  ন: 'ꯟ',
  ণ: 'ꯟ',
  ত: 'ꯠ',
  ট: 'ꯠ',
  ঙ: 'ꯡ',
};

const INDEPENDENT_VOWEL: Record<string, string> = {
  অ: 'ꯑ',
  আ: 'ꯑꯥ',
  ই: 'ꯏ',
  ঈ: 'ꯏ',
  উ: 'ꯎ',
  ঊ: 'ꯎ',
  ঋ: 'ꯔꯤ',
  এ: 'ꯑꯦ',
  ঐ: 'ꯑꯩ',
  ও: 'ꯑꯣ',
  ঔ: 'ꯑꯧ',
};

const VOWEL_SIGN: Record<string, string> = {
  'া': 'ꯥ',
  'ি': 'ꯤ',
  'ী': 'ꯤ',
  'ু': 'ꯨ',
  'ূ': 'ꯨ',
  'ৃ': '꯭ꯔꯤ',
  'ে': 'ꯦ',
  'ৈ': 'ꯩ',
  'ো': 'ꯣ',
  'ৌ': 'ꯧ',
};

const OTHER: Record<string, string> = {
  'ং': 'ꯡ', // anusvara → ngou lonsum (সিং → ꯁꯤꯡ)
  'ঁ': 'ꯪ', // chandrabindu → nung
  'ঃ': '',
  ৎ: 'ꯠ', // khanda ta
  '।': '꯫',
  '॥': '꯫',
  '০': '꯰',
  '১': '꯱',
  '২': '꯲',
  '৩': '꯳',
  '৪': '꯴',
  '৫': '꯵',
  '৬': '꯶',
  '৭': '꯷',
  '৮': '꯸',
  '৯': '꯹',
};

const HASANTA = '্';
/** Second members that form onset clusters (r, l, y, w). */
const MEDIAL = new Set(['র', 'ৰ', 'ল', 'য', 'ৱ']);
const NUKTA = '়';
const APUN = '꯭';
const NUKTA_FORMS: Record<string, string> = { য: 'য়', ড: 'ড়', ঢ: 'ঢ়' };

/** Bengali letters and signs that belong inside a word (not digits/danda). */
const isBengaliWordChar = (c: string | undefined) =>
  c !== undefined &&
  /[ঀ-ৣৰ-৿]/.test(c) &&
  !(c in OTHER && c !== 'ং' && c !== 'ঁ' && c !== 'ঃ' && c !== 'ৎ');

export function bengaliToMeeteiMayek(input: string): string {
  const chars = [...input.normalize('NFC')];
  let out = '';
  let wordStart = true;

  for (let i = 0; i < chars.length; i++) {
    let c = chars[i]!;
    // Consonant + nukta (য + ় → য়)
    if (chars[i + 1] === NUKTA && NUKTA_FORMS[c]) {
      c = NUKTA_FORMS[c]!;
      i += 1;
    }

    if (c in CONSONANT) {
      const next = chars[i + 1];
      if (next === HASANTA) {
        const after = chars[i + 2];
        if (after !== undefined && after in CONSONANT) {
          if (wordStart)
            out += CONSONANT[c]! + APUN; // onset cluster: প্র → ꯄ꯭ꯔ
          else if (LONSUM[c])
            out += LONSUM[c]; // closes the syllable: ম্ফ → ꯝꯐ
          else if (MEDIAL.has(after))
            out += CONSONANT[c]! + APUN; // শ্র → ꯁ꯭ꯔ
          else out += CONSONANT[c]!; // র্জ → ꯔꯖ
        } else {
          out += LONSUM[c] ?? CONSONANT[c]!;
        }
        i += 1; // skip hasanta
      } else if (next !== undefined && next in VOWEL_SIGN) {
        out += CONSONANT[c]! + VOWEL_SIGN[next]!;
        i += 1;
      } else if (!isBengaliWordChar(next) && LONSUM[c]) {
        out += LONSUM[c]; // bare consonant at word end
      } else {
        out += CONSONANT[c]!;
      }
      wordStart = false;
      continue;
    }

    if (c in INDEPENDENT_VOWEL) {
      out += INDEPENDENT_VOWEL[c]!;
      wordStart = false;
      continue;
    }
    if (c in VOWEL_SIGN) {
      out += VOWEL_SIGN[c]!; // stray sign: keep its sound
      continue;
    }
    if (c in OTHER) {
      out += OTHER[c]!;
      if (!isBengaliWordChar(c)) wordStart = true;
      continue;
    }
    if (c === HASANTA || c === NUKTA) continue;

    out += c;
    wordStart = true;
  }
  return out;
}

/** True when the string contains any Bengali-script letter. */
export const hasBengaliScript = (s: string) => /[ঀ-৿]/.test(s);
