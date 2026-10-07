/**
 * "Photographed by an officer's phone": the flat document is placed on a desk with rotation,
 * skew, drop shadow, uneven lighting, a cast shadow, then blurred, noised, JPEG-compressed and
 * slightly cropped. The geometric transform is an explicit affine matrix, so every field's box is
 * mapped exactly into the output image (layout.json, used by dev:fixtures highlights).
 *
 * Note: true perspective (keystone) is not possible with an affine transform; skew + rotation +
 * non-uniform scale approximate a phone held slightly off-axis.
 */
import './fonts.js';
import sharp from 'sharp';
import type { Rng } from '../rng.js';
import type { Box, FlatDocument } from './documents.js';

export type CaptureQuality = 'scan' | 'phone' | 'poor';

export interface CaptureParams {
  quality: CaptureQuality;
  angleDeg: number;
  skewDeg: number;
  scaleY: number;
  margin: number;
  desk: string;
  lighting: number;
  castShadow: number;
  blur: number;
  noise: number;
  jpegQuality: number;
  outputScale: number;
  /** Fraction of the document width cut off one side (0 = none). */
  crop: { side: 'left' | 'right' | 'top' | 'bottom'; fraction: number } | null;
}

export function captureParams(rng: Rng, quality: CaptureQuality): CaptureParams {
  const desk = rng.pick(['#7b5e45', '#8d6e52', '#9aa0a6', '#5d6168', '#3b3f46', '#a1887f']);
  switch (quality) {
    case 'scan':
      return {
        quality,
        angleDeg: rng.float(-0.8, 0.8),
        skewDeg: 0,
        scaleY: 1,
        margin: rng.float(0.015, 0.03),
        desk: '#f2f2ef',
        lighting: rng.float(0, 0.06),
        castShadow: 0,
        blur: 0,
        noise: rng.float(0, 1.5),
        jpegQuality: rng.int(84, 90),
        outputScale: rng.float(0.95, 1.05),
        crop: null,
      };
    case 'phone':
      return {
        quality,
        angleDeg: rng.float(-3.2, 3.2),
        skewDeg: rng.float(-1.8, 1.8),
        scaleY: rng.float(0.97, 1.03),
        margin: rng.float(0.05, 0.11),
        desk,
        lighting: rng.float(0.1, 0.24),
        castShadow: rng.chance(0.45) ? rng.float(0.12, 0.26) : 0,
        blur: rng.chance(0.4) ? rng.float(0.3, 0.7) : 0,
        noise: rng.float(2, 4.5),
        jpegQuality: rng.int(72, 86),
        outputScale: rng.float(0.9, 1.1),
        crop: rng.chance(0.2)
          ? {
              side: rng.pick(['left', 'right', 'top', 'bottom'] as const),
              fraction: rng.float(0.005, 0.012),
            }
          : null,
      };
    case 'poor':
      return {
        quality,
        angleDeg: rng.float(-5, 5),
        skewDeg: rng.float(-3, 3),
        scaleY: rng.float(0.95, 1.05),
        margin: rng.float(0.05, 0.1),
        desk,
        lighting: rng.float(0.22, 0.36),
        castShadow: rng.float(0.2, 0.38),
        blur: rng.float(0.9, 1.5),
        noise: rng.float(5, 8),
        jpegQuality: rng.int(56, 68),
        outputScale: rng.float(0.8, 0.95),
        crop: rng.chance(0.35)
          ? {
              side: rng.pick(['left', 'right', 'top', 'bottom'] as const),
              fraction: rng.float(0.005, 0.015),
            }
          : null,
      };
  }
}

type Matrix = [number, number, number, number, number, number]; // SVG a b c d e f

const mul = (m: Matrix, n: Matrix): Matrix => [
  m[0] * n[0] + m[2] * n[1],
  m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3],
  m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4],
  m[1] * n[4] + m[3] * n[5] + m[5],
];
const apply = (m: Matrix, x: number, y: number): [number, number] => [
  m[0] * x + m[2] * y + m[4],
  m[1] * x + m[3] * y + m[5],
];
const rad = (deg: number) => (deg * Math.PI) / 180;

function transformBox(m: Matrix, b: Box): Box {
  const pts = [
    apply(m, b[0], b[1]),
    apply(m, b[2], b[1]),
    apply(m, b[0], b[3]),
    apply(m, b[2], b[3]),
  ];
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

export interface Photo {
  jpeg: Buffer;
  width: number;
  height: number;
  boxes: Record<string, Box>;
  svg: string;
}

const f2 = (n: number) => Math.round(n * 1000) / 1000;

export async function photograph(rng: Rng, doc: FlatDocument, p: CaptureParams): Promise<Photo> {
  const { width: w, height: h } = doc;
  const W = Math.round(w * (1 + 2 * p.margin));
  const H = Math.round(h * (1 + 2 * p.margin));

  // doc → scene: center, rotate, skew, scale to fit inside the margin.
  const base: Matrix = mul(
    mul(
      [
        Math.cos(rad(p.angleDeg)),
        Math.sin(rad(p.angleDeg)),
        -Math.sin(rad(p.angleDeg)),
        Math.cos(rad(p.angleDeg)),
        0,
        0,
      ],
      [1, 0, Math.tan(rad(p.skewDeg)), 1, 0, 0],
    ),
    [1, 0, 0, p.scaleY, -w / 2, (-h / 2) * p.scaleY],
  );
  const corners = transformBox(base, [0, 0, w, h]);
  const fit = Math.min(
    1,
    (W * (1 - p.margin * 0.6)) / (corners[2] - corners[0]),
    (H * (1 - p.margin * 0.6)) / (corners[3] - corners[1]),
  );
  const m: Matrix = mul([fit, 0, 0, fit, W / 2, H / 2], base);
  const mStr = m.map(f2).join(' ');

  const lightAngle = rng.float(0, 360);
  const shadowFrom = rng.pick(['left', 'right', 'top', 'bottom'] as const);
  const shadowDepth = rng.float(0.18, 0.4);
  const shadowPoly = {
    left: `0,0 ${W * shadowDepth},0 ${W * shadowDepth * 0.6},${H} 0,${H}`,
    right: `${W},0 ${W * (1 - shadowDepth)},0 ${W * (1 - shadowDepth * 0.5)},${H} ${W},${H}`,
    top: `0,0 ${W},0 ${W},${H * shadowDepth * 0.5} 0,${H * shadowDepth}`,
    bottom: `0,${H} ${W},${H} ${W},${H * (1 - shadowDepth)} 0,${H * (1 - shadowDepth * 0.6)}`,
  }[shadowFrom];

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
<defs>
  <filter id="soft" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation="${f2(Math.max(4, w / 120))}"/></filter>
  <filter id="cast" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="${f2(W / 30)}"/></filter>
  <linearGradient id="light" gradientTransform="rotate(${f2(lightAngle)} 0.5 0.5)">
    <stop offset="0" stop-color="#ffffff" stop-opacity="${f2(p.lighting * 0.6)}"/>
    <stop offset="1" stop-color="#000000" stop-opacity="${f2(p.lighting)}"/>
  </linearGradient>
  <radialGradient id="vignette" cx="${f2(rng.float(0.35, 0.65))}" cy="${f2(rng.float(0.35, 0.65))}" r="0.75">
    <stop offset="0.55" stop-color="#000" stop-opacity="0"/>
    <stop offset="1" stop-color="#000" stop-opacity="${f2(p.lighting * 0.9)}"/>
  </radialGradient>
</defs>
<rect width="${W}" height="${H}" fill="${p.desk}"/>
${p.quality === 'scan' ? '' : `<rect width="${w}" height="${h}" transform="matrix(${mStr}) translate(${f2(w * 0.006)} ${f2(h * 0.008)})" fill="#000" fill-opacity="0.35" filter="url(#soft)"/>`}
<g transform="matrix(${mStr})">
${doc.body}
</g>
${p.lighting > 0 ? `<rect width="${W}" height="${H}" fill="url(#light)"/><rect width="${W}" height="${H}" fill="url(#vignette)"/>` : ''}
${p.castShadow > 0 ? `<polygon points="${shadowPoly}" fill="#000" fill-opacity="${f2(p.castShadow)}" filter="url(#cast)"/>` : ''}
</svg>`;

  // Crop (in scene px) — only into the document margin.
  let crop = { left: 0, top: 0, width: W, height: H };
  const docBox = transformBox(m, [0, 0, w, h]);
  if (p.crop) {
    const cut = Math.round(p.crop.fraction * w * fit);
    if (p.crop.side === 'left') {
      const x = Math.max(0, Math.round(docBox[0]) + cut);
      crop = { left: x, top: 0, width: W - x, height: H };
    } else if (p.crop.side === 'right') {
      const x = Math.min(W, Math.round(docBox[2]) - cut);
      crop = { left: 0, top: 0, width: x, height: H };
    } else if (p.crop.side === 'top') {
      const y = Math.max(0, Math.round(docBox[1]) + cut);
      crop = { left: 0, top: y, width: W, height: H - y };
    } else {
      const y = Math.min(H, Math.round(docBox[3]) - cut);
      crop = { left: 0, top: 0, width: W, height: y };
    }
  }

  const outW = Math.round(crop.width * p.outputScale);
  const outH = Math.round(crop.height * p.outputScale);
  let img = sharp(Buffer.from(svg)).extract(crop).resize(outW, outH);
  if (p.blur >= 0.3) img = img.blur(p.blur);
  const { data, info } = await img.removeAlpha().raw().toBuffer({ resolveWithObject: true });

  if (p.noise > 0) {
    const noise = rng.fork('noise');
    const ch = info.channels;
    for (let i = 0; i < data.length; i += ch) {
      // Approx. Gaussian luminance noise (sum of uniforms) + a little chroma noise.
      const l = (noise.next() + noise.next() + noise.next() - 1.5) * 2 * p.noise;
      for (let c = 0; c < ch; c++) {
        const v = data[i + c]! + l + (c === 2 ? (noise.next() - 0.5) * p.noise * 0.6 : 0);
        data[i + c] = v < 0 ? 0 : v > 255 ? 255 : v;
      }
    }
  }
  const jpeg = await sharp(data, {
    raw: { width: info.width, height: info.height, channels: info.channels },
  })
    .jpeg({ quality: p.jpegQuality, mozjpeg: false, chromaSubsampling: '4:2:0' })
    .toBuffer();

  const sx = info.width / crop.width;
  const sy = info.height / crop.height;
  const boxes: Record<string, Box> = {};
  for (const [field, b] of Object.entries(doc.boxes)) {
    const t = transformBox(m, b);
    const clamp = (v: number, max: number) => Math.max(0, Math.min(max, Math.round(v)));
    boxes[field] = [
      clamp((t[0] - crop.left) * sx, info.width),
      clamp((t[1] - crop.top) * sy, info.height),
      clamp((t[2] - crop.left) * sx, info.width),
      clamp((t[3] - crop.top) * sy, info.height),
    ];
  }
  return { jpeg, width: info.width, height: info.height, boxes, svg };
}
