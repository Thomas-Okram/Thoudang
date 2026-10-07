import type { Request, RequestHandler, Response } from 'express';
import type { AuthMode } from '../security/config.js';
import {
  readCookie,
  SESSION_COOKIE,
  type SessionClaims,
  type SessionSigner,
} from '../security/session.js';

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

/**
 * Routes reachable without signing in when REQUIRE_SIGN_IN=1: health/meta for the app shell,
 * sign-in itself, the citizen status page (HMAC-protected), and the phone upload flow — its
 * session id is an unguessable capability URL shown only as the QR code on the officer's screen.
 */
const PUBLIC_ROUTES: { method?: string; pattern: RegExp }[] = [
  { method: 'GET', pattern: /^\/(health|meta|network)\/?$/ },
  { pattern: /^\/auth(\/|$)/ },
  { method: 'GET', pattern: /^\/public\// },
  { pattern: /^\/sessions\/[^/]+(\/.*)?$/ },
];

export const isPublicRoute = (path: string, method: string) =>
  PUBLIC_ROUTES.some((r) => (!r.method || r.method === method) && r.pattern.test(path));

/**
 * REQUIRE_SIGN_IN=1: every other /api route (reads included — case data, redacted images, SSE,
 * dashboard, uploads, demo reset) needs a valid session. Off by default until the web app
 * redirects to the sign-in page on 401.
 */
export function requireSignIn(opts: { enabled: boolean }): RequestHandler {
  return (req, res, next) => {
    if (
      !opts.enabled ||
      req.session ||
      req.method === 'OPTIONS' ||
      isPublicRoute(req.path, req.method)
    ) {
      next();
      return;
    }
    res.status(401).json({ error: 'Sign in with your officer PIN (open /api/auth/login)' });
  };
}

/**
 * Answers 413 AFTER discarding the body (replying mid-upload makes clients see a connection
 * reset instead of the error). Gives up and drops the connection past `hardCapBytes`.
 */
export function refuseTooLarge(
  req: Request,
  res: Response,
  error: string,
  hardCapBytes = 32 * 1024 * 1024,
): void {
  let seen = 0;
  const reply = () => {
    if (!res.headersSent) res.status(413).json({ error });
  };
  req.on('data', (chunk: Buffer) => {
    seen += chunk.length;
    if (seen > hardCapBytes) {
      req.unpipe();
      req.socket.destroy();
    }
  });
  req.once('end', reply);
  req.resume();
}

/** Rejects declared bodies larger than `maxBytes` on non-upload requests (413), before parsing. */
export function bodyLimit(opts: {
  maxBytes: number;
  skip: (path: string, method: string) => boolean;
}): RequestHandler {
  return (req, res, next) => {
    const declared = Number(req.headers['content-length'] ?? 0);
    if (declared > opts.maxBytes && !opts.skip(req.path, req.method)) {
      refuseTooLarge(req, res, 'Request body too large');
      return;
    }
    next();
  };
}
