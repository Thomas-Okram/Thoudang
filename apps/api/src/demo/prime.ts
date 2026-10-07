/**
 * Prime the MAIN database's extraction cache so stage replays are instant:
 *   npm run demo:prime -- --dir ./demo-packets [--with-cases]
 *
 * --dir: one sub-folder per packet (or loose images). Types come from truth.json when present,
 *        else from file names (form/aadhaar/passbook/epic), else the AI classifies.
 * Both the classify and the extract result are cached, so the packet is instant whether the
 * officer drops images into labelled slots or into "Unsorted".
 *
 * Default: warms the cache only and creates NO cases — re-uploading a primed packet on stage
 * would otherwise be flagged as a duplicate of the primed case. --with-cases also creates queue
 * cases (useful to pre-fill the Queue with a batch).
 */
import fs from 'node:fs';
import path from 'node:path';
import { createApp } from '../app.js';
import { openDb } from '../db/client.js';
import { env } from '../env.js';
import { EXTRACTABLE_TYPES, type ExtractableType } from '../extraction/schemas.js';
import { ExtractionService } from '../extraction/service.js';
import { createLogger } from '../logger.js';
import { createAnthropicVisionClient } from '../services/claude.js';
import { preprocessImage } from '../services/images.js';
import { isImageName } from '../upload.js';
import { fromInvocationDir, parseArgs } from '../eval/cli-args.js';
import { typeFromName } from './type-from-name.js';
import { purgeFixtures } from './fixture-model.js';

function truthTypes(folder: string): Record<string, string> {
  const file = path.join(folder, 'truth.json');
  if (!fs.existsSync(file)) return {};
  const truth = JSON.parse(fs.readFileSync(file, 'utf8')) as {
    documents?: Record<string, { type?: string }>;
  };
  return Object.fromEntries(
    Object.entries(truth.documents ?? {}).map(([k, v]) => [k, v.type ?? '']),
  );
}

async function main() {
  const { flags } = parseArgs(process.argv.slice(2));
  const dir = fromInvocationDir(typeof flags.dir === 'string' ? flags.dir : './demo-packets');
  if (!fs.existsSync(dir)) throw new Error(`No such directory: ${dir}`);
  if (!env.anthropicConfigured)
    throw new Error('ANTHROPIC_API_KEY is not set (apps/api/.env) — priming needs the real API.');

  const folders = [
    dir,
    ...fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => path.join(dir, d.name)),
  ];
  const logger = createLogger({ file: env.logFile, console: false });
  const handle = openDb();
  const vision = createAnthropicVisionClient({
    model: env.claude.model,
    timeoutMs: env.claude.timeoutMs,
    maxRetries: env.claude.maxRetries,
  });
  // cache_first: already-primed images are skipped (no API call).
  const extraction = new ExtractionService({
    db: handle.db,
    vision,
    model: env.claude.model,
    demoMode: 'cache_first',
    concurrency: env.claude.concurrency,
    effortClassify: env.claude.effortClassify,
    effortExtract: env.claude.effortExtract,
    logger,
  });

  let images = 0;
  let calls = 0;
  let failures = 0;
  const started = Date.now();
  for (const folder of folders) {
    const files = fs.readdirSync(folder).filter(isImageName).sort();
    if (!files.length) continue;
    const truth = truthTypes(folder);
    console.log(`\n${path.relative(dir, folder) || '.'}`);
    await Promise.all(
      files.map(async (file) => {
        images += 1;
        const image = await preprocessImage(fs.readFileSync(path.join(folder, file)));
        // Fixture rows (npm run dev:fixtures) must not stop real results from being primed.
        if (purgeFixtures(handle.db, image.sha256))
          console.log(`  ${file}: replacing fixture data with real AI results`);
        const cls = await extraction.classify(image, file);
        if (!cls.cacheHit && cls.ok) calls += 1;
        const known = truth[file];
        const type =
          (known && (EXTRACTABLE_TYPES as readonly string[]).includes(known)
            ? (known as ExtractableType)
            : null) ??
          typeFromName(file) ??
          (cls.ok && cls.value.type !== 'other' ? cls.value.type : null);
        if (!type) {
          console.log(`  ${file}: not a packet document (${cls.ok ? cls.value.type : cls.error})`);
          return;
        }
        const ext = await extraction.extract(type, image, file);
        if (!ext.cacheHit && ext.ok) calls += 1;
        if (!ext.ok) failures += 1;
        console.log(
          `  ${file}: ${type} ${ext.ok ? (ext.cacheHit ? 'already cached' : `cached (${ext.latencyMs} ms)`) : `FAILED: ${ext.error}`}`,
        );
      }),
    );

    if (flags['with-cases'] === true) {
      const { pipeline } = createApp({
        db: handle.db,
        config: { ...env, demoMode: 'cache_first' },
        vision,
        logger,
      });
      const tmp = path.join(env.uploadsDir, 'tmp');
      fs.mkdirSync(tmp, { recursive: true });
      const incoming = files.map((file) => {
        const copy = path.join(
          tmp,
          `prime-${Date.now()}-${Math.random().toString(36).slice(2)}${path.extname(file)}`,
        );
        fs.copyFileSync(path.join(folder, file), copy);
        const known = truth[file];
        return {
          path: copy,
          originalName: file,
          mimeType: 'image/jpeg',
          size: fs.statSync(copy).size,
          docType:
            (known && (EXTRACTABLE_TYPES as readonly string[]).includes(known)
              ? (known as ExtractableType)
              : null) ?? typeFromName(file),
        };
      });
      const created = await pipeline.createCase({
        files: incoming,
        source: 'batch',
        packetName: path.basename(folder),
      });
      await pipeline.whenIdle();
      console.log(`  → case ${created.reference}`);
    }
  }
  handle.close();
  console.log(
    `\nPrimed ${images} image(s): ${calls} Claude call(s), ${failures} failure(s), ${((Date.now() - started) / 1000).toFixed(1)} s.`,
  );
  console.log(
    'Run the demo with DEMO_MODE=cache_first (npm run demo does this) — primed images replay instantly.',
  );
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
