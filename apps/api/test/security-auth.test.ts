import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { auditLog } from '../src/db/schema.js';
import { makeImage, packetVision } from './helpers.js';
import { setupApp, testSecurity, TEST_PINS, type TestApp } from './setup.js';

let t: TestApp;
afterEach(() => t?.cleanup());

const DSWO = 'dswo-imphal-west';
const DA = 'da-imphal-west';

async function screenedCase(): Promise<string> {
  let req = request(t.app).post('/api/cases');
  for (const name of ['form.jpg', 'aadhaar.jpg', 'passbook.jpg'])
    req = req.attach('files', await makeImage('#f0f0f0', 400, 300, name), name);
  const res = await req;
  await t.pipeline.whenIdle();
  return res.body.caseId as string;
}
const cookieFrom = (res: request.Response) => {
  const raw = res.headers['set-cookie'] as unknown as string[] | undefined;
  return raw?.[0]?.split(';')[0] ?? '';
};

describe('PIN sign-in and signed session cookie', () => {
  it('login sets an httpOnly SameSite=Strict cookie; /me reflects it; logout revokes it', async () => {
    t = setupApp(packetVision());
    expect((await request(t.app).get('/api/auth/me')).body.officer).toBeNull();

    const res = await request(t.app)
      .post('/api/auth/login')
      .send({ officerId: DSWO, pin: TEST_PINS[DSWO] });
    expect(res.status).toBe(200);
    expect(res.body.officer).toMatchObject({ id: DSWO, role: 'DSWO' });
    expect(res.body.officer.permissions).toContain('approve');
    const setCookie = (res.headers['set-cookie'] as unknown as string[])[0]!;
    expect(setCookie).toMatch(/HttpOnly/);
    expect(setCookie).toMatch(/SameSite=Strict/);
    expect(setCookie).not.toMatch(TEST_PINS[DSWO]);
    const cookie = cookieFrom(res);

    const me = await request(t.app).get('/api/auth/me').set('Cookie', cookie);
    expect(me.body.officer.id).toBe(DSWO);

    await request(t.app).post('/api/auth/logout').set('Cookie', cookie).expect(200);
    expect(
      (await request(t.app).get('/api/auth/me').set('Cookie', cookie)).body.officer,
    ).toBeNull();
  });

  it('a real login can approve; a spoofed X-Officer-Id header alone gets 401', async () => {
    t = setupApp(packetVision());
    const id = await screenedCase();
    const spoof = await request(t.app).post(`/api/cases/${id}/approve`).set('X-Officer-Id', DSWO);
    expect(spoof.status).toBe(401);
    expect(spoof.body.error).toMatch(/Sign in/);

    const login = await request(t.app)
      .post('/api/auth/login')
      .send({ officerId: DSWO, pin: TEST_PINS[DSWO] });
    const ok = await request(t.app)
      .post(`/api/cases/${id}/approve`)
      .set('Cookie', cookieFrom(login));
    expect(ok.status).toBe(200);
    expect(
      t.handle.db
        .select()
        .from(auditLog)
        .all()
        .some((a) => a.action === 'OFFICER_APPROVE' && a.actor === `officer:${DSWO}`),
    ).toBe(true);
  });

  it('the session identity wins over a header naming someone else (no privilege escalation)', async () => {
    t = setupApp(packetVision());
    const id = await screenedCase();
    const res = await request(t.app)
      .post(`/api/cases/${id}/approve`)
      .set('Cookie', t.cookie(DA))
      .set('X-Officer-Id', DSWO);
    expect(res.status).toBe(403); // acted as the Dealing Assistant, who cannot approve
  });

  it('tampered or forged cookies are ignored', async () => {
    t = setupApp(packetVision());
    const good = t.cookie(DA);
    const [name, token] = good.split('=') as [string, string];
    const [payload, mac] = token.split('.') as [string, string];
    const forgedPayload = Buffer.from(
      JSON.stringify({ ...JSON.parse(Buffer.from(payload, 'base64url').toString()), sub: DSWO }),
    ).toString('base64url');
    for (const bad of [`${name}=${forgedPayload}.${mac}`, `${name}=garbage`, `${name}=a.b.c`]) {
      expect((await request(t.app).get('/api/auth/me').set('Cookie', bad)).body.officer).toBeNull();
    }
  });

  it('wrong PINs are refused and lock the officer out after 5 tries', async () => {
    t = setupApp(packetVision());
    for (let i = 0; i < 4; i++) {
      const r = await request(t.app).post('/api/auth/login').send({ officerId: DA, pin: '0000' });
      expect(r.status).toBe(401);
      expect(r.headers['set-cookie']).toBeUndefined();
    }
    expect(
      (await request(t.app).post('/api/auth/login').send({ officerId: DA, pin: '0000' })).status,
    ).toBe(429);
    // Even the right PIN is refused during the lock-out.
    expect(
      (await request(t.app).post('/api/auth/login').send({ officerId: DA, pin: TEST_PINS[DA] }))
        .status,
    ).toBe(429);
    // Unknown officer.
    expect(
      (await request(t.app).post('/api/auth/login').send({ officerId: 'nobody', pin: '1234' }))
        .status,
    ).toBe(401);
  });

  it('login attempts are rate limited per client', async () => {
    t = setupApp(packetVision(), 'live', {
      security: testSecurity({ RATE_LIMIT_LOGIN_PER_5MIN: '3', PIN_MAX_FAILED: '100' }),
    });
    const statuses: number[] = [];
    for (let i = 0; i < 4; i++)
      statuses.push(
        (await request(t.app).post('/api/auth/login').send({ officerId: DA, pin: '9999' })).status,
      );
    expect(statuses).toEqual([401, 401, 401, 429]);
  });

  it('the no-JS sign-in page works with a plain HTML form and never open-redirects', async () => {
    t = setupApp(packetVision());
    const page = await request(t.app).get('/api/auth/login');
    expect(page.status).toBe(200);
    expect(page.text).toContain('<form method="post" action="/api/auth/login">');
    expect(page.text).not.toMatch(/<script/i);
    const ok = await request(t.app)
      .post('/api/auth/login')
      .type('form')
      .send({ officerId: DSWO, pin: TEST_PINS[DSWO], next: '//evil.example/x' });
    expect(ok.status).toBe(303);
    expect(ok.headers.location).toBe('/');
    const bad = await request(t.app)
      .post('/api/auth/login')
      .type('form')
      .send({ officerId: DSWO, pin: '0000', next: '/queue' });
    expect(bad.status).toBe(401);
    expect(bad.text).toContain('Wrong PIN');
  });

  it('AUTH_MODE=header keeps the legacy dropdown identity working', async () => {
    t = setupApp(packetVision(), 'live', { security: testSecurity({ AUTH_MODE: 'header' }) });
    const id = await screenedCase();
    const res = await request(t.app).post(`/api/cases/${id}/approve`).set('X-Officer-Id', DSWO);
    expect(res.status).toBe(200);
  });

  it('officer list exposes who can sign in, never PINs', async () => {
    t = setupApp(packetVision());
    const res = await request(t.app).get('/api/auth/officers');
    expect(res.body.mode).toBe('session');
    expect(res.body.officers.map((o: { id: string }) => o.id).sort()).toEqual([DA, DSWO]);
    expect(JSON.stringify(res.body)).not.toMatch(/2468|1357/);
  });
});
