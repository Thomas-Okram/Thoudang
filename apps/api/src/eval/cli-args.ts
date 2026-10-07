import path from 'node:path';

/** Minimal "--key value" / "--flag" parser. */
export function parseArgs(argv: string[]): {
  positional: string[];
  flags: Record<string, string | true>;
} {
  const positional: string[] = [];
  const flags: Record<string, string | true> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith('--')) {
      const [k, inline] = a.slice(2).split('=', 2) as [string, string | undefined];
      const next = argv[i + 1];
      if (inline !== undefined) flags[k] = inline;
      else if (next !== undefined && !next.startsWith('--')) {
        flags[k] = next;
        i += 1;
      } else flags[k] = true;
    } else positional.push(a);
  }
  return { positional, flags };
}

/** npm workspace scripts run in apps/api; resolve user paths against where npm was invoked. */
export const fromInvocationDir = (p: string) =>
  path.resolve(process.env.INIT_CWD ?? process.cwd(), p);
