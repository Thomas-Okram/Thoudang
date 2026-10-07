import express, { Router, type Request, type Response } from 'express';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { officers } from '../db/schema.js';
import type { Logger } from '../logger.js';
import { rateLimit } from '../middleware/rate-limit.js';
import { permissionsOf, ROLE_LABEL } from '../officers.js';
import type { SecurityConfig } from './config.js';
import { clearSessionCookie, sessionCookie, type PinBook, type SessionSigner } from './session.js';

/**
 * PIN sign-in for the seeded officers.
 *   GET  /api/auth/officers   who can sign in (no PINs, obviously)
 *   GET  /api/auth/me         current session → officer + permissions (or null)
 *   POST /api/auth/login      { officerId, pin } (JSON or HTML form) → httpOnly session cookie
 *   POST /api/auth/logout
 *   GET  /api/auth/login      a minimal server-rendered sign-in page (no JS — works before the
 *                             web app has its own login screen; also through the Vite proxy)
 */
export function authRouter(deps: {
  db: Db;
  sec: SecurityConfig;
  signer: SessionSigner;
  pins: PinBook;
  logger: Logger;
}): Router {
  const { db, sec, signer, pins, logger } = deps;
  const router = Router();
  const form = express.urlencoded({ extended: false, limit: '4kb' });
  const json = express.json({ limit: '4kb' });
  const loginLimiter = rateLimit({
    name: 'login',
    windowMs: 5 * 60_000,
    max: sec.rateLimit.loginAttemptsPer5Min,
    message: 'Too many sign-in attempts. Wait a few minutes and try again.',
  });

  const list = () => db.select().from(officers).all();
  const view = (o: typeof officers.$inferSelect) => ({
    id: o.id,
    name: o.name,
    role: o.role,
    roleLabel: ROLE_LABEL[o.role],
    district: o.district,
    permissions: permissionsOf(o.role),
  });

  router.get('/auth/officers', (_req, res) => {
    res.json({
      mode: sec.authMode,
      officers: list().map((o) => ({ ...view(o), canSignIn: pins.hasPin(o.id) })),
    });
  });

  router.get('/auth/me', (req, res) => {
    const o = req.session
      ? db.select().from(officers).where(eq(officers.id, req.session.sub)).get()
      : undefined;
    res.set('Cache-Control', 'no-store').json({
      mode: sec.authMode,
      officer: o ? view(o) : null,
      expiresAt: o && req.session ? new Date(req.session.exp).toISOString() : null,
    });
  });

  router.get('/auth/login', (req, res) => {
    res.set('Cache-Control', 'no-store').type('html').send(loginPage(list(), { next: safeNext(req.query.next) }));
  });
  router.get('/auth/login.css', (_req, res) => {
    res.type('css').set('Cache-Control', 'public, max-age=3600').send(LOGIN_CSS);
  });

  router.post('/auth/login', loginLimiter, form, json, (req: Request, res: Response) => {
    const isForm = req.is('application/x-www-form-urlencoded') === 'application/x-www-form-urlencoded';
    const body = (req.body ?? {}) as Record<string, unknown>;
    const officerId = typeof body.officerId === 'string' ? body.officerId : '';
    const pin = typeof body.pin === 'string' ? body.pin : String(body.pin ?? '');
    const next = safeNext(body.next);
    const fail = (status: number, error: string) => {
      logger.warn('Sign-in failed', { officerId, reason: error, ip: req.ip });
      if (isForm) res.status(status).type('html').send(loginPage(list(), { error, officerId, next }));
      else res.status(status).json({ error });
    };

    const officer = officerId
      ? db.select().from(officers).where(eq(officers.id, officerId)).get()
      : undefined;
    if (!officer) {
      fail(401, 'Choose an officer and enter the PIN');
      return;
    }
    const result = pins.check(officer.id, pin);
    if (result === 'locked') {
      const until = pins.lockedUntil(officer.id) ?? Date.now();
      fail(429, `Too many wrong PINs. Try again in ${Math.ceil((until - Date.now()) / 60_000)} minute(s).`);
      return;
    }
    if (result !== 'ok') {
      fail(401, result === 'no_pin' ? 'This officer has no PIN configured' : 'Wrong PIN');
      return;
    }
    const { token } = signer.sign(officer.id);
    res.setHeader('Set-Cookie', sessionCookie(token, { maxAgeMs: sec.sessionTtlMs, secure: req.secure }));
    logger.info('Officer signed in', { officerId: officer.id, role: officer.role, ip: req.ip });
    if (isForm) res.redirect(303, next);
    else res.json({ officer: view(officer) });
  });

  router.post('/auth/logout', form, (req, res) => {
    if (req.session) {
      signer.revoke(req.session);
      logger.info('Officer signed out', { officerId: req.session.sub });
    }
    res.setHeader('Set-Cookie', clearSessionCookie());
    if (req.is('application/x-www-form-urlencoded')) res.redirect(303, '/api/auth/login');
    else res.json({ ok: true });
  });

  return router;
}

/** Only same-site relative paths — never an open redirect. */
function safeNext(raw: unknown): string {
  return typeof raw === 'string' && /^\/(?![/\\])/.test(raw) ? raw : '/';
}

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

function loginPage(
  list: (typeof officers.$inferSelect)[],
  opts: { error?: string; officerId?: string; next: string },
): string {
  const options = list
    .map(
      (o) =>
        `<option value="${esc(o.id)}"${o.id === opts.officerId ? ' selected' : ''}>${esc(o.name)} — ${esc(ROLE_LABEL[o.role])}</option>`,
    )
    .join('');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sign in — Thoudang</title><link rel="stylesheet" href="/api/auth/login.css"></head>
<body><main>
<h1>Thoudang</h1><p class="sub">Welfare Scrutiny Desk — officer sign-in</p>
${opts.error ? `<p class="err" role="alert">${esc(opts.error)}</p>` : ''}
<form method="post" action="/api/auth/login">
<label>Officer<select name="officerId" required>${options}</select></label>
<label>PIN<input name="pin" type="password" inputmode="numeric" autocomplete="current-password" pattern="[0-9]{4,8}" required autofocus></label>
<input type="hidden" name="next" value="${esc(opts.next)}">
<button type="submit">Sign in</button>
</form>
<p class="note">Prototype — SPECIMEN data only.</p>
</main></body></html>`;
}

const LOGIN_CSS = `
:root{color-scheme:light}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:#eef1f5;font:17px/1.5 system-ui,sans-serif;color:#0A1B33}
main{background:#fff;padding:32px;border-radius:12px;box-shadow:0 2px 12px rgba(10,27,51,.12);width:min(380px,calc(100vw - 32px));box-sizing:border-box}
h1{margin:0;font-size:1.6rem}
.sub{margin:4px 0 24px;color:#4b5563}
label{display:block;margin-bottom:16px;font-weight:600}
select,input{display:block;width:100%;box-sizing:border-box;margin-top:6px;padding:10px;font:inherit;border:1px solid #cbd5e1;border-radius:8px}
button{width:100%;padding:12px;font:inherit;font-weight:600;color:#fff;background:#0A1B33;border:0;border-radius:8px;cursor:pointer}
button:focus-visible,select:focus-visible,input:focus-visible{outline:3px solid #14b8a6;outline-offset:2px}
.err{background:#fef2f2;color:#991b1b;padding:10px;border-radius:8px}
.note{margin:20px 0 0;font-size:.85rem;color:#6b7280}
`;
