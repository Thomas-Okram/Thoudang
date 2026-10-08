import crypto from 'node:crypto';
import { computePriority, flagTitle, schemeConfig, type Flag } from '@thoudang/core';
import { eq } from 'drizzle-orm';
import { transaction, type Db } from '../db/client.js';
import { cases, flags as flagsTable } from '../db/schema.js';

/**
 * SYNTHETIC historical cases so the department dashboard looks alive (npm run seed:dashboard).
 * Every record is marked historical=true, reference HIST-…, packet "synthetic-historical", and has
 * no documents or Aadhaar digits (so it can never trigger duplicate detection on live cases).
 */

export const MANIPUR_DISTRICTS = [
  'Bishnupur',
  'Chandel',
  'Churachandpur',
  'Imphal East',
  'Imphal West',
  'Jiribam',
  'Kakching',
  'Kamjong',
  'Kangpokpi',
  'Noney',
  'Pherzawl',
  'Senapati',
  'Tamenglong',
  'Tengnoupal',
  'Thoubal',
  'Ukhrul',
] as const;

const VALLEY = new Set([
  'Bishnupur',
  'Imphal East',
  'Imphal West',
  'Kakching',
  'Thoubal',
  'Jiribam',
]);
const NAGA_HILLS = new Set(['Ukhrul', 'Kamjong', 'Senapati', 'Tamenglong', 'Noney']);

// Rough relative application volumes (valley districts are more populous).
const WEIGHT: Record<string, number> = {
  'Imphal East': 14,
  'Imphal West': 14,
  Thoubal: 11,
  Bishnupur: 9,
  Kakching: 7,
  Churachandpur: 8,
  Senapati: 6,
  Ukhrul: 5,
  Kangpokpi: 5,
  Chandel: 3,
  Tamenglong: 3,
  Jiribam: 3,
  Tengnoupal: 2,
  Noney: 2,
  Kamjong: 2,
  Pherzawl: 2,
};

const NAMES = {
  meiteiYumnak: [
    'Okram',
    'Thokchom',
    'Laishram',
    'Yumnam',
    'Ningthoujam',
    'Huidrom',
    'Sapam',
    'Moirangthem',
    'Wahengbam',
    'Khuraijam',
    'Konthoujam',
    'Oinam',
    'Sagolsem',
    'Haobam',
    'Kshetrimayum',
  ],
  meiteiMale: [
    'Tomba',
    'Ibobi',
    'Ibomcha',
    'Joykumar',
    'Loken',
    'Rameshwor',
    'Biren',
    'Bijoy',
    'Chaoba',
    'Manihar',
  ],
  meiteiFemale: [
    'Ibemcha',
    'Tombi',
    'Memcha',
    'Sanatombi',
    'Phajabati',
    'Ibetombi',
    'Leima',
    'Chaobi',
    'Thoibi',
    'Ongbi',
  ],
  pangal: [
    'Md. Abdul Rahim',
    'Md. Iqbal Hussain',
    'Fatima Begum',
    'Rahima Bibi',
    'Md. Nurul Haque',
    'Md. Ismail Khan',
  ],
  naga: [
    ['Shimray', 'Thotso'],
    ['Keishing', 'Ngashangva'],
    ['Kamei', 'Ramkung'],
    ['Zimik', 'Hormila'],
    ['Panmei', 'Gaikhangam'],
    ['Luithui', 'Somila'],
    ['Hungyo', 'Shangam'],
  ],
  kuki: [
    ['Haokip', 'Thangboi'],
    ['Kipgen', 'Paolen'],
    ['Sitlhou', 'Hoineilhing'],
    ['Guite', 'Vungzagin'],
    ['Baite', 'Nemneilhing'],
    ['Touthang', 'Lhingneikim'],
    ['Hmar', 'Lalremsiami'],
  ],
};

/** Citizen deficiencies weighted by how often they occur in practice (synthetic). */
const DEFICIENCY_WEIGHTS: [string, number][] = [
  ['MISSING_DOCUMENT', 24],
  ['DOB_MISMATCH', 18],
  ['NAME_MISMATCH', 14],
  ['BANK_HOLDER_NAME_MISMATCH', 10],
  ['MISSING_SIGNATURE', 9],
  ['MISSING_FIELD', 9],
  ['IFSC_INVALID', 6],
  ['BANK_DETAILS_MISMATCH', 5],
];

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface HistoricalCase {
  row: typeof cases.$inferInsert;
  flags: (typeof flagsTable.$inferInsert)[];
}

export function generateHistoricalCases(
  count: number,
  seed = 2026,
  now = new Date(),
): HistoricalCase[] {
  const rand = mulberry32(seed);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)]!;
  const weighted = <T>(pairs: [T, number][]): T => {
    const total = pairs.reduce((s, [, w]) => s + w, 0);
    let r = rand() * total;
    for (const [v, w] of pairs) if ((r -= w) <= 0) return v;
    return pairs[0]![0];
  };
  const districts = MANIPUR_DISTRICTS.map((d) => [d, WEIGHT[d] ?? 2] as [string, number]);
  const out: HistoricalCase[] = [];

  for (let i = 0; i < count; i++) {
    const district = weighted(districts);
    const female = rand() < 0.55;
    let name: string;
    if (VALLEY.has(district)) {
      if (rand() < 0.1) name = pick(NAMES.pangal);
      else
        name = `${pick(NAMES.meiteiYumnak)} ${female ? pick(NAMES.meiteiFemale) : pick(NAMES.meiteiMale)} ${female ? (rand() < 0.5 ? 'Devi' : 'Chanu') : 'Singh'}`;
    } else {
      const [clan, given] =
        NAGA_HILLS.has(district) || (district === 'Chandel' && rand() < 0.5)
          ? pick(NAMES.naga)
          : pick(NAMES.kuki);
      name = rand() < 0.5 ? `${given} ${clan}` : `${clan} ${given}`;
    }

    const daysAgo = Math.floor(rand() * 150);
    const receivedAt = new Date(
      now.getTime() - daysAgo * 86_400_000 - Math.floor(rand() * 8) * 3_600_000,
    );
    const screenedAt = new Date(receivedAt.getTime() + 15_000 + Math.floor(rand() * 75_000));
    const birthYear = 1934 + Math.floor(rand() * 32); // 60–92 years old
    const dob = `${birthYear}-${String(1 + Math.floor(rand() * 12)).padStart(2, '0')}-${String(1 + Math.floor(rand() * 28)).padStart(2, '0')}`;
    const age = now.getFullYear() - birthYear;
    const widowed = female && rand() < 0.38;
    const disability = rand() < 0.08;
    const displaced = VALLEY.has(district)
      ? rand() < 0.12
      : district === 'Churachandpur' || district === 'Kangpokpi'
        ? rand() < 0.15
        : false;

    const firstStatus = weighted<'READY' | 'NEEDS_CITIZEN_CORRECTION' | 'OFFICER_ATTENTION'>([
      ['READY', 52],
      ['NEEDS_CITIZEN_CORRECTION', 33],
      ['OFFICER_ATTENTION', 15],
    ]);
    // Older applications have mostly been decided by now.
    const approvedChance = daysAgo > 60 ? 0.85 : daysAgo > 30 ? 0.55 : 0.15;
    const status =
      firstStatus === 'READY' && rand() < approvedChance + 0.1
        ? 'APPROVED_BY_OFFICER'
        : rand() < approvedChance * 0.6
          ? 'APPROVED_BY_OFFICER'
          : firstStatus;

    const priority = computePriority(
      {
        age,
        widowed,
        disability,
        internallyDisplaced: displaced,
        daysPending: status === 'APPROVED_BY_OFFICER' ? 0 : daysAgo,
      },
      schemeConfig.priority,
    );
    const id = crypto.randomUUID();
    const flags: HistoricalCase['flags'] = [];
    if (firstStatus === 'NEEDS_CITIZEN_CORRECTION') {
      const n = 1 + (rand() < 0.35 ? 1 : 0);
      for (let k = 0; k < n; k++) {
        const code = weighted(DEFICIENCY_WEIGHTS);
        const flag: Flag = {
          code,
          severity: 'critical',
          action: 'citizen',
          reason: `${flagTitle(code)} (synthetic historical record)`,
          evidence: [{ document: 'form', field: 'document', value: null }],
        };
        flags.push({
          id: crypto.randomUUID(),
          caseId: id,
          ...flag,
          // Real deficiency (accepted); on approved cases the citizen has since corrected it.
          resolution: status === 'APPROVED_BY_OFFICER' ? 'ACCEPTED' : 'OPEN',
          resolutionReason:
            status === 'APPROVED_BY_OFFICER' ? 'Corrected by citizen (synthetic)' : null,
        });
      }
    }
    if (firstStatus === 'OFFICER_ATTENTION') {
      flags.push({
        id: crypto.randomUUID(),
        caseId: id,
        code: 'NAME_AMBIGUOUS',
        severity: 'warn',
        action: 'officer',
        reason: 'Name needs confirmation (synthetic historical record)',
        evidence: [{ document: 'form', field: 'applicantName', value: null }],
        resolution: status === 'APPROVED_BY_OFFICER' ? 'ACCEPTED' : 'OPEN',
      });
    }

    out.push({
      row: {
        id,
        reference: `HIST-2026-${String(i + 1).padStart(4, '0')}`,
        applicantName: name,
        district,
        status,
        processingState: 'SCREENED',
        priorityScore: priority.score,
        priorityReasons: priority.reasons,
        aadhaarLast4: null,
        applicantDob: dob,
        source: 'batch',
        packetName: 'synthetic-historical',
        historical: true,
        receivedAt,
        screenedAt,
        firstScreenStatus: firstStatus,
        noticeSentAt:
          firstStatus === 'NEEDS_CITIZEN_CORRECTION' && rand() < 0.8
            ? new Date(screenedAt.getTime() + 86_400_000)
            : null,
        decidedAt:
          status === 'APPROVED_BY_OFFICER'
            ? new Date(receivedAt.getTime() + (3 + Math.floor(rand() * 20)) * 86_400_000)
            : null,
        decidedBy: status === 'APPROVED_BY_OFFICER' ? 'dswo-imphal-west' : null,
        createdAt: receivedAt,
        updatedAt: screenedAt,
      },
      flags,
    });
  }
  return out;
}

/** Replaces all historical cases (idempotent). Returns how many were written. */
export async function seedHistorical(
  db: Db,
  count = 400,
  seed = 2026,
  now = new Date(),
): Promise<number> {
  const data = generateHistoricalCases(count, seed, now);
  await transaction(db, async (tx) => {
    await tx.delete(cases).where(eq(cases.historical, true));
    for (const c of data) {
      await tx.insert(cases).values(c.row);
      for (const f of c.flags) await tx.insert(flagsTable).values(f);
    }
  });
  return data.length;
}
