import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router';
import QRCode from 'qrcode';
import { fetchNotice, markNoticeSent } from '../lib/api';
import { useOfficer } from '../lib/officer';
import { MODES, NoticeDocument, type NoticeMode } from '../components/notice/NoticeDocument';
import { AudioPlayer } from '../components/notice/AudioPlayer';
import { EmptyState } from '../components/Page';

export function NoticePage() {
  const { caseId = '' } = useParams();
  const qc = useQueryClient();
  const { officer, can } = useOfficer();
  const [mode, setMode] = useState<NoticeMode>('all');
  const [qr, setQr] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const {
    data: n,
    isPending,
    error,
  } = useQuery({ queryKey: ['notice', caseId], queryFn: () => fetchNotice(caseId) });

  const statusUrl = useMemo(() => (n ? `${window.location.origin}${n.statusPath}` : ''), [n]);
  useEffect(() => {
    if (!statusUrl) return;
    QRCode.toDataURL(statusUrl, {
      margin: 0,
      width: 240,
      color: { dark: '#0A1B33', light: '#ffffff' },
    })
      .then(setQr)
      .catch(() => setQr(null));
  }, [statusUrl]);

  if (isPending)
    return (
      <div className="mx-auto max-w-5xl p-8">
        <div className="skeleton h-[80vh]" />
      </div>
    );
  if (error || !n)
    return (
      <div className="mx-auto max-w-3xl p-8">
        <EmptyState
          heading="Notice not available"
          body={error instanceof Error ? error.message : 'Unknown case'}
        />
      </div>
    );

  const whatsappText = n.plainText
    ? mode === 'all'
      ? `${n.plainText.en}\n\n${n.plainText.mni_beng}`
      : n.plainText[mode]
    : '';
  const markSent = async (channel: 'print' | 'whatsapp' | 'in_person') => {
    try {
      const next = await markNoticeSent(caseId, channel);
      qc.setQueryData(['notice', caseId], next);
      void qc.invalidateQueries({ queryKey: ['case'] });
      setMessage(`Notice marked as sent (${channel.replace('_', ' ')})`);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Could not mark as sent');
    }
  };

  return (
    <div className="mx-auto max-w-[1100px] px-6 py-6">
      <div className="no-print mb-5 flex flex-wrap items-center gap-3">
        <Link to={`/cases/${caseId}`} className="text-sm text-slate-500 hover:text-navy-900">
          ← {n.reference}
        </Link>
        <h1 className="text-2xl font-bold text-navy-900">Citizen notice</h1>
        {n.noticeSentAt && (
          <span className="rounded-full bg-navy-900 px-3 py-1 text-xs font-semibold text-white">
            Notice sent on{' '}
            {new Date(n.noticeSentAt).toLocaleString('en-IN', {
              dateStyle: 'medium',
              timeStyle: 'short',
            })}
          </span>
        )}
        <span
          className="ml-auto rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-900"
          title="Every sentence comes from a reviewed template; values come from the case"
        >
          Built from templates · 0 AI calls
        </span>
      </div>

      {!n.allowed ? (
        <div className="rounded-xl border border-amber-300 bg-amber-50 px-6 py-5 text-amber-950">
          <h2 className="text-lg font-bold">No notice can be sent for this case</h2>
          <p className="mt-1">{n.blockedReason}</p>
          <Link
            to={`/cases/${caseId}`}
            className="mt-3 inline-block font-semibold text-navy-900 underline"
          >
            Back to the case
          </Link>
        </div>
      ) : (
        <>
          <div className="no-print mb-4 grid gap-4 lg:grid-cols-[1fr_auto]">
            <div className="flex flex-wrap items-center gap-3">
              <div
                className="inline-flex rounded-lg bg-slate-200 p-1"
                role="tablist"
                aria-label="Script"
              >
                {MODES.map((m) => (
                  <button
                    key={m.key}
                    role="tab"
                    aria-selected={mode === m.key}
                    onClick={() => setMode(m.key)}
                    className={`rounded-md px-4 py-2 text-sm font-semibold transition ${m.className} ${mode === m.key ? 'bg-white text-navy-900 shadow-sm' : 'text-slate-600 hover:text-navy-900'}`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
              {(mode === 'mni_mtei' || mode === 'all') &&
                n.rendered?.review.mni_mtei === 'auto' && (
                  <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-900">
                    Meetei Mayek auto-transliterated — pending review
                  </span>
                )}
              {mode !== 'en' && (n.rendered?.review.pendingCount ?? 0) > 0 && (
                <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-900">
                  Manipuri draft — {n.rendered?.review.pendingCount} template
                  {n.rendered?.review.pendingCount === 1 ? '' : 's'} pending native-speaker review
                </span>
              )}
            </div>
            <AudioPlayer caseId={caseId} audio={n.audio} />
          </div>

          <div className="no-print mb-5 flex flex-wrap gap-2">
            <button
              onClick={() => window.print()}
              className="rounded-lg bg-navy-900 px-4 py-2.5 font-semibold text-white hover:bg-navy-800"
            >
              Print (A4)
            </button>
            <a
              href={`https://wa.me/?text=${encodeURIComponent(whatsappText)}`}
              target="_blank"
              rel="noreferrer"
              className="rounded-lg bg-[#1f9d55] px-4 py-2.5 font-semibold text-white hover:brightness-110"
            >
              Share on WhatsApp
            </a>
            <span className="mx-2 w-px bg-slate-300" />
            {(['print', 'whatsapp', 'in_person'] as const).map((ch) => (
              <button
                key={ch}
                onClick={() => void markSent(ch)}
                disabled={!officer || !can('send_for_correction')}
                title={!officer ? 'Choose an officer first' : undefined}
                className="rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm font-semibold text-navy-900 hover:bg-slate-50 disabled:text-slate-400"
              >
                Mark sent · {ch === 'in_person' ? 'handed over' : ch}
              </button>
            ))}
            {message && <span className="self-center text-sm text-slate-600">{message}</span>}
          </div>

          <NoticeDocument notice={n} mode={mode} qrDataUrl={qr} statusUrl={statusUrl} />
        </>
      )}
    </div>
  );
}
