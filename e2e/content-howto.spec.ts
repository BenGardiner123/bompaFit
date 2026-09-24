import { expect, test, type Page } from '@playwright/test';
import { WGER, connectWger, fakeWger, reviewSheet, wgerBenchPress } from './content-fakes';
import { completeSetup, goToTab, gotoApp } from './helpers';
import { testCuesBody } from './test-cues';

// The How-to sheet and the exercise-content services it can draw on. Nothing
// here touches a real network: every other site is a made-up host, answered or
// refused by the test itself.

const SEEDED_LIFT = 'Bench Press';
/** Its cues come only from the app's own cue file, which one test takes away. */
const INGESTED_LIFT = 'Pullups';

async function startWorkoutWith(page: Page, lift: string) {
  await gotoApp(page);
  await completeSetup(page, { workouts: [[lift]] });
  await goToTab(page, 'Today');
  await page.getByRole('button', { name: /^(Start workout|Train anyway)$/ }).click();
}

async function openHowTo(page: Page) {
  await goToTab(page, 'Train');
  await page.getByRole('button', { name: 'How to' }).click();
  const sheet = page.getByRole('dialog', { name: /^How to perform / });
  await expect(sheet).toBeVisible();
  return sheet;
}

/** Every request the page makes to somewhere other than the app itself. */
function recordCrossOrigin(page: Page, baseURL: string) {
  const origin = new URL(baseURL).origin;
  const seen: string[] = [];
  page.on('request', (request) => {
    const url = request.url();
    if (/^https?:/.test(url) && new URL(url).origin !== origin) seen.push(url);
  });
  return seen;
}

/** Page errors and console errors, the signs of a late update after the sheet has gone. */
function recordErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  return errors;
}

test.describe('How-to sheet and content services', () => {
  test('with no service connected, opening How-to asks no other site for anything', async ({ page, baseURL }) => {
    const crossOrigin = recordCrossOrigin(page, baseURL!);
    await startWorkoutWith(page, SEEDED_LIFT);

    const sheet = await openHowTo(page);
    await expect(sheet.getByText('Execution')).toBeVisible();
    await expect(sheet.getByText('Cues written for Bompa · CC0')).toBeVisible();
    await expect(sheet.getByText('OFFLINE', { exact: true })).toBeVisible();

    // Long enough for any background lookup to have started.
    await page.waitForTimeout(500);
    expect(crossOrigin).toEqual([]);
  });

  test('offline with nothing saved, it ends in a sentence rather than loading forever', async ({ page, context }) => {
    await startWorkoutWith(page, INGESTED_LIFT);
    await page.evaluate(() => navigator.serviceWorker.ready);

    // Take the cue file out of every cache, then the network away, so the one
    // place this movement's cues could come from is gone.
    await page.evaluate(async () => {
      for (const name of await caches.keys()) {
        const cache = await caches.open(name);
        for (const request of await cache.keys()) {
          if (new URL(request.url).pathname === '/howtos.json') await cache.delete(request);
        }
      }
    });
    await context.setOffline(true);

    const opened = Date.now();
    const sheet = await openHowTo(page);
    await expect(sheet.getByText(/No instructions for this movement are available right now/)).toBeVisible({ timeout: 8_500 });
    expect(Date.now() - opened).toBeLessThan(8_500);
    await expect(sheet.getByText('Loading cues…')).toBeHidden();
  });

  test('closing the sheet while it is still looking causes no errors', async ({ page }) => {
    const errors = recordErrors(page);
    await startWorkoutWith(page, INGESTED_LIFT);

    // Hold the cue file back so the lookup is still going when the sheet shuts.
    // It is precached, so it comes out of the caches first; the worker then
    // goes to the network for it, which is where the context route sits.
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.evaluate(async () => {
      for (const name of await caches.keys()) {
        const cache = await caches.open(name);
        for (const request of await cache.keys()) {
          if (new URL(request.url).pathname === '/howtos.json') await cache.delete(request);
        }
      }
    });
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => (release = resolve));
    let asked = 0;
    await page.context().route('**/howtos.json', async (route) => {
      asked += 1;
      await held;
      // The test cue file rather than the real one, which not every copy of
      // this repository carries.
      await route
        .fulfill({ status: 200, contentType: 'application/json; charset=utf-8', body: testCuesBody() })
        .catch(() => {});
    });

    const sheet = await openHowTo(page);
    await expect(sheet.getByText('Loading cues…')).toBeVisible();
    await expect.poll(() => asked).toBeGreaterThan(0);
    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();
    release();

    // And it opens again cleanly afterwards.
    const again = await openHowTo(page);
    await expect(again.getByText('Execution')).toBeVisible({ timeout: 10_000 });
    expect(errors).toEqual([]);
  });

  // ── With a service connected ──────────────────────────────────────────
  //
  // wger is connected through Tools, the way a person does it, and the Bench
  // Press suggestion accepted. A backup file cannot carry a connection — it
  // would hold the API key, which never leaves the phone — so there is no
  // shortcut through import. wger itself is a route answering with the entry
  // recorded from the real service.

  /** Tools → connect wger → accept the Bench Press link → start the workout. */
  async function startWithWger(page: Page) {
    await fakeWger(page.context(), [wgerBenchPress()]);
    await gotoApp(page);
    await completeSetup(page, { workouts: [[SEEDED_LIFT]] });
    await goToTab(page, 'Tools');
    await connectWger(page);
    const review = await reviewSheet(page);
    await review.getByRole('button', { name: `Accept ${SEEDED_LIFT}` }).click();
    await review.getByRole('button', { name: 'Close' }).click();
    await goToTab(page, 'Today');
    await page.getByRole('button', { name: /^(Start workout|Train anyway)$/ }).click();
  }

  /** The first step of the recorded entry, as the adapter turns it into plain text. */
  const WGER_STEP = /^Lay down on a bench, the bar should be directly above your eyes/;
  const WGER_CREDIT = 'Adapted from "Bench Press" on wger';

  test('a connected service with a confirmed link shows its steps and credit', async ({ page }) => {
    await startWithWger(page);

    const sheet = await openHowTo(page);
    await expect(sheet.getByText(WGER_STEP)).toBeVisible({ timeout: 10_000 });
    await expect(sheet.getByRole('link', { name: WGER_CREDIT })).toHaveAttribute('href', 'https://wger.de/exercise/73/');
    await expect(sheet.getByText(/· CC-BY-SA 3 · sistab2$/)).toBeVisible();
    // The text and its picture are both CC-BY-SA 3; each names the licence as a link to its terms.
    const licences = sheet.getByRole('link', { name: 'CC-BY-SA 3', exact: true });
    await expect(licences).toHaveCount(2);
    await expect(licences.first()).toHaveAttribute('href', 'https://creativecommons.org/licenses/by-sa/3.0/deed.en');
  });

  test('a saved copy still shows with the network off', async ({ page, context }) => {
    await startWithWger(page);
    // Opening it once online saves it.
    await expect((await openHowTo(page)).getByText(WGER_STEP)).toBeVisible({ timeout: 10_000 });
    await page.keyboard.press('Escape');

    await context.setOffline(true);
    const sheet = await openHowTo(page);
    await expect(sheet.getByText(WGER_STEP)).toBeVisible();
    await expect(sheet.getByText(/· CC-BY-SA 3 · sistab2$/)).toBeVisible();
    // Creative Commons lets it be kept, so the sheet's promise holds.
    await expect(sheet.getByText('OFFLINE', { exact: true })).toBeVisible();
  });

  test('a service that never answers ends in a sentence within eight seconds, and closing mid-lookup is clean', async ({ page }) => {
    const errors = recordErrors(page);
    await startWithWger(page);
    // Connected and linked; from here on wger stops answering.
    await page.context().unroute(`${WGER}/**`);
    await page.context().route(`${WGER}/**`, () => {
      // Never answered.
    });

    let sheet = await openHowTo(page);
    await expect(sheet.getByText('Checking wger…')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();

    sheet = await openHowTo(page);
    // The eight-second limit itself is timed in the sheet's unit test. Here the
    // browser shares the machine with the rest of the suite and its timers can
    // run late, so this only proves the sentence arrives, with room to spare.
    await expect(sheet.getByText(/Couldn't reach wger/)).toBeVisible({ timeout: 12_000 });
    // Bompa's own cues stayed up the whole time.
    await expect(sheet.getByText('Execution')).toBeVisible();
    expect(errors).toEqual([]);
  });
});
