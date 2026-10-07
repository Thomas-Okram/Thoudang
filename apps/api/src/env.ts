import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const apiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(apiRoot, '../..');

export type DemoMode = 'live' | 'cache_first' | 'cache_only';
export type Effort = 'low' | 'medium' | 'high';

export interface AppConfig {
  port: number;
  /** Port the web app (Vite) is served on — used to build the phone-upload URL. */
  webPort: number;
  /**
   * PUBLIC_BASE_URL, e.g. https://thoudang.dswo.local — the address phones and printed notices
   * should use (Docker, reverse proxy, tunnel). null → http://<first LAN IP>:<webPort>.
   */
  publicBaseUrl: string | null;
  dbPath: string;
  uploadsDir: string;
  logFile: string;
  migrationsDir: string;
  /** Serve the built web app (apps/web/dist) from the API — used by `npm run demo`. */
  serveWeb: boolean;
  webDist: string;
  anthropicConfigured: boolean;
  /**
   * live        → call Claude; on failure fall back to the cache if present.
   * cache_first → use the cache when present, else call Claude.
   * cache_only  → never call Claude (offline demo); cache miss = extraction failed.
   */
  demoMode: DemoMode;
  claude: {
    model: string;
    timeoutMs: number;
    maxRetries: number;
    concurrency: number;
    effortClassify: Effort;
    effortExtract: Effort;
  };
  /** USD per million tokens, for eval cost reporting; usdToInr converts for the Trust Report. */
  pricing: { inputPerMTok: number; outputPerMTok: number; usdToInr: number };
  tts: {
    /** null when GEMINI_API_KEY is not set — audio is then "unavailable", never an error. */
    apiKey: string | null;
    model: string;
    voice: string;
    timeoutMs: number;
  };
  /** Notice templates (edited by reviewers on /admin/templates; versioned in git). */
  templatesPath: string;
  audioDir: string;
  /** Signs citizen status links so references cannot be enumerated. */
  statusLinkSecret: string;
  /** Latest `npm run eval` report shown on the Trust Report. */
  evalReportPath: string;
  fairnessHoldoutPath: string;
}

const oneOf = <T extends string>(
  value: string | undefined,
  allowed: readonly T[],
  fallback: T,
): T => (value && (allowed as readonly string[]).includes(value) ? (value as T) : fallback);

/** Only absolute http(s) URLs; trailing slashes dropped. Anything else is ignored. */
export function parsePublicBaseUrl(raw: string | undefined): string | null {
  if (!raw?.trim()) return null;
  try {
    const u = new URL(raw.trim());
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return `${u.origin}${u.pathname}`.replace(/\/+$/, '');
  } catch {
    return null;
  }
}

export function loadConfig(vars: NodeJS.ProcessEnv = process.env): AppConfig {
  return {
    port: Number(vars.PORT ?? 3001),
    webPort: Number(vars.WEB_PORT ?? 5173),
    publicBaseUrl: parsePublicBaseUrl(vars.PUBLIC_BASE_URL),
    dbPath: path.resolve(apiRoot, vars.DB_PATH ?? './data/thoudang.db'),
    uploadsDir: path.resolve(apiRoot, vars.UPLOADS_DIR ?? './uploads'),
    logFile: path.resolve(apiRoot, vars.LOG_FILE ?? './logs/api.log'),
    migrationsDir: path.resolve(apiRoot, './drizzle'),
    serveWeb: vars.SERVE_WEB === '1',
    webDist: path.resolve(apiRoot, '../web/dist'),
    anthropicConfigured: Boolean(vars.ANTHROPIC_API_KEY),
    demoMode: oneOf(vars.DEMO_MODE, ['live', 'cache_first', 'cache_only'] as const, 'live'),
    claude: {
      model: vars.CLAUDE_MODEL ?? 'claude-sonnet-5-5',
      timeoutMs: Number(vars.CLAUDE_TIMEOUT_MS ?? 60_000),
      maxRetries: Number(vars.CLAUDE_MAX_RETRIES ?? 2),
      concurrency: Number(vars.CLAUDE_CONCURRENCY ?? 3),
      effortClassify: oneOf(vars.CLAUDE_EFFORT_CLASSIFY, ['low', 'medium', 'high'] as const, 'low'),
      effortExtract: oneOf(
        vars.CLAUDE_EFFORT_EXTRACT,
        ['low', 'medium', 'high'] as const,
        'medium',
      ),
    },
    // claude-sonnet-5-5 list price.
    pricing: {
      inputPerMTok: Number(vars.PRICE_INPUT_PER_MTOK ?? 2),
      outputPerMTok: Number(vars.PRICE_OUTPUT_PER_MTOK ?? 10),
      // Configurable — set PRICE_USD_INR to the day's rate.
      usdToInr: Number(vars.PRICE_USD_INR ?? 88),
    },
    tts: {
      apiKey: vars.GEMINI_API_KEY || null,
      model: vars.TTS_MODEL ?? 'gemini-3.8-flash-tts',
      voice: vars.TTS_VOICE ?? 'Kore',
      timeoutMs: Number(vars.TTS_TIMEOUT_MS ?? 45_000),
    },
    templatesPath: path.resolve(
      repoRoot,
      vars.TEMPLATES_PATH ?? 'packages/core/notices/templates.json',
    ),
    audioDir: path.resolve(apiRoot, vars.AUDIO_DIR ?? './data/audio'),
    statusLinkSecret: vars.STATUS_LINK_SECRET ?? 'thoudang-prototype-status-links',
    evalReportPath: path.resolve(repoRoot, vars.EVAL_REPORT ?? 'eval-report.json'),
    fairnessHoldoutPath: path.resolve(
      repoRoot,
      vars.FAIRNESS_HOLDOUT ?? 'packages/core/data/fairness-holdout.json',
    ),
  };
}

export const env: AppConfig = loadConfig();
