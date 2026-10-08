import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { openDb } from '../src/db/client.js';
import { auditLog, extractionCache } from '../src/db/schema.js';
import { openFreshEvalDb } from '../src/eval/fresh-db.js';

describe('openFreshEvalDb', () => {
  it('drops everything from the previous run except the extraction cache', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'thoudang-eval-'));
    const dbPath = path.join(dir, 'eval.db');
    const uploads = path.join(dir, 'eval-uploads');
    fs.mkdirSync(path.join(uploads, 'case-1'), { recursive: true });
    fs.writeFileSync(path.join(uploads, 'case-1', 'x.jpg'), 'x');

    const first = await openDb(dbPath);
    await first.db.insert(extractionCache).values({
      key: 'k1',
      sha256: 'abc',
      stage: 'extract:aadhaar',
      model: 'fixture-truth',
      promptVersion: 'v1',
      result: { ok: true },
      latencyMs: 1,
      inputTokens: 0,
      outputTokens: 0,
    });
    await first.db
      .insert(auditLog)
      .values({ actor: 'system', action: 'CASE_CREATED', entityType: 'case', caseId: 'c1' });
    await first.close();
    fs.writeFileSync(`${dbPath}.audit-anchor.json`, '{}');

    const { handle, carriedCacheRows } = await openFreshEvalDb(dbPath, uploads);
    try {
      expect(carriedCacheRows).toBe(1);
      expect((await handle.db.select().from(extractionCache)).map((r) => r.key)).toEqual(['k1']);
      expect(await handle.db.select().from(auditLog)).toHaveLength(0);
      expect(fs.existsSync(`${dbPath}.audit-anchor.json`)).toBe(false);
      expect(fs.existsSync(uploads)).toBe(false);
    } finally {
      await handle.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('works when there is no previous database', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'thoudang-eval-'));
    const { handle, carriedCacheRows } = await openFreshEvalDb(
      path.join(dir, 'eval.db'),
      path.join(dir, 'u'),
    );
    expect(carriedCacheRows).toBe(0);
    await handle.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
