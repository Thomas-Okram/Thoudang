import type { RequestHandler } from 'express';

/**
 * Small in-memory fixed-window rate limiter (no dependency; one API process, so memory is fine).
 * Keyed by client IP + limiter name. Note: behind the Vite dev proxy every request comes from
 * 127.0.0.1, so in dev the limit is effectively per server — the defaults are sized for that.
 */
export function rateLimit(opts: {
  name: string;
  windowMs: number;
  max: number;
  message: string;
  key?: (req: Parameters<RequestHandler>[0]) => string;
}): RequestHandler {
  const hits = new Map<string, { count: number; resetAt: number }>();
  return (req, res, next) => {
    if (opts.max <= 0) {
      next();
      return;
    }
    const now = Date.now();
    if (hits.size > 10_000) for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k);
    const key = `${opts.name}:${opts.key ? opts.key(req) : (req.ip ?? req.socket.remoteAddress ?? '?')}`;
    let entry = hits.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + opts.windowMs };
      hits.set(key, entry);
    }
    entry.count += 1;
    const remaining = Math.max(0, opts.max - entry.count);
    const resetSecs = Math.ceil((entry.resetAt - now) / 1000);
    res.setHeader('RateLimit-Limit', String(opts.max));
    res.setHeader('RateLimit-Remaining', String(remaining));
    res.setHeader('RateLimit-Reset', String(resetSecs));
    if (entry.count > opts.max) {
      res.setHeader('Retry-After', String(resetSecs));
      res.status(429).json({ error: opts.message, retryAfterSeconds: resetSecs });
      return;
    }
    next();
  };
}
