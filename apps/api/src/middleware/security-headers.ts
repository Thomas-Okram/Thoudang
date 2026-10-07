import helmet from 'helmet';
import type { RequestHandler } from 'express';

/**
 * helmet with a strict, self-only Content-Security-Policy sized to what the web app needs:
 *  - scripts/styles/fonts: the built bundle only (fonts are self-hosted @fontsource files)
 *  - img: self + data: (notice QR code is a data: URL) + blob:
 *  - media: self + blob: (notice audio)        - connect: self (API + Server-Sent Events)
 *  - style-src-attr 'unsafe-inline': React/recharts set inline style attributes; this allows
 *    style ATTRIBUTES only — no <style> injection, no inline or third-party scripts.
 * The demo runs over plain HTTP on the LAN, so upgrade-insecure-requests and HSTS are OFF (they
 * would break phones loading http://192.168.x.x). Turn HSTS on behind TLS.
 */
export function securityHeaders(opts: { hsts?: boolean } = {}): RequestHandler {
  return helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        scriptSrcAttr: ["'none'"],
        styleSrc: ["'self'"],
        styleSrcAttr: ["'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        mediaSrc: ["'self'", 'blob:'],
        fontSrc: ["'self'"],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
        workerSrc: ["'self'", 'blob:'],
        manifestSrc: ["'self'"],
      },
    },
    strictTransportSecurity: opts.hsts ? { maxAge: 15_552_000 } : false,
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: 'same-origin' },
    referrerPolicy: { policy: 'no-referrer' },
    xFrameOptions: { action: 'deny' },
  });
}
