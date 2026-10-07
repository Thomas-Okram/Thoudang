import net from 'node:net';
import type { RequestHandler } from 'express';

/**
 * CORS locked to the LAN / demo origins, plus CSRF defence for state-changing requests.
 *
 * Allowed browser origins: the request's own host (same-origin), localhost, and private-LAN IPv4
 * addresses (10/8, 172.16/12, 192.168/16 — office Wi-Fi and phone hotspots) on our own ports,
 * plus anything listed in CORS_ORIGINS. Other origins get no CORS headers, and their
 * POST/PATCH/PUT/DELETE requests are refused outright (403) — the session cookie is also
 * SameSite=Strict, so this is belt and braces.
 */
export function isPrivateLanHost(hostname: string): boolean {
  const h = hostname.replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h === '127.0.0.1' || h === '::1') return true;
  if (net.isIPv4(h)) {
    const [a, b] = h.split('.').map(Number) as [number, number];
    return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  }
  return false;
}

export function originAllowed(
  origin: string,
  opts: { host: string | undefined; allowedPorts: number[]; extra: string[] },
): boolean {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  if (opts.extra.includes(url.origin)) return true;
  if (opts.host && url.host === opts.host) return true; // same origin (incl. via the Vite proxy)
  const port = Number(url.port || (url.protocol === 'https:' ? 443 : 80));
  return isPrivateLanHost(url.hostname) && opts.allowedPorts.includes(port);
}

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

export function originPolicy(opts: { allowedPorts: number[]; extra: string[] }): RequestHandler {
  return (req, res, next) => {
    const origin = req.headers.origin;
    if (!origin) {
      next(); // same-origin navigation, curl, server-to-server
      return;
    }
    const ok = originAllowed(origin, { host: req.headers.host, ...opts });
    if (ok) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.append('Vary', 'Origin');
    }
    if (req.method === 'OPTIONS') {
      if (!ok) {
        res.status(403).end();
        return;
      }
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,PUT,DELETE');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Officer-Id');
      res.setHeader('Access-Control-Max-Age', '600');
      res.status(204).end();
      return;
    }
    if (!ok && !SAFE.has(req.method)) {
      res.status(403).json({ error: 'Request origin not allowed' });
      return;
    }
    next();
  };
}
