/**
 * Guards the COMMITTED sets (eval-data/synthetic, demo-packets): their truth.json must still be
 * what the generator + current rules engine produce. If this fails after a rules/name-engine
 * change, regenerate:  npm run synth -- --count 40 --out eval-data/synthetic  &&  npm run synth -- --demo
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { containsFullAadhaar } from '@thoudang/core';
import { TruthSchema } from '../../../apps/api/src/eval/score.js';
import { DEMO_PACKETS } from '../src/demo.js';
import { plan } from '../src/plan.js';
import { buildTruth } from '../src/truth.js';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

interface Manifest {
  seed: number;
  set: string;
  packets: { id: string }[];
}

for (const rel of ['eval-data/synthetic', 'demo-packets']) {
  const dir = path.join(repo, rel);
  const manifestFile = path.join(dir, 'manifest.json');
  describe.runIf(fs.existsSync(manifestFile))(`committed set ${rel}`, () => {
    const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8')) as Manifest;
    const fresh = plan(
      manifest.set === 'demo'
        ? { count: 0, seed: manifest.seed, scenarios: DEMO_PACKETS }
        : { count: manifest.packets.length, seed: manifest.seed },
    );

    it('truth.json matches the generator and the current rules engine', () => {
      expect(fresh.map((p) => p.id)).toEqual(manifest.packets.map((p) => p.id));
      for (const p of fresh) {
        const onDisk = JSON.parse(
          fs.readFileSync(path.join(dir, p.id, 'truth.json'), 'utf8'),
        ) as Record<string, unknown>;
        const now = buildTruth(p.spec, p.expectation, {}) as unknown as Record<string, unknown>;
        for (const key of ['expected_status', 'documents', 'name_checks', 'expected_flags']) {
          expect(onDisk[key], `${rel}/${p.id} ${key} is stale — regenerate`).toEqual(now[key]);
        }
      }
    });

    it('every packet has its images, parses with the eval schema and holds no full Aadhaar', () => {
      for (const { id } of manifest.packets) {
        const raw = fs.readFileSync(path.join(dir, id, 'truth.json'), 'utf8');
        expect(containsFullAadhaar(raw), id).toBe(false);
        const truth = TruthSchema.parse(JSON.parse(raw));
        for (const file of Object.keys(truth.documents)) {
          expect(fs.existsSync(path.join(dir, id, file)), `${id}/${file}`).toBe(true);
        }
        expect(fs.existsSync(path.join(dir, id, 'layout.json'))).toBe(true);
      }
    });
  });
}
