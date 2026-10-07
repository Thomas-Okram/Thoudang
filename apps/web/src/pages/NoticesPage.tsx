import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { fetchNotices } from '../lib/api';
import { EmptyState, Page } from '../components/Page';
import { StatusBadge } from '../components/StatusBadge';
import { ButtonLink, Icon, Skeleton } from '../components/ui';

export function NoticesPage() {
  const { data, isPending } = useQuery({ queryKey: ['notices'], queryFn: fetchNotices });
  const list = data?.notices ?? [];
  const pending = list.filter((n) => n.allowed && !n.noticeSentAt).length;
  return (
    <Page
      title="Notices"
      eyebrow="Step 3 · Tell the citizen"
      subtitle="Deficiency notices for citizens — English, Meetei Mayek and Bengali script, printable, with audio."
    >
      <div className="mb-5 flex flex-wrap items-center gap-3 rounded-card border border-line bg-white px-5 py-4 shadow-card">
        <span className="text-[2rem] font-bold leading-none tabular-nums text-navy-900">
          {pending}
        </span>
        <span className="text-ink-soft">
          notice{pending === 1 ? '' : 's'} ready to send · built from reviewed templates, no AI
          writes citizen-facing text.
        </span>
        <span className="ml-auto flex gap-1.5 text-sm">
          <span className="rounded-lg bg-slate-100 px-2 py-0.5">English</span>
          <span className="font-mtei rounded-lg bg-slate-100 px-2 py-0.5">ꯃꯤꯇꯩ ꯃꯌꯦꯛ</span>
          <span className="font-beng rounded-lg bg-slate-100 px-2 py-0.5">বাংলা লিপি</span>
        </span>
      </div>
      {isPending && <Skeleton className="h-48" />}
      {!isPending && !list.length && (
        <EmptyState
          icon="notice"
          heading="No notices needed"
          body="Cases that need a citizen correction appear here."
        />
      )}
      <ul className="space-y-2.5">
        {list.map((n) => (
          <li
            key={n.caseId}
            className="flex flex-wrap items-center gap-4 rounded-card border border-line bg-white px-5 py-4 shadow-card transition hover:shadow-raised"
          >
            <span
              className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${n.noticeSentAt ? 'bg-teal-wash text-teal-deep' : n.allowed ? 'bg-warm-50 text-warm-700' : 'bg-slate-100 text-slate-500'}`}
            >
              <Icon name={n.noticeSentAt ? 'send' : n.allowed ? 'notice' : 'lock'} size={21} />
            </span>
            <div className="min-w-56 flex-1">
              <div className="text-[1.05rem] font-semibold text-navy-900">
                {n.applicantName ?? 'Name not read'}
              </div>
              <div className="text-sm text-ink-muted">
                <span className="font-mono">{n.reference}</span>
                {n.district && ` · ${n.district}`}
                {n.allowed && ` · ${n.items} correction${n.items === 1 ? '' : 's'}`}
              </div>
            </div>
            <StatusBadge status={n.status} />
            {n.noticeSentAt ? (
              <span className="text-sm text-ink-soft">
                Sent {new Date(n.noticeSentAt).toLocaleDateString('en-IN', { dateStyle: 'medium' })}
              </span>
            ) : !n.allowed ? (
              <span className="max-w-xs text-sm text-warm-700">{n.blockedReason}</span>
            ) : null}
            {n.allowed ? (
              <ButtonLink to={`/cases/${n.caseId}/notice`} variant="navy" iconRight="arrowRight">
                {n.noticeSentAt ? 'View notice' : 'Open notice'}
              </ButtonLink>
            ) : (
              <ButtonLink to={`/cases/${n.caseId}`}>Open case</ButtonLink>
            )}
          </li>
        ))}
      </ul>
    </Page>
  );
}
