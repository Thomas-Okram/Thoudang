import type Anthropic from '@anthropic-ai/sdk';
import { redactAadhaarInText } from '@thoudang/core';
import type { z } from 'zod';
import {
  assertUsableStop,
  buildUserContent,
  isRetryableError,
  messageText,
  VisionError,
  withRetry,
  type RetryOptions,
  type VisionClient,
  type VisionRequest,
  type VisionResponse,
} from '../claude.js';
import { jsonSchemaToZod } from './json-schema.js';
import { extractJsonText, jsonOnlyInstructions, repairPrompt } from './json-text.js';

/**
 * Claude on Amazon Bedrock via the India geographic cross-Region inference profile
 * (`in.anthropic.*`, source ap-south-1, routed only between Mumbai and Hyderabad).
 *
 * Structured outputs (`output_config.format`) are NOT available on that profile, so this client:
 *   1. appends the JSON schema to the system prompt and asks for JSON only,
 *   2. extracts + parses the JSON and validates it with zod (converted from the same schema),
 *   3. on failure sends ONE repair turn (user → assistant(bad reply) → user(problem)); the last
 *      message is always the user's, so this is not assistant prefill,
 *   4. if the repair also fails, throws a retryable VisionError so withRetry re-runs the whole
 *      attempt (same budget as the Anthropic path: timeout + 2 retries).
 * `effort` is not sent (not confirmed on Bedrock); temperature/tool_choice are never sent.
 */

/** The slice of the Bedrock SDK client we use — injected in tests. */
export interface BedrockMessagesApi {
  messages: {
    create(
      body: Anthropic.MessageCreateParamsNonStreaming,
      opts?: { timeout?: number },
    ): Promise<Anthropic.Message>;
  };
}

export interface BedrockVisionOptions {
  /** Inference profile ID, e.g. in.anthropic.claude-sonnet-5. */
  model: string;
  timeoutMs: number;
  maxRetries: number;
  baseDelayMs?: number;
  /** AWS region the call is made from (the profile's source region). Default ap-south-1. */
  region?: string;
  /** Injected in tests; otherwise loaded lazily from @anthropic-ai/bedrock-sdk. */
  sdk?: BedrockMessagesApi;
  /** Override for the lazy SDK loader (tests). */
  loadSdk?: (opts: { region: string; timeoutMs: number }) => Promise<BedrockMessagesApi>;
  onRetry?: RetryOptions['onRetry'];
}

// Held in a variable so TypeScript does not require the optional package at compile time.
const BEDROCK_SDK_PACKAGE = '@anthropic-ai/bedrock-sdk';

async function loadBedrockSdk(opts: {
  region: string;
  timeoutMs: number;
}): Promise<BedrockMessagesApi> {
  // The module shape is checked below; the dynamic import itself is untyped by design.
  const mod = (await import(BEDROCK_SDK_PACKAGE)) as {
    AnthropicBedrock?: new (o: Record<string, unknown>) => BedrockMessagesApi;
    default?: new (o: Record<string, unknown>) => BedrockMessagesApi;
  };
  const Ctor = mod.AnthropicBedrock ?? mod.default;
  if (!Ctor) throw new Error(`${BEDROCK_SDK_PACKAGE} has no AnthropicBedrock export`);
  // Credentials come from the standard AWS chain (env keys, AWS_PROFILE, instance role).
  // SDK retries disabled: withRetry owns retry/backoff.
  return new Ctor({ awsRegion: opts.region, timeout: opts.timeoutMs, maxRetries: 0 });
}

function describeIssues(err: z.ZodError): string {
  const parts = err.issues
    .slice(0, 8)
    .map((i) => `${i.path.length ? i.path.join('.') : '(root)'}: ${i.message}`);
  if (err.issues.length > 8) parts.push(`… and ${err.issues.length - 8} more`);
  return redactAadhaarInText(parts.join('; '));
}

type Checked = { ok: true; json: unknown } | { ok: false; problem: string };

function check(text: string, validator: z.ZodType): Checked {
  const candidate = extractJsonText(text);
  if (candidate === null) return { ok: false, problem: 'it did not contain a JSON object.' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    return { ok: false, problem: 'the JSON was malformed and could not be parsed.' };
  }
  const result = validator.safeParse(parsed);
  if (!result.success) {
    return {
      ok: false,
      problem: `the JSON did not match the schema (${describeIssues(result.error)}).`,
    };
  }
  return { ok: true, json: result.data };
}

export function createBedrockVisionClient(opts: BedrockVisionOptions): VisionClient {
  const region = opts.region ?? 'ap-south-1';
  let sdkPromise: Promise<BedrockMessagesApi> | null = opts.sdk ? Promise.resolve(opts.sdk) : null;
  const getSdk = (): Promise<BedrockMessagesApi> => {
    sdkPromise ??= (opts.loadSdk ?? loadBedrockSdk)({ region, timeoutMs: opts.timeoutMs }).catch(
      (err: unknown) => {
        sdkPromise = null;
        const detail = err instanceof Error ? err.message : String(err);
        throw new VisionError(
          `AI_PROVIDER=bedrock needs ${BEDROCK_SDK_PACKAGE} (npm install -w @thoudang/api ${BEDROCK_SDK_PACKAGE}): ${detail}`,
          false,
        );
      },
    );
    return sdkPromise;
  };

  const validators = new WeakMap<Record<string, unknown>, z.ZodType>();
  const validatorFor = (schema: Record<string, unknown>): z.ZodType => {
    let v = validators.get(schema);
    if (!v) {
      v = jsonSchemaToZod(schema);
      validators.set(schema, v);
    }
    return v;
  };

  const once = async (req: VisionRequest): Promise<VisionResponse> => {
    const sdk = await getSdk();
    const validator = validatorFor(req.schema);
    const system = `${req.system}\n\n${jsonOnlyInstructions(req.schema)}`;
    const user: Anthropic.MessageParam = { role: 'user', content: buildUserContent(req) };
    const started = performance.now();
    let inputTokens = 0;
    let outputTokens = 0;
    let model = opts.model;

    const send = async (messages: Anthropic.MessageParam[]) => {
      const msg = await sdk.messages.create(
        { model: opts.model, max_tokens: req.maxTokens, system, messages },
        { timeout: opts.timeoutMs },
      );
      inputTokens += msg.usage.input_tokens;
      outputTokens += msg.usage.output_tokens;
      model = msg.model || model;
      assertUsableStop(msg);
      return messageText(msg);
    };

    const first = await send([user]);
    let result = check(first, validator);
    if (!result.ok) {
      const repaired = await send([
        user,
        { role: 'assistant', content: [{ type: 'text', text: first || '(empty reply)' }] },
        { role: 'user', content: [{ type: 'text', text: repairPrompt(result.problem) }] },
      ]);
      result = check(repaired, validator);
    }
    if (!result.ok) {
      throw new VisionError(
        `Bedrock returned output that is not valid JSON for the schema after one repair: ${result.problem}`,
        true,
      );
    }
    return {
      json: result.json,
      model,
      latencyMs: Math.round(performance.now() - started),
      inputTokens,
      outputTokens,
    };
  };

  return {
    model: opts.model,
    call: (req) =>
      withRetry(() => once(req), {
        retries: opts.maxRetries,
        baseDelayMs: opts.baseDelayMs,
        isRetryable: isRetryableError,
        onRetry: opts.onRetry,
      }),
  };
}
