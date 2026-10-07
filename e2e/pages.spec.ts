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

for (const width of [1440, 1280]) {
  test(`header groups never overlap at ${width}px, normal and Presentation mode`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height: 900 });
    await signIn(page);
    await page.goto('/cases');
    for (const presentation of [false, true]) {
      const toggle = page.getByRole('switch');
      if ((await toggle.getAttribute('aria-checked')) !== String(presentation))
        await toggle.click();
      await page.waitForTimeout(300); // font-size transition
      // Right edge of anything visible in the left group (an overflowing badge counts) vs the
      // left edge of the right group.
      const gap = await page.evaluate(() => {
        const bar = document.querySelector('main#main > div')!;
        const [left, right] = [...bar.children] as HTMLElement[];
        const edge = Math.max(
          ...[left!, ...left!.querySelectorAll<HTMLElement>('*')]
            .filter((el) => el.offsetParent !== null || el === left)
            .map((el) => el.getBoundingClientRect())
            .filter((r) => r.width > 0 && r.height > 0)
            .map((r) => r.right),
        );
        return right!.getBoundingClientRect().left - edge;
      });
      expect(gap, `presentation=${presentation}`).toBeGreaterThanOrEqual(0);
      await page.screenshot({
        path: info.outputPath(`header-${width}-${presentation ? 'presentation' : 'normal'}.png`),
        clip: { x: 0, y: 0, width, height: 120 },
      });
    }
    await page.getByRole('switch').click(); // leave it off for other tests
  });
}
