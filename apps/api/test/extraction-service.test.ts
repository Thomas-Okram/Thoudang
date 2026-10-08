import { afterEach, describe, expect, it } from 'vitest';
import { containsFullAadhaar } from '@thoudang/core';
import { openDb, type DbHandle } from '../src/db/client.js';
import { extractionCache } from '../src/db/schema.js';
import { ExtractionService } from '../src/extraction/service.js';
import type { DemoMode } from '../src/env.js';
import { silentLogger } from '../src/logger.js';
import { preprocessImage } from '../src/services/images.js';
import type { VisionClient } from '../src/services/claude.js';
import { FakeVision, PACKET, classifyJson, makeImage, wireDoc } from './helpers.js';

let handle: DbHandle;
afterEach(() => handle?.close());

async function service(vision: VisionClient | null, demoMode: DemoMode = 'live', concurrency = 3) {
  handle = await openDb(':memory:');
  return new ExtractionService({
    db: handle.db,
    vision,
    model: 'claude-sonnet-5-5',
    demoMode,
    concurrency,
    effortClassify: 'low',
    effortExtract: 'medium',
    logger: silentLogger,
  });
}

const aadhaarVision = () =>
  new FakeVision((req) =>
    req.stage === 'classify' ? classifyJson('aadhaar') : wireDoc('aadhaar', PACKET.aadhaar),
  );

describe('ExtractionService', () => {
  it('cache miss → calls Claude and stores a MASKED result', async () => {
    const vision = aadhaarVision();
    const svc = await service(vision);
    const img = await preprocessImage(await makeImage('#ff0000'));
    const out = await svc.extract('aadhaar', img, 'aadhaar.jpg');
    expect(out).toMatchObject({ ok: true, cacheHit: false, inputTokens: 1500, outputTokens: 400 });
    expect(vision.calls).toHaveLength(1);
    const rows = await handle.db.select().from(extractionCache);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.sha256).toBe(img.sha256);
    expect(containsFullAadhaar(JSON.stringify(rows))).toBe(false);
  });

  it('DEMO_MODE=cache_first → serves the cache without calling Claude', async () => {
    const vision = aadhaarVision();
    const svc = await service(vision, 'cache_first');
    const img = await preprocessImage(await makeImage('#00ff00'));
    await svc.classify(img);
    const second = await svc.classify(img);
    expect(second).toMatchObject({ ok: true, cacheHit: true, latencyMs: 1234 });
    expect(vision.calls).toHaveLength(1);
  });

  it('DEMO_MODE=live → calls Claude even when cached', async () => {
    const vision = aadhaarVision();
    const svc = await service(vision, 'live');
    const img = await preprocessImage(await makeImage('#0000ff'));
    await svc.classify(img);
    await svc.classify(img);
    expect(vision.calls).toHaveLength(2);
  });

  it('DEMO_MODE=cache_only + miss → failure, Claude never called', async () => {
    const vision = aadhaarVision();
    const svc = await service(vision, 'cache_only');
    const out = await svc.classify(await preprocessImage(await makeImage('#123456')));
    expect(out).toMatchObject({ ok: false });
    expect(!out.ok && out.error).toMatch(/cache_only/);
    expect(vision.calls).toHaveLength(0);
  });

  it('API failure with a cached result → uses the cache', async () => {
    let fail = false;
    const vision = new FakeVision(() => {
      if (fail) throw new Error('network down');
      return classifyJson('epic');
    });
    const svc = await service(vision, 'live');
    const img = await preprocessImage(await makeImage('#654321'));
    await svc.classify(img);
    fail = true;
    const out = await svc.classify(img);
    expect(out).toMatchObject({ ok: true, cacheHit: true, value: { type: 'epic' } });
  });

  it('API failure without cache → ok:false with a readable reason (never throws)', async () => {
    const vision = new FakeVision(() => {
      throw new Error('network down');
    });
    const out = await (
      await service(vision)
    ).classify(await preprocessImage(await makeImage('#999999')));
    expect(out).toMatchObject({ ok: false, error: 'network down' });
  });

  it('schema-violating output is a failure, not a crash', async () => {
    const vision = new FakeVision(() => ({ document_type: 'passport' }));
    const out = await (
      await service(vision)
    ).classify(await preprocessImage(await makeImage('#888888')));
    expect(out).toMatchObject({
      ok: false,
      error: 'Claude output did not match the expected schema',
    });
  });

  it('no API key and no cache → failure explaining why', async () => {
    const out = await (
      await service(null)
    ).classify(await preprocessImage(await makeImage('#777777')));
    expect(!out.ok && out.error).toMatch(/ANTHROPIC_API_KEY/);
  });

  it('limits parallel Claude calls to the configured concurrency', async () => {
    const vision = new FakeVision(() => classifyJson('other'), 20);
    const svc = await service(vision, 'live', 3);
    const imgs = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        makeImage(`#${(i + 1).toString(16).repeat(6)}`).then(preprocessImage),
      ),
    );
    await Promise.all(imgs.map((img) => svc.classify(img)));
    expect(vision.calls).toHaveLength(8);
    expect(vision.maxInFlight).toBe(3);
  });
});
