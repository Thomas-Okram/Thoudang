import fs from 'node:fs';
import path from 'node:path';
import { redactAadhaarInText } from '@thoudang/core';

type Level = 'info' | 'warn' | 'error';

export interface Logger {
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
}

export interface LoggerOptions {
  /** Append JSON lines here. Omit to log to the console only. */
  file?: string;
  console?: boolean;
}

/**
 * Every log line passes through redactAadhaarInText before it is written anywhere,
 * so a full Aadhaar number can never reach the console or the log file.
 */
export function createLogger(opts: LoggerOptions = {}): Logger {
  const toConsole = opts.console ?? true;
  if (opts.file) fs.mkdirSync(path.dirname(opts.file), { recursive: true });

  const write = (level: Level, msg: string, meta?: Record<string, unknown>) => {
    const line = redactAadhaarInText(
      JSON.stringify({ ts: new Date().toISOString(), level, msg, ...(meta ? { meta } : {}) }),
    );
    if (opts.file) fs.appendFileSync(opts.file, `${line}\n`);
    if (toConsole) {
      const text = redactAadhaarInText(meta ? `${msg} ${JSON.stringify(meta)}` : msg);
      (level === 'info' ? console.log : level === 'warn' ? console.warn : console.error)(
        `[api] ${text}`,
      );
    }
  };
  return {
    info: (m, meta) => write('info', m, meta),
    warn: (m, meta) => write('warn', m, meta),
    error: (m, meta) => write('error', m, meta),
  };
}

export const silentLogger: Logger = { info: () => {}, warn: () => {}, error: () => {} };
