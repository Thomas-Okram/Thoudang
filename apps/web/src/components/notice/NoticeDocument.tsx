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

  const block = (pick: (t: NoticeText) => string, className = '') => (
    <div className={`space-y-1 ${className}`}>
      {langs.map((l) => (
        <p
          key={l}
          lang={LANG_ATTR[l]}
          className={`${FONT[l]} ${mode === 'all' && l !== 'en' ? 'text-slate-700' : ''}`}
        >
          {pick(text(l))}
        </p>
      ))}
    </div>
  );

  return (
    <article
      className="print-page relative mx-auto max-w-[210mm] overflow-hidden bg-white px-12 py-10 text-[15px] leading-relaxed text-slate-900 shadow-sm ring-1 ring-slate-200"
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

      <header className="relative flex items-start justify-between gap-6 border-b-2 border-navy-900 pb-4">
        <div>
          <div className="text-xs font-semibold uppercase tracking-widest text-slate-500">
            Government of Manipur
          </div>
          <div className="text-lg font-bold text-navy-900">Department of Social Welfare</div>
          <div className="text-sm text-slate-600">Old Age Pension — deficiency notice</div>
        </div>
        <dl className="text-right text-sm">
          <div>
            <dt className="inline text-slate-500">Ref. no. </dt>
            <dd className="inline font-mono font-semibold">{notice.reference}</dd>
          </div>
          <div>
            <dt className="inline text-slate-500">Date </dt>
            <dd className="inline">{notice.date}</dd>
          </div>
          <div>
            <dt className="inline text-slate-500">Applicant </dt>
            <dd className="inline font-semibold">{notice.applicantName}</dd>
          </div>
        </dl>
      </header>

      <div className="relative mt-5 space-y-4">
        {block((t) => t.title, 'text-lg font-bold text-navy-900')}
        {block((t) => t.greeting)}
        {block((t) => t.intro)}

        <ol className="space-y-3 rounded-lg border border-slate-300 p-4" data-testid="notice-items">
          {r.en.items.map((_, i) => (
            <li key={i} className="flex gap-3">
              <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-navy-900 text-xs font-bold text-white">
                {i + 1}
              </span>
              {block((t) => t.items[i] ?? '')}
            </li>
          ))}
        </ol>

        {block((t) => t.bring, 'font-semibold')}
        <div className="rounded-lg border-l-4 border-teal-accent bg-teal-soft/40 px-4 py-3">
          {block((t) => t.notRejection, 'font-semibold text-navy-900')}
        </div>
        {block((t) => t.finalDecision, 'text-sm')}
        {block((t) => t.helpline, 'text-sm')}
      </div>

      <footer className="relative mt-8 flex items-end justify-between gap-6 border-t border-slate-300 pt-4">
        <div className="text-sm">{block((t) => t.signoff, 'font-semibold')}</div>
        <div className="flex items-center gap-3 text-right text-xs text-slate-600">
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
