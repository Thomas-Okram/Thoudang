import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router';
import QRCode from 'qrcode';
import { fetchNotice, markNoticeSent } from '../lib/api';
import { useOfficer } from '../lib/officer';
import { MODES, NoticeDocument, type NoticeMode } from '../components/notice/NoticeDocument';
import { AudioPlayer } from '../components/notice/AudioPlayer';
import { EmptyState } from '../components/Page';
import { Badge, Button, Icon, Skeleton, Tabs, buttonClass } from '../components/ui';

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
        <Skeleton className="h-[80vh]" />
      </div>
    );
  if (error || !n)
    return (
      <div className="mx-auto max-w-3xl p-8">
        <EmptyState
          icon="notice"
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
    <div className="mx-auto max-w-[1180px] px-7 py-8">
      <div className="no-print mb-6">
        <Link
          to={`/cases/${caseId}`}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-ink-muted hover:text-navy-900"
        >
          <Icon name="arrowLeft" size={16} />
          {n.reference}
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-display font-bold text-navy-900">Citizen notice</h1>
          {n.noticeSentAt && (
            <Badge tone="solid" icon="send">
              Notice sent on{' '}
              {new Date(n.noticeSentAt).toLocaleString('en-IN', {
                dateStyle: 'medium',
                timeStyle: 'short',
              })}
            </Badge>
          )}
          <span
            className="ml-auto"
            title="Every sentence comes from a reviewed template; values come from the case"
          >
            <Badge tone="success" icon="shield" size="lg">
              Built from templates · 0 AI calls
            </Badge>
          </span>
        </div>
      </div>

      {!n.allowed ? (
        <div className="flex items-start gap-4 rounded-card border border-warm-200 bg-warm-50 px-6 py-5 text-warm-900">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-warm-100">
            <Icon name="info" size={20} />
          </span>
          <div>
            <h2 className="text-lg font-bold">No notice can be sent for this case</h2>
            <p className="mt-1">{n.blockedReason}</p>
            <Link
              to={`/cases/${caseId}`}
              className="mt-3 inline-flex items-center gap-1 font-semibold text-navy-900 underline"
            >
              Back to the case
            </Link>
          </div>
        </div>
      ) : (
        <>
          <div className="no-print mb-4 grid items-stretch gap-4 lg:grid-cols-[1fr_auto]">
            <div className="flex flex-col justify-center gap-3 rounded-card border border-line bg-white p-4 shadow-card">
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-overline font-bold uppercase text-ink-muted">Script</span>
                <Tabs
                  label="Script"
                  value={mode}
                  onChange={setMode}
                  items={MODES.map((m) => ({
                    value: m.key,
                    label: m.label,
                    className: m.className,
                  }))}
                />
              </div>
              <div className="flex flex-wrap gap-2">
                {(mode === 'mni_mtei' || mode === 'all') &&
                  n.rendered?.review.mni_mtei === 'auto' && (
                    <Badge tone="warn" icon="alert">
                      Meetei Mayek auto-transliterated — pending review
                    </Badge>
                  )}
                {mode !== 'en' && (n.rendered?.review.pendingCount ?? 0) > 0 && (
                  <Badge tone="warn" icon="users">
                    Manipuri draft — {n.rendered?.review.pendingCount} template
                    {n.rendered?.review.pendingCount === 1 ? '' : 's'} pending native-speaker review
                  </Badge>
                )}
              </div>
            </div>
            <AudioPlayer caseId={caseId} audio={n.audio} />
          </div>

          <div className="no-print mb-6 flex flex-wrap items-center gap-2 rounded-card border border-line bg-white p-3 shadow-card">
            <Button variant="navy" icon="print" onClick={() => window.print()}>
              Print (A4)
            </Button>
            <a
              href={`https://wa.me/?text=${encodeURIComponent(whatsappText)}`}
              target="_blank"
              rel="noreferrer"
              className={`${buttonClass('secondary')} !border-[#178a49] !text-[#126b39] hover:!bg-[#effaf3]`}
            >
              <Icon name="message" size={18} />
              Share on WhatsApp
            </a>
            <span aria-hidden className="mx-2 h-7 w-px bg-line" />
            <span className="text-overline font-bold uppercase text-ink-muted">Mark sent</span>
            {(['print', 'whatsapp', 'in_person'] as const).map((ch) => (
              <Button
                key={ch}
                size="sm"
                onClick={() => void markSent(ch)}
                disabled={!officer || !can('send_for_correction')}
                title={!officer ? 'Choose an officer first' : undefined}
              >
                Mark sent · {ch === 'in_person' ? 'handed over' : ch}
              </Button>
            ))}
            {message && (
              <span className="flex items-center gap-1.5 text-sm font-medium text-teal-darker">
                <Icon name="check" size={16} />
                {message}
              </span>
            )}
          </div>

          <div className="rounded-panel bg-[#e4e8ee] p-8 print:bg-transparent print:p-0">
            <NoticeDocument notice={n} mode={mode} qrDataUrl={qr} statusUrl={statusUrl} />
          </div>
        </>
      )}
    </div>
  );
}
