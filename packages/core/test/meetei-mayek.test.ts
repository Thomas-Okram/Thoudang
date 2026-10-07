import { describe, expect, it } from 'vitest';
import { bengaliToMeeteiMayek } from '../src/index.js';

describe('Bengali script → Meetei Mayek transliteration', () => {
  it.each([
    // place and community names
    ['মণিপুর', 'ꯃꯅꯤꯄꯨꯔ'], // Manipur — inherent vowels kept
    ['মৈতৈ', 'ꯃꯩꯇꯩ'], // Meitei — ৈ → cheinap
    ['ইম্ফাল', 'ꯏꯝꯐꯥꯜ'], // Imphal — medial cluster: mit lonsum; final lai lonsum
    ['কাংলা', 'ꯀꯥꯡꯂꯥ'], // Kangla — anusvara → ngou lonsum
    ['লৈবাক', 'ꯂꯩꯕꯥꯛ'], // Leibak — final kok lonsum
    ['থাবল', 'ꯊꯥꯕꯜ'], // Thabal
    // personal names
    ['সিং', 'ꯁꯤꯡ'], // Singh
    ['দেবী', 'ꯗꯦꯕꯤ'], // Devi
    ['চানু', 'ꯆꯥꯅꯨ'], // Chanu
    ['থোক্চোম', 'ꯊꯣꯛꯆꯣꯝ'], // Thokchom — explicit hasanta
    ['ওক্রম', 'ꯑꯣꯛꯔꯝ'], // Okram — medial kr closes the syllable with kok lonsum
    ['ওইনম', 'ꯑꯣꯏꯅꯝ'], // Oinam
    ['ইরোম', 'ꯏꯔꯣꯝ'], // Irom
    ['লাইশ্রম', 'ꯂꯥꯏꯁ꯭ꯔꯝ'], // Laishram — শ has no lonsum → apun iyek
    // common words
    ['আধার', 'ꯑꯥꯙꯥꯔ'], // Aadhaar
    ['নম্বর', 'ꯅꯝꯕꯔ'], // number
    ['চাক', 'ꯆꯥꯛ'], // rice
    ['ঈমা', 'ꯏꯃꯥ'], // mother
    ['অমা', 'ꯑꯃꯥ'], // one
    ['খুৎ', 'ꯈꯨꯠ'], // hand — khanda ta
    ['নুংশি', 'ꯅꯨꯡꯁꯤ'], // love
    ['খোংজাই', 'ꯈꯣꯡꯖꯥꯏ'], // Khongjai
    ['য়াইফবা', 'ꯌꯥꯏꯐꯕꯥ'], // yaiphaba
    ['প্রধান', 'ꯄ꯭ꯔꯙꯥꯟ'], // word-initial cluster → apun iyek
    ['অর্জি', 'ꯑꯔꯖꯤ'], // arji — reph before a non-medial consonant: plain rai
    ['কার্দ', 'ꯀꯥꯔꯗ'], // card
  ])('%s → %s', (bengali, mayek) => {
    expect(bengaliToMeeteiMayek(bengali)).toBe(mayek);
  });

  it('converts digits and the danda', () => {
    expect(bengaliToMeeteiMayek('১২৩')).toBe('꯱꯲꯳');
    expect(bengaliToMeeteiMayek('লাইক।')).toBe('ꯂꯥꯏꯛ꯫');
  });

  it('transliterates whole sentences word by word and leaves Latin text, digits and placeholders alone', () => {
    expect(bengaliToMeeteiMayek('ইম্ফাল THD-2026-0001 {office} মণিপুর')).toBe(
      'ꯏꯝꯐꯥꯜ THD-2026-0001 {office} ꯃꯅꯤꯄꯨꯔ',
    );
    expect(bengaliToMeeteiMayek('“Okram Thomas”')).toBe('“Okram Thomas”');
  });

  it('is deterministic and idempotent on Meetei Mayek input', () => {
    expect(bengaliToMeeteiMayek('ꯃꯅꯤꯄꯨꯔ')).toBe('ꯃꯅꯤꯄꯨꯔ');
  });
});
