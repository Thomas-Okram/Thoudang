import { z } from 'zod';
import raw from '../../notices/templates.json';
import { redactAadhaarInText } from '../validators/aadhaar.js';
import { bengaliToMeeteiMayek } from './meetei-mayek.js';

const Text = z.object({ en: z.string(), mni_beng: z.string() });
const Entry = z.object({
  en: z.string(),
  mni_beng: z.string(),
  mni_mtei: z.string(),
  reviewed: z.boolean(),
});

export const TemplateSetSchema = z.object({
  _note: z.string().optional(),
  settings: z.object({ days: z.number().int().positive(), helpline: z.string(), office: Text }),
  labels: z.object({
    documents: z.record(z.string(), Text),
    fields: z.record(z.string(), Text),
  }),
  blocks: z.array(Entry.extend({ id: z.string() })),
  templates: z.array(Entry.extend({ code: z.string() })),
});
export type TemplateSet = z.infer<typeof TemplateSetSchema>;
export type TemplateEntry = TemplateSet['templates'][number];
export type BlockEntry = TemplateSet['blocks'][number];

/** Bundled templates (packages/core/notices/templates.json). The API may load an edited copy. */
export const defaultTemplateSet: TemplateSet = TemplateSetSchema.parse(raw);

export type NoticeDoc = 'form' | 'aadhaar' | 'passbook' | 'epic';

/** One correction the citizen must make — built deterministically from a flag. */
export interface NoticeItemInput {
  code: string;
  documentA?: NoticeDoc;
  documentB?: NoticeDoc;
  /** Rules-engine field name (dob, applicantName, ifsc …). */
  field?: string;
  valueA?: string | null;
  valueB?: string | null;
  /** English reason from the flag — used only by the GENERIC fallback. */
  reason: string;
}

export interface NoticeInput {
  applicantName: string;
  reference: string;
  date: string;
  district: string;
  items: NoticeItemInput[];
  helpline?: string;
  days?: number;
}

export type NoticeLang = 'en' | 'mni_beng' | 'mni_mtei';

export interface RenderedNoticeText {
  title: string;
  greeting: string;
  intro: string;
  items: string[];
  bring: string;
  notRejection: string;
  finalDecision: string;
  helpline: string;
  signoff: string;
}

export interface RenderedNotice {
  en: RenderedNoticeText;
  mni_beng: RenderedNoticeText;
  mni_mtei: RenderedNoticeText;
  /** Template codes used for each item (GENERIC when no template exists). */
  codes: string[];
  review: {
    /** Templates/blocks used in this notice that nobody has ticked "reviewed" yet. */
    pendingCount: number;
    /** 'auto' when any Meetei Mayek line came from the transliterator. */
    mni_mtei: 'manual' | 'auto';
  };
}

const PLACEHOLDER = /\{(\w+)\}/g;

function fill(text: string, values: Record<string, string>): string {
  return text.replace(PLACEHOLDER, (_m, key: string) => values[key] ?? '—');
}

/**
 * Deterministic notice rendering. No AI: every sentence comes from a template; values come from
 * the case. All output passes through the Aadhaar redactor.
 */
export function renderNotice(set: TemplateSet, input: NoticeInput): RenderedNotice {
  const days = String(input.days ?? set.settings.days);
  const helpline = input.helpline ?? set.settings.helpline;
  const byCode = new Map(set.templates.map((t) => [t.code, t]));
  const block = (id: string): BlockEntry => {
    const b = set.blocks.find((x) => x.id === id);
    if (!b) throw new Error(`Notice template block "${id}" is missing`);
    return b;
  };

  let pending = 0;
  let auto = false;
  const used = new Set<object>();
  const track = (e: { reviewed: boolean }) => {
    if (!used.has(e)) {
      used.add(e);
      if (!e.reviewed) pending += 1;
    }
  };

  /** Fills an entry in all three scripts with language-specific labels. */
  const render = (
    entry: { en: string; mni_beng: string; mni_mtei: string; reviewed: boolean },
    item?: NoticeItemInput,
  ) => {
    track(entry);
    const values = (lang: 'en' | 'mni_beng'): Record<string, string> => {
      const doc = (d?: NoticeDoc) => (d ? (set.labels.documents[d]?.[lang] ?? d) : '—');
      const office = fill(set.settings.office[lang], { district: input.district });
      return {
        name: input.applicantName,
        ref: input.reference,
        date: input.date,
        district: input.district,
        days,
        helpline,
        office,
        document: doc(item?.documentA),
        document_a: doc(item?.documentA),
        document_b: doc(item?.documentB),
        field: item?.field ? (set.labels.fields[item.field]?.[lang] ?? item.field) : '—',
        value_a: item?.valueA ?? '—',
        value_b: item?.valueB ?? '—',
        reason: item?.reason ?? '',
      };
    };
    const en = fill(entry.en, values('en'));
    const beng = fill(entry.mni_beng, values('mni_beng'));
    let mtei: string;
    if (entry.mni_mtei.trim()) {
      // Reviewer-written Meetei Mayek: fill with transliterated Manipuri labels.
      const v = values('mni_beng');
      const translit = Object.fromEntries(
        Object.entries(v).map(([k, x]) => [k, bengaliToMeeteiMayek(x)]),
      );
      mtei = fill(entry.mni_mtei, translit);
    } else {
      auto = true;
      mtei = bengaliToMeeteiMayek(beng);
    }
    return {
      en: redactAadhaarInText(en),
      mni_beng: redactAadhaarInText(beng),
      mni_mtei: redactAadhaarInText(mtei),
    };
  };

  const blocks = Object.fromEntries(
    [
      'title',
      'greeting',
      'intro',
      'bring',
      'not_rejection',
      'final_decision',
      'helpline',
      'signoff',
    ].map((id) => [id, render(block(id))]),
  ) as Record<string, ReturnType<typeof render>>;
  const codes: string[] = [];
  const items = input.items.map((item) => {
    const tpl = byCode.get(item.code) ?? byCode.get('GENERIC');
    if (!tpl) throw new Error('Notice template GENERIC is missing');
    codes.push(byCode.has(item.code) ? item.code : 'GENERIC');
    return render(tpl, item);
  });

  const text = (lang: NoticeLang): RenderedNoticeText => ({
    title: blocks.title![lang],
    greeting: blocks.greeting![lang],
    intro: blocks.intro![lang],
    items: items.map((i) => i[lang]),
    bring: blocks.bring![lang],
    notRejection: blocks.not_rejection![lang],
    finalDecision: blocks.final_decision![lang],
    helpline: blocks.helpline![lang],
    signoff: blocks.signoff![lang],
  });

  return {
    en: text('en'),
    mni_beng: text('mni_beng'),
    mni_mtei: text('mni_mtei'),
    codes,
    review: { pendingCount: pending, mni_mtei: auto ? 'auto' : 'manual' },
  };
}

/** Plain-text rendering (WhatsApp / SMS). Never contains a full Aadhaar number. */
export function noticeToPlainText(n: RenderedNotice, lang: NoticeLang): string {
  const t = n[lang];
  return redactAadhaarInText(
    [
      t.title,
      '',
      t.greeting,
      t.intro,
      ...t.items.map((line, i) => `${i + 1}. ${line}`),
      '',
      t.bring,
      t.notRejection,
      t.finalDecision,
      t.helpline,
      '',
      t.signoff,
    ].join('\n'),
  );
}
