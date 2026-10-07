/**
 * Name-engine fairness report:
 *   npm run fairness                                   # development set (+ held-out if present)
 *   npm run fairness -- --holdout ./holdout-pairs.csv  # import held-out pairs (written blind), then report
 * CSV columns: name_a,name_b,community,expected_same  (community: Meitei | Pangal | Naga | Kuki-Zo)
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  evaluateFairness,
  fairnessDevPairs,
  formatFairnessTable,
  parseFairnessCsv,
  type FairnessPair,
} from '@thoudang/core';
import { env } from '../env.js';
import { fromInvocationDir, parseArgs } from './cli-args.js';

const { flags } = parseArgs(process.argv.slice(2));

if (typeof flags.holdout === 'string') {
  const file = fromInvocationDir(flags.holdout);
  const { pairs, errors } = parseFairnessCsv(fs.readFileSync(file, 'utf8'));
  if (errors.length) {
    console.error(`Not imported — fix these rows in ${file}:\n  ${errors.join('\n  ')}`);
    process.exit(1);
  }
  fs.writeFileSync(
    env.fairnessHoldoutPath,
    `${JSON.stringify({ _note: 'Held-out name pairs written without seeing the engine. Never used to tune the engine. Do not edit labels after seeing results.', source: path.basename(file), createdAt: new Date().toISOString(), pairs }, null, 2)}\n`,
  );
  console.log(`Imported ${pairs.length} held-out pairs → ${env.fairnessHoldoutPath}`);
}

const print = (title: string, pairs: readonly FairnessPair[]) => {
  console.log(
    `\n${title} — ${pairs.length} pairs\n${formatFairnessTable(evaluateFairness(pairs))}`,
  );
};
print('Development set (seen during build)', fairnessDevPairs);
if (fs.existsSync(env.fairnessHoldoutPath)) {
  print(
    'Held-out set (written blind)',
    (JSON.parse(fs.readFileSync(env.fairnessHoldoutPath, 'utf8')) as { pairs: FairnessPair[] })
      .pairs,
  );
} else {
  console.log(
    '\nNo held-out set yet. Add one with: npm run fairness -- --holdout ./holdout-pairs.csv',
  );
}
