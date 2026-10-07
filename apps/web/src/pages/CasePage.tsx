import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router';
import { EmptyState, Page } from '../components/Page';
import { StatusBadge } from '../components/StatusBadge';
import { fetchCase, type CaseDetail, type CaseFlag } from '../lib/api';
import { DOC_LABEL, prettyField } from '../lib/labels';

/** Interim case summary (Phase 4). The full scrutiny view with image highlights is Phase 5. */
export function CasePage() {
  const { caseId } = useParams();
  const { data, error, isPending } = useQuery({
    queryKey: ['case', caseId],
    queryFn: () => fetchCase(caseId!),
    enabled: Boolean(caseId),
    refetchInterval: (q) => {
      const s = q.state.data?.case.processingState;
      return s === 'RECEIVED' || s === 'EXTRACTING' ? 2000 : false;
    },
  });

  if (!caseId) {
    return (
      <Page title="Case" subtitle="Open a case from Intake or the Queue.">
        <EmptyState
          heading="No case selected"
          body="Screen a packet on the Intake page, then open it here."
        />
      </Page>
    );
  }
  if (isPending)
    return (
      <Page title="Case" subtitle="Loading…">
        <div />
      </Page>
    );
  if (error || !data) {
    return (
      <Page title="Case" subtitle="">
        <EmptyState
          heading="Case not found"
          body={error instanceof Error ? error.message : 'Unknown case'}
        />
      </Page>
    );
  }
  return <CaseSummaryView d={data} />;
}

const SEVERITY_STYLE: Record<CaseFlag['severity'], string> = {
  critical: 'border-l-rose-500 bg-rose-50/60',
  warn: 'border-l-amber-500 bg-amber-50/60',
  info: 'border-l-slate-400 bg-slate-50',
};
const ACTION_LABEL: Record<CaseFlag['action'], string> = {
  citizen: 'Citizen must correct',
  officer: 'Officer to review',
  none: 'For information',
};
const CONF_STYLE = {
  high: 'text-emerald-700',
  medium: 'text-amber-700',
  low: 'text-rose-700',
} as const;

function CaseSummaryView({ d }: { d: CaseDetail }) {
  const c = d.case;
  const flags = [...d.flags].sort(
    (a, b) =>
      ({ critical: 0, warn: 1, info: 2 })[a.severity] -
      { critical: 0, warn: 1, info: 2 }[b.severity],
  );
  return (
    <Page
      title={c.applicantName ?? c.reference}
      subtitle={`${c.reference} · received ${new Date(c.receivedAt).toLocaleString('en-IN')}`}
    >
      <section className="flex flex-wrap items-center gap-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <StatusBadge status={c.status} large />
        <span className="text-slate-600">
          Priority <strong className="text-navy-900">{c.priorityScore}</strong>
          {c.priorityReasons.length > 0 && <> · {c.priorityReasons.join(' · ')}</>}
        </span>
        {c.aadhaarMasked && (
          <span className="font-mono text-slate-600">Aadhaar {c.aadhaarMasked}</span>
        )}
        {c.processingState === 'EXTRACTING' && (
          <span className="text-teal-accent">Processing…</span>
        )}
        <span className="ml-auto text-sm text-slate-500">
          Notice: {d.notice.allowed ? 'can be drafted' : (d.notice.reasons[0] ?? 'not needed')}
        </span>
      </section>

      <section className="mt-6">
        <h2 className="mb-3 text-xl font-bold text-navy-900">Flags ({flags.length})</h2>
        {flags.length === 0 && <p className="text-slate-600">No flags — every check passed.</p>}
        <ul className="space-y-2">
          {flags.map((f) => (
            <li
              key={f.id}
              className={`rounded-lg border border-l-4 border-slate-200 p-4 ${SEVERITY_STYLE[f.severity]}`}
            >
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <code className="rounded bg-white px-1.5 font-semibold text-navy-900">
                  {f.code}
                </code>
                <span className="uppercase tracking-wide text-slate-500">{f.severity}</span>
                <span className="text-slate-500">· {ACTION_LABEL[f.action]}</span>
              </div>
              <p className="mt-1 text-navy-900">{f.reason}</p>
              {f.evidence.length > 0 && (
                <ul className="mt-2 flex flex-wrap gap-2 text-xs text-slate-600">
                  {f.evidence.map((e, i) => (
                    <li key={i} className="rounded bg-white px-2 py-1 ring-1 ring-slate-200">
                      {e.document}.{e.field}:{' '}
                      <strong>{e.value === null ? '—' : String(e.value)}</strong>
                      {e.confidence !== undefined && (
                        <span className="text-slate-400"> ({Math.round(e.confidence * 100)}%)</span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-8 space-y-5">
        <h2 className="text-xl font-bold text-navy-900">Documents</h2>
        {d.documents.map((doc) => (
          <article
            key={doc.id}
            className="grid gap-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm md:grid-cols-[220px_1fr]"
          >
            <a href={doc.imageUrl} target="_blank" rel="noreferrer" className="block">
              <img
                src={doc.thumbUrl}
                alt={doc.originalName}
                className="w-full rounded border border-slate-200 bg-slate-50 object-contain"
              />
            </a>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-lg font-bold text-navy-900">
                  {doc.detectedType ? DOC_LABEL[doc.detectedType] : 'Unidentified'}
                </h3>
                <span className="text-sm text-slate-500">{doc.originalName}</span>
                {doc.cacheHit && (
                  <span className="rounded bg-slate-200 px-1.5 text-xs font-semibold text-slate-600">
                    cached
                  </span>
                )}
                {doc.extraction?.legibility === 'poor' && (
                  <span className="rounded bg-amber-100 px-1.5 text-xs font-semibold text-amber-900">
                    poor legibility
                  </span>
                )}
              </div>
              {doc.error && (
                <p className="mt-2 rounded bg-rose-50 px-3 py-1.5 text-sm text-rose-800">
                  {doc.error}
                </p>
              )}
              {doc.extraction && (
                <table className="mt-3 w-full text-sm">
                  <tbody>
                    {Object.entries(doc.extraction.fields).map(([name, v]) => (
                      <tr key={name} className="border-t border-slate-100">
                        <td className="w-56 py-1.5 pr-3 text-slate-500">{prettyField(name)}</td>
                        <td className="py-1.5 font-medium text-navy-900">
                          {v.value ?? <span className="italic text-slate-400">{v.status}</span>}
                        </td>
                        <td
                          className={`w-20 py-1.5 text-right text-xs font-semibold ${CONF_STYLE[v.confidence]}`}
                        >
                          {v.confidence}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {doc.extraction?.notes && (
                <p className="mt-2 text-sm text-slate-600">Notes: {doc.extraction.notes}</p>
              )}
            </div>
          </article>
        ))}
      </section>

      <section className="mt-8">
        <h2 className="mb-3 text-xl font-bold text-navy-900">Audit trail</h2>
        <ol className="space-y-1 font-mono text-xs text-slate-600">
          {d.audit.map((a) => (
            <li key={a.id}>
              {new Date(a.createdAt).toLocaleTimeString('en-IN')} · {a.actor} ·{' '}
              <strong>{a.action}</strong> · {a.entityType}
            </li>
          ))}
        </ol>
        <Link to="/intake" className="mt-6 inline-block text-teal-accent hover:underline">
          ← Back to intake
        </Link>
      </section>
    </Page>
  );
}
