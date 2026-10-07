import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, type ConsoleMessage, type Page } from '@playwright/test';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const PACKETS = path.join(ROOT, 'demo-packets');
/** Must match e2e/server.ts — lets `audit:verify` check the E2E database. */
export const E2E_CHAIN_ENV = {
  DB_PATH: path.join(ROOT, 'e2e/.data/e2e.db'),
  AUDIT_CHAIN_KEY: 'e2e-audit-chain-key',
};

export const SLOT_OF: Record<string, string> = {
  'form.jpg': 'application_form',
  'aadhaar.jpg': 'aadhaar',
  'passbook.jpg': 'bank_passbook',
  'epic.jpg': 'epic',
};

/** Pause for the recording (no-op in the E2E run). */
export const beat = (page: Page, ms: number) =>
  process.env.DEMO_RECORD === '1' ? page.waitForTimeout(ms) : Promise.resolve();

/** Collects console errors / page errors so a test can assert there were none. */
export function watchConsole(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m: ConsoleMessage) => {
    if (m.type() === 'error') errors.push(`${page.url()} → ${m.text()}`);
  });
  page.on('pageerror', (e) => errors.push(`${page.url()} → ${e.message}`));
  return errors;
}

export async function signIn(page: Page, officerId = 'dswo-imphal-west', pin = '2468') {
  await page.goto('/queue');
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByRole('heading', { name: 'Who is signing in?' })).toBeVisible();
  await beat(page, 900);
  await page.getByTestId(`login-officer-${officerId}`).click();
  await beat(page, 500);
  for (const d of pin) {
    await page.getByTestId('pin-input').press(d);
    await beat(page, 220);
  }
  await expect(page).toHaveURL(/\/queue/);
  await expect(page.getByTestId('signed-in-officer')).toBeVisible();
}

/** Intake → labelled slots → Screen application → wait for the paced stepper → Open case. */
export async function screenPacket(page: Page, folder: string, files: string[]) {
  await page.goto('/intake');
  await expect(page.getByTestId('slot-board')).toBeVisible();
  for (const f of files) {
    const slot = page.getByTestId(`slot-${SLOT_OF[f]}`);
    await slot.locator('input[type=file]').setInputFiles(path.join(PACKETS, folder, f));
    await expect(slot.getByRole('button', { name: /^Remove / })).toBeVisible();
    await beat(page, 450);
  }
  await page.getByRole('button', { name: 'Screen application' }).click();
  const progress = page
    .getByRole('region', { name: 'Screening progress' })
    .or(page.locator('section[aria-labelledby="progress-title"]'));
  await expect(progress.first()).toBeVisible();
  const open = page.getByRole('link', { name: 'Open case' }).first();
  await expect(open).toBeVisible({ timeout: 45_000 });
  await beat(page, 1500);
  await open.click();
  await expect(page).toHaveURL(/\/cases\/[\w-]+$/);
  return page.url().split('/').pop()!;
}
