import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { EXERCISEDB_API, connectWger, exercisedbFixture, fakeWger as routeWger, providerRow, reviewSheet, wgerEntry } from './content-fakes';
import { completeSetup, finishSession, goToTab, gotoApp } from './helpers';

// Tools → Exercise content: connecting a service, reviewing the links it
// suggests, downloading for offline, and disconnecting.
//
// Every provider host is faked with a route. Nothing here may reach the real
// wger or RapidAPI, so an unrouted request to any other origin is aborted and
// recorded, and a test fails if one was attempted where none should be.

test.beforeEach(async ({ context }) => {
  await context.route(
    (url) => url.hostname !== 'localhost',
    (route) => route.abort('blockedbyclient'),
  );
});

/** Every request the context sends to an origin other than the app's own. */
function outbound(context: BrowserContext, page: Page): () => string[] {
  const seen: string[] = [];
  context.on('request', (request) => {
    const origin = new URL(page.url() === 'about:blank' ? 'http://localhost' : page.url()).origin;
    if (!request.url().startsWith(origin) && !request.url().startsWith('data:')) seen.push(request.url());
  });
  return () => seen;
}

async function readTable(page: Page, table: string): Promise<Record<string, unknown>[]> {
  return page.evaluate(async (name) => {
    const open = indexedDB.open('bompa');
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
    return new Promise<Record<string, unknown>[]>((resolve, reject) => {
      const request = database.transaction(name).objectStore(name).getAll();
      request.onsuccess = () => resolve(request.result as Record<string, unknown>[]);
      request.onerror = () => reject(request.error);
    });
  }, table);
}

// ─── A fake wger ──────────────────────────────────────────────

const WGER_ENTRIES = [
  wgerEntry({ id: 73, uuid: '3717d144-7815-4a97-9a56-956fb889c996', name: 'Bench Press', steps: ['Lie on the bench.', 'Lower the bar to your chest.', 'Press it back up.'] }),
  wgerEntry({ id: 74, uuid: '0b5f5a6e-0000-4000-8000-000000000002', name: 'Overhead Press', steps: ['Stand tall.', 'Press the bar overhead.'], equipment: ['Barbell'] }),
];

function fakeWger(context: BrowserContext, opts: Parameters<typeof routeWger>[2] = {}) {
  return routeWger(context, WGER_ENTRIES, opts);
}

async function openTools(page: Page) {
  await gotoApp(page);
  await completeSetup(page, { workouts: [['Bench Press', 'Overhead Press']], names: ['Push A'] });
  await goToTab(page, 'Tools');
}

// ─── Tests ────────────────────────────────────────────────────

test('with no service connected, a normal session sends nothing off the device', async ({ page, context }) => {
  const sent = outbound(context, page);
  await openTools(page);
  await expect(page.getByText('Nothing is sent anywhere unless you connect a service.', { exact: false })).toBeVisible();

  // Every tab, and a workout from start to finish.
  for (const tab of ['Today', 'Plan', 'History', 'Tools'] as const) await goToTab(page, tab);
  await goToTab(page, 'Today');
  await page.getByRole('button', { name: /^(Start workout|Train anyway)$/ }).click();
  await goToTab(page, 'Train');
  await page.getByRole('button', { name: /^Log set/ }).click();
  await finishSession(page);
  await goToTab(page, 'Tools');

  expect(sent()).toEqual([]);
});

test('says what a connected service is sent, and what it never is', async ({ page }) => {
  await openTools(page);
  const text = page.getByText(/Nothing is sent anywhere unless you connect a service/);
  await expect(text).toBeVisible();
  await expect(text).toContainText('only exercise names and ids');
  await expect(text).toContainText('never your training');
});

test('connects wger after a passing test, then accepts one suggestion and says no match to another', async ({ page, context }) => {
  await fakeWger(context);
  await openTools(page);

  await connectWger(page);
  // Connecting looks for matches once, so there is something to review.
  const sheet = await reviewSheet(page);
  await expect(sheet.getByRole('listitem', { name: 'Bench Press' })).toContainText('wger: Bench Press');

  await sheet.getByRole('button', { name: 'Accept Bench Press' }).click();
  await sheet.getByRole('button', { name: 'No match for Overhead Press' }).click();
  await expect(sheet.getByText('Nothing left to review.')).toBeVisible();
  await sheet.getByRole('button', { name: 'Close' }).click();

  await expect(page.getByText('1 linked · 0 to review · 1 with no match')).toBeVisible();
  const links = await readTable(page, 'contentLinks');
  expect(links.map((l) => [l.exerciseId, l.status]).sort()).toEqual([
    ['barbell-bench-press', 'confirmed'],
    ['overhead-press', 'none'],
  ].sort());

  // Neither answer is asked again.
  await page.getByRole('button', { name: 'Find matches' }).click();
  await expect(page.getByRole('status').filter({ hasText: /already has a link|No new suggestions/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Review \d+ suggestions?$/ })).toHaveCount(0);
});

test('choosing another entry links the movement to the one picked', async ({ page, context }) => {
  await fakeWger(context);
  await openTools(page);
  await connectWger(page);

  const sheet = await reviewSheet(page);
  await sheet.getByRole('button', { name: 'Choose another for Overhead Press' }).click();
  await sheet.getByRole('textbox', { name: 'Search wger' }).fill('bench');
  await sheet.getByRole('button', { name: 'Search', exact: true }).click();
  await sheet.getByRole('button', { name: 'Link to Bench Press' }).click();
  await expect(sheet.getByRole('listitem', { name: 'Overhead Press' })).toHaveCount(0);

  const links = await readTable(page, 'contentLinks');
  expect(links.find((l) => l.exerciseId === 'overhead-press')).toMatchObject({ status: 'confirmed', method: 'manual', externalId: WGER_ENTRIES[0]!.uuid as string });
});

test('a keyed service needs a passing test before Connect, and never shows the saved key', async ({ page, context }) => {
  const KEY = 'test-key-5f2c9a';
  let answer = 401;
  const keysSeen: (string | undefined)[] = [];
  await context.route(`${EXERCISEDB_API}/**`, async (route) => {
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-expose-headers': 'x-ratelimit-remaining' };
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    // The connection test is the liveness route and nothing else: it spends no exercise lookups.
    if (new URL(route.request().url()).pathname !== '/api/v1/liveness') return route.fulfill({ status: 404, headers: cors, json: {} });
    keysSeen.push(await route.request().headerValue('x-rapidapi-key') ?? undefined);
    if (answer !== 200) return route.fulfill({ status: answer, headers: cors, json: exercisedbFixture('error-unauthorized') });
    return route.fulfill({ status: 200, headers: { ...cors, 'x-ratelimit-remaining': '482' }, json: exercisedbFixture('liveness') });
  });
  await openTools(page);

  await providerRow(page, 'ExerciseDB').click();
  const connect = page.getByRole('button', { name: 'Connect', exact: true });
  const key = page.getByLabel('API key');
  await expect(key).toHaveAttribute('type', 'password');
  await expect(connect).toBeDisabled();

  // Plan-dependent saving is asked, and starts at No.
  const plan = page.getByRole('group', { name: 'Does your plan allow saving content on this phone?' });
  await expect(plan.getByRole('button', { name: 'No', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText('never saved on this phone')).toBeVisible();

  // A refused key is said in words and saves nothing.
  await key.fill(KEY);
  await page.getByRole('button', { name: 'Test connection' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'That key was refused' })).toBeVisible();
  await expect(connect).toBeDisabled();
  expect(await readTable(page, 'providerConnections')).toEqual([]);

  // A passing test earns Connect.
  answer = 200;
  await page.getByRole('button', { name: 'Test connection' }).click();
  await expect(page.getByRole('status').filter({ hasText: '482 calls left' })).toBeVisible();
  // Each test was one call to the gateway, carrying the key typed.
  expect(keysSeen).toEqual([KEY, KEY]);
  await expect(connect).toBeEnabled();
  await connect.click();
  await expect(providerRow(page, 'ExerciseDB')).toHaveAccessibleName('ExerciseDB, connected');

  const saved = await readTable(page, 'providerConnections');
  expect(saved).toHaveLength(1);
  expect(saved[0]).toMatchObject({ providerId: 'exercisedb', cachingAllowed: false });

  // Once saved, the key is never put back on screen — not after a reload either.
  await page.reload();
  await goToTab(page, 'Tools');
  await providerRow(page, 'ExerciseDB').click();
  await expect(page.getByLabel('API key')).toHaveCount(0);
  expect(await page.content()).not.toContain(KEY);
  // And it is never in the settings that a backup exports whole.
  expect(JSON.stringify(await readTable(page, 'settings'))).not.toContain(KEY);
});

test('disconnecting keeps links unless asked to forget them', async ({ page, context }) => {
  await fakeWger(context);
  await openTools(page);
  await connectWger(page);
  const sheet = await reviewSheet(page);
  await sheet.getByRole('button', { name: /^Accept all/ }).click();
  await sheet.getByRole('button', { name: 'Close' }).click();

  await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
  await page.getByRole('button', { name: 'Disconnect wger' }).click();
  await expect(providerRow(page, 'wger')).toHaveAccessibleName('wger, not connected');
  expect(await readTable(page, 'providerConnections')).toEqual([]);
  expect(await readTable(page, 'contentLinks')).toHaveLength(2);

  await connectWger(page);
  await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Also forget links' }).check();
  await page.getByRole('button', { name: 'Disconnect wger' }).click();
  await expect(providerRow(page, 'wger')).toHaveAccessibleName('wger, not connected');
  expect(await readTable(page, 'contentLinks')).toEqual([]);
  expect(await readTable(page, 'contentCache')).toEqual([]);
});

test('download for offline shows progress, and stops on a spent quota with a reason', async ({ page, context }) => {
  // The first entry downloads; the second is refused as too many requests.
  await fakeWger(context, { detailStatus: (_uuid, call) => (call >= 2 ? 429 : 200) });
  await openTools(page);
  await connectWger(page);
  const sheet = await reviewSheet(page);
  await sheet.getByRole('button', { name: /^Accept all/ }).click();
  await sheet.getByRole('button', { name: 'Close' }).click();

  await page.getByRole('button', { name: 'Download for offline' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Stopped at 1 of 2: your quota with wger is used up' })).toBeVisible();
  await expect(page.getByText(/^Saved on this phone: 1 instruction, [01] images?$/)).toBeVisible();
});

test('download for offline waits while a session is in progress', async ({ page, context }) => {
  await fakeWger(context);
  await openTools(page);
  await connectWger(page);

  await goToTab(page, 'Today');
  await page.getByRole('button', { name: /^(Start workout|Train anyway)$/ }).click();
  await goToTab(page, 'Tools');
  await providerRow(page, 'wger').click();
  await expect(page.getByRole('button', { name: 'Download for offline' })).toBeDisabled();
  await expect(page.getByText('Downloads wait until your session is finished.')).toBeVisible();
});
