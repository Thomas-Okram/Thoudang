import { useState } from 'react';
import type { CaseDetail } from '../../lib/api';
import { Button, ButtonLink } from '../ui/Button';
import { Icon } from '../ui/Icon';

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
    <div className="sticky bottom-3 z-20 rounded-card border border-line bg-white/95 px-4 py-3 shadow-[0_10px_40px_-12px_rgba(10,27,51,0.45)] backdrop-blur">
      <div className="flex flex-wrap items-center gap-2.5">
        <Button
          variant="success"
          size="md"
          icon="check"
          disabled={Boolean(approveWhy)}
          loading={busy === 'approve'}
          loadingLabel="Approving…"
          onClick={() => run('approve', onApprove)}
          title={approveWhy ?? 'Approve for sanction'}
        >
          Approve for sanction
        </Button>
        <Button
          variant="attention"
          size="md"
          icon="user"
          disabled={Boolean(correctWhy) || busy === 'approve'}
          loading={busy === 'correct'}
          loadingLabel="Sending…"
          onClick={() => run('correct', onSendForCorrection)}
          title={correctWhy ?? 'Send for citizen correction'}
        >
          Send for citizen correction
        </Button>
        {d.notice.allowed ? (
          <ButtonLink to={`/cases/${d.case.id}/notice`} variant="secondary" size="md" icon="notice">
            {d.case.noticeSentAt ? 'View notice' : 'Generate notice'}
          </ButtonLink>
        ) : (
          <Button
            size="md"
            icon="notice"
            disabled
            title={d.notice.reasons[0] ?? 'No notice needed'}
            className="border-dashed"
          >
            Generate notice
          </Button>
        )}
        {d.case.noticeSentAt && (
          <span className="text-xs text-ink-muted">
            Notice sent on{' '}
            {new Date(d.case.noticeSentAt).toLocaleDateString('en-IN', { dateStyle: 'medium' })}
          </span>
        )}
        <span className="ml-auto flex gap-1">
          <Button
            variant="ghost"
            size="sm"
            icon="note"
            onClick={() => setNoteOpen((o) => !o)}
            disabled={!hasOfficer}
          >
            Add note
          </Button>
          <Button variant="ghost" size="sm" icon="history" onClick={onOpenAudit}>
            Audit trail ({d.audit.length})
          </Button>
        </span>
      </div>
      {(approveWhy || correctWhy) && !approved && (
        <p
          className="mt-2.5 flex items-start gap-1.5 text-[0.82rem] text-ink-muted"
          data-testid="action-hints"
        >
          <Icon name="info" size={15} className="mt-0.5 shrink-0" />
          <span>
            {approveWhy && <span>Approve: {approveWhy}. </span>}
            {correctWhy && <span>Correction: {correctWhy}</span>}
          </span>
        </p>
      )}
      {noteOpen && (
        <form
          className="mt-3 flex gap-2"
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
            className="flex-1 rounded-control border border-line-strong px-3 py-2 text-[0.95rem] focus:border-teal-accent focus:outline-none focus:ring-2 focus:ring-teal-accent/40"
          />
          <Button type="submit" variant="navy">
            Save note
          </Button>
        </form>
      )}
    </div>
  );
}
