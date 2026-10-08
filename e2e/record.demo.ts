import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { ROOT, beat, screenPacket, signIn } from './helpers';

/**
 * npm run demo:record → demo-recording/thoudang-demo.webm (1440×900, human pace, fixtures mode).
 * Backup video for the stage: same story as docs/pitch/SCRIPT.md. Not part of `npm run e2e`.
 */
const OUT = path.join(ROOT, 'demo-recording/thoudang-demo.webm');

/** Playwright videos have no mouse pointer — draw one that glides to each click. */
const CURSOR = `
  addEventListener('DOMContentLoaded', () => {
    const c = document.createElement('div');
    c.id = '__cursor';
    Object.assign(c.style, {
      position: 'fixed', left: '0', top: '0', width: '22px', height: '22px', zIndex: '2147483647',
      pointerEvents: 'none', borderRadius: '50%', background: 'rgba(15,158,142,.35)',
      border: '2px solid #0b7a6e', transform: 'translate(-50%,-50%)',
      transition: 'left .45s cubic-bezier(.2,.8,.2,1), top .45s cubic-bezier(.2,.8,.2,1), width .15s, height .15s',
    });
    document.body.appendChild(c);
    addEventListener('mousemove', (e) => { c.style.left = e.clientX + 'px'; c.style.top = e.clientY + 'px'; }, true);
    addEventListener('mousedown', () => { c.style.width = '14px'; c.style.height = '14px'; }, true);
    addEventListener('mouseup', () => { c.style.width = '22px'; c.style.height = '22px'; }, true);
  });
`;

async function glide(page: Page, target: Locator) {
  const box = await target.boundingBox();
  if (box) {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 18 });
    await page.waitForTimeout(350);
  }
}
async function press(page: Page, target: Locator, pause = 700) {
  await target.scrollIntoViewIfNeeded();
  await glide(page, target);
  await target.click();
  await page.waitForTimeout(pause);
}
async function scrollBy(page: Page, total: number, step = 120) {
  for (let y = 0; y < total; y += step) {
    await page.mouse.wheel(0, step);
    await page.waitForTimeout(140);
  }
}

test('record the demo', async ({ page }) => {
  await page.addInitScript(CURSOR);

  // 0. Sign in
  await signIn(page);
  await beat(page, 1200);
  await press(page, page.getByRole('switch'), 900); // Presentation mode for the projector

  // 1. Hero: "L. Tomba Meitei" — resolved by the father's full yumnak on the form
  await screenPacket(page, 'demo-07-tomba-l-resolved-by-father', [
    'form.jpg',
    'aadhaar.jpg',
    'passbook.jpg',
  ]);
  await expect(page.getByTestId('status-banner')).toContainText(/ready/i);
  await beat(page, 2000);
  const identity = page.getByRole('region', { name: 'Identity across documents' });
  await identity.scrollIntoViewIfNeeded();
  await beat(page, 2500);
  for (const name of await page.getByTestId('name-as-written').all()) {
    await glide(page, name);
    await beat(page, 1300);
  }
  await glide(page, identity.getByText(/Relative.s full yumnak/));
  await beat(page, 3000);

  // 2. "Kh. Loken Singh" — ambiguous, so it goes to an officer
  await screenPacket(page, 'demo-04-kh-loken-ambiguous', [
    'form.jpg',
    'aadhaar.jpg',
    'passbook.jpg',
  ]);
  await expect(page.getByTestId('status-banner')).toContainText(/officer attention/i);
  await beat(page, 2000);
  const pair = page.getByTestId('identity-pair').first();
  await pair.scrollIntoViewIfNeeded();
  await glide(page, pair.getByLabel('Candidate yumnaks'));
  await beat(page, 3500);

  const flag = page.getByTestId('flag').filter({ hasText: /Kh\./ }).first();
  await press(page, flag, 2500); // spotlight on the document
  await press(page, flag.getByRole('button', { name: 'Override' }), 900);
  const dialog = page.getByRole('dialog');
  await press(page, dialog.getByRole('radio').first(), 500);
  await dialog
    .getByRole('textbox')
    .pressSequentially('Verified the yumnak with the applicant in person.', { delay: 35 });
  await beat(page, 600);
  await press(page, dialog.getByRole('button', { name: 'Override flag' }), 1800);

  const row = page.getByTestId('field-applicant_name').first();
  await press(page, row.getByRole('button', { name: 'Edit' }), 700);
  const form = page
    .locator('form')
    .filter({ has: page.getByRole('button', { name: 'Save & re-check' }) });
  await form.getByRole('textbox').first().fill('');
  await form.getByRole('textbox').first().pressSequentially('Khuraijam Loken Singh', { delay: 45 });
  await form.getByRole('textbox').nth(1).pressSequentially('Full yumnak on the Aadhaar card.', {
    delay: 30,
  });
  await press(page, form.getByRole('button', { name: 'Save & re-check' }), 1500);
  await expect(page.getByTestId('status-banner')).toContainText(/ready/i);
  await page.getByTestId('status-banner').scrollIntoViewIfNeeded();
  await beat(page, 2500);
  await press(page, page.getByRole('button', { name: 'Approve for sanction' }), 2500);
  await expect(page.getByTestId('status-banner')).toContainText(/approved/i);

  // 3. A citizen-correction packet → queue → notice in three scripts → print → status page
  const dobCase = await screenPacket(page, 'demo-05-dob-mismatch', [
    'form.jpg',
    'aadhaar.jpg',
    'passbook.jpg',
  ]);
  await beat(page, 2000);
  await page.goto('/queue');
  await beat(page, 3500);
  await page.goto(`/cases/${dobCase}/notice`);
  await expect(page.getByTestId('notice-document')).toBeVisible();
  await beat(page, 2000);
  for (const tab of ['English', 'ꯃꯤꯇꯩ ꯃꯌꯦꯛ', 'বাংলা লিপি', 'All three']) {
    await press(page, page.getByRole('tab', { name: tab }), 2200);
  }
  await scrollBy(page, 900);
  await beat(page, 1500);
  await page.emulateMedia({ media: 'print' });
  await page.evaluate(() => window.scrollTo(0, 0));
  await beat(page, 3500); // the A4 print view
  await page.emulateMedia({ media: 'screen' });
  const status = (await page
    .getByTestId('notice-document')
    .getByText(/\/s\//)
    .first()
    .textContent())!.trim();
  await page.goto(new URL(status).pathname + new URL(status).search);
  await expect(page.getByTestId('public-status')).toBeVisible();
  await beat(page, 3500);

  // 4. Trust Report and dashboard
  await page.goto('/trust');
  await beat(page, 2000);
  await page.getByTestId('fairness-holdout').scrollIntoViewIfNeeded();
  await beat(page, 4500);
  await scrollBy(page, 1400);
  await beat(page, 2500);
  await page.goto('/dashboard');
  await beat(page, 4000);

  const video = page.video();
  await page.close();
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  await video!.saveAs(OUT);
});
