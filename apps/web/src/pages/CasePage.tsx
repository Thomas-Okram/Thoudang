import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router';
import { EmptyState, Page } from '../components/Page';
import { DocumentViewer } from '../components/case/DocumentViewer';
import { IdentityCard } from '../components/case/IdentityCard';
import { FlagsPanel } from '../components/case/FlagsPanel';
import { FieldsTable } from '../components/case/FieldsTable';
import { StatusBanner } from '../components/case/StatusBanner';
import { ActionBar } from '../components/case/ActionBar';
import { AuditDrawer } from '../components/case/AuditDrawer';
import {
  addNote,
  approveCase,
  editField,
  fetchCase,
  resolveFlag,
  sendForCorrection,
  type CaseDetail,
  type CaseFlag,
} from '../lib/api';
import { usePipelineEvents, type PipelineEvent } from '../lib/events';
import { highlightForEvidence, type Highlight } from '../lib/highlight';
import { useOfficer } from '../lib/officer';
import { ButtonLink, Icon, Toast } from '../components/ui';

const DOC_ORDER = ['application_form', 'aadhaar', 'bank_passbook', 'epic', 'other'];

export function CasePage() {
  const { caseId } = useParams();
  if (!caseId) {
    return (
      <Page title="Case" subtitle="Open a case from the Queue or from Intake.">
        <EmptyState
          heading="No case selected"
          icon="queue"
          body="Pick a case in the Queue to scrutinise its documents, identity checks and flags."
          action={
            <ButtonLink to="/queue" variant="navy" iconRight="arrowRight">
              Go to the queue
            </ButtonLink>
          }
        />
      </Page>
    );
  }
  return <CaseView caseId={caseId} />;
}

function CaseView({ caseId }: { caseId: string }) {
  const qc = useQueryClient();
  const { officer, can, meta } = useOfficer();
  const key = useMemo(() => ['case', caseId, officer?.id ?? null] as const, [caseId, officer?.id]);
  const { data, error, isPending } = useQuery({
    queryKey: key,
    queryFn: () => fetchCase(caseId),
    refetchInterval: (q) => {
      const s = q.state.data?.case.processingState;
      return s === 'RECEIVED' || s === 'EXTRACTING' ? 1500 : false;
    },
  });

  const [activeDoc, setActiveDoc] = useState<string | null>(null);
  const [hover, setHover] = useState<Highlight | null>(null);
  const [focus, setFocus] = useState<Highlight | null>(null);
  const [selectedFlag, setSelectedFlag] = useState<string | null>(null);
  const [auditOpen, setAuditOpen] = useState(false);
  const [toast, setToast] = useState<{ text: string; tone: 'ok' | 'error' } | null>(null);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  // Another officer (or the pipeline) changed this case → refresh.
  usePipelineEvents(
    useCallback(
      (e: PipelineEvent) => {
        if (
          e.type === 'case' &&
          e.caseId === caseId &&
          (e.stage === 'done' || e.stage === 'updated')
        ) {
          void qc.invalidateQueries({ queryKey: ['case', caseId] });
        }
      },
      [caseId, qc],
    ),
    `?caseId=${caseId}`,
  );

  const documents = useMemo(
    () =>
      [...(data?.documents ?? [])].sort(
        (a, b) =>
          DOC_ORDER.indexOf(a.detectedType ?? 'other') -
          DOC_ORDER.indexOf(b.detectedType ?? 'other'),
      ),
    [data?.documents],
  );
  const highlight = hover ?? focus;
  const shownDoc = activeDoc ?? documents[0]?.id ?? null;

  const mutate = useCallback(
    async (fn: () => Promise<CaseDetail>, ok: string) => {
      try {
        const next = await fn();
        qc.setQueryData(key, next);
        void qc.invalidateQueries({ queryKey: ['cases'] });
        void qc.invalidateQueries({ queryKey: ['stats'] });
        setToast({ text: ok, tone: 'ok' });
      } catch (err) {
        setToast({
          text: err instanceof Error ? err.message : 'Something went wrong',
          tone: 'error',
        });
        throw err;
      }
    },
    [key, qc],
  );

  const selectFlag = useCallback(
    (f: CaseFlag) => {
      setSelectedFlag(f.id);
      setHover(null); // an explicit selection beats a stale hover
      const h = highlightForEvidence(f.evidence, documents);
      if (h) {
        setFocus(h);
        setActiveDoc(h.documentId);
      }
    },
    [documents],
  );

  const onResolve = useCallback(
    (
      f: CaseFlag,
      decision: 'accept' | 'override' | 'reopen',
      reason?: { reasonCode: string; reasonText?: string },
    ) =>
      mutate(
        () => resolveFlag(caseId, f.id, { decision, ...reason }),
        decision === 'accept'
          ? `Accepted “${f.title}”`
          : decision === 'override'
            ? `Overrode “${f.title}”`
            : `Reopened “${f.title}”`,
      ).catch(() => undefined),
    [caseId, mutate],
  );

  if (isPending) return <CaseSkeleton />;
  if (error || !data) {
    return (
      <Page title="Case" subtitle="">
        <EmptyState
          icon="search"
          heading="Case not found"
          body={error instanceof Error ? error.message : 'Unknown case'}
        />
      </Page>
    );
  }

  const approved = data.case.status === 'APPROVED_BY_OFFICER';
  const readOnlyReason = !officer
    ? 'Choose who you are (top right) to accept or override flags.'
    : approved
      ? 'Approved — the case is locked.'
      : null;

  return (
    <div className="grid min-h-[calc(100vh-4rem)] grid-cols-1 xl:grid-cols-[minmax(0,46fr)_minmax(0,54fr)]">
      <div className="border-r border-line bg-white xl:sticky xl:top-16 xl:h-[calc(100vh-4rem)]">
        <div className="h-[70vh] xl:h-full">
          <DocumentViewer
            documents={documents}
            activeId={shownDoc}
            onSelect={setActiveDoc}
            highlight={highlight}
          />
        </div>
      </div>

      <div className="min-w-0 space-y-5 px-5 py-5 xl:px-7">
        <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-sm text-ink-muted">
          <Link to="/queue" className="flex items-center gap-1 font-medium hover:text-navy-900">
            <Icon name="queue" size={15} />
            Queue
          </Link>
          <Icon name="chevronRight" size={14} />
          <span className="font-semibold text-navy-900" aria-current="page">
            {data.case.reference}
          </span>
        </nav>
        <StatusBanner d={data} />
        <IdentityCard
          identity={data.identity}
          onHover={(t) => {
            setHover(t ? { ...t, mode: 'hover' } : null);
            if (t) setActiveDoc(t.documentId);
          }}
        />
        <FlagsPanel
          flags={data.flags}
          documents={documents}
          selectedId={selectedFlag}
          onSelect={selectFlag}
          onResolve={onResolve}
          canResolve={Boolean(officer) && can('resolve_flag') && !approved}
          readOnlyReason={readOnlyReason}
          reasons={meta?.overrideReasons ?? []}
        />
        <FieldsTable
          documents={documents}
          canEdit={Boolean(officer) && can('edit_field') && !approved}
          reasons={meta?.editReasons ?? []}
          onHover={(t) => {
            setHover(t ? { ...t, mode: 'hover' } : null);
            if (t) setActiveDoc(t.documentId);
          }}
          onFocusField={(t) => {
            setHover(null);
            setFocus({ ...t, mode: 'click' });
            setActiveDoc(t.documentId);
          }}
          onEdit={(args) => mutate(() => editField(caseId, args), 'Saved — rules re-checked')}
        />
        <ActionBar
          d={data}
          hasOfficer={Boolean(officer)}
          canApproveRole={can('approve')}
          canCorrectRole={can('send_for_correction')}
          onApprove={() =>
            mutate(() => approveCase(caseId), 'Approved for sanction').catch(() => undefined)
          }
          onSendForCorrection={() =>
            mutate(() => sendForCorrection(caseId), 'Sent for citizen correction').catch(
              () => undefined,
            )
          }
          onOpenAudit={() => setAuditOpen(true)}
          onAddNote={(text) => mutate(() => addNote(caseId, text), 'Note added')}
        />
      </div>

      {auditOpen && <AuditDrawer entries={data.audit} onClose={() => setAuditOpen(false)} />}
      {toast && <Toast tone={toast.tone}>{toast.text}</Toast>}
    </div>
  );
}

function CaseSkeleton() {
  return (
    <div
      className="grid min-h-[calc(100vh-4rem)] grid-cols-1 xl:grid-cols-[minmax(0,46fr)_minmax(0,54fr)]"
      aria-busy
    >
      <div className="border-r border-line bg-white p-4">
        <div className="flex gap-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="skeleton h-12 w-36" />
          ))}
        </div>
        <div className="skeleton mt-4 h-[70vh] w-full" />
      </div>
      <div className="space-y-4 p-6">
        <div className="skeleton h-36 w-full" />
        <div className="skeleton h-56 w-full" />
        <div className="skeleton h-72 w-full" />
      </div>
    </div>
  );
}
