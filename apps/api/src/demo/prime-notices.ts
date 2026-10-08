/**
 * Pre-generate notice audio for every case that has a citizen notice, so the stage run needs
 * no network:   npm run notices:prime
 * Needs GEMINI_API_KEY. Audio is cached by sha256(model|voice|text) in data/audio/.
 */
import { eq } from 'drizzle-orm';
import { openDb } from '../db/client.js';
import { cases } from '../db/schema.js';
import { env } from '../env.js';
import { buildNotice, TemplateStore } from '../notices.js';
import { AudioCache, createGeminiTts } from '../services/tts.js';

async function main() {
  if (!env.tts.apiKey)
    throw new Error('GEMINI_API_KEY is not set (apps/api/.env) — cannot generate notice audio.');
  const tts = createGeminiTts({
    apiKey: env.tts.apiKey,
    model: env.tts.model,
    voice: env.tts.voice,
    timeoutMs: env.tts.timeoutMs,
  });
  const audio = new AudioCache(env.audioDir);
  const templates = new TemplateStore(env.templatesPath).load();
  const handle = await openDb();
  const rows = await handle.db.select().from(cases).where(eq(cases.historical, false));
  let made = 0;
  let cached = 0;
  let failed = 0;
  for (const r of rows) {
    const n = await buildNotice(handle.db, r.id, {
      templates,
      statusLinkSecret: env.statusLinkSecret,
    });
    if (!n?.allowed || !n.audioText) continue;
    try {
      const started = Date.now();
      const out = await audio.ensure(tts, n.audioText);
      if (out.cached) cached += 1;
      else made += 1;
      console.log(
        `  ${r.reference}: ${out.cached ? 'already cached' : `generated in ${((Date.now() - started) / 1000).toFixed(1)} s`}`,
      );
    } catch (err) {
      failed += 1;
      console.log(`  ${r.reference}: FAILED — ${err instanceof Error ? err.message : 'error'}`);
    }
  }
  await handle.close();
  console.log(
    `\nNotice audio: ${made} generated, ${cached} already cached, ${failed} failed (model ${env.tts.model}, voice ${env.tts.voice}).`,
  );
  if (!made && !cached && !failed)
    console.log('No case currently needs a citizen notice. Screen the demo packets first.');
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
