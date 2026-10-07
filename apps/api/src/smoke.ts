/**
 * Real-API smoke test (costs a few cents):
 *   npm run smoke -- path/to/image.jpg [--type application_form|aadhaar|bank_passbook|epic]
 * Prints the classification, the (Aadhaar-masked) extraction, latency and token usage.
 */
import fs from 'node:fs';
import { openDb } from './db/client.js';
import { env } from './env.js';
import { ExtractionService } from './extraction/service.js';
import { EXTRACTABLE_TYPES, type ExtractableType } from './extraction/schemas.js';
import { createLogger } from './logger.js';
import { createAnthropicVisionClient } from './services/claude.js';
import { preprocessImage } from './services/images.js';
import { fromInvocationDir, parseArgs } from './eval/cli-args.js';

async function main() {
  const { positional, flags } = parseArgs(process.argv.slice(2));
  const file = positional[0];
  if (!file) throw new Error('Usage: npm run smoke -- path/to/image.jpg [--type aadhaar]');
  if (!env.anthropicConfigured) throw new Error('ANTHROPIC_API_KEY is not set (apps/api/.env).');
  const imagePath = fromInvocationDir(file);

  const handle = openDb(':memory:');
  const service = new ExtractionService({
    db: handle.db,
    vision: createAnthropicVisionClient({
      model: env.claude.model,
      timeoutMs: env.claude.timeoutMs,
      maxRetries: env.claude.maxRetries,
      onRetry: (_e, attempt, delay) => console.log(`  retry ${attempt} in ${delay} ms`),
    }),
    model: env.claude.model,
    demoMode: 'live',
    concurrency: 1,
    effortClassify: env.claude.effortClassify,
    effortExtract: env.claude.effortExtract,
    logger: createLogger({ console: true }),
  });

  const image = await preprocessImage(fs.readFileSync(imagePath));
  console.log(
    `Image: ${imagePath} → ${image.width}×${image.height} JPEG, sha256 ${image.sha256.slice(0, 12)}…`,
  );
  console.log(
    `Model: ${env.claude.model}  effort classify=${env.claude.effortClassify} extract=${env.claude.effortExtract}\n`,
  );

  let type = typeof flags.type === 'string' ? (flags.type as ExtractableType) : null;
  let inTok = 0;
  let outTok = 0;
  if (!type) {
    const c = await service.classify(image, file);
    if (!c.ok) throw new Error(`Classification failed: ${c.error}`);
    console.log('Classification:', JSON.stringify(c.value, null, 2));
    console.log(
      `  latency ${c.latencyMs} ms, tokens in ${c.inputTokens} / out ${c.outputTokens}\n`,
    );
    inTok += c.inputTokens;
    outTok += c.outputTokens;
    if (c.value.type === 'other') return console.log('Not a packet document — nothing to extract.');
    type = c.value.type;
  }
  if (!EXTRACTABLE_TYPES.includes(type)) throw new Error(`Unknown --type ${type}`);
  const x = await service.extract(type, image, file);
  if (!x.ok) throw new Error(`Extraction failed: ${x.error}`);
  console.log(`Extraction (${type}, Aadhaar already masked):`, JSON.stringify(x.value, null, 2));
  console.log(`  latency ${x.latencyMs} ms, tokens in ${x.inputTokens} / out ${x.outputTokens}`);
  inTok += x.inputTokens;
  outTok += x.outputTokens;
  const usd = (inTok / 1e6) * env.pricing.inputPerMTok + (outTok / 1e6) * env.pricing.outputPerMTok;
  console.log(`\nTotal: ${inTok} input + ${outTok} output tokens ≈ $${usd.toFixed(4)}`);
  handle.close();
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
