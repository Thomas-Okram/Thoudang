/**
 * Name-engine fairness report:
 *   npm run fairness                                    # dev set + holdout v1 (pre-fix) + v2 if present
 *   npm run fairness -- --holdout ./eval-data/holdout-v2/holdout-v2-pairs.csv
 *                                                       # import the blind holdout v2, then report
 * CSV columns: name_a,name_b,community,expected_same  (community: Meitei | Pangal | Naga | Kuki-Zo)
 *
 * Holdout v1 (packages/core/data/fairness-holdout.json) is SEEN: it motivated the 8 Oct given-name
 * rule, so imports never overwrite it. New blind pairs always go to holdout v2.
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  evaluateFairness,
  fairnessDevPairs,
  formatFairnessTable,
  parseFairnessCsv,
  type FairnessPair,
  type FairnessRow,
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
  if (!pairs.length) {
    console.error(`Not imported — ${file} has no pairs yet (only the header?).`);
    process.exit(1);
  }
  fs.writeFileSync(
    env.fairnessHoldoutV2Path,
    `${JSON.stringify({ _note: 'Holdout v2: name pairs written blind by department staff after the given-name fix. Never used to tune the engine. Do not edit labels after seeing results.', version: 'v2', status: 'blind', source: path.basename(file), createdAt: new Date().toISOString(), pairs }, null, 2)}\n`,
  );
  console.log(`Imported ${pairs.length} blind pairs → ${env.fairnessHoldoutV2Path}`);
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

const print = (title: string, pairs: readonly FairnessPair[]) => {
  const report = evaluateFairness(pairs);
  console.log(`\n${title} — ${pairs.length} pairs\n${formatFairnessTable(report)}`);
  return report.overall;
};

const readSet = (file: string) =>
  fs.existsSync(file)
    ? (JSON.parse(fs.readFileSync(file, 'utf8')) as {
        pairs: FairnessPair[];
        status?: string;
        preFix?: { engine: string; overall: FairnessRow };
      })
    : null;

print('Development set (seen during build)', fairnessDevPairs);

const v1 = readSet(env.fairnessHoldoutPath);
if (v1) {
  const seen = v1.status === 'seen';
  const now = print(
    seen ? 'Holdout v1 (pre-fix) — SEEN, in-sample since the given-name fix' : 'Held-out set',
    v1.pairs,
  );
  if (v1.preFix) {
    const b = v1.preFix.overall;
    console.log(
      `\nBefore → after (${v1.preFix.engine}):` +
        `\n  false matches      ${b.falseMatches} → ${now.falseMatches}` +
        `\n  referred           ${b.referred} (${pct(b.referralRate)}) → ${now.referred} (${pct(now.referralRate)})` +
        `\n  false non-matches  ${b.falseNonMatches} → ${now.falseNonMatches}` +
        `\n  accuracy (auto)    ${pct(b.accuracy)} (${b.correct}/${b.decided}) → ${pct(now.accuracy)} (${now.correct}/${now.decided})`,
    );
  }
}

const v2 = readSet(env.fairnessHoldoutV2Path);
if (v2) {
  print('Holdout v2 (blind, department staff)', v2.pairs);
} else {
  console.log(
    '\nNo blind holdout v2 yet. Import it with:\n  npm run fairness -- --holdout ./eval-data/holdout-v2/holdout-v2-pairs.csv',
  );
}
