import type Anthropic from '@anthropic-ai/sdk';
import { createAnthropicVisionClient, type RetryOptions, type VisionClient } from '../claude.js';
import { createBedrockVisionClient, type BedrockMessagesApi } from './bedrock.js';

/**
 * AI provider selection — AI_PROVIDER=anthropic (default) | bedrock.
 *
 *   anthropic  Claude API, structured outputs. Needs ANTHROPIC_API_KEY. Model CLAUDE_MODEL.
 *   bedrock    Amazon Bedrock, India geographic cross-Region inference profile (data stays in
 *              ap-south-1/ap-south-2). JSON-in-text + zod + one repair retry. Needs AWS
 *              credentials (AWS_ACCESS_KEY_ID/SECRET, AWS_PROFILE, or a web-identity/container
 *              role). BEDROCK_REGION (default ap-south-1), BEDROCK_MODEL_ID (default
 *              in.anthropic.claude-sonnet-5 — confirm with `aws bedrock list-inference-profiles
 *              --region ap-south-1`; Sonnet 5.5 is not on the India profile as of Oct 2026).
 */
export type AiProvider = 'anthropic' | 'bedrock';

export interface ProviderConfig {
  provider: AiProvider;
  /** False when credentials are missing — callers then run cache-only, as today. */
  configured: boolean;
  model: string;
  region: string | null;
}

export const BEDROCK_DEFAULT_REGION = 'ap-south-1';
export const BEDROCK_DEFAULT_MODEL = 'in.anthropic.claude-sonnet-5';

function hasAwsCredentials(vars: NodeJS.ProcessEnv): boolean {
  return Boolean(
    (vars.AWS_ACCESS_KEY_ID && vars.AWS_SECRET_ACCESS_KEY) ||
    vars.AWS_PROFILE ||
    vars.AWS_WEB_IDENTITY_TOKEN_FILE ||
    vars.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI ||
    vars.AWS_CONTAINER_CREDENTIALS_FULL_URI,
  );
}

export function resolveProvider(vars: NodeJS.ProcessEnv = process.env): ProviderConfig {
  if (vars.AI_PROVIDER === 'bedrock') {
    return {
      provider: 'bedrock',
      configured: hasAwsCredentials(vars),
      model: vars.BEDROCK_MODEL_ID || BEDROCK_DEFAULT_MODEL,
      region: vars.BEDROCK_REGION || vars.AWS_REGION || BEDROCK_DEFAULT_REGION,
    };
  }
  return {
    provider: 'anthropic',
    configured: Boolean(vars.ANTHROPIC_API_KEY),
    model: vars.CLAUDE_MODEL ?? 'claude-sonnet-5-5',
    region: null,
  };
}

export interface CreateVisionClientOptions {
  provider: ProviderConfig;
  timeoutMs: number;
  maxRetries: number;
  baseDelayMs?: number;
  onRetry?: RetryOptions['onRetry'];
  /** Injected in tests (an Anthropic or Bedrock client — both expose messages.create). */
  sdk?: Pick<Anthropic, 'messages'> | BedrockMessagesApi;
}

export function createVisionClient(opts: CreateVisionClientOptions): VisionClient {
  const common = {
    model: opts.provider.model,
    timeoutMs: opts.timeoutMs,
    maxRetries: opts.maxRetries,
    baseDelayMs: opts.baseDelayMs,
    onRetry: opts.onRetry,
  };
  if (opts.provider.provider === 'bedrock') {
    return createBedrockVisionClient({
      ...common,
      region: opts.provider.region ?? BEDROCK_DEFAULT_REGION,
      sdk: opts.sdk as BedrockMessagesApi | undefined,
    });
  }
  return createAnthropicVisionClient({
    ...common,
    sdk: opts.sdk as Pick<Anthropic, 'messages'> | undefined,
  });
}

export { createBedrockVisionClient } from './bedrock.js';
