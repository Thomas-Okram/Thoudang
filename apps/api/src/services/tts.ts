import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Text-to-speech for citizen notices (Manipuri, Bengali script).
 * Provider: Gemini TTS via the Interactions API (`POST /v1beta/interactions`, model
 * gemini-3.8-flash-tts). The model detects the language itself — no language code is sent.
 * Response audio: base64 WAV (24 kHz mono 16-bit PCM) at steps[type=model_output].content[type=audio].data.
 */
export interface TtsClient {
  readonly model: string;
  readonly voice: string;
  synthesize(text: string): Promise<Buffer>;
}

export class TtsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TtsError';
  }
}

type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal },
) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

export interface GeminiTtsOptions {
  apiKey: string;
  model: string;
  voice: string;
  timeoutMs: number;
  fetchImpl?: FetchLike;
}

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/interactions';

interface InteractionResponse {
  steps?: { type?: string; content?: { type?: string; data?: string; mime_type?: string }[] }[];
}

/** 16-bit mono PCM → WAV container (used if the API ever returns headerless audio). */
export function pcmToWav(pcm: Buffer, sampleRate = 24_000): Buffer {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

export function createGeminiTts(opts: GeminiTtsOptions): TtsClient {
  const doFetch: FetchLike = opts.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
  return {
    model: opts.model,
    voice: opts.voice,
    async synthesize(text: string): Promise<Buffer> {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
      try {
        const res = await doFetch(ENDPOINT, {
          method: 'POST',
          headers: { 'x-goog-api-key': opts.apiKey, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: opts.model,
            input: [{ type: 'user_input', content: [{ type: 'text', text }] }],
            response_format: { type: 'audio', mime_type: 'audio/wav' },
            generation_config: { speech_config: [{ voice: opts.voice }] },
          }),
          signal: controller.signal,
        });
        if (!res.ok) throw new TtsError(`Gemini TTS returned HTTP ${res.status}`);
        const body = (await res.json()) as InteractionResponse;
        const audio = (body.steps ?? [])
          .filter((s) => s.type === 'model_output')
          .flatMap((s) => s.content ?? [])
          .filter((c) => c.type === 'audio' && c.data)
          .at(-1);
        if (!audio?.data) throw new TtsError('Gemini TTS response contained no audio');
        const bytes = Buffer.from(audio.data, 'base64');
        return bytes.subarray(0, 4).toString('ascii') === 'RIFF' ? bytes : pcmToWav(bytes);
      } catch (err) {
        if (err instanceof TtsError) throw err;
        if (controller.signal.aborted) throw new TtsError('Gemini TTS timed out');
        throw new TtsError('Could not reach Gemini TTS');
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

/** Rendered-notice audio cache: sha256(model|voice|text) → <dir>/<hash>.wav */
export class AudioCache {
  constructor(private readonly dir: string) {}

  key(
    client: Pick<TtsClient, 'model' | 'voice'> | { model: string; voice: string },
    text: string,
  ): string {
    return crypto
      .createHash('sha256')
      .update(`${client.model}|${client.voice}|${text}`)
      .digest('hex');
  }

  pathFor(hash: string): string {
    return path.join(this.dir, `${hash}.wav`);
  }

  has(hash: string): boolean {
    return fs.existsSync(this.pathFor(hash));
  }

  /** Cached audio, or synthesise + store. Throws TtsError on failure (callers degrade gracefully). */
  async ensure(
    client: TtsClient,
    text: string,
  ): Promise<{ hash: string; path: string; cached: boolean }> {
    const hash = this.key(client, text);
    const file = this.pathFor(hash);
    if (fs.existsSync(file)) return { hash, path: file, cached: true };
    const wav = await client.synthesize(text);
    fs.mkdirSync(this.dir, { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, wav);
    fs.renameSync(tmp, file);
    return { hash, path: file, cached: false };
  }
}
