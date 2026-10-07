/**
 * Renders planned packets to disk: <out>/<id>/{form,aadhaar,passbook,epic}.jpg + truth.json +
 * layout.json, plus <out>/manifest.json summarising the set.
 */
import './render/fonts.js';
import fs from 'node:fs';
import path from 'node:path';
import {
  renderAadhaar,
  renderEpic,
  renderForm,
  renderPassbook,
  type FlatDocument,
} from './render/documents.js';
import { captureParams, photograph, type CaptureQuality } from './render/photo.js';
import type { Rng } from './rng.js';
import { plan, SCREENING_DAY, type PlanOptions, type PlannedPacket } from './plan.js';
import { buildTruth, DOC_FILES, type DocKey, type TruthJson } from './truth.js';

export type QualityMix = Record<CaptureQuality, number>;
export const EVAL_QUALITY: QualityMix = { scan: 0.3, phone: 0.55, poor: 0.15 };
/** Demo packets must replay reliably on stage: no "poor" captures. */
export const DEMO_QUALITY: QualityMix = { scan: 0.45, phone: 0.55, poor: 0 };

export function flatDocuments(p: PlannedPacket, rng: Rng): Partial<Record<DocKey, FlatDocument>> {
  const s = p.spec;
  const out: Partial<Record<DocKey, FlatDocument>> = {};
  if (s.form) out.form = renderForm(rng.fork('form'), s.form, s.writer);
  if (s.aadhaar) out.aadhaar = renderAadhaar(rng.fork('aadhaar'), s.aadhaar);
  if (s.passbook) out.passbook = renderPassbook(rng.fork('passbook'), s.passbook);
  if (s.epic) out.epic = renderEpic(rng.fork('epic'), s.epic);
  return out;
}

export interface WrittenPacket {
  id: string;
  dir: string;
  truth: TruthJson;
  files: string[];
}

export async function writePacket(
  root: string,
  p: PlannedPacket,
  ctx: { seed: number; quality: QualityMix; all: PlannedPacket[]; set: string },
): Promise<WrittenPacket> {
  const dir = path.join(root, p.id);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const docs = flatDocuments(p, p.rng.fork('docs'));
  const layout: Record<string, Record<string, number[]>> = {};
  const capture: Record<string, string> = {};
  for (const key of Object.keys(DOC_FILES) as DocKey[]) {
    const doc = docs[key];
    if (!doc) continue;
    const crng = p.rng.fork(`capture-${key}`);
    const quality = crng.weighted(ctx.quality);
    const photo = await photograph(
      crng.fork('photo'),
      doc,
      captureParams(crng.fork('params'), quality),
    );
    const file = DOC_FILES[key];
    fs.writeFileSync(path.join(dir, file), photo.jpeg);
    layout[file] = photo.boxes;
    capture[file] = quality;
  }
  const original = p.spec.duplicateOf !== null ? ctx.all[p.spec.duplicateOf] : undefined;
  const truth = buildTruth(p.spec, p.expectation, {
    set: ctx.set,
    seed: ctx.seed,
    packet: p.id,
    duplicate_of: original?.id ?? null,
    screening_day: SCREENING_DAY,
    capture,
    build_attempts: p.attempts,
    ...(original
      ? {
          order_note: `Process ${original.id} BEFORE this packet: duplicate detection compares against earlier cases.`,
        }
      : {}),
  });
  fs.writeFileSync(path.join(dir, 'truth.json'), `${JSON.stringify(truth, null, 2)}\n`);
  fs.writeFileSync(path.join(dir, 'layout.json'), `${JSON.stringify(layout, null, 2)}\n`);
  return { id: p.id, dir, truth, files: fs.readdirSync(dir).sort() };
}

/** Removes packet folders previously written by this generator (never anything else). */
export function cleanOutput(root: string): void {
  if (!fs.existsSync(root)) return;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const truthFile = path.join(root, entry.name, 'truth.json');
    if (!fs.existsSync(truthFile)) continue;
    try {
      const t = JSON.parse(fs.readFileSync(truthFile, 'utf8')) as {
        synthetic?: { generator?: string };
      };
      if (t.synthetic?.generator === 'tools/synth') {
        fs.rmSync(path.join(root, entry.name), { recursive: true, force: true });
      }
    } catch {
      // Not ours / unreadable — leave it alone.
    }
  }
}

export function summarise(packets: WrittenPacket[]) {
  const count = <K extends string>(xs: K[]) =>
    Object.fromEntries(
      [...new Set(xs)].sort().map((k) => [k, xs.filter((x) => x === k).length]),
    ) as Record<K, number>;
  const syn = packets.map((p) => p.truth.synthetic as Record<string, unknown>);
  return {
    packets: packets.length,
    byScenario: count(syn.map((s) => String(s.scenario))),
    byExpectedStatus: count(packets.map((p) => p.truth.expected_status)),
    byCommunity: count(syn.map((s) => String(s.community))),
    byDistrict: count(syn.map((s) => String(s.district))),
    byCapture: count(
      syn.flatMap((s) => Object.values((s.capture ?? {}) as Record<string, string>)),
    ),
    withEpic: syn.filter((s) => s.epic_included).length,
    displaced: syn.filter((s) => s.displaced).length,
    flags: count(packets.flatMap((p) => p.truth.expected_flags.map((f) => f.code))),
  };
}

export interface GenerateOptions extends PlanOptions {
  out: string;
  quality?: QualityMix;
  set?: string;
  log?: (line: string) => void;
}

export async function generate(opts: GenerateOptions) {
  const planned = plan(opts);
  fs.mkdirSync(opts.out, { recursive: true });
  cleanOutput(opts.out);
  const written: WrittenPacket[] = [];
  for (const p of planned) {
    const w = await writePacket(opts.out, p, {
      seed: opts.seed,
      quality: opts.quality ?? EVAL_QUALITY,
      all: planned,
      set: opts.set ?? 'eval',
    });
    written.push(w);
    opts.log?.(
      `  ${p.id}  ${p.scenario.padEnd(24)} ${w.truth.expected_status.padEnd(25)} ${w.files.filter((f) => f.endsWith('.jpg')).join(', ')}`,
    );
  }
  const manifest = {
    _note:
      'SYNTHETIC SPECIMEN packets generated by tools/synth (npm run synth). Fictional people, mock documents. Regenerate with the same seed to reproduce.',
    generator: 'tools/synth',
    seed: opts.seed,
    set: opts.set ?? 'eval',
    screening_day: SCREENING_DAY,
    summary: summarise(written),
    packets: written.map((w) => ({
      id: w.id,
      scenario: (w.truth.synthetic as Record<string, unknown>).scenario,
      plants: (w.truth.synthetic as Record<string, unknown>).plants,
      expected_status: w.truth.expected_status,
      duplicate_of: (w.truth.synthetic as Record<string, unknown>).duplicate_of,
    })),
  };
  fs.writeFileSync(path.join(opts.out, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return { planned, written, manifest };
}
