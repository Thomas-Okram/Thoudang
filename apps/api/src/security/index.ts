import type express from 'express';
import type { Db } from '../db/client.js';
import type { AppConfig } from '../env.js';
import type { EventBus } from '../events.js';
import type { Logger } from '../logger.js';
import { bodyLimit, identity } from '../middleware/auth.js';
import { originPolicy } from '../middleware/origin.js';
import { rateLimit } from '../middleware/rate-limit.js';
import { securityHeaders } from '../middleware/security-headers.js';
import { uploadGuard, uploadRoutes } from '../middleware/upload-guard.js';
import { AuditChain, anchorPathFor, sqliteOf } from './audit-chain.js';
import { authRouter } from './auth-routes.js';
import type { SecurityConfig } from './config.js';
import { PinBook, SessionSigner } from './session.js';

export { loadSecurityConfig, type SecurityConfig } from './config.js';

export interface SecurityBundle {
  sec: SecurityConfig;
  signer: SessionSigner;
  pins: PinBook;
  chain: AuditChain;
  /** Chains any audit rows written since the last seal (also runs automatically). */
  sealNow: () => number;
  /** Message for a 401 from requireOfficer, adjusted to the auth mode. */
  unauthenticatedMessage: (original: string) => string;
  /** Startup warnings (demo PINs, ephemeral secret, …) for the server log. */
  warnings: () => string[];
}

/**
 * Installs the whole security layer on the Express app. Call right after `express()` and before
 * any body parser or router: headers → origin lock → size limits → rate limits → identity →
 * upload guard → /api/auth routes. Audit rows are sealed into the hash chain after every response
 * and on every pipeline event.
 */
export function installSecurity(
  app: express.Express,
  deps: { db: Db; config: AppConfig; sec: SecurityConfig; logger: Logger; bus: EventBus },
): SecurityBundle {
  const { db, config, sec, logger } = deps;
  const signer = new SessionSigner(sec.sessionSecret, sec.sessionTtlMs);
  const pins = new PinBook(sec.officerPins, sec.rateLimit.maxFailedPins, sec.rateLimit.lockoutMs);
  const sqlite = sqliteOf(db);
  const chain = new AuditChain(sqlite, sec.auditChainKey, anchorPathFor(config.dbPath));

  let anchorWarned = false;
  const sealNow = () => {
    if (!sqlite.open) return 0; // shutting down
    try {
      const { sealed, anchorMismatch } = chain.seal();
      if (anchorMismatch && !anchorWarned) {
        anchorWarned = true;
        logger.error('Audit chain does not match its anchor — run `npm run audit:verify`');
      }
      return sealed;
    } catch (err) {
      logger.error('Audit chain seal failed', {
        message: err instanceof Error ? err.message : 'unknown',
      });
      return 0;
    }
  };
  let pending = false;
  const sealSoon = () => {
    if (pending) return;
    pending = true;
    setImmediate(() => {
      pending = false;
      sealNow();
    });
  };
  sealNow();
  deps.bus.subscribe(() => sealSoon());

  const routes = uploadRoutes(sec.upload);
  const isUpload = (p: string, method: string) =>
    method === 'POST' && routes.some((r) => r.pattern.test(p.replace(/^\/api(?=\/)/, '')));
  const uploadLimiter = rateLimit({
    name: 'upload',
    windowMs: 60_000,
    max: sec.rateLimit.uploadsPerMinute,
    message: 'Too many uploads in a minute. Please wait a moment and try again.',
  });

  app.disable('x-powered-by');
  app.use(securityHeaders());
  app.use((_req, res, next) => {
    res.once('finish', sealSoon);
    next();
  });
  app.use('/api', originPolicy({ allowedPorts: sec.allowedPorts, extra: sec.corsOrigins }));
  app.use(bodyLimit({ maxBytes: sec.maxJsonBytes, skip: isUpload }));
  app.use('/api', (req, res, next) =>
    isUpload(req.path, req.method) ? uploadLimiter(req, res, next) : next(),
  );
  app.use('/api', identity({ mode: sec.authMode, signer }));
  app.use(
    '/api',
    uploadGuard({
      uploadsDir: config.uploadsDir,
      maxFileBytes: sec.upload.maxFileBytes,
      maxPacketFiles: sec.upload.maxPacketFiles,
      maxBatchFiles: sec.upload.maxBatchFiles,
      maxBatchBytes: sec.upload.maxBatchBytes,
      maxZipEntries: sec.upload.maxZipEntries,
      maxZipUncompressedBytes: sec.upload.maxZipUncompressedBytes,
      onEvent: (event, detail) =>
        event === 'rejected'
          ? logger.warn('Upload refused', detail)
          : logger.info('GPS location removed from an uploaded image', detail),
    }),
  );
  app.use('/api', authRouter({ db, sec, signer, pins, logger }));

  return {
    sec,
    signer,
    pins,
    chain,
    sealNow,
    unauthenticatedMessage: (original) =>
      sec.authMode === 'session'
        ? 'Sign in with your officer PIN to do this (open /api/auth/login)'
        : original,
    warnings: () => [
      ...(sec.authMode === 'header'
        ? ['AUTH_MODE=header — officer identity is NOT authenticated (legacy demo dropdown).']
        : []),
      ...(sec.usingDemoPins
        ? ['OFFICER_PINS not set — using the demo PINs from .env.example.']
        : []),
      ...(sec.sessionSecretEphemeral
        ? [
            'SESSION_SECRET not set — random per-process secret; officers sign in again after a restart.',
          ]
        : []),
      ...(sec.auditChainKeyIsDefault
        ? ['AUDIT_CHAIN_KEY not set — audit hash chain uses the public default key.']
        : []),
    ],
  };
}
