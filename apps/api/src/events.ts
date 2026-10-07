import { EventEmitter } from 'node:events';
import type { DetectedType } from './db/schema.js';

export type CaseStage =
  | 'uploaded'
  | 'classifying'
  | 'extracting'
  | 'screening'
  | 'done'
  | 'error'
  /** An officer decision changed the case (flag resolved, field edited, approved …). */
  | 'updated';
export type DocumentStage =
  'classifying' | 'classified' | 'extracting' | 'extracted' | 'failed' | 'skipped';

export type PipelineEvent =
  | {
      type: 'case';
      caseId: string;
      reference: string;
      batchId: string | null;
      stage: CaseStage;
      status?: string;
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

type WithoutAt<T> = T extends unknown ? Omit<T, 'at'> : never;

/** In-process pub/sub feeding the SSE endpoint. */
export class EventBus {
  private readonly emitter = new EventEmitter();
  constructor() {
    this.emitter.setMaxListeners(0);
  }
  publish(event: WithoutAt<PipelineEvent>): void {
    this.emitter.emit('event', { ...event, at: new Date().toISOString() } as PipelineEvent);
  }
  subscribe(listener: (e: PipelineEvent) => void): () => void {
    this.emitter.on('event', listener);
    return () => this.emitter.off('event', listener);
  }
}
