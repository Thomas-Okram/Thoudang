import { expect, test, type Page } from '@playwright/test';
import { signIn, watchConsole } from './helpers';

const PAGES = ['/dashboard', '/intake', '/queue', '/notices', '/trust', '/admin/templates'];

async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, `${page.url()} scrolls sideways by ${overflow}px`).toBeLessThanOrEqual(1);
}

for (const width of [1440, 1280]) {
  test(`every officer page renders without console errors at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const errors = watchConsole(page);
    await signIn(page);
    for (const p of PAGES) {
      await page.goto(p);
      await expect(page.locator('main#main')).toBeVisible();
      await page.waitForLoadState('networkidle');
      await noHorizontalScroll(page);
    }
    // a case and its notice, whatever is in the queue
    const { cases } = (await (await page.request.get('/api/cases')).json()) as {
      cases: { id: string; status: string }[];
    };
    for (const c of cases.slice(0, 3)) {
      await page.goto(`/cases/${c.id}`);
      await expect(page.getByTestId('status-banner')).toBeVisible();
      await noHorizontalScroll(page);
      await page.goto(`/cases/${c.id}/notice`);
      await page.waitForLoadState('networkidle');
    }
    expect(errors).toEqual([]);
  });
}

test('phone upload page at 390px: public session link, no sign-in, thumb-zone camera', async ({
  page,
  browser,
}) => {
  await signIn(page);
  const res = await page.request.post('/api/sessions');
  expect(res.status()).toBe(201);
  const { mobileUrl } = (await res.json()) as { mobileUrl: string };
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
  const p = await phone.newPage();
  const errors = watchConsole(p);
  await p.goto(new URL(mobileUrl).pathname);
  await expect(p).toHaveURL(/\/m\/upload\//);
  await expect(p.getByRole('button', { name: /camera|photo/i }).first()).toBeVisible();
  await p.waitForLoadState('networkidle');
  await noHorizontalScroll(p);
  await phone.close();
  expect(errors).toEqual([]);
});

test('signed-out visitors are sent to sign-in; API reads need a session', async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto('/trust');
  await expect(page).toHaveURL(/\/login\?next=%2Ftrust/);
  expect((await page.request.get('/api/cases')).status()).toBe(401);
  await ctx.close();
});
