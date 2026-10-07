import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { fetchNotices } from '../lib/api';
import { EmptyState, Page } from '../components/Page';
import { StatusBadge } from '../components/StatusBadge';

export function NoticesPage() {
  const { data, isPending } = useQuery({ queryKey: ['notices'], queryFn: fetchNotices });
  const list = data?.notices ?? [];
  const pending = list.filter((n) => n.allowed && !n.noticeSentAt).length;
  return (
    <Page
      title="Notices"
      subtitle="Deficiency notices for citizens — English, Meetei Mayek and Bengali script, printable, with audio."
    >
      <p className="mb-4 text-slate-600">
        {pending} notice{pending === 1 ? '' : 's'} ready to send · built from reviewed templates, no
        AI writes citizen-facing text.
      </p>
      {isPending && <div className="skeleton h-48" />}
      {!isPending && !list.length && (
        <EmptyState
          heading="No notices needed"
          body="Cases that need a citizen correction appear here."
        />
      )}
      <ul className="space-y-2">
        {list.map((n) => (
          <li
            key={n.caseId}
            className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white px-5 py-3 shadow-sm"
          >
            <div className="min-w-56 flex-1">
              <div className="font-semibold text-navy-900">
                {n.applicantName ?? 'Name not read'}
              </div>
              <div className="text-sm text-slate-500">
                <span className="font-mono">{n.reference}</span>
                {n.district && ` · ${n.district}`}
                {n.allowed && ` · ${n.items} correction${n.items === 1 ? '' : 's'}`}
              </div>
            </div>
            <StatusBadge status={n.status} />
            {n.noticeSentAt ? (
              <span className="text-sm text-slate-600">
                Sent {new Date(n.noticeSentAt).toLocaleDateString('en-IN', { dateStyle: 'medium' })}
              </span>
            ) : !n.allowed ? (
              <span className="max-w-xs text-sm text-amber-800">{n.blockedReason}</span>
            ) : null}
            {n.allowed ? (
              <Link
                to={`/cases/${n.caseId}/notice`}
                className="rounded-lg bg-navy-900 px-4 py-2 text-sm font-semibold text-white hover:bg-navy-800"
              >
                {n.noticeSentAt ? 'View notice' : 'Open notice'}
              </Link>
            ) : (
              <Link
                to={`/cases/${n.caseId}`}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-navy-900"
              >
                Open case
              </Link>
            )}
          </li>
        ))}
      </ul>
    </Page>
  );
}
