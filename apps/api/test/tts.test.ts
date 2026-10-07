import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { AudioCache, createGeminiTts, pcmToWav, TtsError } from '../src/services/tts.js';

const wav = pcmToWav(Buffer.alloc(480));
const okResponse = (data: Buffer) => ({
  ok: true,
  status: 200,
  json: async () => ({
    steps: [
      { type: 'user_input', content: [] },
      {
        type: 'model_output',
        content: [{ type: 'audio', mime_type: 'audio/wav', data: data.toString('base64') }],
      },
    ],
  }),
});

describe('Gemini TTS wrapper', () => {
  it('posts to the Interactions API with the documented body (no language code) and decodes WAV', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okResponse(wav));
    const tts = createGeminiTts({
      apiKey: 'k',
      model: 'gemini-3.8-flash-tts',
      voice: 'Kore',
      timeoutMs: 1000,
      fetchImpl,
    });
    const out = await tts.synthesize('অদোম্গী অর্জি ফংলে।');
    expect(out.subarray(0, 4).toString()).toBe('RIFF');
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/interactions');
    expect(init.headers['x-goog-api-key']).toBe('k');
    expect(JSON.parse(init.body)).toEqual({
      model: 'gemini-3.8-flash-tts',
      input: [{ type: 'user_input', content: [{ type: 'text', text: 'অদোম্গী অর্জি ফংলে।' }] }],
      response_format: { type: 'audio', mime_type: 'audio/wav' },
      generation_config: { speech_config: [{ voice: 'Kore' }] },
    });
  });

  it('wraps headerless PCM in a WAV container', async () => {
    const tts = createGeminiTts({
      apiKey: 'k',
      model: 'm',
      voice: 'v',
      timeoutMs: 1000,
      fetchImpl: vi.fn().mockResolvedValue(okResponse(Buffer.alloc(100))),
    });
    const out = await tts.synthesize('x');
    expect(out.subarray(0, 4).toString()).toBe('RIFF');
    expect(out.length).toBe(144);
  });

  it.each([
    [
      'HTTP error',
      vi.fn().mockResolvedValue({ ok: false, status: 503, json: async () => ({}) }),
      /HTTP 503/,
    ],
    [
      'no audio in response',
      vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ steps: [] }) }),
      /no audio/,
    ],
    ['network failure', vi.fn().mockRejectedValue(new Error('ECONNRESET')), /Could not reach/],
  ])('failure path: %s → TtsError', async (_name, fetchImpl, message) => {
    const tts = createGeminiTts({
      apiKey: 'k',
      model: 'm',
      voice: 'v',
      timeoutMs: 1000,
      fetchImpl,
    });
    await expect(tts.synthesize('x')).rejects.toThrow(TtsError);
    await expect(tts.synthesize('x')).rejects.toThrow(message);
  });

  it('times out', async () => {
    const fetchImpl = vi.fn(
      (_url: string, init: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) =>
          init.signal.addEventListener('abort', () => reject(new Error('aborted'))),
        ),
    );
    const tts = createGeminiTts({
      apiKey: 'k',
      model: 'm',
      voice: 'v',
      timeoutMs: 20,
      fetchImpl: fetchImpl as never,
    });
    await expect(tts.synthesize('x')).rejects.toThrow(/timed out/);
  });
});

describe('AudioCache', () => {
  it('synthesises once per distinct text, then serves from disk', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'audio-'));
    const synthesize = vi.fn().mockResolvedValue(wav);
    const client = { model: 'm', voice: 'v', synthesize };
    const cache = new AudioCache(dir);
    const first = await cache.ensure(client, 'hello');
    const second = await cache.ensure(client, 'hello');
    expect(first.cached).toBe(false);
    expect(second).toMatchObject({ cached: true, path: first.path });
    expect(synthesize).toHaveBeenCalledTimes(1);
    await cache.ensure(client, 'different');
    expect(synthesize).toHaveBeenCalledTimes(2);
  });
});
