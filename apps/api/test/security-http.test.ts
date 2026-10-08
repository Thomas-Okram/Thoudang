import fs from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { containsFullAadhaar } from '@thoudang/core';
import { originAllowed } from '../src/middleware/origin.js';
import { runLeakScan } from '../src/leak-scan.js';
import { TemplateStore } from '../src/notices.js';
import { verifyAuditCli } from '../src/security/audit-verify.js';
import { FULL_AADHAAR, makeImage, packetVision } from './helpers.js';
import { setupApp, testSecurity, type TestApp } from './setup.js';

let t: TestApp;
afterEach(() => t?.cleanup());

/** The synthetic number in its textual forms (a checksum-free digit-run check false-positives on UUIDs). */
const leaks = (text: string) =>
  [
    FULL_AADHAAR,
    `${FULL_AADHAAR.slice(0, 4)} ${FULL_AADHAAR.slice(4, 8)} ${FULL_AADHAAR.slice(8)}`,
  ].filter((f) => text.includes(f));

describe('security headers', () => {
  it('sends a strict self-only CSP without upgrade-insecure-requests (LAN is plain HTTP)', async () => {
    t = await setupApp(null);
    const res = await request(t.app).get('/api/health');
    const csp = res.headers['content-security-policy'] as string;
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toContain('unsafe-eval');
    expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/);
    expect(csp).not.toContain('upgrade-insecure-requests');
    expect(csp).not.toMatch(/https?:\/\//); // no third-party hosts
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['strict-transport-security']).toBeUndefined();
  });
});

describe('CORS locked to LAN / demo origins', () => {
  const opts = {
    host: 'localhost:3001',
    allowedPorts: [3001, 5173, 4173],
    extra: ['https://thoudang.example.gov.in'],
  };
  it.each([
    ['http://localhost:5173', true],
    ['http://192.168.1.20:5173', true], // office Wi-Fi
    ['http://172.20.10.3:5173', true], // iPhone hotspot
    ['http://10.0.0.7:3001', true],
    ['https://thoudang.example.gov.in', true],
    ['http://192.168.1.20:8080', false], // LAN but not our port
    ['http://8.8.8.8:5173', false],
    ['https://evil.example', false],
    ['null', false],
    ['file://', false],
  ])('%s → %s', (origin, ok) => expect(originAllowed(origin, opts)).toBe(ok));

  it('allowed origins get credentialed CORS; foreign origins cannot POST (CSRF)', async () => {
    t = await setupApp(null);
    const lan = await request(t.app).get('/api/health').set('Origin', 'http://192.168.1.20:5173');
    expect(lan.headers['access-control-allow-origin']).toBe('http://192.168.1.20:5173');
    expect(lan.headers['access-control-allow-credentials']).toBe('true');

    const evilGet = await request(t.app).get('/api/health').set('Origin', 'https://evil.example');
    expect(evilGet.headers['access-control-allow-origin']).toBeUndefined();

    const evilPost = await request(t.app)
      .post('/api/auth/login')
      .set('Origin', 'https://evil.example')
      .send({ officerId: 'dswo-imphal-west', pin: '2468' });
    expect(evilPost.status).toBe(403);
    const preflight = await request(t.app)
      .options('/api/cases')
      .set('Origin', 'https://evil.example')
      .set('Access-Control-Request-Method', 'POST');
    expect(preflight.status).toBe(403);
  });
});

describe('request limits', () => {
  it('oversized JSON bodies are refused with 413', async () => {
    t = await setupApp(null);
    const res = await request(t.app)
      .post('/api/cases/x/notes')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ text: 'x'.repeat(2 * 1024 * 1024) }));
    expect(res.status).toBe(413);
  });

  it('uploads are rate limited', async () => {
    t = await setupApp(packetVision(), 'live', {
      security: testSecurity({ RATE_LIMIT_UPLOADS_PER_MIN: '2' }),
    });
    const img = await makeImage('#eee', 200, 150, 'form');
    const statuses: number[] = [];
    for (let i = 0; i < 3; i++)
      statuses.push(
        (await request(t.app).post('/api/cases').attach('files', img, 'form.jpg')).status,
      );
    await t.pipeline.whenIdle();
    expect(statuses).toEqual([202, 202, 429]);
  });
});

describe('audit hash chain in the running app', () => {
  it('every audit row written by requests and the background pipeline is sealed and verifies', async () => {
    t = await setupApp(packetVision());
    let req = request(t.app).post('/api/cases');
    for (const name of ['form.jpg', 'aadhaar.jpg', 'passbook.jpg'])
      req = req.attach('files', await makeImage('#ececec', 400, 300, name), name);
    const res = await req;
    await t.pipeline.whenIdle();
    await request(t.app)
      .post(`/api/cases/${res.body.caseId}/approve`)
      .set('Cookie', t.cookie('dswo-imphal-west'));
    // Sealed automatically after the response (asynchronously — no explicit seal here).
    await vi.waitFor(async () => expect((await t.security.chain.verify()).unsealed).toBe(0));
    const v = await t.security.chain.verify();
    expect(v.ok).toBe(true);
    expect(v.unsealed).toBe(0);
    expect(v.verified).toBeGreaterThan(5);
    expect(await verifyAuditCli({ dbPath: t.dbPath, key: 'test-chain-key', print: () => {} })).toBe(
      0,
    );
    // The anchor file next to the DB holds no Aadhaar-like digits.
    expect(containsFullAadhaar(fs.readFileSync(`${t.dbPath}.audit-anchor.json`, 'utf8'))).toBe(
      false,
    );
  });

  it('the Aadhaar leak scanner stays at 0 findings with the security layer on', async () => {
    t = await setupApp(packetVision());
    let req = request(t.app).post('/api/cases');
    for (const name of ['form.jpg', 'aadhaar.jpg', 'passbook.jpg'])
      req = req.attach('files', await makeImage('#e1e1e1', 400, 300, name), name);
    await req;
    await t.pipeline.whenIdle();
    await new Promise((r) => setImmediate(r));
    const scan = await runLeakScan(t.handle.db, {
      logFile: t.logFile,
      templates: new TemplateStore(t.templatesPath),
      statusLinkSecret: 'test-secret',
    });
    expect(scan.findings).toEqual([]);
    expect(scan.clean).toBe(true);
    // And the raw DB file (incl. audit_chain) has no full Aadhaar number.
    for (const f of [t.dbPath, `${t.dbPath}-wal`])
      if (fs.existsSync(f)) expect(leaks(fs.readFileSync(f).toString('latin1'))).toEqual([]);
  });
});
