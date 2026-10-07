import crypto from 'node:crypto';

/**
 * Security settings. Kept apart from env.ts so the security layer can evolve without touching the
 * core app config. Every value has a safe default; see apps/api/.env.example.
 */
export type AuthMode = 'session' | 'header';

export interface SecurityConfig {
  /**
   * session → identity comes ONLY from the signed httpOnly cookie (PIN login); any client-sent
   *           X-Officer-Id header is discarded.
   * header  → legacy demo dropdown (X-Officer-Id trusted). Fallback until the web has a login screen.
   */
  authMode: AuthMode;
  /** Every /api route except a small public list needs a session (session mode only). */
  requireSignIn: boolean;
  sessionSecret: Buffer;
  /** true when SESSION_SECRET is unset: a random per-process secret (sessions end on restart). */
  sessionSecretEphemeral: boolean;
  sessionTtlMs: number;
  /** officerId → PIN (4–8 digits). */
  officerPins: Record<string, string>;
  usingDemoPins: boolean;
  /** Extra allowed browser origins (exact match), on top of localhost / private-LAN on our ports. */
  corsOrigins: string[];
  /** Ports a LAN/localhost origin may use (API port, web port, vite preview). */
  allowedPorts: number[];
  rateLimit: {
    uploadsPerMinute: number;
    loginAttemptsPer5Min: number;
    /** Failed PINs for ONE officer before that officer is locked out for lockoutMs. */
    maxFailedPins: number;
    lockoutMs: number;
  };
  upload: {
    maxFileBytes: number;
    maxPacketFiles: number;
    maxBatchFiles: number;
    maxBatchBytes: number;
    maxZipEntries: number;
    maxZipUncompressedBytes: number;
  };
  /** Max body for every non-upload request. */
  maxJsonBytes: number;
  /** Delete uploaded images this many days after a case is closed. 0 = never. */
  retentionDays: number;
  /** HMAC key for the audit hash chain. Keep it OUT of the database (env / secrets store). */
  auditChainKey: string;
  auditChainKeyIsDefault: boolean;
}

/** Demo PINs — also listed in .env.example. Change them for any shared deployment. */
export const DEMO_OFFICER_PINS: Record<string, string> = {
  'dswo-imphal-west': '2468',
  'da-imphal-west': '1357',
};
export const DEFAULT_AUDIT_CHAIN_KEY = 'thoudang-audit-chain-v1';

const MB = 1024 * 1024;
const num = (v: string | undefined, fallback: number) => {
  const n = Number(v);
  return v !== undefined && v !== '' && Number.isFinite(n) && n >= 0 ? n : fallback;
};

/** "dswo-imphal-west:2468, da-imphal-west:1357" → { id: pin }. Invalid entries are ignored. */
export function parseOfficerPins(raw: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (raw ?? '').split(',')) {
    const [id, pin] = part.split(':').map((s) => s.trim());
    if (id && pin && /^\d{4,8}$/.test(pin)) out[id] = pin;
  }
  return out;
}

export function loadSecurityConfig(vars: NodeJS.ProcessEnv = process.env): SecurityConfig {
  const pins = parseOfficerPins(vars.OFFICER_PINS);
  const usingDemoPins = Object.keys(pins).length === 0;
  const secret = vars.SESSION_SECRET;
  const port = num(vars.PORT, 3001);
  const webPort = num(vars.WEB_PORT, 5173);
  return {
    authMode: vars.AUTH_MODE === 'header' ? 'header' : 'session',
    requireSignIn: vars.AUTH_MODE !== 'header' && vars.REQUIRE_SIGN_IN === '1',
    sessionSecret: secret ? Buffer.from(secret, 'utf8') : crypto.randomBytes(32),
    sessionSecretEphemeral: !secret,
    sessionTtlMs: num(vars.SESSION_TTL_HOURS, 12) * 3_600_000,
    officerPins: usingDemoPins ? { ...DEMO_OFFICER_PINS } : pins,
    usingDemoPins,
    corsOrigins: (vars.CORS_ORIGINS ?? '')
      .split(',')
      .map((s) => s.trim().replace(/\/$/, ''))
      .filter(Boolean),
    allowedPorts: [...new Set([port, webPort, 4173])],
    rateLimit: {
      uploadsPerMinute: num(vars.RATE_LIMIT_UPLOADS_PER_MIN, 120),
      loginAttemptsPer5Min: num(vars.RATE_LIMIT_LOGIN_PER_5MIN, 10),
      maxFailedPins: num(vars.PIN_MAX_FAILED, 5),
      lockoutMs: num(vars.PIN_LOCKOUT_MIN, 5) * 60_000,
    },
    upload: {
      maxFileBytes: Math.floor(num(vars.MAX_UPLOAD_FILE_MB, 20) * MB),
      maxPacketFiles: 6,
      maxBatchFiles: num(vars.MAX_BATCH_FILES, 400),
      maxBatchBytes: num(vars.MAX_BATCH_MB, 600) * MB,
      maxZipEntries: num(vars.MAX_ZIP_ENTRIES, 2000),
      maxZipUncompressedBytes: num(vars.MAX_ZIP_UNCOMPRESSED_MB, 1024) * MB,
    },
    maxJsonBytes: 1 * MB,
    retentionDays: num(vars.RETENTION_DAYS, 30),
    auditChainKey: vars.AUDIT_CHAIN_KEY || DEFAULT_AUDIT_CHAIN_KEY,
    auditChainKeyIsDefault: !vars.AUDIT_CHAIN_KEY,
  };
}
