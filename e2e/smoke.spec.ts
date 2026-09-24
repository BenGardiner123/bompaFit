import { expect, test } from '@playwright/test';
import { gotoApp, setupHeading, skipSetup } from './helpers';

// The narrowest possible check that the harness itself works: the static export
// is served, the bundle boots, and IndexedDB is empty per test. If this fails,
// nothing else in the suite means anything.

test.describe('harness', () => {
  test('serves the static export and boots the app', async ({ page }) => {
    await gotoApp(page);
    await expect(setupHeading(page)).toBeVisible();
  });

  test('starts every test with an empty database', async ({ page }) => {
    // A leaked context would carry setupComplete across and land on Today
    // instead, which is exactly the pollution that makes suites lie.
    await gotoApp(page);
    await expect(setupHeading(page)).toContainText('Units');
  });

  test('renders the bare app at phone width, with no desktop bezel', async ({ page }) => {
    await gotoApp(page);
    await skipSetup(page);
    // AndroidFrame draws a phone picture only above FRAME_BREAKPOINT (492px).
    // At the 412px test viewport the app must own the whole screen.
    const body = await page.evaluate(() => document.body.getBoundingClientRect().width);
    expect(body).toBeLessThanOrEqual(412);
  });
});
