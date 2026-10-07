import { expect, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { E2E_CHAIN_ENV, ROOT, screenPacket, signIn, watchConsole } from './helpers';

/**
 * The full stage demo, in fixtures mode (no API keys): one ordered story on one server.
 * Kh. Loken Singh (ambiguous) → override + field edit → approve; a DOB-mismatch packet arrives
 * live in the queue → citizen notice in three scripts → print → citizen status page →
 * Trust Report → dashboard. Any browser console error fails the run.
 */
test('full demo path', async ({ page, context }) => {
  const errors = watchConsole(page);

  await test.step('sign in: pick officer → 4-digit PIN', async () => {
    await signIn(page);
  });

  const khCase = await test.step('intake with labelled slots → live progress → case', () =>
    screenPacket(page, 'demo-04-kh-loken-ambiguous', ['form.jpg', 'aadhaar.jpg', 'passbook.jpg']));

  await test.step('case view: officer attention, Kh. is ambiguous', async () => {
    await expect(page.getByTestId('status-banner')).toContainText(/officer attention/i);
    await expect(page.getByText('Fixture data (no AI)').first()).toBeVisible();
    const pairs = page.getByTestId('identity-pair');
    await expect(pairs).toHaveCount(3);
    await expect(pairs.first().locator('[data-verdict]')).toHaveAttribute(
      'data-verdict',
      'AMBIGUOUS',
    );
    await expect(pairs.first().getByTestId('pair-headline')).toHaveText(
      'Unclear — an officer should check before deciding.',
    );
    await expect(pairs.first().getByLabel('Candidate yumnaks')).toContainText('Khuraijam');
  });

  await test.step('clicking a flag highlights its evidence on the document', async () => {
    const flag = page.getByTestId('flag').filter({ hasText: /Kh\./ }).first();
    await flag.click();
    await expect(page.getByTestId('bbox-highlight').first()).toBeVisible();
  });

  await test.step('override a flag with a reason', async () => {
    const flag = page.getByTestId('flag').filter({ hasText: /Kh\./ }).first();
    await flag.getByRole('button', { name: 'Override' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('radio').first().check();
    await dialog.getByRole('textbox').fill('Verified the yumnak with the applicant in person.');
    await dialog.getByRole('button', { name: 'Override flag' }).click();
    await expect(dialog).toBeHidden();
    await expect(
      page
        .getByTestId('flag')
        .filter({ hasText: /overridden/i })
        .first(),
    ).toBeVisible();
  });

  await test.step('field edit re-runs the rules (no AI call)', async () => {
    const row = page.getByTestId('field-applicant_name').first();
    await row.getByRole('button', { name: 'Edit' }).click();
    const form = page
      .locator('form')
      .filter({ has: page.getByRole('button', { name: 'Save & re-check' }) });
    await form.getByRole('textbox').first().fill('Khuraijam Loken Singh');
    await form.getByRole('textbox').nth(1).fill('Full yumnak confirmed from the Aadhaar card.');
    await form.getByRole('button', { name: 'Save & re-check' }).click();
    await expect(form).toBeHidden();
    await expect(page.getByTestId('status-banner')).toContainText(/ready/i);
    await expect(
      page.getByTestId('identity-pair').first().locator('[data-verdict]'),
    ).toHaveAttribute('data-verdict', /SAME/);
  });

  await test.step('DSWO approves', async () => {
    const approve = page.getByRole('button', { name: 'Approve for sanction' });
    await expect(approve).toBeEnabled();
    await approve.click();
    await expect(page.getByTestId('status-banner')).toContainText(/approved/i);
  });

  const dobCase = await test.step('queue updates live when a new packet is screened', async () => {
    await page.goto('/queue');
    const citizenColumn = page.getByLabel('Needs citizen correction', { exact: true });
    await expect(citizenColumn).toBeVisible();
    const before = await citizenColumn.getByTestId('queue-card').count();

    const desk = await context.newPage();
    const deskErrors = watchConsole(desk);
    const id = await screenPacket(desk, 'demo-05-dob-mismatch', [
      'form.jpg',
      'aadhaar.jpg',
      'passbook.jpg',
    ]);
    await expect(desk.getByTestId('status-banner')).toContainText(/citizen correction/i);
    await desk.close();
    expect(deskErrors).toEqual([]);

    await expect(citizenColumn.getByTestId('queue-card')).toHaveCount(before + 1);
    await expect(citizenColumn).toContainText('Gaikhangam Dangmei');
    expect(khCase).not.toBe(id);
    return id;
  });

  const statusUrl = await test.step('notice in all three scripts', async () => {
    await page.goto(`/cases/${dobCase}/notice`);
    const doc = page.getByTestId('notice-document');
    await expect(doc).toBeVisible();
    await expect(page.getByTestId('notice-items')).toContainText(/birth/i);
    await page.getByRole('tab', { name: 'English' }).click();
    await expect(doc.locator('.font-mtei')).toHaveCount(0);
    await page.getByRole('tab', { name: 'ꯃꯤꯇꯩ ꯃꯌꯦꯛ' }).click();
    await expect(doc.locator('.font-mtei').first()).toBeVisible();
    await page.getByRole('tab', { name: 'বাংলা লিপি' }).click();
    await expect(doc.locator('.font-beng').first()).toBeVisible();
    await page.getByRole('tab', { name: 'All three' }).click();
    await expect(doc.locator('.font-mtei').first()).toBeVisible();
    await expect(doc.locator('.font-beng').first()).toBeVisible();
    await expect(page.getByTestId('audio-unavailable')).toBeVisible();
    const url = (await doc.getByText(/\/s\//).first().textContent())!.trim();
    expect(url).toMatch(/\/s\/[^?]+\?k=/);
    return url;
  });

  await test.step('print view (A4)', async () => {
    await page.evaluate(() => {
      (window as unknown as { __printed: number }).__printed = 0;
      window.print = () => {
        (window as unknown as { __printed: number }).__printed += 1;
      };
    });
    await page.getByRole('button', { name: 'Print (A4)' }).click();
    expect(await page.evaluate(() => (window as unknown as { __printed: number }).__printed)).toBe(
      1,
    );
    await page.emulateMedia({ media: 'print' });
    await expect(page.getByTestId('notice-document')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Print (A4)' })).toBeHidden();
    await expect(page.locator('aside')).toBeHidden();
    await page.emulateMedia({ media: 'screen' });
  });

  await test.step('citizen status page (public, no sign-in)', async () => {
    const citizen = await context.browser()!.newContext({ viewport: { width: 390, height: 844 } });
    const phone = await citizen.newPage();
    const phoneErrors = watchConsole(phone);
    await phone.goto(new URL(statusUrl).pathname + new URL(statusUrl).search);
    await expect(phone.getByTestId('public-status')).toBeVisible();
    await expect(phone.getByTestId('public-status')).toContainText(/correction/i);
    await expect(phone.getByText('Gaikhangam Dangmei')).toHaveCount(0); // first name only
    await citizen.close();
    expect(phoneErrors).toEqual([]);
  });

  await test.step('Trust Report: false matches first, safeguards', async () => {
    await page.goto('/trust');
    const holdout = page.getByTestId('fairness-holdout');
    await expect(holdout).toBeVisible();
    await expect(holdout.getByText('False matches').first()).toBeVisible();
    await expect(page.getByTestId('fairness-dev')).toBeVisible();
  });

  await test.step('Aadhaar leak scan over DB, logs and live API responses = 0 findings', async () => {
    await page.goto('/trust');
    const [res] = await Promise.all([
      page.waitForResponse((r) => r.url().endsWith('/api/trust/leak-scan')),
      page.getByRole('button', { name: /leak scan/i }).click(),
    ]);
    const scan = (await res.json()) as {
      clean: boolean;
      findings: unknown[];
      scanned: { dbRows: number };
    };
    expect(scan.findings).toEqual([]);
    expect(scan.clean).toBe(true);
    expect(scan.scanned.dbRows).toBeGreaterThan(100);
  });

  await test.step('audit hash chain verifies (npm run audit:verify)', async () => {
    const out = execFileSync(
      path.join(ROOT, 'node_modules/.bin/tsx'),
      [path.join(ROOT, 'apps/api/src/security/audit-verify.ts')],
      {
        cwd: path.join(ROOT, 'apps/api'),
        env: { ...process.env, ...E2E_CHAIN_ENV },
        encoding: 'utf8',
      },
    );
    expect(out).toContain('OK — audit hash chain intact');
  });

  await test.step('department dashboard', async () => {
    await page.goto('/dashboard');
    await expect(page.getByTestId('stat-tile').first()).toBeVisible();
  });

  expect(errors).toEqual([]);
});
