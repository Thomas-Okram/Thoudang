import fs from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { bengaliToMeeteiMayek, containsFullAadhaar } from '@thoudang/core';
import type { ExtractableType } from '../src/extraction/schemas.js';
import { pcmToWav, TtsError } from '../src/services/tts.js';
import { FakeVision, FULL_AADHAAR, makeImage, PACKET, wireDoc } from './helpers.js';
import { setupApp, type TestApp } from './setup.js';

let t: TestApp;
afterEach(() => t?.cleanup());

const DA = 'da-imphal-west';
let current: Partial<Record<ExtractableType, Record<string, string | null>>> = {};
const claude = () =>
  new FakeVision((req) => {
    const label = req.label ?? '';
    const type: ExtractableType = label.includes('form')
      ? 'application_form'
      : label.includes('aadhaar')
        ? 'aadhaar'
        : 'bank_passbook';
    if (req.stage === 'classify')
      return { document_type: type, confidence: 'high', legibility: 'good', reason: 't' };
    return wireDoc(
      type,
      { ...PACKET[type], ...(current[type] ?? {}) },
      { notes: `number ${FULL_AADHAAR}` },
    );
  });

let seed = 0;
async function screened(
  overrides: typeof current,
  opts: Parameters<typeof setupApp>[2] = {},
  reuse = false,
) {
  current = overrides;
  if (!reuse) t = setupApp(claude(), 'live', opts);
  let req = request(t.app).post('/api/cases');
  seed += 1;
  for (const [name, type] of [
    ['form.jpg', 'application_form'],
    ['aadhaar.jpg', 'aadhaar'],
    ['passbook.jpg', 'bank_passbook'],
  ] as const) {
    req = req
      .field('types', type)
      .attach('files', await makeImage('#fafafa', 500, 300, `${seed}${name}`), {
        filename: name,
        contentType: 'image/jpeg',
      });
  }
  const res = await req;
  await t.pipeline.whenIdle();
  return res.body.caseId as string;
}

/** DOB differs (form 15-03-1944 vs Aadhaar 1943) and the form is unsigned. */
const DEFICIENT = {
  application_form: { date_of_birth: '15-03-1944', signature_present: 'no' },
  aadhaar: { dob_or_yob: '1943' },
};

const FORMS = [
  FULL_AADHAAR,
  `${FULL_AADHAAR.slice(0, 4)} ${FULL_AADHAAR.slice(4, 8)} ${FULL_AADHAAR.slice(8)}`,
];
const leaks = (s: string) =>
  FORMS.some((f) => s.includes(f)) ||
  containsFullAadhaar(
    s.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ''),
  );

describe('citizen notice', () => {
  it('renders one plain line per correction, with values as written, in three scripts', async () => {
    const id = await screened(DEFICIENT);
    const n = (await request(t.app).get(`/api/cases/${id}/notice`)).body;
    expect(n.allowed).toBe(true);
    expect(n.rendered.codes.sort()).toEqual(['DOB_MISMATCH', 'MISSING_SIGNATURE']);
    const dob = n.rendered.en.items.find((l: string) => l.startsWith('Your date of birth'));
    expect(dob).toContain('application form (“15-03-1944”)');
    expect(dob).toContain('Aadhaar card (“1943”)');
    expect(n.rendered.en.notRejection).toMatch(/not a rejection/);
    expect(n.rendered.mni_mtei.items[0]).toBe(bengaliToMeeteiMayek(n.rendered.mni_beng.items[0]));
    expect(n.rendered.review.mni_mtei).toBe('auto');
    expect(n.statusPath).toMatch(/^\/s\/THD-\d{4}-0001\?k=[0-9a-f]{12}$/);
  });

  it('no Aadhaar digits in the notice JSON, print text or WhatsApp text', async () => {
    const id = await screened({
      ...DEFICIENT,
      application_form: { ...DEFICIENT.application_form, aadhaar_number: '2345 6789 1111' },
    });
    // The officer accepts the form/card Aadhaar mismatch → it becomes a citizen correction (last 4 only).
    const detail = (await request(t.app).get(`/api/cases/${id}`)).body;
    const mismatch = detail.flags.find(
      (f: { code: string }) => f.code === 'AADHAAR_FORM_CARD_MISMATCH',
    );
    await request(t.app)
      .post(`/api/cases/${id}/flags/${mismatch.id}/resolve`)
      .set('X-Officer-Id', DA)
      .send({ decision: 'accept' })
      .expect(200);
    const n = (await request(t.app).get(`/api/cases/${id}/notice`)).body;
    expect(n.rendered.codes).toContain('AADHAAR_FORM_CARD_MISMATCH');
    const line = n.rendered.en.items.find((l: string) => l.includes('last four digits'));
    expect(line).toContain(`(1111)`);
    expect(line).toContain(`(${FULL_AADHAAR.slice(8)})`);
    for (const text of [
      JSON.stringify(n),
      n.plainText.en,
      n.plainText.mni_beng,
      n.plainText.mni_mtei,
    ]) {
      expect(leaks(text)).toBe(false);
    }
  });

  it('is blocked for a suspected duplicate, with the reason', async () => {
    await screened(DEFICIENT);
    const second = await screened(DEFICIENT, {}, true);
    const n = (await request(t.app).get(`/api/cases/${second}/notice`)).body;
    expect(n).toMatchObject({ allowed: false, rendered: null });
    expect(n.blockedReason).toMatch(/duplicate/i);
    expect(
      (await request(t.app).post(`/api/cases/${second}/notice/sent`).set('X-Officer-Id', DA))
        .status,
    ).toBe(409);
  });

  it('a clean case has nothing to notify', async () => {
    const id = await screened({});
    expect((await request(t.app).get(`/api/cases/${id}/notice`)).body).toMatchObject({
      allowed: false,
      blockedReason: 'There is nothing for the citizen to correct.',
    });
  });

  it('"Mark notice sent" needs an officer, is audited, and shows on the case', async () => {
    const id = await screened(DEFICIENT);
    expect((await request(t.app).post(`/api/cases/${id}/notice/sent`)).status).toBe(401);
    const res = await request(t.app)
      .post(`/api/cases/${id}/notice/sent`)
      .set('X-Officer-Id', DA)
      .send({ channel: 'whatsapp' });
    expect(res.status).toBe(200);
    expect(res.body.noticeSentAt).not.toBeNull();
    const detail = (await request(t.app).get(`/api/cases/${id}`)).body;
    expect(detail.audit.at(-1).summary).toBe(
      'Dealing Assistant marked the deficiency notice as sent (whatsapp)',
    );
    const list = (await request(t.app).get('/api/notices')).body.notices;
    expect(list[0]).toMatchObject({ caseId: id, allowed: true, items: 2 });
    expect(list[0].noticeSentAt).not.toBeNull();
  });
});

describe('citizen status page', () => {
  it('reveals only reference, first (given) name and a coarse status — and only with the signed link', async () => {
    const id = await screened({
      ...DEFICIENT,
      application_form: {
        ...DEFICIENT.application_form,
        applicant_name: 'Laishram Ningol Okram Ongbi Ibemcha Devi',
      },
    });
    const { statusPath } = (await request(t.app).get(`/api/cases/${id}/notice`)).body;
    const [, ref, k] = /^\/s\/([^?]+)\?k=(.+)$/.exec(statusPath)!;
    const ok = await request(t.app).get(`/api/public/status/${ref}`).query({ k });
    expect(ok.status).toBe(200);
    expect(Object.keys(ok.body).sort()).toEqual(['firstName', 'reference', 'status', 'updatedAt']);
    expect(ok.body).toMatchObject({ firstName: 'Ibemcha', status: 'Correction needed' });
    const text = JSON.stringify(ok.body);
    for (const secret of ['Laishram', 'Okram', '1944', 'Imphal', FULL_AADHAAR.slice(8)])
      expect(text).not.toContain(secret);

    const bad = await request(t.app).get(`/api/public/status/${ref}`).query({ k: '000000000000' });
    const unknown = await request(t.app).get('/api/public/status/THD-2026-9999').query({ k });
    expect(bad.status).toBe(404);
    expect(unknown.status).toBe(404);
    expect(bad.body).toEqual(unknown.body); // no enumeration oracle
  });
});

describe('notice audio', () => {
  it('no TTS configured → "Audio unavailable", the notice still works', async () => {
    const id = await screened(DEFICIENT);
    const n = (await request(t.app).get(`/api/cases/${id}/notice`)).body;
    expect(n.allowed).toBe(true);
    expect(n.audio).toMatchObject({ available: false });
    expect(n.audio.reason).toMatch(/Audio unavailable/);
    expect((await request(t.app).post(`/api/cases/${id}/notice/audio`)).body.available).toBe(false);
  });

  it('generates once, serves cached WAV after; Bengali-script Manipuri is what gets read', async () => {
    const synthesize = vi.fn().mockResolvedValue(pcmToWav(Buffer.alloc(2400)));
    const id = await screened(DEFICIENT, {
      tts: { model: 'gemini-3.8-flash-tts', voice: 'Kore', synthesize },
    });
    const first = (await request(t.app).post(`/api/cases/${id}/notice/audio`)).body;
    expect(first).toMatchObject({ available: true, cached: false });
    const text = synthesize.mock.calls[0]![0] as string;
    expect(text).toMatch(/[ঀ-৿]/);
    expect(leaks(text)).toBe(false);
    const second = (await request(t.app).post(`/api/cases/${id}/notice/audio`)).body;
    expect(second).toMatchObject({ available: true, cached: true, url: first.url });
    expect(synthesize).toHaveBeenCalledTimes(1);
    const wav = await request(t.app).get(first.url).buffer(true);
    expect(wav.headers['content-type']).toBe('audio/wav');
    expect((await request(t.app).get(`/api/cases/${id}/notice`)).body.audio).toMatchObject({
      available: true,
      cached: true,
    });
  });

  it('TTS failure → available:false with a reason, never an error status', async () => {
    const synthesize = vi.fn().mockRejectedValue(new TtsError('Gemini TTS timed out'));
    const id = await screened(DEFICIENT, { tts: { model: 'm', voice: 'v', synthesize } });
    const res = await request(t.app).post(`/api/cases/${id}/notice/audio`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      available: false,
      reason: 'Audio unavailable — Gemini TTS timed out',
    });
  });
});

describe('template review', () => {
  it('reviewers edit the file-backed templates; edits are audited and used immediately', async () => {
    const id = await screened(DEFICIENT);
    const before = (await request(t.app).get('/api/templates')).body;
    expect(before.summary).toMatchObject({ reviewed: 0, manualMeetei: 0 });
    expect(
      (
        await request(t.app)
          .patch('/api/templates/template/MISSING_SIGNATURE')
          .send({ reviewed: true })
      ).status,
    ).toBe(401);
    const res = await request(t.app)
      .patch('/api/templates/template/MISSING_SIGNATURE')
      .set('X-Officer-Id', DA)
      .send({ reviewed: true, mni_mtei: 'ꯑꯔꯖꯤ ꯐꯣꯔꯝꯗꯥ ꯁꯥꯏꯟ ꯇꯧꯗ꯭ꯔꯦ꯫', ignored: 'x' });
    expect(res.status).toBe(200);
    const onDisk = JSON.parse(fs.readFileSync(t.templatesPath, 'utf8'));
    expect(
      onDisk.templates.find((x: { code: string }) => x.code === 'MISSING_SIGNATURE'),
    ).toMatchObject({ reviewed: true, mni_mtei: 'ꯑꯔꯖꯤ ꯐꯣꯔꯝꯗꯥ ꯁꯥꯏꯟ ꯇꯧꯗ꯭ꯔꯦ꯫' });
    const n = (await request(t.app).get(`/api/cases/${id}/notice`)).body;
    expect(n.rendered.mni_mtei.items).toContain('ꯑꯔꯖꯤ ꯐꯣꯔꯝꯗꯥ ꯁꯥꯏꯟ ꯇꯧꯗ꯭ꯔꯦ꯫');
    expect(
      (
        await request(t.app)
          .patch('/api/templates/nonsense/X')
          .set('X-Officer-Id', DA)
          .send({ reviewed: true })
      ).status,
    ).toBe(400);
    expect(
      (
        await request(t.app)
          .patch('/api/templates/template/NOPE')
          .set('X-Officer-Id', DA)
          .send({ reviewed: true })
      ).status,
    ).toBe(400);
  });
});
