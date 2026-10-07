/**
 * Eval harness:  npm run eval -- --dir ./eval-data [--mode live|cache_first|cache_only] [--out eval-report.json]
 *
 * Each sub-folder of --dir is one packet: images + truth.json. Runs the REAL pipeline (Claude unless
 * cached) against a separate eval database (apps/api/data/eval.db) so the demo queue stays clean.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../app.js';
import { openDb } from '../db/client.js';
import { extractions } from '../db/schema.js';
import { loadConfig, type DemoMode } from '../env.js';
import { createLogger } from '../logger.js';
import { caseDetail } from '../routes/cases.js';
import { createAnthropicVisionClient } from '../services/claude.js';
import { PROMPT_VERSION } from '../extraction/schemas.js';
import { isImageName } from '../upload.js';
import { eq } from 'drizzle-orm';
import { fromInvocationDir, parseArgs } from './cli-args.js';
import {
  TruthSchema,
  formatReport,
  scorePacket,
  summarise,
  type ExtractedForEval,
  type PacketScore,
  type UsageStats,
} from './score.js';

const apiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

async function main() {
  const { flags } = parseArgs(process.argv.slice(2));
  const dir = fromInvocationDir(typeof flags.dir === 'string' ? flags.dir : './eval-data');
  const out = fromInvocationDir(typeof flags.out === 'string' ? flags.out : 'eval-report.json');
  const mode = (
    typeof flags.mode === 'string' ? flags.mode : (process.env.DEMO_MODE ?? 'live')
  ) as DemoMode;

  if (!fs.existsSync(dir)) throw new Error(`No such directory: ${dir}`);
  const packets = fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && fs.existsSync(path.join(dir, d.name, 'truth.json')))
    .map((d) => d.name)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  if (!packets.length) throw new Error(`No packet folders with truth.json in ${dir}`);

  const config = loadConfig({
    ...process.env,
    DB_PATH: path.join(apiRoot, 'data/eval.db'),
    UPLOADS_DIR: path.join(apiRoot, 'data/eval-uploads'),
    LOG_FILE: path.join(apiRoot, 'logs/eval.log'),
    DEMO_MODE: mode,
  });
  const vision = config.anthropicConfigured
    ? createAnthropicVisionClient({
        model: config.claude.model,
        timeoutMs: config.claude.timeoutMs,
        maxRetries: config.claude.maxRetries,
      })
    : null;
  if (!vision && mode !== 'cache_only') {
    console.warn('ANTHROPIC_API_KEY not set — only cached results can be used.');
  }
  const handle = openDb(config.dbPath);
  const logger = createLogger({ file: config.logFile, console: false });
  const { pipeline, bus } = createApp({ db: handle.db, config, vision, logger });

  const doneAt = new Map<string, number>();
  bus.subscribe((e) => {
    if (e.type === 'case' && e.stage === 'done') doneAt.set(e.caseId, Date.now());
    if (e.type === 'document') process.stdout.write(e.stage === 'failed' ? 'x' : '.');
  });

  const scores: PacketScore[] = [];
  const usage: UsageStats = {
    packets: 0,
    apiCalls: 0,
    cacheHits: 0,
    inputTokens: 0,
    outputTokens: 0,
    apiLatencyMs: [],
    packetWallMs: [],
  };
  const tmp = path.join(config.uploadsDir, 'tmp');
  fs.mkdirSync(tmp, { recursive: true });

  console.log(
    `Evaluating ${packets.length} packet(s) from ${dir} — model ${config.claude.model}, mode ${mode}`,
  );
  for (const name of packets) {
    const folder = path.join(dir, name);
    const truth = TruthSchema.parse(
      JSON.parse(fs.readFileSync(path.join(folder, 'truth.json'), 'utf8')),
    );
    const images = fs.readdirSync(folder).filter(isImageName).sort();
    const files = images.map((img) => {
      const copy = path.join(
        tmp,
        `eval-${Date.now()}-${Math.random().toString(36).slice(2)}${path.extname(img)}`,
      );
      fs.copyFileSync(path.join(folder, img), copy);
      return {
        path: copy,
        originalName: img,
        mimeType: 'image/jpeg',
        size: fs.statSync(copy).size,
      };
    });
    process.stdout.write(`\n${name} `);
    const started = Date.now();
    const created = await pipeline.createCase({ files, source: 'eval', packetName: name });
    await pipeline.whenIdle();
    const detail = caseDetail(handle.db, created.caseId)!;

    const extracted: ExtractedForEval[] = detail.documents.map((d) => ({
      fileName: d.originalName,
      detectedType: d.detectedType,
      fields: (d.extraction as { fields?: ExtractedForEval['fields'] } | null)?.fields ?? null,
    }));
    scores.push(scorePacket(name, truth, extracted, detail.case.status));

    const calls = handle.db
      .select()
      .from(extractions)
      .where(eq(extractions.caseId, created.caseId))
      .all();
    usage.packets += 1;
    for (const c of calls) {
      if (c.cacheHit) usage.cacheHits += 1;
      else if (c.status === 'OK') usage.apiCalls += 1;
      usage.inputTokens += c.inputTokens ?? 0;
      usage.outputTokens += c.outputTokens ?? 0;
      if (c.status === 'OK' && c.latencyMs) usage.apiLatencyMs.push(c.latencyMs);
    }
    usage.packetWallMs.push((doneAt.get(created.caseId) ?? Date.now()) - started);
    process.stdout.write(` ${detail.case.status}`);
  }

  const summary = summarise(scores, usage, config.pricing);
  const report = {
    generatedAt: new Date().toISOString(),
    model: config.claude.model,
    promptVersion: PROMPT_VERSION,
    mode,
    dataset: dir,
    note: 'Token cost counts every call as if uncached (cache hits report the tokens of the original call).',
    summary,
    packets: scores,
  };
  fs.writeFileSync(out, JSON.stringify(report, null, 2));
  console.log(`\n\n${formatReport(summary)}\n\nReport written to ${out}`);
  handle.close();
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
