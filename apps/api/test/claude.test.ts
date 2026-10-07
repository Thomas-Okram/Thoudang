import { describe, expect, it, vi } from 'vitest';
import Anthropic from '@anthropic-ai/sdk';
import {
  createAnthropicVisionClient,
  isRetryableError,
  withRetry,
  VisionError,
  type VisionRequest,
} from '../src/services/claude.js';

const req: VisionRequest = {
  stage: 'classify',
  system: 'sys',
  prompt: 'classify this',
  image: { data: 'AAAA', mediaType: 'image/jpeg' },
  schema: { type: 'object', properties: {}, required: [], additionalProperties: false },
  effort: 'low',
  maxTokens: 4000,
  label: 'aadhaar.jpg',
};

function message(text: string, stop_reason = 'end_turn') {
  return {
    id: 'msg_1',
    type: 'message',
    role: 'assistant',
    model: 'claude-sonnet-5-5',
    content: [{ type: 'text', text }],
    stop_reason,
    stop_details: null,
    usage: { input_tokens: 1000, output_tokens: 50 },
  };
}

function fakeSdk(impl: (body: Record<string, unknown>) => unknown) {
  const create = vi.fn(async (body: Record<string, unknown>, _opts?: unknown) => impl(body));
  return { sdk: { messages: { create } } as unknown as Pick<Anthropic, 'messages'>, create };
}

const serverError = () => new Anthropic.InternalServerError(500, {}, 'boom', new Headers());
const badRequest = () => new Anthropic.BadRequestError(400, {}, 'bad', new Headers());

describe('withRetry', () => {
  it('retries retryable errors with exponential backoff, then succeeds', async () => {
    const sleeps: number[] = [];
    let n = 0;
    const result = await withRetry(
      async () => {
        n += 1;
        if (n < 3) throw serverError();
        return 'ok';
      },
      {
        retries: 2,
        baseDelayMs: 100,
        isRetryable: isRetryableError,
        sleep: async (ms) => void sleeps.push(ms),
      },
    );
    expect(result).toBe('ok');
    expect(sleeps).toEqual([100, 300]);
  });

  it('gives up after the configured retries', async () => {
    let n = 0;
    await expect(
      withRetry(
        async () => {
          n += 1;
          throw serverError();
        },
        { retries: 2, isRetryable: isRetryableError, sleep: async () => {} },
      ),
    ).rejects.toThrow();
    expect(n).toBe(3);
  });

  it('does not retry non-retryable errors', async () => {
    let n = 0;
    await expect(
      withRetry(
        async () => {
          n += 1;
          throw badRequest();
        },
        { retries: 2, isRetryable: isRetryableError, sleep: async () => {} },
      ),
    ).rejects.toThrow();
    expect(n).toBe(1);
  });

  it('classifies errors', () => {
    expect(isRetryableError(new Anthropic.APIConnectionTimeoutError())).toBe(true);
    expect(isRetryableError(new Anthropic.RateLimitError(429, {}, 'slow', new Headers()))).toBe(
      true,
    );
    expect(isRetryableError(serverError())).toBe(true);
    expect(isRetryableError(badRequest())).toBe(false);
    expect(isRetryableError(new VisionError('x', false))).toBe(false);
  });
});

describe('createAnthropicVisionClient', () => {
  it('sends a request that follows the Claude API rules', async () => {
    const { sdk, create } = fakeSdk(() => message('{"a":1}'));
    const client = createAnthropicVisionClient({
      model: 'claude-sonnet-5-5',
      timeoutMs: 60_000,
      maxRetries: 2,
      sdk,
    });
    const res = await client.call(req);
    expect(res).toMatchObject({ json: { a: 1 }, inputTokens: 1000, outputTokens: 50 });

    const body = create.mock.calls[0]![0] as Record<string, unknown>;
    expect(body.model).toBe('claude-sonnet-5-5');
    expect(body).not.toHaveProperty('temperature');
    expect(body).not.toHaveProperty('tool_choice');
    expect(body).not.toHaveProperty('tools');
    expect(body.output_config).toEqual({
      effort: 'low',
      format: { type: 'json_schema', schema: req.schema },
    });
    const messages = body.messages as { role: string; content: { type: string }[] }[];
    expect(messages).toHaveLength(1);
    expect(messages.at(-1)!.role).toBe('user'); // no assistant prefill
    expect(messages[0]!.content.map((c) => c.type)).toEqual(['image', 'text']);
    expect(JSON.stringify(body)).not.toContain('aadhaar.jpg'); // label stays local
    expect(create.mock.calls[0]![1]).toEqual({ timeout: 60_000 });
  });

  it('treats a refusal as a non-retryable failure', async () => {
    const { sdk, create } = fakeSdk(() => message('', 'refusal'));
    const client = createAnthropicVisionClient({
      model: 'm',
      timeoutMs: 1000,
      maxRetries: 2,
      baseDelayMs: 1,
      sdk,
    });
    await expect(client.call(req)).rejects.toThrow(/declined/);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('retries invalid JSON and 5xx, then succeeds', async () => {
    let n = 0;
    const { sdk, create } = fakeSdk(() => {
      n += 1;
      if (n === 1) throw serverError();
      if (n === 2) return message('not json');
      return message('{"ok":true}');
    });
    const client = createAnthropicVisionClient({
      model: 'm',
      timeoutMs: 1000,
      maxRetries: 2,
      baseDelayMs: 1,
      sdk,
    });
    expect((await client.call(req)).json).toEqual({ ok: true });
    expect(create).toHaveBeenCalledTimes(3);
  });

  it('does not retry a 400', async () => {
    const { sdk, create } = fakeSdk(() => {
      throw badRequest();
    });
    const client = createAnthropicVisionClient({
      model: 'm',
      timeoutMs: 1000,
      maxRetries: 2,
      baseDelayMs: 1,
      sdk,
    });
    await expect(client.call(req)).rejects.toThrow();
    expect(create).toHaveBeenCalledTimes(1);
  });
});
