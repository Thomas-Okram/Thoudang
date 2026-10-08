import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { auditLog } from '../src/db/schema.js';
import { openDb } from '../src/db/client.js';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/env.js';
import { silentLogger } from '../src/logger.js';
import path from 'node:path';
import { makeImage, packetVision } from './helpers.js';
import { setupApp, type TestApp } from './setup.js';

let t: TestApp;
afterEach(() => t?.cleanup());

const SLOTS = [
  ['form.jpg', 'application_form'],
  ['aadhaar.jpg', 'aadhaar'],
  ['passbook.jpg', 'bank_passbook'],
  ['epic.jpg', 'epic'],
] as const;

describe('labelled intake slots (speed path)', () => {
  it('officer-labelled images skip classification: 4 Claude calls instead of 8, audited', async () => {
    const vision = packetVision();
    t = await setupApp(vision);
    let req = request(t.app).post('/api/cases');
    for (const [i, [name, type]] of SLOTS.entries()) {
      req = req.field('types', type).attach('files', await makeImage(`#e${i}e${i}e${i}`), {
        filename: name,
        contentType: 'image/jpeg',
      });
    }
    const res = await req;
    await t.pipeline.whenIdle();
    expect(vision.calls.map((c) => c.stage)).toEqual(['extract', 'extract', 'extract', 'extract']);

    const detail = await request(t.app).get(`/api/cases/${res.body.caseId}`);
    expect(detail.body.case.status).toBe('READY');
    expect(detail.body.documents.map((d: { typeSource: string }) => d.typeSource)).toEqual([
      'officer',
      'officer',
      'officer',
      'officer',
    ]);
    const audit = await t.handle.db.select().from(auditLog);
    expect(audit.filter((a) => a.action === 'TYPE_SET_BY_OFFICER')).toHaveLength(4);
    expect(audit.filter((a) => a.action === 'AI_CLASSIFICATION')).toHaveLength(0);
    const docEvents = t.events.filter((e) => e.type === 'document' && e.stage === 'classified');
    expect(
      docEvents.every((e) => e.type === 'document' && e.message === 'Type set by officer'),
    ).toBe(true);
  });

  it('mixed packet: only the unsorted image is classified', async () => {
    const vision = packetVision();
    t = await setupApp(vision);
    const res = await request(t.app)
      .post('/api/cases')
      .field('types', 'application_form')
      .attach('files', await makeImage('#a1a1a1'), {
        filename: 'form.jpg',
        contentType: 'image/jpeg',
      })
      .field('types', '')
      .attach('files', await makeImage('#b2b2b2'), {
        filename: 'aadhaar.jpg',
        contentType: 'image/jpeg',
      });
    expect(res.status).toBe(202);
    await t.pipeline.whenIdle();
    expect(vision.calls.filter((c) => c.stage === 'classify')).toHaveLength(1);
    expect(vision.calls.filter((c) => c.stage === 'extract')).toHaveLength(2);
  });

  it('phone upload with a chosen type flows through the session into the case', async () => {
    const vision = packetVision();
    t = await setupApp(vision);
    const id = (await request(t.app).post('/api/sessions')).body.sessionId;
    const s = await request(t.app)
      .post(`/api/sessions/${id}/files?from=phone&type=aadhaar`)
      .attach('files', await makeImage('#c3c3c3'), {
        filename: 'IMG_0001.jpg',
        contentType: 'image/jpeg',
      });
    expect(s.body.files[0]).toMatchObject({ from: 'phone', docType: 'aadhaar' });

    // Move it to unsorted and back to aadhaar (slot drag on the desk)
    const fileId = s.body.files[0].id;
    expect(
      (await request(t.app).patch(`/api/sessions/${id}/files/${fileId}`).send({ docType: null }))
        .body.files[0].docType,
    ).toBeNull();
    expect(
      (
        await request(t.app)
          .patch(`/api/sessions/${id}/files/${fileId}`)
          .send({ docType: 'aadhaar' })
      ).body.files[0].docType,
    ).toBe('aadhaar');

    const sub = await request(t.app).post(`/api/sessions/${id}/submit`);
    await t.pipeline.whenIdle();
    expect(vision.calls.map((c) => c.stage)).toEqual(['extract']);
    const detail = await request(t.app).get(`/api/cases/${sub.body.caseId}`);
    expect(detail.body.documents[0]).toMatchObject({
      detectedType: 'aadhaar',
      typeSource: 'officer',
    });
  });
});

describe('intake previews never show an Aadhaar number', () => {
  it('blurs Aadhaar, form and unsorted previews; passbook/voter ID stay sharp', async () => {
    t = await setupApp(packetVision());
    const id = (await request(t.app).post('/api/sessions')).body.sessionId;
    const add = async (type: string | null, name: string) =>
      (
        await request(t.app)
          .post(`/api/sessions/${id}/files${type ? `?type=${type}` : ''}`)
          .attach('files', await makeImage('#eeeeee'), {
            filename: name,
            contentType: 'image/jpeg',
          })
      ).body.files.at(-1);
    const expectations: [string | null, string, string][] = [
      ['aadhaar', 'a.jpg', 'blur'],
      ['application_form', 'f.jpg', 'blur'],
      [null, 'x.jpg', 'blur'],
      ['bank_passbook', 'p.jpg', 'none'],
      ['epic', 'e.jpg', 'none'],
    ];
    for (const [type, name, mode] of expectations) {
      const file = await add(type, name);
      const thumb = await request(t.app).get(file.thumbUrl);
      expect(thumb.headers['x-redaction']).toBe(mode);
    }
  });
});

describe('upload sessions survive an API restart', () => {
  it('a session created by one app instance is usable by the next (same DB file)', async () => {
    t = await setupApp(packetVision());
    const id = (await request(t.app).post('/api/sessions')).body.sessionId;
    await request(t.app)
      .post(`/api/sessions/${id}/files?type=application_form`)
      .attach('files', await makeImage('#d4d4d4'), {
        filename: 'form.jpg',
        contentType: 'image/jpeg',
      })
      .expect(201);

    // "Restart": a fresh app on the same database file and uploads dir.
    const second = await openDb(t.dbPath);
    const config = loadConfig({ DB_PATH: t.dbPath, UPLOADS_DIR: path.join(t.dir, 'uploads') });
    const vision = packetVision();
    const restarted = await createApp({
      db: second.db,
      config,
      vision,
      logger: silentLogger,
      today: () => '2026-10-09',
    });
    const s = await request(restarted.app).get(`/api/sessions/${id}`);
    expect(s.status).toBe(200);
    expect(s.body.files).toHaveLength(1);
    expect(s.body.files[0].docType).toBe('application_form');
    const sub = await request(restarted.app).post(`/api/sessions/${id}/submit`);
    expect(sub.status).toBe(202);
    await restarted.pipeline.whenIdle();
    expect((await request(restarted.app).get(`/api/sessions/${id}`)).status).toBe(404);
    await second.close();
  });
});
