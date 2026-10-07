import crypto from 'node:crypto';

export const SESSION_COOKIE = 'thoudang_sid';

export interface SessionClaims {
  /** officer id */
  sub: string;
  /** issued at / expires at (ms since epoch) */
  iat: number;
  exp: number;
  /** random id — lets logout revoke this one session */
  jti: string;
}

const b64 = (b: Buffer | string) => Buffer.from(b).toString('base64url');

/**
 * Stateless signed session token: base64url(JSON claims) + "." + HMAC-SHA256. No session table —
 * the signature proves the server issued it; logout adds the jti to an in-memory deny list.
 */
export class SessionSigner {
  private revoked = new Map<string, number>();

  constructor(
    private secret: Buffer,
    private ttlMs: number,
  ) {}

  private mac(payload: string): string {
    return crypto.createHmac('sha256', this.secret).update(payload).digest('base64url');
  }

  sign(officerId: string, now = Date.now()): { token: string; claims: SessionClaims } {
    const claims: SessionClaims = {
      sub: officerId,
      iat: now,
      exp: now + this.ttlMs,
      jti: crypto.randomBytes(12).toString('base64url'),
    };
    const payload = b64(JSON.stringify(claims));
    return { token: `${payload}.${this.mac(payload)}`, claims };
  }

  verify(token: string | undefined, now = Date.now()): SessionClaims | null {
    if (!token) return null;
    const [payload, mac, extra] = token.split('.');
    if (!payload || !mac || extra !== undefined) return null;
    const expected = Buffer.from(this.mac(payload));
    const given = Buffer.from(mac);
    if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;
    let claims: SessionClaims;
    try {
      claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as SessionClaims;
    } catch {
      return null;
    }
    if (typeof claims.sub !== 'string' || typeof claims.exp !== 'number') return null;
    if (claims.exp <= now || this.revoked.has(claims.jti)) return null;
    return claims;
  }

  revoke(claims: SessionClaims): void {
    this.revoked.set(claims.jti, claims.exp);
    const now = Date.now();
    for (const [jti, exp] of this.revoked) if (exp <= now) this.revoked.delete(jti);
  }
}

/** PINs are kept only as scrypt hashes in memory; comparison is constant-time. */
export class PinBook {
  private salt = crypto.randomBytes(16);
  private hashes = new Map<string, Buffer>();
  private failures = new Map<string, { count: number; lockedUntil: number }>();

  constructor(
    pins: Record<string, string>,
    private maxFailed: number,
    private lockoutMs: number,
  ) {
    for (const [id, pin] of Object.entries(pins)) this.hashes.set(id, this.hash(pin));
  }

  private hash(pin: string): Buffer {
    return crypto.scryptSync(pin, this.salt, 32);
  }

  hasPin(officerId: string): boolean {
    return this.hashes.has(officerId);
  }

  lockedUntil(officerId: string, now = Date.now()): number | null {
    const f = this.failures.get(officerId);
    return f && f.lockedUntil > now ? f.lockedUntil : null;
  }

  /** ok | wrong | locked | no_pin. A lock-out applies even to the correct PIN. */
  check(officerId: string, pin: string, now = Date.now()): 'ok' | 'wrong' | 'locked' | 'no_pin' {
    if (this.lockedUntil(officerId, now)) return 'locked';
    const expected = this.hashes.get(officerId);
    // Hash anyway so timing does not reveal whether the officer has a PIN.
    const given = this.hash(String(pin).slice(0, 16));
    if (!expected) return 'no_pin';
    if (crypto.timingSafeEqual(given, expected)) {
      this.failures.delete(officerId);
      return 'ok';
    }
    const f = this.failures.get(officerId) ?? { count: 0, lockedUntil: 0 };
    f.count += 1;
    if (f.count >= this.maxFailed) {
      f.count = 0;
      f.lockedUntil = now + this.lockoutMs;
    }
    this.failures.set(officerId, f);
    return f.lockedUntil > now ? 'locked' : 'wrong';
  }
}

/** Minimal Cookie header parser (no dependency). */
export function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) {
      try {
        return decodeURIComponent(part.slice(i + 1).trim());
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

export function sessionCookie(
  token: string,
  opts: { maxAgeMs: number; secure: boolean },
): string {
  return [
    `${SESSION_COOKIE}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    `Max-Age=${Math.floor(opts.maxAgeMs / 1000)}`,
    ...(opts.secure ? ['Secure'] : []),
  ].join('; ');
}

export const clearSessionCookie = () =>
  `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`;
