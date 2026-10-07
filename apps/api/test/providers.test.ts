import { describe, expect, it, vi } from 'vitest';
import Anthropic from '@anthropic-ai/sdk';
import type { VisionRequest } from '../src/services/claude.js';
import {
  createBedrockVisionClient,
  type BedrockMessagesApi,
} from '../src/services/providers/bedrock.js';
import { jsonSchemaToZod } from '../src/services/providers/json-schema.js';
import { extractJsonText, jsonOnlyInstructions } from '../src/services/providers/json-text.js';
import { createVisionClient, resolveProvider } from '../src/services/providers/index.js';
import { CLASSIFY_SCHEMA, extractionSchema } from '../src/extraction/schemas.js';

const req: VisionRequest = {
  stage: 'classify',
  system: 'You classify documents.',
  prompt: 'classify this',
  image: { data: 'AAAA', mediaType: 'image/jpeg' },
  schema: CLASSIFY_SCHEMA,
  effort: 'low',
  maxTokens: 4000,
  label: 'aadhaar.jpg',
};

const GOOD = { document_type: 'aadhaar', confidence: 'high', legibility: 'good', reason: 'card' };

function message(text: string, stop_reason = 'end_turn') {
  return {
    id: 'msg_1',
    type: 'message',
    role: 'assistant',
    model: 'in.anthropic.claude-sonnet-5',
    content: [{ type: 'text', text }],
    stop_reason,
    stop_details: null,
    usage: { input_tokens: 1000, output_tokens: 50 },
  };
}

function fakeSdk(impl: (body: Record<string, unknown>, n: number) => unknown) {
  let n = 0;
  const create = vi.fn(async (body: Record<string, unknown>, _opts?: unknown) => {
    n += 1;
    return impl(body, n);
  });
  return { sdk: { messages: { create } } as unknown as BedrockMessagesApi, create };
}

const serverError = () => new Anthropic.InternalServerError(500, {}, 'boom', new Headers());

describe('jsonSchemaToZod', () => {
  it('validates the classify wire schema, strictly', () => {
    const z = jsonSchemaToZod(CLASSIFY_SCHEMA);
    expect(z.safeParse(GOOD).success).toBe(true);
    expect(z.safeParse({ ...GOOD, document_type: 'passport' }).success).toBe(false);
    expect(z.safeParse({ ...GOOD, extra: 1 }).success).toBe(false); // additionalProperties:false
    expect(z.safeParse({ ...GOOD, reason: undefined }).success).toBe(false);
  });

  it('resolves $defs/$ref in the extraction schemas', () => {
    const z = jsonSchemaToZod(extractionSchema('bank_passbook'));
    const field = { value: 'x', status: 'present', confidence: 'high', bbox: [1, 2, 3, 4] };
    const ok = {
      legibility: 'good',
      notes: '',
      fields: {
        account_holder_name: field,
        account_number: field,
        ifsc: field,
        bank_name: field,
        branch: { ...field, bbox: [] },
      },
    };
    expect(z.safeParse(ok).success).toBe(true);
    expect(
      z.safeParse({ ...ok, fields: { ...ok.fields, ifsc: { ...field, bbox: ['a'] } } }).success,
    ).toBe(false);
    expect(
      z.safeParse({ ...ok, fields: { ...ok.fields, ifsc: { ...field, status: 'maybe' } } }).success,
    ).toBe(false);
  });

  it('supports integer, boolean and nested arrays', () => {
    const z = jsonSchemaToZod({
      type: 'object',
      properties: {
        n: { type: 'integer' },
        b: { type: 'boolean' },
        xs: { type: 'array', items: { type: 'string' } },
      },
      required: ['n', 'b'],
      additionalProperties: false,
    });
    expect(z.safeParse({ n: 1, b: true }).success).toBe(true);
    expect(z.safeParse({ n: 1.5, b: true }).success).toBe(false);
    expect(z.safeParse({ n: 1, b: true, xs: ['a'] }).success).toBe(true);
  });
});

describe('extractJsonText', () => {
  it('accepts bare JSON, fenced JSON and JSON surrounded by prose', () => {
    expect(extractJsonText('{"a":1}')).toBe('{"a":1}');
    expect(extractJsonText('```json\n{"a":1}\n```')).toBe('{"a":1}');
    expect(extractJsonText('Here you go:\n{"a":{"b":2}}\nDone.')).toBe('{"a":{"b":2}}');
    expect(extractJsonText('no json here')).toBeNull();
  });

  it('instructions embed the schema and forbid prose', () => {
    const text = jsonOnlyInstructions(CLASSIFY_SCHEMA);
    expect(text).toContain('"document_type"');
    expect(text).toMatch(/only/i);
  });
});

describe('createBedrockVisionClient', () => {
  const base = { model: 'in.anthropic.claude-sonnet-5', timeoutMs: 60_000, maxRetries: 2 };

  it('sends a JSON-in-text request without structured outputs, effort or prefill', async () => {
    const { sdk, create } = fakeSdk(() => message(JSON.stringify(GOOD)));
    const client = createBedrockVisionClient({ ...base, sdk });
    const res = await client.call(req);
    expect(res).toMatchObject({ json: GOOD, inputTokens: 1000, outputTokens: 50 });
    expect(client.model).toBe('in.anthropic.claude-sonnet-5');

    const body = create.mock.calls[0]![0];
    expect(body.model).toBe('in.anthropic.claude-sonnet-5');
    expect(body).not.toHaveProperty('output_config');
    expect(body).not.toHaveProperty('temperature');
    expect(body).not.toHaveProperty('tool_choice');
    expect(body).not.toHaveProperty('tools');
    expect(String(body.system)).toContain('You classify documents.');
    expect(String(body.system)).toContain('"document_type"');
    const messages = body.messages as { role: string; content: { type: string }[] }[];
    expect(messages).toHaveLength(1);
    expect(messages.at(-1)!.role).toBe('user');
    expect(messages[0]!.content.map((c) => c.type)).toEqual(['image', 'text']);
    expect(JSON.stringify(body)).not.toContain('aadhaar.jpg');
    expect(create.mock.calls[0]![1]).toEqual({ timeout: 60_000 });
  });

  it('accepts fenced JSON', async () => {
    const { sdk } = fakeSdk(() => message('```json\n' + JSON.stringify(GOOD) + '\n```'));
    const client = createBedrockVisionClient({ ...base, sdk });
    expect((await client.call(req)).json).toEqual(GOOD);
  });

  it('repairs once when the JSON does not match the schema, and sums token usage', async () => {
    const bad = JSON.stringify({ ...GOOD, document_type: 'passport' });
    const { sdk, create } = fakeSdk((_b, n) =>
      n === 1 ? message(bad) : message(JSON.stringify(GOOD)),
    );
    const client = createBedrockVisionClient({ ...base, sdk });
    const res = await client.call(req);
    expect(res.json).toEqual(GOOD);
    expect(res.inputTokens).toBe(2000);
    expect(res.outputTokens).toBe(100);
    expect(create).toHaveBeenCalledTimes(2);

    const repair = create.mock.calls[1]![0];
    const messages = repair.messages as { role: string; content: unknown }[];
    expect(messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
    expect(messages[1]!.content).toEqual([{ type: 'text', text: bad }]);
    expect(JSON.stringify(messages[2]!.content)).toContain('document_type');
    expect(repair).not.toHaveProperty('output_config');
  });

  it('repairs prose that contains no JSON at all', async () => {
    const { sdk, create } = fakeSdk((_b, n) =>
      n === 1 ? message('I think this is an Aadhaar card.') : message(JSON.stringify(GOOD)),
    );
    const client = createBedrockVisionClient({ ...base, sdk });
    expect((await client.call(req)).json).toEqual(GOOD);
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('after a failed repair, the whole attempt is retried by withRetry', async () => {
    const { sdk, create } = fakeSdk((_b, n) =>
      n <= 2 ? message('nope') : message(JSON.stringify(GOOD)),
    );
    const client = createBedrockVisionClient({ ...base, baseDelayMs: 1, sdk });
    expect((await client.call(req)).json).toEqual(GOOD);
    expect(create).toHaveBeenCalledTimes(3);
  });

  it('gives up with a VisionError when every attempt stays invalid', async () => {
    const { sdk, create } = fakeSdk(() => message('nope'));
    const client = createBedrockVisionClient({ ...base, maxRetries: 1, baseDelayMs: 1, sdk });
    await expect(client.call(req)).rejects.toThrow(/valid JSON/);
    expect(create).toHaveBeenCalledTimes(4); // 2 attempts × (call + repair)
  });

  it('treats a refusal as non-retryable and does not repair it', async () => {
    const { sdk, create } = fakeSdk(() => message('', 'refusal'));
    const client = createBedrockVisionClient({ ...base, baseDelayMs: 1, sdk });
    await expect(client.call(req)).rejects.toThrow(/declined/);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('retries 5xx errors', async () => {
    const { sdk, create } = fakeSdk((_b, n) => {
      if (n === 1) throw serverError();
      return message(JSON.stringify(GOOD));
    });
    const client = createBedrockVisionClient({ ...base, baseDelayMs: 1, sdk });
    expect((await client.call(req)).json).toEqual(GOOD);
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('redacts Aadhaar numbers out of validation error messages', async () => {
    const { sdk } = fakeSdk(() => message('2345 6789 0123 is the number'));
    const client = createBedrockVisionClient({ ...base, maxRetries: 0, sdk });
    const err = await client.call(req).catch((e: unknown) => e);
    expect(String((err as Error).message)).not.toMatch(/2345\s?6789\s?0123/);
  });
});

describe('resolveProvider / createVisionClient', () => {
  it('defaults to the Anthropic API', () => {
    expect(resolveProvider({ ANTHROPIC_API_KEY: 'k' })).toMatchObject({
      provider: 'anthropic',
      configured: true,
      model: 'claude-sonnet-5-5',
    });
    expect(resolveProvider({}).configured).toBe(false);
    expect(resolveProvider({ CLAUDE_MODEL: 'x', ANTHROPIC_API_KEY: 'k' }).model).toBe('x');
  });

  it('selects Bedrock India (ap-south-1) when AI_PROVIDER=bedrock', () => {
    const p = resolveProvider({ AI_PROVIDER: 'bedrock', AWS_PROFILE: 'sdc' });
    expect(p).toMatchObject({
      provider: 'bedrock',
      configured: true,
      region: 'ap-south-1',
      model: 'in.anthropic.claude-sonnet-5',
    });
    expect(
      resolveProvider({
        AI_PROVIDER: 'bedrock',
        BEDROCK_REGION: 'ap-south-2',
        BEDROCK_MODEL_ID: 'in.anthropic.claude-opus-5',
        AWS_ACCESS_KEY_ID: 'a',
        AWS_SECRET_ACCESS_KEY: 's',
      }),
    ).toMatchObject({
      region: 'ap-south-2',
      model: 'in.anthropic.claude-opus-5',
      configured: true,
    });
    expect(resolveProvider({ AI_PROVIDER: 'bedrock' }).configured).toBe(false);
  });

  it('ignores an unknown provider name rather than crashing', () => {
    expect(resolveProvider({ AI_PROVIDER: 'openai' }).provider).toBe('anthropic');
  });

  it('builds a client for each provider with the injected SDK', async () => {
    const anth = fakeSdk(() => message(JSON.stringify(GOOD)));
    const a = createVisionClient({
      provider: resolveProvider({ ANTHROPIC_API_KEY: 'k' }),
      timeoutMs: 1000,
      maxRetries: 0,
      sdk: anth.sdk,
    });
    await a.call(req);
    expect(anth.create.mock.calls[0]![0]).toHaveProperty('output_config');

    const bed = fakeSdk(() => message(JSON.stringify(GOOD)));
    const b = createVisionClient({
      provider: resolveProvider({ AI_PROVIDER: 'bedrock', AWS_PROFILE: 'p' }),
      timeoutMs: 1000,
      maxRetries: 0,
      sdk: bed.sdk,
    });
    expect(b.model).toBe('in.anthropic.claude-sonnet-5');
    await b.call(req);
    expect(bed.create.mock.calls[0]![0]).not.toHaveProperty('output_config');
  });

  it('reports a clear error when the Bedrock SDK package is not installed', async () => {
    const client = createBedrockVisionClient({
      model: 'in.anthropic.claude-sonnet-5',
      timeoutMs: 1000,
      maxRetries: 0,
      region: 'ap-south-1',
      loadSdk: async () => {
        throw new Error("Cannot find package '@anthropic-ai/bedrock-sdk'");
      },
    });
    await expect(client.call(req)).rejects.toThrow(/bedrock-sdk/);
  });
});
