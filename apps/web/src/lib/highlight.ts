import { EVIDENCE_DOC_TYPE, extractionFieldFor } from '@thoudang/core';
import type { CaseDocument, FlagEvidence } from './api';

/** What the document viewer should outline. `field` is the extraction (wire) field name. */
export interface Highlight {
  documentId: string;
  field: string | null;
  /** 'click' also switches tab and zooms to the box; 'hover' only outlines. */
  mode: 'hover' | 'click';
}

export function wireField(e: Pick<FlagEvidence, 'document' | 'field'>): string | null {
  return extractionFieldFor(e);
}

/** The first document of the evidence's type (multi-image types: prefer one that has the field). */
export function documentFor(
  e: Pick<FlagEvidence, 'document' | 'field'>,
  docs: CaseDocument[],
): CaseDocument | null {
  const type = EVIDENCE_DOC_TYPE[e.document];
  const field = wireField(e);
  const ofType = docs.filter((d) => d.detectedType === type);
  return (
    ofType.find((d) => field && d.extraction?.fields[field]?.value != null) ?? ofType[0] ?? null
  );
}

/** Evidence → highlight target; prefers evidence that actually has a bounding box. */
export function highlightForEvidence(
  evidence: FlagEvidence[],
  docs: CaseDocument[],
): Highlight | null {
  const targets = evidence
    .map((e) => {
      const doc = documentFor(e, docs);
      const field = wireField(e);
      return doc
        ? {
            documentId: doc.id,
            field,
            hasBox: Boolean(field && doc.extraction?.fields[field]?.bbox),
          }
        : null;
    })
    .filter((t): t is NonNullable<typeof t> => t !== null);
  const best = targets.find((t) => t.hasBox) ?? targets[0];
  return best ? { documentId: best.documentId, field: best.field, mode: 'click' } : null;
}

export const DOC_SHORT: Record<FlagEvidence['document'], string> = {
  form: 'Form',
  aadhaar: 'Aadhaar',
  passbook: 'Passbook',
  epic: 'Voter ID',
};
