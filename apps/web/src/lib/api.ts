export interface HealthResponse {
  demo: boolean;
  ttsConfigured: boolean;
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
export type SlotType = Exclude<DetectedType, 'other'>;
export type Severity = 'info' | 'warn' | 'critical';
export type NameVerdict = 'SAME' | 'LIKELY_SAME' | 'AMBIGUOUS' | 'DIFFERENT';

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
  age: number | null;
  scheme: string;
  source: string;
  historical: boolean;
  noticeSentAt: string | null;
  batchId: string | null;
  packetName: string | null;
  receivedAt: string;
  updatedAt: string;
  screenedAt: string | null;
  screeningMs: number | null;
  forwardedAt: string | null;
  decidedAt: string | null;
  correctionRequestedAt: string | null;
  topFlag: { code: string; title: string; severity: Severity } | null;
  flagCounts: { critical: number; warn: number; info: number };
  openFlags: number;
  searchScore?: number;
}

export interface ExtractedValue {
  value: string | null;
  status: 'present' | 'blank' | 'unreadable';
  confidence: 'high' | 'medium' | 'low';
  bbox: [number, number, number, number] | null;
  editedBy?: string;
}

export interface CaseDocument {
  id: string;
  originalName: string;
  detectedType: DetectedType | null;
  typeConfidence: 'high' | 'medium' | 'low' | null;
  typeSource: 'ai' | 'officer' | null;
  state: 'UPLOADED' | 'CLASSIFIED' | 'EXTRACTED' | 'FAILED' | 'SKIPPED';
  width: number;
  height: number;
  imageUrl: string;
  thumbUrl: string;
  redaction: 'bbox' | 'blur' | 'none';
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
  model: string | null;
}

export interface FlagEvidence {
  document: 'form' | 'aadhaar' | 'passbook' | 'epic';
  field: string;
  value: string | number | boolean | null;
  confidence?: number;
}

export interface CaseFlag {
  id: string;
  code: string;
  title: string;
  severity: Severity;
  action: 'citizen' | 'officer' | 'none';
  reason: string;
  evidence: FlagEvidence[];
  resolution: 'OPEN' | 'ACCEPTED' | 'OVERRIDDEN';
  resolvedBy: string | null;
  resolvedByName: string | null;
  resolvedAt: string | null;
  resolutionReason: string | null;
}

export interface IdentityEntry {
  key: string;
  documentId: string;
  docType: DetectedType;
  label: string;
  field: string;
  value: string;
}

export interface IdentityPair {
  a: string;
  b: string;
  verdict: NameVerdict;
  score: number;
  reasons: string[];
  candidates: string[];
}

export interface Identity {
  entries: IdentityEntry[];
  pairs: IdentityPair[];
  knownYumnaks: string[];
  relatives: string[];
}

export interface AuditEntry {
  id: number;
  actor: string;
  actorName: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  reason: string | null;
  createdAt: string;
  summary: string;
}

export type Permission =
  | 'approve'
  | 'resolve_flag'
  | 'edit_field'
  | 'add_note'
  | 'send_for_correction'
  | 'forward'
  | 'edit_templates';

export interface CaseDetail {
  case: CaseSummary;
  documents: CaseDocument[];
  identity: Identity;
  flags: CaseFlag[];
  notice: { allowed: boolean; blockedBy: string[]; reasons: string[] };
  actions: {
    canApprove: boolean;
    approveBlockedBy: { id: string; code: string; title: string }[];
    canSendForCorrection: boolean;
    correctionBlockedReason: string | null;
    viewerPermissions: Permission[];
  };
  audit: AuditEntry[];
}

export interface Officer {
  id: string;
  name: string;
  role: 'DSWO' | 'DEALING_ASSISTANT';
  roleLabel: string;
  district: string | null;
  permissions: Permission[];
}

export interface Reason {
  code: string;
  label: string;
}

export interface Meta {
  officers: Officer[];
  overrideReasons: Reason[];
  editReasons: Reason[];
}

export interface Stats {
  total: number;
  byStatus: Record<CaseStatus, number>;
  avgScreeningMs: number | null;
  flagsCaught: number;
  districts: string[];
  processing: number;
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
    docType: DetectedType | null;
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

// ---------------------------------------------------------------------------------------------

/**
 * Officer identity. In the default AUTH_MODE=session the API reads it from the httpOnly session
 * cookie set by PIN sign-in (sent automatically on same-origin fetch and EventSource), and this
 * stays null. Only the AUTH_MODE=header fallback sends the chosen officer as X-Officer-Id.
 */
let currentOfficer: string | null = null;
export const setCurrentOfficer = (id: string | null) => {
  currentOfficer = id;
};

/** Called on any 401 (session expired / API restarted) so the app can send the officer to sign in. */
let onUnauthorized: (() => void) | null = null;
export const setUnauthorizedHandler = (fn: (() => void) | null) => {
  onUnauthorized = fn;
};

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

async function handle<T>(res: Response): Promise<T> {
  if (res.status === 401 && !res.url.includes('/api/auth/')) onUnauthorized?.();
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    let details: unknown;
    try {
      const body = (await res.json()) as { error?: string; details?: unknown };
      if (body.error) message = body.error;
      details = body.details;
    } catch {
      // keep status text
    }
    throw new ApiError(res.status, message, details);
  }
  return (await res.json()) as T;
}

const headers = (extra: Record<string, string> = {}) => ({
  Accept: 'application/json',
  ...(currentOfficer ? { 'X-Officer-Id': currentOfficer } : {}),
  ...extra,
});

export const getJson = <T>(path: string) =>
  fetch(path, { headers: headers() }).then((r) => handle<T>(r));

const send = <T>(path: string, init: RequestInit) =>
  fetch(path, {
    ...init,
    headers: headers(init.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
  }).then((r) => handle<T>(r));
const post = <T>(path: string, body?: unknown) =>
  send<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });

export const fetchHealth = () => getJson<HealthResponse>('/api/health');
export const fetchMeta = () => getJson<Meta>('/api/meta');
export const fetchStats = () => getJson<Stats>('/api/stats');
export const fetchCase = (id: string) => getJson<CaseDetail>(`/api/cases/${id}`);
export const fetchCases = (params: Record<string, string | undefined> = {}) => {
  const q = new URLSearchParams(
    Object.entries(params).filter((e): e is [string, string] => Boolean(e[1])),
  );
  const qs = q.toString();
  return getJson<{ cases: CaseSummary[] }>(`/api/cases${qs ? `?${qs}` : ''}`);
};

export const resolveFlag = (
  caseId: string,
  flagId: string,
  body: { decision: 'accept' | 'override' | 'reopen'; reasonCode?: string; reasonText?: string },
) => post<CaseDetail>(`/api/cases/${caseId}/flags/${flagId}/resolve`, body);

export const editField = (
  caseId: string,
  body: {
    documentId: string;
    field: string;
    value: string | null;
    reasonCode: string;
    reasonText?: string;
  },
) =>
  send<CaseDetail>(`/api/cases/${caseId}/fields`, { method: 'PATCH', body: JSON.stringify(body) });

export const approveCase = (caseId: string, note?: string) =>
  post<CaseDetail>(`/api/cases/${caseId}/approve`, { note });
export const sendForCorrection = (caseId: string, note?: string) =>
  post<CaseDetail>(`/api/cases/${caseId}/send-for-correction`, { note });
export const addNote = (caseId: string, text: string) =>
  post<CaseDetail>(`/api/cases/${caseId}/notes`, { text });
export const forwardCases = (caseIds: string[]) =>
  post<{ forwarded: string[]; skipped: { id: string; reason: string }[] }>('/api/cases/forward', {
    caseIds,
  });

// --- PIN sign-in (cookie session) ----------------------------------------------------------

export type AuthMode = 'session' | 'header';

export interface AuthMe {
  mode: AuthMode;
  officer: Officer | null;
  expiresAt: string | null;
}

export interface SignInOfficer extends Officer {
  canSignIn: boolean;
}

export const fetchMe = () => getJson<AuthMe>('/api/auth/me');
export const fetchSignInOfficers = () =>
  getJson<{ mode: AuthMode; officers: SignInOfficer[] }>('/api/auth/officers');
export const signIn = (officerId: string, pin: string) =>
  post<{ officer: Officer }>('/api/auth/login', { officerId, pin });
export const signOut = () => post<{ ok: true }>('/api/auth/logout');

export const createSession = () => post<UploadSession>('/api/sessions');
export const fetchSession = (id: string) => getJson<UploadSession>(`/api/sessions/${id}`);

export function uploadToSession(
  id: string,
  files: File[],
  from: 'desk' | 'phone',
  type?: SlotType | null,
) {
  const form = new FormData();
  files.forEach((f) => form.append('files', f, f.name));
  const q = new URLSearchParams({ from, ...(type ? { type } : {}) });
  return send<UploadSession>(`/api/sessions/${id}/files?${q.toString()}`, {
    method: 'POST',
    body: form,
  });
}

export const setSessionFileType = (id: string, fileId: string, docType: SlotType | null) =>
  send<UploadSession>(`/api/sessions/${id}/files/${fileId}`, {
    method: 'PATCH',
    body: JSON.stringify({ docType }),
  });

export const removeSessionFile = (id: string, fileId: string) =>
  send<UploadSession>(`/api/sessions/${id}/files/${fileId}`, { method: 'DELETE' });

export const submitSession = (id: string) => post<CreatedCase>(`/api/sessions/${id}/submit`);

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

// ---- Notices -------------------------------------------------------------------------------

export type NoticeLang = 'en' | 'mni_beng' | 'mni_mtei';

export interface NoticeText {
  title: string;
  greeting: string;
  intro: string;
  items: string[];
  bring: string;
  notRejection: string;
  finalDecision: string;
  helpline: string;
  signoff: string;
}

export interface NoticeAudio {
  available: boolean;
  cached: boolean;
  url: string | null;
  reason: string | null;
}

export interface Notice {
  caseId: string;
  reference: string;
  applicantName: string;
  allowed: boolean;
  blockedReason: string | null;
  rendered: {
    en: NoticeText;
    mni_beng: NoticeText;
    mni_mtei: NoticeText;
    codes: string[];
    review: { pendingCount: number; mni_mtei: 'manual' | 'auto' };
  } | null;
  plainText: Record<NoticeLang, string> | null;
  statusPath: string;
  noticeSentAt: string | null;
  date: string;
  audio: NoticeAudio;
}

export interface NoticeListItem {
  caseId: string;
  reference: string;
  applicantName: string | null;
  district: string | null;
  status: CaseStatus;
  allowed: boolean;
  blockedReason: string | null;
  items: number;
  noticeSentAt: string | null;
}

export const fetchNotice = (caseId: string) => getJson<Notice>(`/api/cases/${caseId}/notice`);
export const generateNoticeAudio = (caseId: string) =>
  post<NoticeAudio>(`/api/cases/${caseId}/notice/audio`);
export const markNoticeSent = (caseId: string, channel: 'print' | 'whatsapp' | 'in_person') =>
  post<Notice>(`/api/cases/${caseId}/notice/sent`, { channel });
export const fetchNotices = () => getJson<{ notices: NoticeListItem[] }>('/api/notices');

export interface TemplateEntry {
  en: string;
  mni_beng: string;
  mni_mtei: string;
  reviewed: boolean;
}
export interface TemplateSetView {
  settings: { days: number; helpline: string };
  templates: (TemplateEntry & { code: string })[];
  blocks: (TemplateEntry & { id: string })[];
  summary: { total: number; reviewed: number; manualMeetei: number };
}
export const fetchTemplates = () => getJson<TemplateSetView>('/api/templates');
export const patchTemplate = (
  kind: 'template' | 'block',
  key: string,
  patch: Partial<TemplateEntry>,
) =>
  send<{ ok: true; entry: TemplateEntry }>(`/api/templates/${kind}/${encodeURIComponent(key)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });

export interface PublicStatus {
  reference: string;
  firstName: string;
  status: 'Received' | 'Correction needed' | 'Under review' | 'Approved';
  updatedAt: string;
}
export const fetchPublicStatus = (ref: string, k: string) =>
  getJson<PublicStatus>(`/api/public/status/${encodeURIComponent(ref)}?k=${encodeURIComponent(k)}`);

// ---- Trust report & dashboard --------------------------------------------------------------

export interface FairnessRow {
  community: string;
  pairs: number;
  decided: number;
  correct: number;
  accuracy: number;
  referred: number;
  referralRate: number;
  falseMatches: number;
  falseNonMatches: number;
}
export interface FairnessView {
  label: string;
  description: string;
  pairs: number;
  rows: FairnessRow[];
  overall: FairnessRow;
}
export interface LeakScan {
  scannedAt: string;
  findings: { where: string; location: string }[];
  scanned: { dbRows: number; logLines: number; apiResponses: number };
  clean: boolean;
}
export interface Rate {
  key: string;
  n: number;
  accuracy: number;
}
export interface TrustReport {
  generatedAt: string;
  evaluation:
    | { available: false; howTo: string }
    | {
        available: true;
        generatedAt: string;
        model: string;
        mode: string;
        labelled: boolean;
        packets: number;
        fieldsScored: number;
        fieldAccuracy: number | null;
        classificationAccuracy: number | null;
        statusAccuracy: number | null;
        nameVerdictAccuracy: number | null;
        byDocType: Rate[];
        byField: Rate[];
        byConfidence: Rate[];
        latency: { avgApiCallMs: number; avgPacketWallMs: number };
        cost: {
          totalUsd: number;
          avgPerPacketUsd: number;
          perApplicationInr: number;
          usdToInr: number;
        };
      };
  fairness: { dev: FairnessView; holdout: (FairnessView & { createdAt: string | null }) | null };
  safeguards: {
    statuses: string[];
    rejectStatusExists: boolean;
    leakScan: LeakScan | null;
    imagesRedacted: number;
    imagesTotal: number;
    auditEntries: number;
    approvals: number;
    approvalsByDswoOnly: boolean;
    flagsDecidedByOfficers: number;
    overrideRate: number | null;
    notices: { aiCalls: number; templates: number; reviewed: number };
    syntheticOnly: { liveCases: number; historicalSynthetic: number };
  };
  limitations: string[];
}
export const fetchTrust = () => getJson<TrustReport>('/api/trust');
export const runLeakScan = () => post<LeakScan>('/api/trust/leak-scan');

export interface WatchCase {
  id: string;
  reference: string;
  applicantName: string | null;
  district: string | null;
  daysPending: number;
  age: number | null;
  historical: boolean;
}
export interface Dashboard {
  generatedAt: string;
  historicalIncluded: number;
  kpis: {
    received: number;
    screenedToday: number;
    avgScreeningMs: number | null;
    firstTimeRight: number | null;
    pendingByStatus: { READY: number; NEEDS_CITIZEN_CORRECTION: number; OFFICER_ATTENTION: number };
    approved: number;
    noticesSent: number;
    avgDaysPending: number | null;
  };
  deficiencies: { code: string; title: string; count: number }[];
  districts: {
    district: string;
    received: number;
    ready: number;
    correction: number;
    attention: number;
    approved: number;
  }[];
  priorityWatch: { key: string; label: string; count: number; cases: WatchCase[] }[];
}
export const fetchDashboard = (includeHistorical = true) =>
  getJson<Dashboard>(`/api/dashboard${includeHistorical ? '' : '?historical=exclude'}`);
export const resetDemo = () =>
  post<{ ok: true; removed: { cases: number; sessions: number } }>('/api/demo/reset');
