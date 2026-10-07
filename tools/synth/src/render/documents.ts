/**
 * Flat (scanner-perfect) SVG renderings of each mock document. Generic layouts only: no emblems,
 * logos, seals or official templates; every document carries a SPECIMEN banner and watermark.
 */
import type { Rng } from '../rng.js';
import type { AadhaarSpec, EpicSpec, FormField, FormSpec, PassbookSpec, Writer } from '../spec.js';
import { PRINT, textWidth } from './fonts.js';

export type Box = [number, number, number, number];

export interface FlatDocument {
  width: number;
  height: number;
  /** SVG markup (no outer <svg>), in document pixel coordinates. */
  body: string;
  /** Approximate box of each truth field's value, in document pixel coordinates. */
  boxes: Record<string, Box>;
  /** Every visible text run (for tests: truth ↔ image consistency, branding checks). */
  texts: string[];
}

export const ID_BANNER = 'SPECIMEN — SYNTHETIC TEST DOCUMENT, NOT A GOVERNMENT ID';
export const FORM_BANNER = 'SPECIMEN — SYNTHETIC TEST FORM, NOT A REAL APPLICATION';

export const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const r1 = (n: number) => Math.round(n * 10) / 10;

class Canvas {
  parts: string[] = [];
  boxes: Record<string, Box> = {};
  texts: string[] = [];

  raw(svg: string) {
    this.parts.push(svg);
  }

  /** Printed text. Returns its approximate box. */
  print(
    x: number,
    y: number,
    text: string,
    o: {
      size?: number;
      bold?: boolean;
      fill?: string;
      anchor?: 'start' | 'middle' | 'end';
      spacing?: number;
      maxWidth?: number;
      opacity?: number;
    } = {},
  ): Box {
    let size = o.size ?? 28;
    const spacing = o.spacing ?? 0;
    const est = (s: number) => textWidth(text, PRINT, s) + spacing * text.length;
    if (o.maxWidth && est(size) > o.maxWidth) size = (size * o.maxWidth) / est(size);
    const w = est(size);
    const anchor = o.anchor ?? 'start';
    const x1 = anchor === 'middle' ? x - w / 2 : anchor === 'end' ? x - w : x;
    this.texts.push(text);
    this.parts.push(
      `<text x="${r1(x)}" y="${r1(y)}" font-family="${PRINT}" font-size="${r1(size)}"${o.bold ? ' font-weight="700"' : ''}${spacing ? ` letter-spacing="${spacing}"` : ''} fill="${o.fill ?? '#1f2328'}"${o.opacity !== undefined ? ` fill-opacity="${o.opacity}"` : ''} text-anchor="${anchor}">${esc(text)}</text>`,
    );
    return [x1, y - size * 0.78, x1 + w, y + size * 0.24];
  }

  /**
   * Handwritten value: writer's font and ink, slight rotation, wandering baseline (per-character
   * dy), shrunk to fit the line.
   */
  hand(rng: Rng, x: number, y: number, text: string, writer: Writer, maxWidth: number): Box {
    let size = writer.size * rng.float(0.94, 1.06);
    if (textWidth(text, writer.font, size) > maxWidth) {
      size = (size * maxWidth) / textWidth(text, writer.font, size);
    }
    const w = textWidth(text, writer.font, size);
    const angle = rng.float(-1.3, 1.3);
    const x0 = x + rng.float(-4, 10);
    const y0 = y + rng.float(-5, 3);
    const amp = size * rng.float(0.02, 0.06);
    const freq = rng.float(0.25, 0.6);
    const phase = rng.float(0, Math.PI * 2);
    let prev = 0;
    const spans = [...text]
      .map((ch, i) => {
        const off = amp * Math.sin(i * freq + phase) + rng.float(-0.6, 0.6);
        const dy = r1(off - prev);
        prev += dy;
        return `<tspan dy="${dy}">${esc(ch)}</tspan>`;
      })
      .join('');
    this.texts.push(text);
    this.parts.push(
      `<text xml:space="preserve" x="${r1(x0)}" y="${r1(y0)}" font-family="${writer.font}" font-size="${r1(size)}" fill="${writer.ink}" fill-opacity="${r1(rng.float(0.82, 0.97) * 100) / 100}" transform="rotate(${r1(angle * 10) / 10} ${r1(x0)} ${r1(y0)})">${spans}</text>`,
    );
    const lift = Math.abs(Math.sin((angle * Math.PI) / 180)) * w;
    return [x0 - 4, y0 - size * 0.85 - lift - amp, x0 + w * 1.06 + 4, y0 + size * 0.3 + lift + amp];
  }

  svg() {
    return this.parts.join('\n');
  }
}

function watermark(c: Canvas, w: number, h: number) {
  c.texts.push('SPECIMEN');
  c.raw(
    `<text x="${w / 2}" y="${h / 2}" font-family="${PRINT}" font-size="${Math.round(w / 7)}" font-weight="700" fill="#c0392b" fill-opacity="0.12" text-anchor="middle" transform="rotate(-24 ${w / 2} ${h / 2})">SPECIMEN</text>`,
  );
}

function banner(c: Canvas, x: number, y: number, w: number, text: string, size: number) {
  c.raw(
    `<rect x="${x}" y="${y}" width="${w}" height="${size * 1.6}" fill="#fdecea" stroke="#c0392b" stroke-width="2"/>`,
  );
  c.print(x + w / 2, y + size * 1.15, text, {
    size,
    bold: true,
    fill: '#b03a2e',
    anchor: 'middle',
    maxWidth: w - 20,
  });
}

// ---------------------------------------------------------------------------------------------
// Application form
// ---------------------------------------------------------------------------------------------

const FORM_ROWS: [FormField, string][] = [
  ['applicant_name', '1. Name of applicant (in block letters)'],
  ['father_or_husband_name', "2. Father's / Husband's name"],
  ['address', '3. Permanent address'],
  ['district', '4. District'],
  ['category', '5. Category (SC / ST / OBC / General)'],
  ['aadhaar_number', '6. Aadhaar number'],
  ['mobile', '7. Mobile number'],
  ['date_of_birth', '8. Date of birth'],
  ['age', '9. Age (in years)'],
  ['marital_status_if_stated', '10. Marital status'],
  ['disability_if_stated', '11. Disability, if any'],
  ['annual_income', '12. Annual family income (Rs.)'],
  ['bank_name', '13. Name of bank'],
  ['branch', '14. Branch'],
  ['account_number', '15. Savings account number'],
  ['ifsc', '16. IFSC code'],
];

function signaturePath(rng: Rng, x: number, y: number): string {
  let d = `M${r1(x)} ${r1(y)}`;
  let cx = x;
  for (let i = 0; i < rng.int(4, 7); i++) {
    const dx = rng.float(35, 70);
    d += ` c ${r1(dx * 0.3)} ${r1(rng.float(-60, -20))}, ${r1(dx * 0.7)} ${r1(rng.float(20, 50))}, ${r1(dx)} ${r1(rng.float(-15, 15))}`;
    cx += dx;
  }
  d += ` M${r1(x + 10)} ${r1(y + rng.float(18, 28))} l ${r1(cx - x - rng.float(20, 60))} ${r1(rng.float(-10, 6))}`;
  return d;
}

function thumbPrint(rng: Rng, x: number, y: number): string {
  const rings = Array.from({ length: 9 }, (_, i) => {
    const rx = 18 + i * 5.5;
    const ry = 26 + i * 7;
    return `<ellipse cx="${x}" cy="${y}" rx="${r1(rx + rng.float(-1.5, 1.5))}" ry="${r1(ry + rng.float(-1.5, 1.5))}" fill="none" stroke="#4b3f8f" stroke-width="${r1(rng.float(2.2, 3.6))}" stroke-dasharray="${rng.int(8, 18)} ${rng.int(3, 7)}"/>`;
  }).join('');
  return `<g opacity="${r1(rng.float(0.55, 0.8) * 100) / 100}" transform="rotate(${rng.int(-25, 25)} ${x} ${y})">${rings}</g>`;
}

export function renderForm(rng: Rng, f: FormSpec, writer: Writer): FlatDocument {
  const w = 1700;
  const h = 2300;
  const c = new Canvas();
  const paper = rng.pick(['#fbf9f3', '#f8f5ec', '#fdfdfb', '#f6f3e8']);
  c.raw(`<rect width="${w}" height="${h}" fill="${paper}"/>`);
  c.raw(
    `<rect x="60" y="60" width="${w - 120}" height="${h - 120}" fill="none" stroke="#333" stroke-width="3"/>`,
  );
  c.print(110, 140, 'SOCIAL WELFARE DEPARTMENT, MANIPUR', { size: 30, bold: true });
  c.print(110, 196, 'APPLICATION FOR OLD AGE PENSION', { size: 40, bold: true });
  c.print(110, 240, 'Generic layout for software testing — not the official form', {
    size: 22,
    fill: '#5f6368',
  });
  c.raw(
    `<rect x="1370" y="95" width="210" height="250" fill="none" stroke="#666" stroke-dasharray="6 5"/>`,
  );
  c.print(1475, 210, 'Affix recent', { size: 20, fill: '#777', anchor: 'middle' });
  c.print(1475, 236, 'photograph', { size: 20, fill: '#777', anchor: 'middle' });
  banner(c, 110, 268, 1220, FORM_BANNER, 24);
  c.raw(`<line x1="100" y1="365" x2="${w - 100}" y2="365" stroke="#333" stroke-width="2"/>`);

  FORM_ROWS.forEach(([key, label], i) => {
    const y = 420 + i * 84;
    c.print(110, y, label, { size: 27 });
    c.raw(
      `<line x1="720" y1="${y + 10}" x2="1590" y2="${y + 10}" stroke="#555" stroke-width="1.5" stroke-dasharray="4 4"/>`,
    );
    const v = f.fields[key];
    if (v !== null) c.boxes[key] = c.hand(rng, 735, y, v, writer, 840);
  });

  const declY = 420 + FORM_ROWS.length * 84 + 30;
  c.print(
    110,
    declY,
    'DECLARATION: I declare that the particulars given above are true to the best of my',
    {
      size: 23,
      fill: '#333',
    },
  );
  c.print(110, declY + 32, 'knowledge, and that I am not receiving any other pension.', {
    size: 23,
    fill: '#333',
  });
  const dateY = declY + 110;
  c.print(110, dateY, 'Date:', { size: 28 });
  c.raw(
    `<line x1="190" y1="${dateY + 10}" x2="520" y2="${dateY + 10}" stroke="#555" stroke-dasharray="4 4"/>`,
  );
  if (f.fields.application_date !== null) {
    c.boxes.application_date = c.hand(rng, 200, dateY, f.fields.application_date, writer, 310);
  }
  c.print(110, dateY + 75, 'Place:', { size: 28 });
  c.raw(
    `<line x1="200" y1="${dateY + 85}" x2="520" y2="${dateY + 85}" stroke="#555" stroke-dasharray="4 4"/>`,
  );
  c.hand(rng, 210, dateY + 75, f.place, writer, 300);

  const sx = 1050;
  const sy = dateY - 60;
  c.raw(`<rect x="${sx}" y="${sy}" width="520" height="150" fill="none" stroke="#555"/>`);
  c.print(sx + 10, sy + 175, 'Signature / thumb impression of applicant', {
    size: 22,
    fill: '#555',
  });
  c.boxes.signature_present = [sx, sy, sx + 520, sy + 150];
  if (f.signature === 'signature') {
    c.raw(
      `<path d="${signaturePath(rng, sx + rng.int(40, 120), sy + rng.int(70, 100))}" stroke="${writer.ink}" stroke-width="${r1(rng.float(2.5, 4))}" fill="none" stroke-linecap="round"/>`,
    );
  } else if (f.signature === 'thumb') {
    c.raw(thumbPrint(rng, sx + rng.int(180, 340), sy + 75));
    c.print(sx + 470, sy + 135, 'LTI', { size: 22, fill: '#4b3f8f', anchor: 'end' });
  }

  c.raw(
    `<rect x="110" y="${h - 200}" width="${w - 220}" height="70" fill="none" stroke="#999" stroke-dasharray="3 4"/>`,
  );
  c.print(130, h - 157, 'For office use only:  Diary No. ________   Received on ________', {
    size: 22,
    fill: '#777',
  });
  watermark(c, w, h);
  c.print(
    w / 2,
    h - 80,
    'SPECIMEN — synthetic test data generated for the AI4SEVA hackathon. Fictional applicant.',
    {
      size: 19,
      fill: '#7f8c8d',
      anchor: 'middle',
    },
  );
  return { width: w, height: h, body: c.svg(), boxes: c.boxes, texts: c.texts };
}

// ---------------------------------------------------------------------------------------------
// ID-style cards
// ---------------------------------------------------------------------------------------------

const spaced = (n: string) => `${n.slice(0, 4)} ${n.slice(4, 8)} ${n.slice(8)}`;

function cardFrame(
  c: Canvas,
  rng: Rng,
  w: number,
  h: number,
  title: string,
  palette: { bg: string; band: string; line: string },
) {
  c.raw(`<rect width="${w}" height="${h}" rx="26" fill="${palette.bg}"/>`);
  const lines = Array.from({ length: 22 }, (_, i) => {
    const x = i * 60 - 200 + rng.int(0, 10);
    return `<line x1="${x}" y1="${h}" x2="${x + 380}" y2="110" stroke="${palette.line}" stroke-width="1"/>`;
  }).join('');
  c.raw(`<g opacity="0.35">${lines}</g>`);
  c.raw(
    `<path d="M0 26 a26 26 0 0 1 26 -26 h${w - 52} a26 26 0 0 1 26 26 v64 h-${w} z" fill="${palette.band}"/>`,
  );
  c.print(w / 2, 60, title, {
    size: 31,
    bold: true,
    fill: '#ffffff',
    anchor: 'middle',
    maxWidth: w - 60,
  });
  banner(c, 40, 104, w - 80, ID_BANNER, 17);
  // Photo placeholder: generic silhouette.
  c.raw(`<rect x="44" y="165" width="200" height="240" fill="#dfe4e8" stroke="#9aa5ad"/>`);
  c.raw(
    `<circle cx="144" cy="250" r="48" fill="#b8c1c8"/><path d="M64 405 q80 -120 160 0 z" fill="#b8c1c8"/>`,
  );
}

function labelled(
  c: Canvas,
  x: number,
  y: number,
  label: string,
  value: string,
  size: number,
  maxWidth: number,
): Box {
  c.print(x, y, label, { size: 18, fill: '#5f6368' });
  return c.print(x, y + size + 4, value, { size, bold: true, fill: '#111', maxWidth });
}

export function renderAadhaar(rng: Rng, a: AadhaarSpec): FlatDocument {
  const w = 1012;
  const h = 638;
  const c = new Canvas();
  cardFrame(c, rng, w, h, 'AADHAAR (MOCK) · SYNTHETIC SPECIMEN', {
    bg: rng.pick(['#fff7ee', '#fdf6f0', '#fbf8f1']),
    band: rng.pick(['#7a4b2a', '#8a5a3c', '#6d4c41']),
    line: '#e9c9a8',
  });
  c.boxes.name = labelled(c, 275, 182, 'Name', a.name, 30, 690);
  c.boxes.dob_or_yob = labelled(c, 275, 262, a.dobLabel, a.dob, 28, 400);
  c.boxes.gender = labelled(c, 700, 262, 'Gender', a.gender, 28, 260);
  c.boxes.address = labelled(c, 275, 342, 'Address', a.address, 24, 690);
  c.raw(`<line x1="44" y1="455" x2="${w - 44}" y2="455" stroke="#c9a27e" stroke-width="2"/>`);
  c.boxes.aadhaar_number = c.print(w / 2, 530, spaced(a.number), {
    size: 52,
    bold: true,
    fill: '#111',
    anchor: 'middle',
    spacing: 4,
  });
  watermark(c, w, h);
  c.print(w / 2, h - 28, 'Fictional person · mock layout · for software testing only', {
    size: 17,
    fill: '#7f8c8d',
    anchor: 'middle',
  });
  return { width: w, height: h, body: c.svg(), boxes: c.boxes, texts: c.texts };
}

export function renderEpic(rng: Rng, e: EpicSpec): FlatDocument {
  const w = 1012;
  const h = 638;
  const c = new Canvas();
  cardFrame(c, rng, w, h, 'VOTER ID (EPIC, MOCK) · SYNTHETIC SPECIMEN', {
    bg: rng.pick(['#eef3f8', '#f0f4f7', '#edf2f6']),
    band: rng.pick(['#34495e', '#2e4053', '#37474f']),
    line: '#c5d3df',
  });
  c.boxes.epic_number = labelled(c, 275, 182, 'EPIC No.', e.number, 32, 450);
  c.boxes.name = labelled(c, 275, 262, 'Elector’s Name', e.name, 28, 690);
  c.boxes.relative_name = labelled(c, 275, 342, e.relLabel, e.relative, 26, 690);
  c.boxes.dob_or_age = labelled(c, 275, 422, 'Date of Birth / Age', e.dobOrAge, 26, 690);
  watermark(c, w, h);
  c.print(w / 2, h - 28, 'Fictional person · mock layout · for software testing only', {
    size: 17,
    fill: '#7f8c8d',
    anchor: 'middle',
  });
  return { width: w, height: h, body: c.svg(), boxes: c.boxes, texts: c.texts };
}

// ---------------------------------------------------------------------------------------------
// Passbook
// ---------------------------------------------------------------------------------------------

export function renderPassbook(rng: Rng, p: PassbookSpec): FlatDocument {
  const w = 1400;
  const h = 920;
  const c = new Canvas();
  c.raw(`<rect width="${w}" height="${h}" fill="${rng.pick(['#fffdf6', '#fbfaf3', '#fdfbf5'])}"/>`);
  c.raw(
    `<rect x="36" y="36" width="${w - 72}" height="${h - 72}" fill="none" stroke="#6b4f2a" stroke-width="3"/>`,
  );
  c.boxes.bank_name = c.print(w / 2, 108, p.bank.toUpperCase(), {
    size: 42,
    bold: true,
    fill: '#3e2f1c',
    anchor: 'middle',
    maxWidth: w - 140,
  });
  c.print(w / 2, 150, 'SAVINGS ACCOUNT PASSBOOK (MOCK)', {
    size: 26,
    fill: '#6b4f2a',
    anchor: 'middle',
  });
  banner(c, 80, 172, w - 160, ID_BANNER, 20);
  const rows: [string, string, string][] = [
    ['account_holder_name', 'Account holder', p.holder],
    ['account_number', 'Account No.', p.account],
    ['', 'CIF No.', p.cif],
    ['ifsc', 'IFSC', p.ifsc],
    ['branch', 'Branch', p.branch],
    ['', 'Address', p.address],
  ];
  rows.forEach(([key, label, value], i) => {
    const y = 300 + i * 66;
    c.print(90, y, label, { size: 28, fill: '#444' });
    c.print(380, y, ':', { size: 28, fill: '#444' });
    const box = c.print(410, y, value, { size: 31, bold: true, fill: '#111', maxWidth: 900 });
    if (key) c.boxes[key] = box;
  });
  const ty = 300 + rows.length * 66 + 20;
  c.raw(`<line x1="80" y1="${ty}" x2="${w - 80}" y2="${ty}" stroke="#6b4f2a"/>`);
  const cols = [90, 290, 760, 960, 1160];
  ['Date', 'Particulars', 'Withdrawal', 'Deposit', 'Balance'].forEach((t, i) =>
    c.print(cols[i]!, ty + 36, t, { size: 22, bold: true, fill: '#555' }),
  );
  const opening = rng.int(5, 40) * 100;
  c.print(cols[0]!, ty + 76, `0${rng.int(1, 9)}-0${rng.int(1, 9)}-20${rng.int(18, 25)}`, {
    size: 22,
    fill: '#555',
  });
  c.print(cols[1]!, ty + 76, 'BY CASH (OPENING)', { size: 22, fill: '#555' });
  c.print(cols[3]!, ty + 76, `${opening}.00`, { size: 22, fill: '#555' });
  c.print(cols[4]!, ty + 76, `${opening}.00`, { size: 22, fill: '#555' });
  watermark(c, w, h);
  c.print(
    w / 2,
    h - 52,
    'Fictional account · mock layout, no bank logo · for software testing only',
    {
      size: 18,
      fill: '#7f8c8d',
      anchor: 'middle',
    },
  );
  return { width: w, height: h, body: c.svg(), boxes: c.boxes, texts: c.texts };
}
