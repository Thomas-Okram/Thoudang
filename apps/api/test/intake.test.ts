import http from 'node:http';
import type { AddressInfo } from 'node:net';
import AdmZip from 'adm-zip';
import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { lanAddresses } from '../src/network.js';
import { groupIntoPackets, type RelativeFile } from '../src/upload.js';
import { makeImage, packetVision } from './helpers.js';
import { setupApp, type TestApp } from './setup.js';

let t: TestApp;
afterEach(() => t?.cleanup());

describe('PUBLIC_BASE_URL', () => {
  it('the phone QR link uses PUBLIC_BASE_URL when set (Docker / reverse proxy / tunnel)', async () => {
    t = setupApp(packetVision(), 'live', {
      env: { PUBLIC_BASE_URL: 'https://thoudang.example.in/' },
    });
    const s = await request(t.app).post('/api/sessions').expect(201);
    expect(s.body.mobileUrl).toBe(`https://thoudang.example.in/m/upload/${s.body.sessionId}`);
    const again = await request(t.app).get(`/api/sessions/${s.body.sessionId}`).expect(200);
    expect(again.body.mobileUrl).toBe(s.body.mobileUrl);
    const net = await request(t.app).get('/api/network').expect(200);
    expect(net.body.publicBaseUrl).toBe('https://thoudang.example.in');
  });

  it('is ignored when it is not an http(s) URL', async () => {
    t = setupApp(packetVision(), 'live', { env: { PUBLIC_BASE_URL: 'javascript:alert(1)' } });
    const s = await request(t.app).post('/api/sessions').expect(201);
    expect(s.body.mobileUrl).toMatch(/^http:\/\/.+:5173\/m\/upload\/[\w-]+$/);
    const net = await request(t.app).get('/api/network').expect(200);
    expect(net.body.publicBaseUrl).toBeNull();
  });
});

describe('phone/desk upload sessions', () => {
  it('desk + phone add images to one session; submit creates a phone-sourced case', async () => {
    t = setupApp(packetVision());
    const s = await request(t.app).post('/api/sessions');
    expect(s.status).toBe(201);
    expect(s.body.mobileUrl).toMatch(/^http:\/\/.+:5173\/m\/upload\/[\w-]+$/);
    const id = s.body.sessionId;

    await request(t.app)
      .post(`/api/sessions/${id}/files`)
      .attach('files', await makeImage('#eee'), { filename: 'form.jpg', contentType: 'image/jpeg' })
      .expect(201);
    const phone = await request(t.app)
      .post(`/api/sessions/${id}/files?from=phone`)
      .attach('files', await makeImage('#ddd'), {
        filename: 'aadhaar.jpg',
        contentType: 'image/jpeg',
      })
      .attach('files', await makeImage('#ccc'), {
        filename: 'passbook.jpg',
        contentType: 'image/jpeg',
      });
    expect(phone.body.files.map((f: { from: string }) => f.from)).toEqual([
      'desk',
      'phone',
      'phone',
    ]);
    expect(t.events.filter((e) => e.type === 'session' && e.action === 'file-added')).toHaveLength(
      3,
    );

    const thumb = await request(t.app).get(phone.body.files[0].thumbUrl);
    expect(thumb.headers['content-type']).toBe('image/jpeg');

    await request(t.app).delete(`/api/sessions/${id}/files/${phone.body.files[2].id}`).expect(200);
    await request(t.app)
      .post(`/api/sessions/${id}/files?from=phone`)
      .attach('files', await makeImage('#bbb'), {
        filename: 'passbook.jpg',
        contentType: 'image/jpeg',
      })
      .expect(201);

    const submitted = await request(t.app).post(`/api/sessions/${id}/submit`);
    expect(submitted.status).toBe(202);
    await t.pipeline.whenIdle();
    const detail = await request(t.app).get(`/api/cases/${submitted.body.caseId}`);
    expect(detail.body.case.source).toBe('phone');
    expect(detail.body.documents).toHaveLength(3);
    expect((await request(t.app).get(`/api/sessions/${id}`)).status).toBe(404);
  });

  it('a session holds at most 6 images', async () => {
    t = setupApp(packetVision());
    const id = (await request(t.app).post('/api/sessions')).body.sessionId;
    for (let i = 0; i < 6; i++) {
      await request(t.app)
        .post(`/api/sessions/${id}/files`)
        .attach('files', await makeImage('#eee'), {
          filename: `p${i}.jpg`,
          contentType: 'image/jpeg',
        })
        .expect(201);
    }
    const res = await request(t.app)
      .post(`/api/sessions/${id}/files`)
      .attach('files', await makeImage('#eee'), { filename: 'p7.jpg', contentType: 'image/jpeg' });
    expect(res.status).toBe(400);
  });
});

describe('batch intake', () => {
  it('folder upload (one sub-folder per packet) → one case per packet', async () => {
    t = setupApp(packetVision());
    let req = request(t.app).post('/api/cases/batch');
    for (const p of ['packet-01', 'packet-02']) {
      for (const name of ['form.jpg', 'aadhaar.jpg', 'passbook.jpg']) {
        req = req
          .field('paths', `batch/${p}/${name}`)
          .attach('files', await makeImage('#f0f0f0', 600, 400, `${p} ${name}`), {
            filename: name,
            contentType: 'image/jpeg',
          });
      }
    }
    const res = await req;
    expect(res.status).toBe(202);
    expect(res.body.cases.map((c: { packetName: string }) => c.packetName)).toEqual([
      'packet-01',
      'packet-02',
    ]);
    await t.pipeline.whenIdle();
    const listed = await request(t.app).get(`/api/cases?batchId=${res.body.batchId}`);
    expect(listed.body.cases).toHaveLength(2);
    expect(
      listed.body.cases.every(
        (c: { source: string; processingState: string }) =>
          c.source === 'batch' && c.processingState === 'SCREENED',
      ),
    ).toBe(true);
    // Both packets carry the same synthetic applicant → the later one is caught as a duplicate.
    expect(listed.body.cases.map((c: { status: string }) => c.status).sort()).toEqual([
      'OFFICER_ATTENTION',
      'READY',
    ]);
  });

  it('zip upload is expanded and grouped the same way', async () => {
    t = setupApp(packetVision());
    const zip = new AdmZip();
    for (const p of ['p1', 'p2', 'p3']) {
      for (const name of ['form.jpg', 'aadhaar.jpg'])
        zip.addFile(`intake/${p}/${name}`, await makeImage('#eaeaea', 500, 300, `${p}${name}`));
    }
    zip.addFile('__MACOSX/intake/p1/._form.jpg', Buffer.from('junk'));
    const res = await request(t.app)
      .post('/api/cases/batch')
      .attach('files', zip.toBuffer(), { filename: 'intake.zip', contentType: 'application/zip' });
    expect(res.status).toBe(202);
    expect(res.body.cases).toHaveLength(3);
    await t.pipeline.whenIdle();
  });

  it('groupIntoPackets ignores hidden files and non-images, sorts naturally', () => {
    const f = (relPath: string): RelativeFile => ({
      relPath,
      path: relPath,
      originalName: relPath,
      mimeType: 'image/jpeg',
      size: 1,
    });
    const packets = groupIntoPackets([
      f('b/packet-10/a.jpg'),
      f('b/packet-2/a.jpg'),
      f('b/packet-2/.DS_Store'),
      f('b/packet-2/truth.json'),
      f('b/.hidden/x.jpg'),
    ]);
    expect(packets.map((p) => [p.name, p.files.length])).toEqual([
      ['packet-2', 1],
      ['packet-10', 1],
    ]);
  });
});

describe('GET /api/events (SSE)', () => {
  it('streams events as text/event-stream data lines, filtered by caseId', async () => {
    t = setupApp(packetVision());
    const server = t.app.listen(0);
    const { port } = server.address() as AddressInfo;
    const chunks: string[] = [];
    await new Promise<void>((resolve, reject) => {
      const req = http.get(`http://127.0.0.1:${port}/api/events?caseId=wanted`, (res) => {
        expect(res.headers['content-type']).toBe('text/event-stream');
        res.setEncoding('utf8');
        res.on('data', (c: string) => {
          chunks.push(c);
          if (chunks.join('').includes('"stage":"done"')) {
            req.destroy();
            resolve();
          }
        });
        setTimeout(() => {
          t.bus.publish({
            type: 'case',
            caseId: 'other',
            reference: 'X',
            batchId: null,
            stage: 'uploaded',
          });
          t.bus.publish({
            type: 'case',
            caseId: 'wanted',
            reference: 'Y',
            batchId: null,
            stage: 'done',
            status: 'READY',
          });
        }, 30);
      });
      req.on('error', (e) =>
        e.message.includes('aborted') || e.message.includes('socket hang up')
          ? resolve()
          : reject(e),
      );
    });
    server.close();
    const body = chunks.join('');
    expect(body).toContain(': connected');
    expect(body).toMatch(/data: \{"type":"case","caseId":"wanted".*"stage":"done"/);
    expect(body).not.toContain('"caseId":"other"');
  });
});

describe('LAN address detection', () => {
  it('prefers physical private interfaces over virtual ones and skips loopback/public', () => {
    const iface = (address: string, internal = false) => ({
      address,
      family: 'IPv4' as const,
      internal,
      netmask: '',
      mac: '',
      cidr: null,
    });
    const ips = lanAddresses({
      lo0: [iface('127.0.0.1', true)],
      bridge100: [iface('192.168.64.1')],
      en0: [iface('172.20.10.3')],
      utun3: [iface('10.8.0.2')],
      en5: [iface('8.8.8.8')],
    });
    expect(ips[0]).toBe('172.20.10.3');
    expect(ips).not.toContain('127.0.0.1');
    expect(ips).not.toContain('8.8.8.8');
  });
});
