import pLimit from 'p-limit';
import { ZodError } from 'zod';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { extractionCache } from '../db/schema.js';
import type { DemoMode, Effort } from '../env.js';
import type { Logger } from '../logger.js';
import { describeError, type VisionClient } from '../services/claude.js';
import type { ProcessedImage } from '../services/images.js';
import { SYSTEM_PROMPT, classifyPrompt, extractPrompt } from './prompts.js';
import { normaliseExtraction } from './normalise.js';
import {
  CLASSIFY_SCHEMA,
  ClassifyResponseSchema,
  PROMPT_VERSION,
  extractResponseSchema,
  extractionSchema,
  type Classification,
  type ExtractableType,
  type ExtractedDocument,
} from './schemas.js';

export interface CallMeta {
  model: string;
  cacheHit: boolean;
  /** Latency/tokens of the original API call (also reported on cache hits, for eval cost). */
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
}

export type StageOutcome<T> =
  ({ ok: true; value: T } & CallMeta) | ({ ok: false; error: string } & CallMeta);

export interface ExtractionServiceOptions {
  db: Db;
  /** null when no API key is configured — the service then serves from cache only. */
  vision: VisionClient | null;
  model: string;
  demoMode: DemoMode;
  concurrency: number;
  effortClassify: Effort;
  effortExtract: Effort;
  logger: Logger;
}

const CLASSIFY_MAX_TOKENS = 4_000;
const EXTRACT_MAX_TOKENS = 16_000;

type CachedPayload = Record<string, unknown>;

export class ExtractionService {
  private readonly limit: ReturnType<typeof pLimit>;

  constructor(private readonly opts: ExtractionServiceOptions) {
    this.limit = pLimit(Math.max(1, opts.concurrency));
  }

  get model(): string {
    return this.opts.vision?.model ?? this.opts.model;
  }

  classify(image: ProcessedImage, label?: string): Promise<StageOutcome<Classification>> {
    return this.run<Classification>({
      stage: 'classify',
      image,
      label,
      call: async (vision) => {
        const res = await vision.call({
          stage: 'classify',
          system: SYSTEM_PROMPT,
          prompt: classifyPrompt(image.width, image.height),
          image: { data: image.buffer.toString('base64'), mediaType: image.mediaType },
          schema: CLASSIFY_SCHEMA,
          effort: this.opts.effortClassify,
          maxTokens: CLASSIFY_MAX_TOKENS,
          label,
        });
        const parsed = ClassifyResponseSchema.parse(res.json);
        const value: Classification = {
          type: parsed.document_type,
          confidence: parsed.confidence,
          legibility: parsed.legibility,
          reason: parsed.reason,
        };
        return { res, value };
      },
    });
  }

  extract(
    type: ExtractableType,
    image: ProcessedImage,
    label?: string,
  ): Promise<StageOutcome<ExtractedDocument>> {
    return this.run<ExtractedDocument>({
      stage: `extract:${type}`,
      image,
      label,
      call: async (vision) => {
        const res = await vision.call({
          stage: 'extract',
          system: SYSTEM_PROMPT,
          prompt: extractPrompt(type, image.width, image.height),
          image: { data: image.buffer.toString('base64'), mediaType: image.mediaType },
          schema: extractionSchema(type),
          effort: this.opts.effortExtract,
          maxTokens: EXTRACT_MAX_TOKENS,
          label,
        });
        const wire = extractResponseSchema(type).parse(res.json);
        // Mask the Aadhaar number before the result goes anywhere (cache, DB, logs, UI).
        const value = normaliseExtraction(type, wire, image);
        return { res, value };
      },
    });
  }

  cacheKey(stage: string, sha256: string): string {
    return `${stage}|${sha256}|${this.model}|${PROMPT_VERSION}`;
  }

  private readCache(key: string) {
    return this.opts.db.select().from(extractionCache).where(eq(extractionCache.key, key)).get();
  }

  private async run<T>(args: {
    stage: string;
    image: ProcessedImage;
    label?: string;
    call: (vision: VisionClient) => Promise<{
      res: { model: string; latencyMs: number; inputTokens: number; outputTokens: number };
      value: T;
    }>;
  }): Promise<StageOutcome<T>> {
    const { demoMode, vision, logger } = this.opts;
    const key = this.cacheKey(args.stage, args.image.sha256);
    const cached = this.readCache(key);
    const fromCache = (row: NonNullable<typeof cached>): StageOutcome<T> => ({
      ok: true,
      value: row.result as unknown as T,
      model: row.model,
      cacheHit: true,
      latencyMs: row.latencyMs,
      inputTokens: row.inputTokens,
      outputTokens: row.outputTokens,
    });
    const failed = (error: string, latencyMs = 0): StageOutcome<T> => ({
      ok: false,
      error,
      model: this.model,
      cacheHit: false,
      latencyMs,
      inputTokens: 0,
      outputTokens: 0,
    });

    if (cached && demoMode !== 'live') return fromCache(cached);
    if (demoMode === 'cache_only') {
      return failed('No cached result for this image (DEMO_MODE=cache_only)');
    }
    if (!vision) {
      if (cached) return fromCache(cached);
      return failed('ANTHROPIC_API_KEY is not set and no cached result exists');
    }

    const started = performance.now();
    try {
      const { res, value } = await this.limit(() => args.call(vision));
      this.opts.db
        .insert(extractionCache)
        .values({
          key,
          sha256: args.image.sha256,
          stage: args.stage,
          model: res.model,
          promptVersion: PROMPT_VERSION,
          result: value as unknown as CachedPayload,
          latencyMs: res.latencyMs,
          inputTokens: res.inputTokens,
          outputTokens: res.outputTokens,
        })
        .onConflictDoUpdate({
          target: extractionCache.key,
          set: {
            result: value as unknown as CachedPayload,
            latencyMs: res.latencyMs,
            inputTokens: res.inputTokens,
            outputTokens: res.outputTokens,
            createdAt: new Date(),
          },
        })
        .run();
      return {
        ok: true,
        value,
        model: res.model,
        cacheHit: false,
        latencyMs: res.latencyMs,
        inputTokens: res.inputTokens,
        outputTokens: res.outputTokens,
      };
    } catch (err) {
      const reason =
        err instanceof ZodError
          ? 'Claude output did not match the expected schema'
          : describeError(err);
      logger.warn('Claude call failed', { stage: args.stage, label: args.label, reason });
      if (cached) {
        logger.info('Using cached result after API failure', { stage: args.stage });
        return fromCache(cached);
      }
      return failed(reason, Math.round(performance.now() - started));
    }
  }
}
