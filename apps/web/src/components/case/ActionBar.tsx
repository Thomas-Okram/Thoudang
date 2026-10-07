import { useState } from 'react';
import { Link } from 'react-router';
import type { CaseDetail } from '../../lib/api';

export function ActionBar({
  d,
  canApproveRole,
  canCorrectRole,
  hasOfficer,
  onApprove,
  onSendForCorrection,
  onOpenAudit,
  onAddNote,
}: {
  d: CaseDetail;
  canApproveRole: boolean;
  canCorrectRole: boolean;
  hasOfficer: boolean;
  onApprove: () => Promise<void>;
  onSendForCorrection: () => Promise<void>;
  onOpenAudit: () => void;
  onAddNote: (text: string) => Promise<void>;
}) {
  const [busy, setBusy] = useState<'approve' | 'correct' | null>(null);
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState('');
  const approved = d.case.status === 'APPROVED_BY_OFFICER';

  const approveWhy = !hasOfficer
    ? 'Choose an officer first'
    : !canApproveRole
      ? 'Only the DSWO can approve'
      : approved
        ? 'Already approved'
        : d.actions.approveBlockedBy.length
          ? `Resolve first: ${[...new Set(d.actions.approveBlockedBy.map((b) => b.title))].join(', ')}`
          : null;
  const correctWhy = !hasOfficer
    ? 'Choose an officer first'
    : !canCorrectRole
      ? 'Not allowed for this role'
      : approved
        ? 'Already approved'
        : d.actions.correctionBlockedReason;

  const run = async (kind: 'approve' | 'correct', fn: () => Promise<void>) => {
    setBusy(kind);
    try {
      await fn();
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="sticky bottom-0 z-20 -mx-1 rounded-xl border border-slate-200 bg-white/95 px-4 py-3 shadow-[0_-6px_20px_-12px_rgba(10,27,51,0.35)] backdrop-blur">
      <div className="flex flex-wrap items-center gap-2">
        <button
          disabled={Boolean(approveWhy) || busy !== null}
          onClick={() => run('approve', onApprove)}
          title={approveWhy ?? 'Approve for sanction'}
          className="rounded-lg bg-emerald-600 px-4 py-2.5 font-bold text-white shadow-sm transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          {busy === 'approve' ? 'Approving…' : 'Approve for sanction'}
        </button>
        <button
          disabled={Boolean(correctWhy) || busy !== null}
          onClick={() => run('correct', onSendForCorrection)}
          title={correctWhy ?? 'Send for citizen correction'}
          className="rounded-lg border border-amber-500 bg-white px-4 py-2.5 font-semibold text-amber-900 transition hover:bg-amber-50 disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-400"
        >
          {busy === 'correct' ? 'Sending…' : 'Send for citizen correction'}
        </button>
        {d.notice.allowed ? (
          <Link
            to={`/cases/${d.case.id}/notice`}
            className="rounded-lg border border-navy-900 bg-white px-4 py-2.5 font-semibold text-navy-900 transition hover:bg-slate-50"
          >
            {d.case.noticeSentAt ? 'View notice' : 'Generate notice'}
          </Link>
        ) : (
          <button
            disabled
            title={d.notice.reasons[0] ?? 'No notice needed'}
            className="cursor-not-allowed rounded-lg border border-dashed border-slate-300 px-4 py-2.5 font-semibold text-slate-400"
          >
            Generate notice
          </button>
        )}
        {d.case.noticeSentAt && (
          <span className="text-xs text-slate-500">
            Notice sent on{' '}
            {new Date(d.case.noticeSentAt).toLocaleDateString('en-IN', { dateStyle: 'medium' })}
          </span>
        )}
        <span className="ml-auto flex gap-1">
          <button
            onClick={() => setNoteOpen((o) => !o)}
            disabled={!hasOfficer}
            className="rounded-lg px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100 disabled:text-slate-300"
          >
            Add note
          </button>
          <button
            onClick={onOpenAudit}
            className="rounded-lg px-3 py-2 text-sm font-semibold text-navy-900 hover:bg-slate-100"
          >
            Audit trail ({d.audit.length})
          </button>
        </span>
      </div>
      {(approveWhy || correctWhy) && !approved && (
        <p className="mt-1.5 text-xs text-slate-500" data-testid="action-hints">
          {approveWhy && <span>Approve: {approveWhy}. </span>}
          {correctWhy && <span>Correction: {correctWhy}</span>}
        </p>
      )}
      {noteOpen && (
        <form
          className="mt-2 flex gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!note.trim()) return;
            await onAddNote(note.trim());
            setNote('');
            setNoteOpen(false);
          }}
        >
          <input
            autoFocus
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Note for the file (visible in the audit trail)"
            className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
          <button className="rounded-lg bg-navy-900 px-4 py-2 text-sm font-semibold text-white">
            Save note
          </button>
        </form>
      )}
    </div>
  );
}
