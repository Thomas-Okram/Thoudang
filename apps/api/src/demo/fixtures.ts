/**
 * UI/demo fallback WITHOUT an API key:  npm run dev:fixtures [-- --dir ./eval-data]
 *
 * Seeds the MAIN database's extraction cache from each packet's truth.json (+ layout.json boxes),
 * so uploading those SPECIMEN images replays instantly with DEMO_MODE=cache_first/cache_only.
 * Rows are stored with model "fixture-truth" and shown everywhere as "Fixture data (no AI)" —
 * they must never be presented as AI output.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { openDb } from '../db/client.js';
import { extractionCache } from '../db/schema.js';
import { env } from '../env.js';
import { normaliseExtraction } from '../extraction/normalise.js';
import {
  DOC_FIELDS,
  EXTRACTABLE_TYPES,
  PROMPT_VERSION,
  type ExtractableType,
} from '../extraction/schemas.js';
import { ExtractionService } from '../extraction/service.js';
import { silentLogger } from '../logger.js';
import { preprocessImage } from '../services/images.js';
import { TruthSchema } from '../eval/score.js';
import { fromInvocationDir, parseArgs } from '../eval/cli-args.js';

export const FIXTURE_MODEL = 'fixture-truth';
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

async function main() {
  const { flags } = parseArgs(process.argv.slice(2));
  const dir =
    typeof flags.dir === 'string' ? fromInvocationDir(flags.dir) : path.join(repoRoot, 'eval-data');
  const handle = openDb();
  const keyMaker = new ExtractionService({
    db: handle.db,
    vision: null,
    model: env.claude.model,
    demoMode: 'cache_only',
    concurrency: 1,
    effortClassify: 'low',
    effortExtract: 'medium',
    logger: silentLogger,
  });
  const put = (key: string, sha256: string, stage: string, result: Record<string, unknown>) =>
    handle.db
      .insert(extractionCache)
      .values({
        key,
        sha256,
        stage,
        model: FIXTURE_MODEL,
        promptVersion: PROMPT_VERSION,
        result,
        latencyMs: 0,
        inputTokens: 0,
        outputTokens: 0,
      })
      .onConflictDoUpdate({ target: extractionCache.key, set: { result, model: FIXTURE_MODEL } })
      .run();

  let images = 0;
  for (const packet of fs.readdirSync(dir).sort()) {
    const folder = path.join(dir, packet);
    if (!fs.existsSync(path.join(folder, 'truth.json'))) continue;
    const truth = TruthSchema.parse(
      JSON.parse(fs.readFileSync(path.join(folder, 'truth.json'), 'utf8')),
    );
    const layoutFile = path.join(folder, 'layout.json');
    const layout = fs.existsSync(layoutFile)
      ? (JSON.parse(fs.readFileSync(layoutFile, 'utf8')) as Record<
          string,
          Record<string, number[]>
        >)
      : {};
    for (const [file, doc] of Object.entries(truth.documents)) {
      const raw = fs.readFileSync(path.join(folder, file));
      const meta = await sharp(raw).metadata();
      const image = await preprocessImage(raw);
      const k = image.width / (meta.width ?? image.width);
      put(keyMaker.cacheKey('classify', image.sha256), image.sha256, 'classify', {
        type: doc.type,
        confidence: 'high',
        legibility: 'good',
        reason: 'Fixture from truth.json (no AI)',
      });
      if ((EXTRACTABLE_TYPES as readonly string[]).includes(doc.type)) {
        const type = doc.type as ExtractableType;
        const fields = Object.fromEntries(
          DOC_FIELDS[type].map((f) => {
            const value = doc.fields[f];
            const box = layout[file]?.[f];
            return [
              f,
              value === undefined || value === null
                ? { value: '', status: 'blank' as const, confidence: 'high' as const, bbox: [] }
                : {
                    value,
                    status: 'present' as const,
                    confidence: 'high' as const,
                    bbox: box ? box.map((n) => n * k) : [],
                  },
            ];
          }),
        );
        const normalised = normaliseExtraction(
          type,
          { legibility: 'good', notes: 'Fixture data (no AI)', fields },
          image,
        );
        put(
          keyMaker.cacheKey(`extract:${type}`, image.sha256),
          image.sha256,
          `extract:${type}`,
          normalised as unknown as Record<string, unknown>,
        );
      }
      images += 1;
    }
    console.log(`  ${packet}: ${Object.keys(truth.documents).length} image(s)`);
  }
  handle.close();
  console.log(`\nSeeded fixture results for ${images} image(s) into ${env.dbPath}.`);
  console.log(
    'Upload those images with DEMO_MODE=cache_first or cache_only (npm run demo). Shown as "Fixture data (no AI)".',
  );
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
