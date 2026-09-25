import { expect, test } from '@playwright/test';
import { completeSetup, goToTab, gotoApp } from './helpers';
import { TEST_CUE_STEP, serveTestCues } from './test-cues';

// The ingested movement library.
//
// Everything here is about the half of the feature that cannot be checked in
// jsdom: the cue file is fetched over HTTP at runtime and precached by the
// service worker, and neither of those exists outside a real browser against
// the real static export.

/** In Free Exercise DB, and deliberately not one of the hand-written 14. */
const INGESTED_LIFT = 'Pullups';

/** Open the How-to sheet for whichever lift the logger is currently on. */
async function openHowTo(page: import('@playwright/test').Page) {
  await goToTab(page, 'Train');
  await page.getByRole('button', { name: 'How to' }).click();
  return page.getByRole('dialog', { name: /^How to perform / });
}

test.describe('the movement library', () => {
  test('search reaches movements far outside the seeded fourteen', async ({ page }) => {
    await gotoApp(page);
    await expect(page.getByText(/^Step \d+ of \d+ · /)).toBeVisible();

    // Straight to step 3, where a workout gets built.
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await page.getByRole('button', { name: '+ New workout' }).click();
    await page.getByRole('dialog', { name: /^Edit / }).getByRole('button', { name: '+ Add a lift' }).click();

    const picker = page.getByRole('dialog', { name: 'Add a lift' });
    const search = picker.getByPlaceholder('Search by name, muscle or equipment');

    // A movement the seeded library never had. This search returned "Nothing
    // matches" until the dataset landed.
    await search.fill(INGESTED_LIFT);
    await expect(picker.getByRole('button', { name: new RegExp(INGESTED_LIFT, 'i') }).first()).toBeVisible();

    // Searching by equipment reaches movements no seeded entry could offer.
    await search.fill('kettlebell');
    await expect(picker.getByRole('button', { name: /kettlebell/i }).first()).toBeVisible();

    // The excluded categories are genuinely absent, not merely unlikely.
    await search.fill('stretch');
    await expect(picker.getByText(/Nothing matches/)).toBeVisible();
  });

  test('an ingested movement fetches its cues on demand', async ({ page, context }) => {
    await serveTestCues(context);
    await gotoApp(page);
    await completeSetup(page, { workouts: [[INGESTED_LIFT]] });

    await goToTab(page, 'Today');
    await page.getByRole('button', { name: /^(Start .+|Train anyway)$/ }).click();

    const sheet = await openHowTo(page);
    await expect(sheet).toBeVisible();

    // Execution steps come from the cue file fetched at runtime, so seeing the
    // served step at all is the proof the on-demand load works end to end.
    await expect(sheet.getByText('Execution')).toBeVisible({ timeout: 10_000 });
    await expect(sheet.getByText(TEST_CUE_STEP)).toBeVisible();
    await expect(sheet.getByText('Loading cues…')).toBeHidden();

    // The dataset carries no common fault, so the block is absent
    // rather than filled with something invented.
    await expect(sheet.getByText('Common fault')).toBeHidden();
  });

  test('cues render offline for a movement never opened online', async ({ page, context }) => {
    await serveTestCues(context);
    await gotoApp(page);
    await completeSetup(page, { workouts: [[INGESTED_LIFT]] });

    // No reload: a cold offline start is offline.spec.ts's job. This covers the
    // part the library is responsible for, which is the cue file being there.
    await page.evaluate(() => navigator.serviceWorker.ready);

    // Precached at install, before anything asked for it. This is the assertion
    // that actually distinguishes the precache list from the stale-while-revalidate
    // strategy, which would have cached nothing at this point. caches.match
    // searches every cache, because the cache name changes with each build.
    const precached = await page.evaluate(async () => Boolean(await caches.match('/howtos.json')));
    expect(precached).toBe(true);

    await context.setOffline(true);

    await goToTab(page, 'Today');
    await page.getByRole('button', { name: /^(Start .+|Train anyway)$/ }).click();

    // This sheet has never been opened, so the cue file has never been fetched
    // by the app. With the network gone it can only come from the cache.
    const sheet = await openHowTo(page);
    await expect(sheet.getByText('Execution')).toBeVisible({ timeout: 20_000 });
    await expect(sheet.getByText(TEST_CUE_STEP)).toBeVisible();
  });

  test('the bundled library is not copied into IndexedDB', async ({ page }) => {
    await gotoApp(page);
    await completeSetup(page, { workouts: [[INGESTED_LIFT]] });

    const stored = await page.evaluate(async () => {
      const open = indexedDB.open('bompa');
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        open.onsuccess = () => resolve(open.result);
        open.onerror = () => reject(open.error);
      });
      return new Promise<number>((resolve, reject) => {
        const request = database.transaction('exercises').objectStore('exercises').count();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    });

    // Shipped content versions with the app. That table is for movements the
    // user invents, and nothing has invented one yet.
    expect(stored).toBe(0);
  });
});
