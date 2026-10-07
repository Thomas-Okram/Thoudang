export interface HealthResponse {
  status: 'ok' | 'degraded';
  service: string;
  db: 'ok' | 'error';
  claudeConfigured: boolean;
  demoMode: 'live' | 'cache_first' | 'cache_only';
  model: string;
  time: string;
}

export type CaseStatus =
  'READY' | 'NEEDS_CITIZEN_CORRECTION' | 'OFFICER_ATTENTION' | 'APPROVED_BY_OFFICER';

export type DetectedType = 'application_form' | 'aadhaar' | 'bank_passbook' | 'epic' | 'other';

export interface CaseSummary {
  id: string;
  reference: string;
  applicantName: string | null;
  district: string | null;
  status: CaseStatus;
  processingState: 'RECEIVED' | 'EXTRACTING' | 'SCREENED' | 'EXTRACTION_FAILED';
  priorityScore: number;
  priorityReasons: string[];
  aadhaarMasked: string | null;
  applicantDob: string | null;
  source: string;
  batchId: string | null;
  packetName: string | null;
  receivedAt: string;
}

export interface ExtractedValue {
  value: string | null;
  status: 'present' | 'blank' | 'unreadable';
  confidence: 'high' | 'medium' | 'low';
  bbox: [number, number, number, number] | null;
}

export interface CaseDocument {
  id: string;
  originalName: string;
  detectedType: DetectedType | null;
  typeConfidence: 'high' | 'medium' | 'low' | null;
  state: 'UPLOADED' | 'CLASSIFIED' | 'EXTRACTED' | 'FAILED' | 'SKIPPED';
  width: number;
  height: number;
  imageUrl: string;
  thumbUrl: string;
  classification: { type: DetectedType; confidence: string; reason: string } | null;
  extraction: {
    legibility: 'good' | 'poor';
    notes: string;
    fields: Record<string, ExtractedValue>;
    aadhaar: { masked: string | null; checksumValid: boolean | null } | null;
  } | null;
  error: string | null;
  cacheHit: boolean;
  latencyMs: number;
}

export interface CaseFlag {
  id: string;
  code: string;
  severity: 'info' | 'warn' | 'critical';
  action: 'citizen' | 'officer' | 'none';
  reason: string;
  evidence: {
    document: string;
    field: string;
    value: string | number | boolean | null;
    confidence?: number;
  }[];
  resolution: string;
}

export interface AuditEntry {
  id: number;
  actor: string;
  action: string;
  entityType: string;
  entityId: string | null;
  after: unknown;
  reason: string | null;
  createdAt: string;
}

export interface CaseDetail {
  case: CaseSummary;
  documents: CaseDocument[];
  flags: CaseFlag[];
  notice: { allowed: boolean; blockedBy: string[]; reasons: string[] };
  audit: AuditEntry[];
}

export interface UploadSession {
  sessionId: string;
  mobileUrl: string;
  maxFiles: number;
  files: {
    id: string;
    originalName: string;
    size: number;
    from: 'desk' | 'phone';
    thumbUrl: string;
  }[];
}

export interface CreatedCase {
  caseId: string;
  reference: string;
  documents: number;
}

export interface BatchResult {
  batchId: string;
  cases: (CreatedCase & { packetName: string })[];
  skipped: { packetName: string; reason: string }[];
}

async function handle<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      // keep status text
    }
    throw new Error(message);
  }
  return (await res.json()) as T;
}

export const getJson = <T>(path: string) =>
  fetch(path, { headers: { Accept: 'application/json' } }).then((r) => handle<T>(r));

const send = <T>(path: string, init: RequestInit) => fetch(path, init).then((r) => handle<T>(r));

export const fetchHealth = () => getJson<HealthResponse>('/api/health');
export const fetchCase = (id: string) => getJson<CaseDetail>(`/api/cases/${id}`);
export const fetchCases = (q = '') => getJson<{ cases: CaseSummary[] }>(`/api/cases${q}`);

export const createSession = () => send<UploadSession>('/api/sessions', { method: 'POST' });
export const fetchSession = (id: string) => getJson<UploadSession>(`/api/sessions/${id}`);

export function uploadToSession(id: string, files: File[], from: 'desk' | 'phone') {
  const form = new FormData();
  files.forEach((f) => form.append('files', f, f.name));
  return send<UploadSession>(`/api/sessions/${id}/files?from=${from}`, {
    method: 'POST',
    body: form,
  });
}

export const removeSessionFile = (id: string, fileId: string) =>
  send<UploadSession>(`/api/sessions/${id}/files/${fileId}`, { method: 'DELETE' });

export const submitSession = (id: string) =>
  send<CreatedCase>(`/api/sessions/${id}/submit`, { method: 'POST' });

/** Folder upload: each file is preceded by its relative path ("batch/packet-01/form.jpg"). */
export function uploadBatch(files: { file: File; relPath: string }[]) {
  const form = new FormData();
  for (const { file, relPath } of files) {
    form.append('paths', relPath);
    form.append('files', file, file.name);
  }
  return send<BatchResult>('/api/cases/batch', { method: 'POST', body: form });
}

export function uploadBatchZip(zip: File) {
  const form = new FormData();
  form.append('files', zip, zip.name);
  return send<BatchResult>('/api/cases/batch', { method: 'POST', body: form });
}
