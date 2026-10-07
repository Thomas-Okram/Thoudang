import type { RequestHandler } from 'express';
import type { AuthMode } from '../security/config.js';
import { readCookie, SESSION_COOKIE, type SessionClaims, type SessionSigner } from '../security/session.js';

declare module 'express-serve-static-core' {
  interface Request {
    /** Verified session (PIN login), if any. */
    session?: SessionClaims;
  }
}

/**
 * Establishes WHO is acting, before any route runs.
 *
 * The routes (officers.ts → requireOfficer) read the officer id from the X-Officer-Id header.
 * This middleware makes that header trustworthy instead of changing every route:
 *  - a valid signed session cookie ALWAYS wins: the header is overwritten with the session's
 *    officer id (so a stale dropdown in the browser can never act as someone else);
 *  - in `session` mode a client-supplied X-Officer-Id without a session is DISCARDED, so
 *    requireOfficer answers 401 "sign in";
 *  - in `header` mode (legacy demo dropdown) the header is passed through unchanged.
 */
export function identity(opts: { mode: AuthMode; signer: SessionSigner }): RequestHandler {
  return (req, _res, next) => {
    const claims = opts.signer.verify(readCookie(req.headers.cookie, SESSION_COOKIE));
    if (claims) {
      req.session = claims;
      req.headers['x-officer-id'] = claims.sub;
    } else if (opts.mode === 'session') {
      delete req.headers['x-officer-id'];
    }
    next();
  };
}

/** Rejects declared bodies larger than `maxBytes` on non-upload requests (413), before parsing. */
export function bodyLimit(opts: { maxBytes: number; skip: (path: string, method: string) => boolean }): RequestHandler {
  return (req, res, next) => {
    const declared = Number(req.headers['content-length'] ?? 0);
    if (declared > opts.maxBytes && !opts.skip(req.path, req.method)) {
      res.status(413).json({ error: 'Request body too large' });
      req.resume();
      return;
    }
    next();
  };
}
