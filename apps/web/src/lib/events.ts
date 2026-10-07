import { useEffect, useRef } from 'react';
import type { CaseStatus, DetectedType } from './api';

export type CaseStage =
  'uploaded' | 'classifying' | 'extracting' | 'screening' | 'done' | 'error' | 'updated';
export type DocumentStage =
  'classifying' | 'classified' | 'extracting' | 'extracted' | 'failed' | 'skipped';

export type PipelineEvent =
  | {
      type: 'case';
      caseId: string;
      reference: string;
      batchId: string | null;
      stage: CaseStage;
      status?: CaseStatus;
      message?: string;
      at: string;
    }
  | {
      type: 'document';
      caseId: string;
      batchId: string | null;
      documentId: string;
      originalName: string;
      stage: DocumentStage;
      detectedType?: DetectedType | null;
      cacheHit?: boolean;
      message?: string;
      at: string;
    }
  | {
      type: 'session';
      sessionId: string;
      action: 'file-added' | 'file-removed' | 'submitted';
      fileId?: string;
      caseId?: string;
      at: string;
    };

/**
 * Subscribes to GET /api/events (Server-Sent Events). EventSource reconnects automatically.
 * `path` overrides the stream (the phone page uses its public /api/sessions/:id/events).
 */
export function usePipelineEvents(
  onEvent: (e: PipelineEvent) => void,
  query = '',
  path = '/api/events',
): void {
  const handler = useRef(onEvent);
  handler.current = onEvent;
  useEffect(() => {
    const source = new EventSource(`${path}${query}`);
    source.onmessage = (msg) => {
      try {
        handler.current(JSON.parse(msg.data as string) as PipelineEvent);
      } catch {
        // ignore malformed frames
      }
    };
    return () => source.close();
  }, [path, query]);
}
