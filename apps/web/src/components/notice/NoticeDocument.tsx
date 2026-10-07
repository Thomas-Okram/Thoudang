import type { Notice, NoticeLang, NoticeText } from '../../lib/api';

export type NoticeMode = NoticeLang | 'all';

export const MODES: { key: NoticeMode; label: string; className: string }[] = [
  { key: 'en', label: 'English', className: '' },
  { key: 'mni_mtei', label: 'ꯃꯤꯇꯩ ꯃꯌꯦꯛ', className: 'font-mtei' },
  { key: 'mni_beng', label: 'বাংলা লিপি', className: 'font-beng' },
  { key: 'all', label: 'All three', className: '' },
];

const LANGS: NoticeLang[] = ['en', 'mni_mtei', 'mni_beng'];
const FONT: Record<NoticeLang, string> = { en: '', mni_beng: 'font-beng', mni_mtei: 'font-mtei' };
/** In "All three" mode each script gets its own left rule so the eye can follow one language. */
const RULE: Record<NoticeLang, string> = {
  en: 'border-navy-900',
  mni_mtei: 'border-teal-accent',
  mni_beng: 'border-warm-400',
};
const LANG_NAME: Record<NoticeLang, { label: string; className: string }> = {
  en: { label: 'English', className: '' },
  mni_mtei: { label: 'ꯃꯤꯇꯩ ꯃꯌꯦꯛ', className: 'font-mtei' },
  mni_beng: { label: 'বাংলা লিপি', className: 'font-beng' },
};
const LANG_ATTR: Record<NoticeLang, string> = {
  en: 'en',
  mni_beng: 'mni-Beng',
  mni_mtei: 'mni-Mtei',
};

export function NoticeDocument({
  notice,
  mode,
  qrDataUrl,
  statusUrl,
}: {
  notice: Notice;
  mode: NoticeMode;
  qrDataUrl: string | null;
  statusUrl: string;
}) {
  const r = notice.rendered;
  if (!r) return null;
  const langs = mode === 'all' ? LANGS : [mode];
  const text = (lang: NoticeLang) => r[lang];

  const all = mode === 'all';
  const block = (pick: (t: NoticeText) => string, className = '') => (
    <div className={`${all ? 'space-y-1.5' : ''} ${className}`}>
      {langs.map((l) => (
        <p
          key={l}
          lang={LANG_ATTR[l]}
          className={`${FONT[l]} ${all ? `border-l-[3px] pl-3 ${RULE[l]}` : ''} ${all && l !== 'en' ? 'text-slate-700' : ''} ${l !== 'en' ? 'text-[1.04em]' : ''}`}
        >
          {pick(text(l))}
        </p>
      ))}
    </div>
  );

  return (
    <article
      className="print-page relative mx-auto max-w-[210mm] overflow-hidden rounded-sm bg-white px-14 py-12 text-[15px] leading-relaxed text-slate-900 shadow-[0_2px_4px_rgb(10_27_51/0.06),0_24px_60px_-20px_rgb(10_27_51/0.35)] ring-1 ring-line"
      data-testid="notice-document"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 flex items-center justify-center"
      >
        <span className="rotate-[-24deg] select-none whitespace-nowrap text-7xl font-black tracking-widest text-rose-600/10">
          PROTOTYPE — SPECIMEN
        </span>
      </div>
      <div aria-hidden className="absolute inset-x-0 top-0 flex h-1.5">
        <span className="flex-1 bg-navy-900" />
        <span className="w-24 bg-teal-accent" />
        <span className="w-12 bg-warm-400" />
      </div>

      <header className="relative flex items-start justify-between gap-6 border-b-2 border-navy-900 pb-5">
        <div className="flex items-center gap-4">
          <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full border-2 border-navy-900 text-navy-900">
            <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M4 21V9l8-5 8 5v12M4 21h16M8 21v-6M12 21v-6M16 21v-6M3 9h18" />
            </svg>
          </span>
          <div>
            <div className="text-[0.7rem] font-bold uppercase tracking-[0.18em] text-slate-500">
              Government of Manipur
            </div>
            <div className="text-xl font-bold leading-tight text-navy-900">
              Department of Social Welfare
            </div>
            <div className="text-sm text-slate-600">Old Age Pension — deficiency notice</div>
          </div>
        </div>
        <dl className="grid max-w-[42%] shrink-0 grid-cols-[auto_auto] gap-x-3 gap-y-0.5 text-right text-sm">
          <dt className="text-slate-500">Ref. no.</dt>
          <dd className="font-mono font-semibold">{notice.reference}</dd>
          <dt className="text-slate-500">Date</dt>
          <dd>{notice.date}</dd>
          <dt className="text-slate-500">Applicant</dt>
          <dd className="font-semibold">{notice.applicantName}</dd>
        </dl>
      </header>

      {all && (
        <div className="relative mt-4 flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-600" aria-hidden>
          {LANGS.map((l) => (
            <span key={l} className="flex items-center gap-1.5">
              <span className={`h-3.5 border-l-[3px] ${RULE[l]}`} />
              <span className={LANG_NAME[l].className}>{LANG_NAME[l].label}</span>
            </span>
          ))}
        </div>
      )}

      <div className="relative mt-5 space-y-5">
        {block((t) => t.title, 'text-lg font-bold text-navy-900')}
        {block((t) => t.greeting)}
        {block((t) => t.intro)}

        <ol
          className="space-y-4 rounded-xl border border-slate-300 bg-slate-50/50 p-5"
          data-testid="notice-items"
        >
          {r.en.items.map((_, i) => (
            <li key={i} className="flex gap-3.5">
              <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-navy-900 text-sm font-bold text-white">
                {i + 1}
              </span>
              {block((t) => t.items[i] ?? '', 'min-w-0 flex-1')}
            </li>
          ))}
        </ol>

        {block((t) => t.bring, 'font-semibold')}
        <div className="rounded-xl border-l-4 border-teal-accent bg-teal-wash px-5 py-4">
          {block((t) => t.notRejection, 'font-semibold text-navy-900')}
        </div>
        {block((t) => t.finalDecision, 'text-sm')}
        {block((t) => t.helpline, 'text-sm')}
      </div>

      <footer className="relative mt-10 flex items-end justify-between gap-6 border-t border-slate-300 pt-5">
        <div className="text-sm">
          {block((t) => t.signoff, 'font-semibold')}
          <div className="mt-8 w-48 border-t border-dashed border-slate-400 pt-1 text-xs text-slate-500">
            Signature &amp; seal
          </div>
        </div>
        <div className="flex items-center gap-3 rounded-xl border border-slate-200 p-3 text-right text-xs text-slate-600">
          <div>
            <div className="font-semibold text-navy-900">Check your application status</div>
            <div>Scan the code, or open:</div>
            <div className="max-w-[44mm] break-all font-mono">{statusUrl}</div>
          </div>
          {qrDataUrl && (
            <img src={qrDataUrl} alt="QR code for application status" className="h-24 w-24" />
          )}
        </div>
      </footer>
    </article>
  );
}
