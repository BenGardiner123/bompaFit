import { expect, test } from '@playwright/test';
import { completeSetup, goToTab, gotoApp, setupHeading, skipRest } from './helpers';

// The app must work offline — people train in basements. This is the check that cannot be done in
// jsdom at all — there is no service worker there — and it is the reason the
// suite runs against the real static export rather than `next dev`, where the
// worker deliberately never registers.

test.describe('offline', () => {
  test('registers a service worker', async ({ page }) => {
    await gotoApp(page);
    const registered = await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.ready;
      return Boolean(registration.active || registration.installing || registration.waiting);
    });
    expect(registered).toBe(true);
  });

  test('reloads and runs with the network cut', async ({ page, context }) => {
    await gotoApp(page);
    await completeSetup(page);

    // Wait for the worker to be in control, or the reload races it and fetches
    // from a network that is about to disappear.
    await page.evaluate(() => navigator.serviceWorker.ready);
    await context.setOffline(true);

    await page.reload();

    // The tab bar alone proves nothing: it is in the prerendered HTML, so it
    // paints even when every script request fails. The placeholder clearing
    // needs the app to hydrate and read IndexedDB, and switching tabs needs a
    // live click handler — neither can happen without the JavaScript.
    await expect(page.getByText('BOMPA', { exact: true })).toBeHidden({ timeout: 20_000 });
    await goToTab(page, 'History');
    await goToTab(page, 'Plan');
  });

  test('a cold offline start works after a single online visit', async ({ page, context }) => {
    // The first visit is the whole story. The browser fetches the app's
    // scripts before the worker controls the page, so anything the worker
    // does not save at install is never saved at all.
    await gotoApp(page);
    await page.evaluate(() => navigator.serviceWorker.ready);
    await context.setOffline(true);

    await page.reload();
    await expect(page.getByText('BOMPA', { exact: true })).toBeHidden({ timeout: 20_000 });
    await expect(setupHeading(page)).toBeVisible();
  });

  test('a set logged offline is still there after coming back online', async ({ page, context }) => {
    await gotoApp(page);
    await completeSetup(page);
    await page.evaluate(() => navigator.serviceWorker.ready);

    await context.setOffline(true);

    await goToTab(page, 'Today');
    await page.getByRole('button', { name: /^(Start .+|Train anyway)$/ }).click();
    await goToTab(page, 'Train');
    await page.getByRole('button', { name: 'Log set' }).click();
    await skipRest(page);
    await expect(page.getByRole('button', { name: /^Edit set 1\b/ })).toBeVisible();

    // IndexedDB is local, so this must survive regardless of the network.
    await context.setOffline(false);
    await page.reload();
    await goToTab(page, 'Train');
    await expect(page.getByRole('button', { name: /^Edit set 1\b/ })).toBeVisible();
  });
});
