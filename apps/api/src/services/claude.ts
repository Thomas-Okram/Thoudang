import Anthropic from '@anthropic-ai/sdk';
import { redactAadhaarInText } from '@thoudang/core';
import type { Effort } from '../env.js';

/**
 * The ONLY place Thoudang talks to the Claude API.
 *
 * Rules (see CLAUDE.md): model claude-sonnet-5-5, no temperature, no forced tool_choice,
 * no assistant prefill, structured outputs via output_config.format json_schema,
 * 60s timeout, 2 retries with backoff. Everything else depends on the VisionClient
 * interface so tests never call the real API.
 */

export interface VisionRequest {
  stage: 'classify' | 'extract';
  system: string;
  prompt: string;
  image: { data: string; mediaType: 'image/jpeg' | 'image/png' };
  /** JSON schema with additionalProperties:false everywhere and ≤16 union-typed params. */
  schema: Record<string, unknown>;
  effort: Effort;
  maxTokens: number;
  /** Debug label (e.g. original file name). Never sent to the API. */
  label?: string;
}

export interface VisionResponse {
  json: unknown;
  model: string;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
}

export interface VisionClient {
  readonly model: string;
  call(req: VisionRequest): Promise<VisionResponse>;
}

export class VisionError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(redactAadhaarInText(message));
    this.name = 'VisionError';
  }
}

export interface RetryOptions {
  retries: number;
  baseDelayMs?: number;
  isRetryable?: (err: unknown) => boolean;
  sleep?: (ms: number) => Promise<void>;
  onRetry?: (err: unknown, attempt: number, delayMs: number) => void;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Exponential backoff: base, 3×base, 9×base … Non-retryable errors are thrown immediately. */
export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions): Promise<T> {
  const sleep = opts.sleep ?? defaultSleep;
  const base = opts.baseDelayMs ?? 1000;
  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (err) {
      const retryable = opts.isRetryable ? opts.isRetryable(err) : true;
      if (!retryable || attempt >= opts.retries) throw err;
      const delay = base * 3 ** attempt;
      opts.onRetry?.(err, attempt + 1, delay);
      await sleep(delay);
      attempt += 1;
    }
  }
}

/** Timeouts, connection errors, 408/409/429 and 5xx are worth retrying; 4xx config errors are not. */
export function isRetryableError(err: unknown): boolean {
  if (err instanceof VisionError) return err.retryable;
  if (err instanceof Anthropic.APIConnectionError) return true; // includes timeouts
  if (err instanceof Anthropic.APIError) {
    const status = err.status ?? 0;
    return status === 408 || status === 409 || status === 429 || status >= 500;
  }
  return false;
}

export interface AnthropicVisionOptions {
  model: string;
  timeoutMs: number;
  maxRetries: number;
  baseDelayMs?: number;
  /** Injected in tests; defaults to a real SDK client (reads ANTHROPIC_API_KEY). */
  sdk?: Pick<Anthropic, 'messages'>;
  onRetry?: RetryOptions['onRetry'];
}

export function createAnthropicVisionClient(opts: AnthropicVisionOptions): VisionClient {
  // SDK retries disabled: withRetry owns retry/backoff so behaviour is explicit and testable.
  const sdk = opts.sdk ?? new Anthropic({ timeout: opts.timeoutMs, maxRetries: 0 });

  const once = async (req: VisionRequest): Promise<VisionResponse> => {
    const started = performance.now();
    const msg = await sdk.messages.create(
      {
        model: opts.model,
        max_tokens: req.maxTokens,
        system: req.system,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: { type: 'base64', media_type: req.image.mediaType, data: req.image.data },
              },
              { type: 'text', text: req.prompt },
            ],
          },
        ],
        output_config: {
          effort: req.effort,
          format: { type: 'json_schema', schema: req.schema },
        },
      },
      { timeout: opts.timeoutMs },
    );
    const latencyMs = Math.round(performance.now() - started);

    if (msg.stop_reason === 'refusal') {
      throw new VisionError(
        `Claude declined to process the image${msg.stop_details?.category ? ` (${msg.stop_details.category})` : ''}`,
        false,
      );
    }
    if (msg.stop_reason === 'max_tokens') {
      throw new VisionError('Claude response was truncated (max_tokens)', false);
    }
    const text = msg.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw new VisionError('Claude returned output that is not valid JSON', true);
    }
    return {
      json,
      model: msg.model,
      latencyMs,
      inputTokens: msg.usage.input_tokens,
      outputTokens: msg.usage.output_tokens,
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

/** Short, log-safe description of any error (Aadhaar-redacted, no stack). */
export function describeError(err: unknown): string {
  if (err instanceof Anthropic.APIConnectionTimeoutError) return 'Claude API timed out';
  if (err instanceof Anthropic.APIConnectionError) return 'Could not reach the Claude API';
  if (err instanceof Anthropic.AuthenticationError) return 'Claude API key was rejected';
  if (err instanceof Anthropic.RateLimitError) return 'Claude API rate limit reached';
  if (err instanceof Anthropic.APIError) return `Claude API error ${err.status ?? ''}`.trim();
  if (err instanceof Error) return redactAadhaarInText(err.message);
  return 'Unknown error';
}
