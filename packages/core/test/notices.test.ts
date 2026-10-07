import { describe, expect, it } from 'vitest';
import {
  bengaliToMeeteiMayek,
  containsFullAadhaar,
  defaultTemplateSet,
  noticeToPlainText,
  renderNotice,
  TemplateSetSchema,
  verhoeffCheckDigit,
  type NoticeInput,
  type TemplateSet,
} from '../src/index.js';

const FULL = (() => {
  const b = '23456789012';
  return b + verhoeffCheckDigit(b);
})();

const input = (over: Partial<NoticeInput> = {}): NoticeInput => ({
  applicantName: 'Laishram Ningol Okram Ongbi Ibemcha Devi',
  reference: 'THD-2026-0003',
  date: '8 Oct 2026',
  district: 'Bishnupur',
  items: [
    {
      code: 'DOB_MISMATCH',
      documentA: 'form',
      documentB: 'aadhaar',
      field: 'dob',
      valueA: '15-03-1944',
      valueB: '1943',
      reason: 'DOB differs',
    },
    {
      code: 'MISSING_DOCUMENT',
      documentA: 'passbook',
      reason: 'The bank passbook was not submitted.',
    },
  ],
  ...over,
});

describe('notice templates', () => {
  it('the bundled template file is valid and every entry starts unreviewed', () => {
    const set = TemplateSetSchema.parse(defaultTemplateSet);
    expect(set.templates.map((t) => t.code)).toEqual(
      expect.arrayContaining([
        'MISSING_DOCUMENT',
        'EXTRACTION_FAILED',
        'NAME_MISMATCH',
        'DOB_MISMATCH',
        'BANK_HOLDER_NAME_MISMATCH',
        'AADHAAR_FORM_CARD_MISMATCH',
        'MISSING_FIELD',
        'MISSING_SIGNATURE',
        'GENERIC',
      ]),
    );
    expect([...set.templates, ...set.blocks].every((t) => t.reviewed === false)).toBe(true);
    expect(set.blocks.map((b) => b.id)).toEqual(
      expect.arrayContaining(['greeting', 'bring', 'not_rejection', 'final_decision', 'helpline']),
    );
  });
});

describe('renderNotice', () => {
  const n = renderNotice(defaultTemplateSet, input());

  it('fills placeholders in English, with document labels and values side by side', () => {
    expect(n.en.greeting).toBe('Dear Laishram Ningol Okram Ongbi Ibemcha Devi,');
    expect(n.en.items[0]).toBe(
      'Your date of birth is different on the application form (“15-03-1944”) and the Aadhaar card (“1943”). Please bring a document that shows your correct date of birth.',
    );
    expect(n.en.items[1]).toBe(
      'The bank passbook was not submitted. Please bring your bank passbook.',
    );
    expect(n.en.bring).toBe(
      'Please bring these to the Office of the District Social Welfare Officer, Bishnupur within 30 days.',
    );
    expect(n.en.notRejection).toMatch(/not a rejection/);
    expect(n.en.intro).toContain('THD-2026-0003');
  });

  it('fills the Bengali-script Manipuri version with Manipuri labels, keeping names as written', () => {
    expect(n.mni_beng.items[0]).toContain('অর্জি ফোর্মদা “15-03-1944”');
    expect(n.mni_beng.items[0]).toContain('আধার কার্দদা “1943”');
    expect(n.mni_beng.bring).toContain('30 নুমিৎ মনুংদা');
  });

  it('auto-transliterates Meetei Mayek from the Bengali-script text and says so', () => {
    expect(n.mni_mtei.items[0]).toBe(bengaliToMeeteiMayek(n.mni_beng.items[0]!));
    expect(n.mni_mtei.items[0]).toContain('“15-03-1944”');
    expect(n.review.mni_mtei).toBe('auto');
    expect(n.review.pendingCount).toBeGreaterThan(0);
  });

  it('uses the reviewer’s own Meetei Mayek text when present', () => {
    const set: TemplateSet = structuredClone(defaultTemplateSet);
    set.templates.find((t) => t.code === 'MISSING_DOCUMENT')!.mni_mtei = '{document} ꯄꯤꯈꯤꯗꯦ꯫';
    const r = renderNotice(
      set,
      input({ items: [{ code: 'MISSING_DOCUMENT', documentA: 'passbook', reason: 'x' }] }),
    );
    expect(r.mni_mtei.items[0]).toBe(`${bengaliToMeeteiMayek('বেংক পাসবুক')} ꯄꯤꯈꯤꯗꯦ꯫`);
  });

  it('falls back to a generic line for codes without a template', () => {
    const r = renderNotice(
      defaultTemplateSet,
      input({
        items: [{ code: 'SOMETHING_NEW', documentA: 'form', reason: 'Please re-sign page 2.' }],
      }),
    );
    expect(r.en.items[0]).toBe('Please re-sign page 2.');
    expect(r.mni_beng.items[0]).toContain('অর্জি ফোর্মদা শেমদোক্পা');
  });

  it('never contains a full Aadhaar number, even if one sneaks into a value', () => {
    const r = renderNotice(
      defaultTemplateSet,
      input({
        items: [
          {
            code: 'AADHAAR_FORM_CARD_MISMATCH',
            documentA: 'form',
            documentB: 'aadhaar',
            valueA: FULL,
            valueB: '0124',
            reason: 'x',
          },
        ],
      }),
    );
    for (const lang of ['en', 'mni_beng', 'mni_mtei'] as const) {
      expect(containsFullAadhaar(JSON.stringify(r[lang]))).toBe(false);
      expect(containsFullAadhaar(noticeToPlainText(r, lang))).toBe(false);
    }
    expect(r.en.items[0]).toContain(`XXXX XXXX ${FULL.slice(8)}`);
  });

  it('plain text (for WhatsApp) has the key lines in order', () => {
    const text = noticeToPlainText(n, 'en');
    const lines = text.split('\n').filter(Boolean);
    expect(lines[0]).toBe('Notice: corrections needed in your Old Age Pension application');
    expect(text).toContain('1. Your date of birth is different');
    expect(text).toContain('2. The bank passbook was not submitted.');
    expect(text).toMatch(/not a rejection/);
    expect(lines.at(-1)).toBe('District Social Welfare Officer, Bishnupur');
  });

  it('missing values render as an em dash, never as a raw placeholder', () => {
    const r = renderNotice(
      defaultTemplateSet,
      input({
        items: [{ code: 'NAME_MISMATCH', documentA: 'form', documentB: 'aadhaar', reason: 'x' }],
      }),
    );
    expect(r.en.items[0]).not.toMatch(/\{\w+\}/);
    expect(r.en.items[0]).toContain('(“—”)');
  });
});
