import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import AdmZip from 'adm-zip';
import sharp from 'sharp';
import { eq } from 'drizzle-orm';
import { documents } from '../src/db/schema.js';
import { countGps } from '../src/security/exif.js';
import { makeImage, packetVision } from './helpers.js';
import { setupApp, testSecurity, type TestApp } from './setup.js';

let t: TestApp;
afterEach(() => t?.cleanup());

const GPS = {
  GPSLatitudeRef: 'N',
  GPSLatitude: '24/1 49/1 1234/100',
  GPSLongitudeRef: 'E',
  GPSLongitude: '93/1 56/1 0/1',
};
const gpsPhoto = (text: string) =>
  makeImage('#dde6ee', 500, 350, text).then((b) =>
    sharp(b)
      .withExif({ IFD0: { Make: 'Phone' }, IFD3: GPS })
      .jpeg()
      .toBuffer(),
  );
const tmpFiles = () => {
  const dir = path.join(t.config.uploadsDir, 'tmp');
  return fs.existsSync(dir) ? fs.readdirSync(dir) : [];
};

describe('upload guard', () => {
  it('stored originals have GPS stripped, random names, and are never served raw', async () => {
    t = await setupApp(packetVision());
    const photo = await gpsPhoto('form');
    expect(countGps(photo)).toBeGreaterThan(0);
    const res = await request(t.app)
      .post('/api/cases')
      .attach('files', photo, { filename: 'form.jpg', contentType: 'image/jpeg' })
      .attach('files', await gpsPhoto('aadhaar'), {
        filename: '../../aadhaar.jpg',
        contentType: 'image/jpeg',
      });
    expect(res.status).toBe(202);
    await t.pipeline.whenIdle();
    const docs = await t.handle.db
      .select()
      .from(documents)
      .where(eq(documents.caseId, res.body.caseId));
    expect(docs).toHaveLength(2);
    for (const d of docs) {
      const stored = fs.readFileSync(d.storedPath);
      expect(countGps(stored)).toBe(0);
      expect(path.basename(d.storedPath)).toMatch(/^[0-9a-f-]{36}-original\.jpg$/);
      expect(path.dirname(d.storedPath)).toBe(path.join(t.config.uploadsDir, res.body.caseId));
      const served = await request(t.app).get(`/api/documents/${d.id}/image`);
      expect(served.status).toBe(200);
      expect(Buffer.from(served.body).equals(stored)).toBe(false);
      expect(countGps(Buffer.from(served.body))).toBe(0);
    }
    expect((await request(t.app).get(`/uploads/${res.body.caseId}`)).status).toBe(404);
    expect(tmpFiles()).toEqual([]);
  });

  it('refuses files whose content is not JPEG/PNG/WebP/HEIC, whatever their name or MIME', async () => {
    t = await setupApp(packetVision());
    const cases: [Buffer, string][] = [
      [Buffer.from('<?php system($_GET["c"]); ?>'), 'form.jpg'],
      [Buffer.from('GIF89a\x01\x00\x01\x00'), 'aadhaar.gif'],
      [Buffer.from('%PDF-1.7\n'), 'passbook.pdf'],
      [
        await sharp(await makeImage('#fff'))
          .tiff()
          .toBuffer(),
        'scan.tif',
      ],
    ];
    for (const [buf, name] of cases) {
      const res = await request(t.app)
        .post('/api/cases')
        .attach('files', await makeImage('#fafafa'), {
          filename: 'ok.jpg',
          contentType: 'image/jpeg',
        })
        .attach('files', buf, { filename: name, contentType: 'image/jpeg' });
      expect(res.status, name).toBe(415);
      expect(res.body.error).toMatch(/not a JPEG, PNG, WebP or HEIC/);
    }
    expect((await request(t.app).get('/api/cases')).body.cases).toHaveLength(0);
    expect(tmpFiles()).toEqual([]); // nothing left behind
  });

  it('a real image with a misleading name is stored under its true extension', async () => {
    t = await setupApp(packetVision());
    const png = await sharp(await makeImage('#eee', 300, 200, 'form'))
      .png()
      .toBuffer();
    const res = await request(t.app)
      .post('/api/cases')
      .attach('files', png, { filename: 'form.php', contentType: 'application/x-php' });
    expect(res.status).toBe(202);
    await t.pipeline.whenIdle();
    const doc = (
      await t.handle.db
        .select()
        .from(documents)
        .where(eq(documents.caseId, res.body.caseId))
        .limit(1)
    )[0]!;
    expect(doc.storedPath).toMatch(/-original\.png$/);
    expect(doc.mimeType).toBe('image/png');
  });

  it('enforces per-file size and file-count limits', async () => {
    t = await setupApp(packetVision(), 'live', {
      security: testSecurity({ MAX_UPLOAD_FILE_MB: '0.05' }),
    });
    const side = 1200;
    const big = await sharp(crypto.randomBytes(side * side * 3), {
      raw: { width: side, height: side, channels: 3 },
    })
      .jpeg({ quality: 100 })
      .toBuffer();
    expect(big.length).toBeGreaterThan(0.05 * 1024 * 1024);
    const tooBig = await request(t.app).post('/api/cases').attach('files', big, 'form.jpg');
    expect(tooBig.status).toBe(413);

    await t.cleanup();
    t = await setupApp(packetVision());
    let req = request(t.app).post('/api/cases');
    for (let i = 0; i < 7; i++) req = req.attach('files', await makeImage('#eee'), `p${i}.jpg`);
    const tooMany = await req;
    expect(tooMany.status).toBe(400);
    expect(tooMany.body.error).toMatch(/at most 6/);
    expect(tmpFiles()).toEqual([]);
  });

  it('batch: folder junk is dropped quietly; zips are checked entry by entry and GPS-stripped', async () => {
    t = await setupApp(packetVision());
    // Folder upload with a .DS_Store and a truth.json next to the images.
    const folder = await request(t.app)
      .post('/api/cases/batch')
      .field('paths', 'b/p1/form.jpg')
      .field('paths', 'b/p1/.DS_Store')
      .field('paths', 'b/p1/truth.json')
      .attach('files', await gpsPhoto('p1form'), 'form.jpg')
      .attach('files', Buffer.from([0, 0, 0, 1, 66, 117, 100, 49]), '.DS_Store')
      .attach('files', Buffer.from('{"a":1}'), 'truth.json');
    expect(folder.status).toBe(202);
    expect(folder.body.cases).toHaveLength(1);
    await t.pipeline.whenIdle();

    const zip = new AdmZip();
    zip.addFile('intake/p2/form.jpg', await gpsPhoto('p2form'));
    zip.addFile('intake/p2/aadhaar.jpg', await gpsPhoto('p2aadhaar'));
    zip.addFile('__MACOSX/intake/p2/._form.jpg', Buffer.from('junk'));
    const ok = await request(t.app)
      .post('/api/cases/batch')
      .attach('files', zip.toBuffer(), { filename: 'intake.zip', contentType: 'application/zip' });
    expect(ok.status).toBe(202);
    await t.pipeline.whenIdle();
    const caseId = ok.body.cases[0].caseId as string;
    for (const d of await t.handle.db.select().from(documents).where(eq(documents.caseId, caseId)))
      expect(countGps(fs.readFileSync(d.storedPath))).toBe(0);

    const evil = new AdmZip();
    evil.addFile('intake/p3/form.jpg', await makeImage('#eee'));
    evil.addFile('intake/p3/aadhaar.jpg', Buffer.from('#!/bin/sh\nrm -rf /'));
    const refused = await request(t.app)
      .post('/api/cases/batch')
      .attach('files', evil.toBuffer(), { filename: 'evil.zip', contentType: 'application/zip' });
    expect(refused.status).toBe(415);
    expect(refused.body.error).toMatch(/aadhaar\.jpg is not a JPEG/);
  });

  it('phone upload sessions go through the same guard', async () => {
    t = await setupApp(packetVision());
    const s = await request(t.app).post('/api/sessions');
    const bad = await request(t.app)
      .post(`/api/sessions/${s.body.sessionId}/files?from=phone`)
      .attach('files', Buffer.from('not an image'), {
        filename: 'IMG_0001.jpg',
        contentType: 'image/jpeg',
      });
    expect(bad.status).toBe(415);
    const good = await request(t.app)
      .post(`/api/sessions/${s.body.sessionId}/files?from=phone&type=aadhaar`)
      .attach('files', await gpsPhoto('aadhaar'), {
        filename: 'IMG_0002.jpg',
        contentType: 'image/jpeg',
      });
    expect(good.status).toBe(201);
    const file = (await t.sessions.get(s.body.sessionId))!.files[0]!;
    expect(countGps(fs.readFileSync(file.path))).toBe(0);
  });
});
