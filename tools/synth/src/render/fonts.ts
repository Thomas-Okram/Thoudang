/**
 * Point fontconfig at the BUNDLED fonts only (tools/synth/fonts), so images render the same on
 * every machine and the handwriting fonts work offline. Must run before sharp renders any text:
 * import this module before anything that renders SVG.
 *
 * PANGOCAIRO_BACKEND=fc: on macOS Pango otherwise uses CoreText and ignores fontconfig.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const FONTS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../fonts');

process.env.FONTCONFIG_FILE = path.join(FONTS_DIR, 'fonts.conf');
process.env.PANGOCAIRO_BACKEND = 'fc';

export const PRINT = 'PT Sans';

/** Average advance per character, in em (measured on the bundled fonts). */
const METRICS: Record<string, { lower: number; upper: number }> = {
  Caveat: { lower: 0.38, upper: 0.49 },
  Kalam: { lower: 0.462, upper: 0.57 },
  'Patrick Hand': { lower: 0.39, upper: 0.445 },
  'PT Sans': { lower: 0.475, upper: 0.545 },
};

/** Estimated rendered width in px (good to a few % — used for layout and highlight boxes). */
export function textWidth(text: string, font: string, size: number): number {
  const m = METRICS[font] ?? METRICS['PT Sans']!;
  let w = 0;
  for (const ch of text) w += /[A-Z0-9]/.test(ch) ? m.upper : ch === ' ' ? 0.25 : m.lower;
  return w * size;
}
