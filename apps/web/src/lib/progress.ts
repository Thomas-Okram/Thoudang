import { useCallback, useEffect, useState } from 'react';
import { fetchCase, type CaseStatus, type DetectedType } from './api';
import {
  usePipelineEvents,
  type CaseStage,
  type DocumentStage,
  type PipelineEvent,
} from './events';

export interface DocProgress {
  id: string;
  name: string;
  stage: DocumentStage | 'uploaded';
  type: DetectedType | null;
  cacheHit: boolean;
  message?: string;
}

export interface CaseProgress {
  caseId: string;
  reference: string;
  packetName?: string;
  stage: CaseStage;
  status?: CaseStatus;
  docs: Record<string, DocProgress>;
  startedAt: number;
  finishedAt?: number;
}

export const STAGE_ORDER: CaseStage[] = [
  'uploaded',
  'classifying',
  'extracting',
  'screening',
  'done',
];

export function applyEvent(
  state: Record<string, CaseProgress>,
  e: PipelineEvent,
): Record<string, CaseProgress> {
  if (e.type === 'session') return state;
  const current = state[e.caseId];
  if (!current) return state;
  if (e.type === 'case') {
    const finished = e.stage === 'done' || e.stage === 'error';
    // Never move backwards (events can arrive after the polling fallback finished the card).
    if (current.stage === 'done') return state;
    return {
      ...state,
      [e.caseId]: {
        ...current,
        stage: e.stage === 'error' ? current.stage : e.stage,
        status: e.status ?? current.status,
        finishedAt: finished && e.stage === 'done' ? Date.now() : current.finishedAt,
      },
    };
  }
  const prev = current.docs[e.documentId];
  return {
    ...state,
    [e.caseId]: {
      ...current,
      docs: {
        ...current.docs,
        [e.documentId]: {
          id: e.documentId,
          name: e.originalName,
          stage: e.stage,
          type: e.detectedType ?? prev?.type ?? null,
          cacheHit: e.cacheHit ?? prev?.cacheHit ?? false,
          message: e.message,
        },
      },
    },
  };
}

/** Live progress for cases started from this page: SSE first, polling as a safety net. */
export function useCaseProgress() {
  const [cases, setCases] = useState<Record<string, CaseProgress>>({});

  usePipelineEvents(useCallback((e: PipelineEvent) => setCases((s) => applyEvent(s, e)), []));

  const track = useCallback((c: { caseId: string; reference: string; packetName?: string }) => {
    setCases((s) => ({
      ...s,
      [c.caseId]: { ...c, stage: 'uploaded', docs: s[c.caseId]?.docs ?? {}, startedAt: Date.now() },
    }));
  }, []);

  const pending = Object.values(cases)
    .filter((c) => c.stage !== 'done')
    .map((c) => c.caseId)
    .join(',');

  useEffect(() => {
    if (!pending) return;
    const timer = setInterval(() => {
      for (const id of pending.split(',')) {
        fetchCase(id)
          .then((d) => {
            if (
              d.case.processingState === 'SCREENED' ||
              d.case.processingState === 'EXTRACTION_FAILED'
            ) {
              setCases((s) => {
                const c = s[id];
                if (!c || c.stage === 'done') return s;
                const docs = Object.fromEntries(
                  d.documents.map((doc) => [
                    doc.id,
                    {
                      id: doc.id,
                      name: doc.originalName,
                      stage: (doc.state === 'FAILED'
                        ? 'failed'
                        : doc.state === 'SKIPPED'
                          ? 'skipped'
                          : 'extracted') as DocumentStage,
                      type: doc.detectedType,
                      cacheHit: doc.cacheHit,
                    },
                  ]),
                );
                return {
                  ...s,
                  [id]: {
                    ...c,
                    stage: 'done',
                    status: d.case.status,
                    docs,
                    finishedAt: Date.now(),
                  },
                };
              });
            }
          })
          .catch(() => undefined);
      }
    }, 4000);
    return () => clearInterval(timer);
  }, [pending]);

  return { cases, track };
}
