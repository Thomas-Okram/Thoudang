/**
 * Synthetic packet generator.
 *
 *   npm run synth -- --count 40 --out eval-data/synthetic [--seed 20261009] [--mix mix.json]
 *   npm run synth -- --demo [--out demo-packets]
 *
 * --mix: JSON file of scenario weights, e.g. {"clean": 0.5, "duplicate": 0.1}; unspecified
 *        scenarios keep their default weight (see DEFAULT_MIX in plan.ts).
 * --demo: the 6 hand-picked live-demo packets (fixed seed, good captures only).
 */
import fs from 'node:fs';
import path from 'node:path';
import { DEMO_PACKETS, DEMO_SEED } from './demo.js';
import { DEMO_QUALITY, EVAL_QUALITY, generate } from './generate.js';
import { DEFAULT_MIX, parseMix } from './plan.js';

export const DEFAULT_SEED = 20261009;

export function parseArgs(argv: string[]): Record<string, string | true> {
  const flags: Record<string, string | true> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (!a.startsWith('--')) throw new Error(`Unexpected argument: ${a}`);
    const [k, inline] = a.slice(2).split('=', 2) as [string, string | undefined];
    const next = argv[i + 1];
    if (inline !== undefined) flags[k] = inline;
    else if (next !== undefined && !next.startsWith('--')) {
      flags[k] = next;
      i++;
    } else flags[k] = true;
  }
  return flags;
}

/** npm runs scripts from the repo root; resolve paths against where the user typed the command. */
const fromInvocationDir = (p: string) => path.resolve(process.env.INIT_CWD ?? process.cwd(), p);

async function main() {
  const flags = parseArgs(process.argv.slice(2));
  const demo = flags.demo === true;
  const out = fromInvocationDir(
    typeof flags.out === 'string' ? flags.out : demo ? 'demo-packets' : 'eval-data/synthetic',
  );
  const seed =
    typeof flags.seed === 'string' ? Number(flags.seed) : demo ? DEMO_SEED : DEFAULT_SEED;
  if (!Number.isInteger(seed)) throw new Error('--seed must be an integer');
  const count = typeof flags.count === 'string' ? Number(flags.count) : 40;
  if (!demo && (!Number.isInteger(count) || count < 1 || count > 2000)) {
    throw new Error('--count must be an integer between 1 and 2000');
  }
  const mix =
    typeof flags.mix === 'string'
      ? parseMix(
          JSON.parse(fs.readFileSync(fromInvocationDir(flags.mix), 'utf8')) as Record<
            string,
            unknown
          >,
        )
      : DEFAULT_MIX;

  console.log(
    demo
      ? `Writing the ${DEMO_PACKETS.length} demo packets to ${out} (seed ${seed})`
      : `Writing ${count} synthetic packets to ${out} (seed ${seed})`,
  );
  const started = Date.now();
  const { manifest } = await generate({
    out,
    seed,
    count,
    mix,
    scenarios: demo ? DEMO_PACKETS : undefined,
    quality: demo ? DEMO_QUALITY : EVAL_QUALITY,
    set: demo ? 'demo' : 'eval',
    log: (l) => console.log(l),
  });
  const s = manifest.summary;
  console.log(`\nDone in ${((Date.now() - started) / 1000).toFixed(1)} s.`);
  console.log(`Expected status: ${JSON.stringify(s.byExpectedStatus)}`);
  console.log(`Communities:     ${JSON.stringify(s.byCommunity)}`);
  console.log(`Captures:        ${JSON.stringify(s.byCapture)}`);
  console.log(`Manifest: ${path.join(out, 'manifest.json')}`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
