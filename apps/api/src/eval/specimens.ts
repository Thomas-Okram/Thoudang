/**
 * Generates example eval packets:  npm run make-specimens [-- --out ./eval-data]
 *
 * Every image is SYNTHETIC and watermarked "SPECIMEN". Layouts are generic (no emblems, logos or
 * real templates). Aadhaar numbers are made-up 12-digit numbers that pass the Verhoeff checksum so
 * the masking path is exercised end-to-end; truth.json only ever stores the masked form.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { verhoeffCheckDigit } from '@thoudang/core';
import { fromInvocationDir, parseArgs } from './cli-args.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const PRINT = "Helvetica, Arial, 'Liberation Sans', sans-serif";
const HAND = "'Bradley Hand', 'Segoe Print', 'Comic Sans MS', 'Chalkboard SE', cursive";

function watermark(w: number, h: number): string {
  return `<text x="${w / 2}" y="${h / 2}" font-family="${PRINT}" font-size="${Math.round(w / 7)}" font-weight="700"
    fill="#c0392b" fill-opacity="0.13" text-anchor="middle" transform="rotate(-24 ${w / 2} ${h / 2})">SPECIMEN</text>`;
}

function footer(w: number, h: number): string {
  return `<text x="${w / 2}" y="${h - 18}" font-family="${PRINT}" font-size="16" fill="#7f8c8d" text-anchor="middle">
    SPECIMEN — synthetic test document for the AI4SEVA hackathon. Not a valid identity document.</text>`;
}

async function render(svg: string, file: string): Promise<void> {
  await sharp(Buffer.from(svg)).jpeg({ quality: 88 }).toFile(file);
}

interface FormData {
  applicant_name: string;
  father_or_husband_name: string;
  address: string;
  district: string;
  category: string;
  aadhaar_number: string;
  mobile: string;
  bank_name: string;
  branch: string;
  ifsc: string;
  account_number: string;
  date_of_birth: string;
  age: string;
  annual_income: string;
  signature_present: 'yes' | 'no';
  application_date: string;
  marital_status_if_stated: string;
  disability_if_stated: string;
}

const FORM_LABELS: [keyof FormData, string][] = [
  ['applicant_name', '1. Name of applicant'],
  ['father_or_husband_name', "2. Father's / Husband's name"],
  ['address', '3. Permanent address'],
  ['district', '4. District'],
  ['category', '5. Category (SC/ST/OBC/General)'],
  ['aadhaar_number', '6. Aadhaar number'],
  ['mobile', '7. Mobile number'],
  ['date_of_birth', '8. Date of birth'],
  ['age', '9. Age (years)'],
  ['marital_status_if_stated', '10. Marital status'],
  ['disability_if_stated', '11. Disability, if any'],
  ['annual_income', '12. Annual family income'],
  ['bank_name', '13. Bank name'],
  ['branch', '14. Branch'],
  ['account_number', '15. Account number'],
  ['ifsc', '16. IFSC code'],
];

function formSvg(d: FormData): string {
  const w = 1700;
  const h = 2200;
  const rows = FORM_LABELS.map(([key, label], i) => {
    const y = 420 + i * 92;
    return `<text x="110" y="${y}" font-family="${PRINT}" font-size="30" fill="#222">${esc(label)}</text>
      <line x1="720" y1="${y + 10}" x2="1590" y2="${y + 10}" stroke="#555" stroke-width="1.5" stroke-dasharray="4 4"/>
      <text x="735" y="${y}" font-family="${HAND}" font-size="38" fill="#1a3c8f">${esc(d[key])}</text>`;
  }).join('\n');
  const sigY = 420 + FORM_LABELS.length * 92 + 70;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
  <rect width="100%" height="100%" fill="#fbf9f3"/>
  <rect x="60" y="60" width="${w - 120}" height="${h - 120}" fill="none" stroke="#333" stroke-width="3"/>
  <text x="${w / 2}" y="150" font-family="${PRINT}" font-size="34" font-weight="700" text-anchor="middle">GOVERNMENT OF MANIPUR · SOCIAL WELFARE DEPARTMENT</text>
  <text x="${w / 2}" y="210" font-family="${PRINT}" font-size="40" font-weight="700" text-anchor="middle">APPLICATION FOR OLD AGE PENSION (SPECIMEN)</text>
  <text x="${w / 2}" y="262" font-family="${PRINT}" font-size="24" fill="#555" text-anchor="middle">Synthetic layout for testing — not the official form</text>
  <line x1="100" y1="300" x2="${w - 100}" y2="300" stroke="#333" stroke-width="2"/>
  ${rows}
  <text x="110" y="${sigY}" font-family="${PRINT}" font-size="30">Date: </text>
  <text x="210" y="${sigY}" font-family="${HAND}" font-size="38" fill="#1a3c8f">${esc(d.application_date)}</text>
  <rect x="1050" y="${sigY - 70}" width="520" height="120" fill="none" stroke="#555"/>
  <text x="1060" y="${sigY + 80}" font-family="${PRINT}" font-size="24" fill="#555">Signature / thumb impression of applicant</text>
  ${d.signature_present === 'yes' ? `<path d="M1090 ${sigY + 10} c 40 -60, 80 40, 120 -20 s 60 40, 110 -10 s 70 30, 150 -25" stroke="#1a3c8f" stroke-width="4" fill="none"/>` : ''}
  ${watermark(w, h)}
  ${footer(w, h - 60)}
</svg>`;
}

function cardSvg(title: string, lines: [string, string][], opts: { big?: string } = {}): string {
  const w = 1012;
  const h = 638;
  const body = lines
    .map(
      (
        [k, v],
        i,
      ) => `<text x="300" y="${190 + i * 58}" font-family="${PRINT}" font-size="26" fill="#333">${esc(k)}</text>
      <text x="520" y="${190 + i * 58}" font-family="${PRINT}" font-size="28" font-weight="700" fill="#111">${esc(v)}</text>`,
    )
    .join('\n');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
  <rect width="100%" height="100%" rx="28" fill="#f4f6f8"/>
  <rect x="0" y="0" width="${w}" height="100" rx="28" fill="#2c3e50"/>
  <text x="${w / 2}" y="64" font-family="${PRINT}" font-size="34" font-weight="700" fill="#fff" text-anchor="middle">${esc(title)}</text>
  <rect x="50" y="150" width="210" height="260" fill="#d5dbe0" stroke="#95a5a6"/>
  <text x="155" y="290" font-family="${PRINT}" font-size="22" fill="#7f8c8d" text-anchor="middle">PHOTO</text>
  ${body}
  ${opts.big ? `<text x="${w / 2}" y="${h - 80}" font-family="${PRINT}" font-size="46" font-weight="700" letter-spacing="6" text-anchor="middle">${esc(opts.big)}</text>` : ''}
  ${watermark(w, h)}
  ${footer(w, h)}
</svg>`;
}

function passbookSvg(lines: [string, string][]): string {
  const w = 1400;
  const h = 900;
  const body = lines
    .map(
      (
        [k, v],
        i,
      ) => `<text x="90" y="${260 + i * 80}" font-family="${PRINT}" font-size="32" fill="#333">${esc(k)}</text>
      <text x="520" y="${260 + i * 80}" font-family="${PRINT}" font-size="34" font-weight="700" fill="#111">${esc(v)}</text>`,
    )
    .join('\n');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
  <rect width="100%" height="100%" fill="#fffdf6"/>
  <rect x="40" y="40" width="${w - 80}" height="${h - 80}" fill="none" stroke="#6b4f2a" stroke-width="3"/>
  <text x="${w / 2}" y="140" font-family="${PRINT}" font-size="44" font-weight="700" fill="#6b4f2a" text-anchor="middle">SAVINGS BANK PASSBOOK (SPECIMEN)</text>
  ${body}
  ${watermark(w, h)}
  ${footer(w, h - 40)}
</svg>`;
}

const aadhaarNumber = (body11: string) => body11 + verhoeffCheckDigit(body11);
const spaced = (n: string) => `${n.slice(0, 4)} ${n.slice(4, 8)} ${n.slice(8)}`;
const masked = (n: string) => `XXXX XXXX ${n.slice(8)}`;

interface PacketSpec {
  name: string;
  expected_status: string;
  note: string;
  form: FormData;
  aadhaar: { name: string; dob: string; gender: string; number: string; address: string };
  passbook: { holder: string; account: string; ifsc: string; bank: string; branch: string };
  epic?: { name: string; relative: string; number: string; dobOrAge: string };
  name_checks: { a: string; b: string; expected: string }[];
}

function packets(): PacketSpec[] {
  const n1 = aadhaarNumber('23456789012');
  const n2 = aadhaarNumber('34567890123');
  return [
    {
      name: 'example-packet-01',
      expected_status: 'READY',
      note: 'Clean packet: all names, DOBs and bank details agree. Widow aged 78 → priority.',
      form: {
        applicant_name: 'Thokchom Ibemcha Devi',
        father_or_husband_name: 'Late Thokchom Tomba Singh',
        address: 'Wangkhei Ayangpalli, Imphal East',
        district: 'Imphal East',
        category: 'General',
        aadhaar_number: spaced(n1),
        mobile: '9876543210',
        bank_name: 'State Bank of India',
        branch: 'Imphal Main',
        ifsc: 'SBIN0001234',
        account_number: '30123456789',
        date_of_birth: '12/05/1948',
        age: '78',
        annual_income: 'Rs. 24,000/-',
        signature_present: 'yes',
        application_date: '20/09/2026',
        marital_status_if_stated: 'Widow',
        disability_if_stated: 'No',
      },
      aadhaar: {
        name: 'Thokchom Ibemcha Devi',
        dob: '12/05/1948',
        gender: 'Female',
        number: n1,
        address: 'Wangkhei, Imphal East, Manipur 795001',
      },
      passbook: {
        holder: 'THOKCHOM IBEMCHA DEVI',
        account: '30123456789',
        ifsc: 'SBIN0001234',
        bank: 'State Bank of India',
        branch: 'Imphal Main',
      },
      epic: {
        name: 'Thokchom Ibemcha Devi',
        relative: 'Thokchom Tomba Singh',
        number: 'MNP1234567',
        dobOrAge: 'Age as on 01.01.2026: 77',
      },
      name_checks: [
        { a: 'form.jpg:applicant_name', b: 'aadhaar.jpg:name', expected: 'SAME' },
        { a: 'form.jpg:applicant_name', b: 'passbook.jpg:account_holder_name', expected: 'SAME' },
      ],
    },
    {
      name: 'example-packet-02',
      expected_status: 'OFFICER_ATTENTION',
      note: '"Kh." could be Khuraijam, Khwairakpam, Khumanthem … and nothing in the packet disambiguates → officer. No voter ID (optional).',
      form: {
        applicant_name: 'Kh. Loken Singh',
        father_or_husband_name: 'Kh. Ibomcha Singh',
        address: 'Sagolband Tera, Imphal West',
        district: 'Imphal West',
        category: 'OBC',
        aadhaar_number: spaced(n2),
        mobile: '9612345678',
        bank_name: 'Manipur Rural Bank',
        branch: 'Sagolband',
        ifsc: 'MRBA0000123',
        account_number: '41020300456',
        date_of_birth: '03/02/1950',
        age: '76',
        annual_income: 'Rs. 30,000/-',
        signature_present: 'yes',
        application_date: '18/09/2026',
        marital_status_if_stated: 'Married',
        disability_if_stated: 'No',
      },
      aadhaar: {
        name: 'Khuraijam Loken Singh',
        dob: '03/02/1950',
        gender: 'Male',
        number: n2,
        address: 'Sagolband Tera, Imphal West, Manipur 795001',
      },
      passbook: {
        holder: 'KHURAIJAM LOKEN SINGH',
        account: '41020300456',
        ifsc: 'MRBA0000123',
        bank: 'Manipur Rural Bank',
        branch: 'Sagolband',
      },
      name_checks: [{ a: 'form.jpg:applicant_name', b: 'aadhaar.jpg:name', expected: 'AMBIGUOUS' }],
    },
  ];
}

async function writePacket(root: string, p: PacketSpec): Promise<void> {
  const dir = path.join(root, p.name);
  fs.mkdirSync(dir, { recursive: true });
  await render(formSvg(p.form), path.join(dir, 'form.jpg'));
  await render(
    cardSvg(
      'AADHAAR · SPECIMEN · NOT VALID',
      [
        ['Name', p.aadhaar.name],
        ['DOB', p.aadhaar.dob],
        ['Gender', p.aadhaar.gender],
        ['Address', p.aadhaar.address.slice(0, 28)],
      ],
      { big: spaced(p.aadhaar.number) },
    ),
    path.join(dir, 'aadhaar.jpg'),
  );
  await render(
    passbookSvg([
      ['Account holder', p.passbook.holder],
      ['Account No.', p.passbook.account],
      ['IFSC', p.passbook.ifsc],
      ['Bank', p.passbook.bank],
      ['Branch', p.passbook.branch],
    ]),
    path.join(dir, 'passbook.jpg'),
  );
  if (p.epic) {
    await render(
      cardSvg('ELECTOR PHOTO ID · SPECIMEN', [
        ['EPIC No.', p.epic.number],
        ['Name', p.epic.name],
        ["Father's name", p.epic.relative],
        ['', p.epic.dobOrAge],
      ]),
      path.join(dir, 'epic.jpg'),
    );
  }

  const formTruth: Record<string, string | null> = {
    ...p.form,
    aadhaar_number: masked(p.aadhaar.number),
  };
  const truth = {
    _note: `${p.note} SYNTHETIC SPECIMEN DATA. Field values are the exact transcription expected; null = blank on the document. Aadhaar numbers are stored masked only.`,
    expected_status: p.expected_status,
    documents: {
      'form.jpg': { type: 'application_form', fields: formTruth },
      'aadhaar.jpg': {
        type: 'aadhaar',
        fields: {
          name: p.aadhaar.name,
          dob_or_yob: p.aadhaar.dob,
          gender: p.aadhaar.gender,
          aadhaar_number: masked(p.aadhaar.number),
        },
      },
      'passbook.jpg': {
        type: 'bank_passbook',
        fields: {
          account_holder_name: p.passbook.holder,
          account_number: p.passbook.account,
          ifsc: p.passbook.ifsc,
          bank_name: p.passbook.bank,
          branch: p.passbook.branch,
        },
      },
      ...(p.epic
        ? {
            'epic.jpg': {
              type: 'epic',
              fields: {
                name: p.epic.name,
                relative_name: p.epic.relative,
                epic_number: p.epic.number,
                dob_or_age: p.epic.dobOrAge,
              },
            },
          }
        : {}),
    },
    name_checks: p.name_checks,
  };
  fs.writeFileSync(path.join(dir, 'truth.json'), `${JSON.stringify(truth, null, 2)}\n`);
  console.log(`  ${p.name}: ${fs.readdirSync(dir).join(', ')}`);
}

async function main() {
  const { flags } = parseArgs(process.argv.slice(2));
  const out =
    typeof flags.out === 'string' ? fromInvocationDir(flags.out) : path.join(repoRoot, 'eval-data');
  console.log(`Writing SPECIMEN packets to ${out}`);
  for (const p of packets()) await writePacket(out, p);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
