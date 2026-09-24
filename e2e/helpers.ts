import { expect, type Page } from '@playwright/test';

// Shared flows for the end-to-end suite.
//
// Everything here drives the real interface rather than seeding IndexedDB
// directly. Writing rows straight into storage would be faster, but it would
// duplicate the schema in test code, and the copy would drift the first time
// version(3) lands — the tests would keep passing against a shape the app no
// longer writes.

/** Tab labels, as the tab bar renders them. */
export type TabName = 'Today' | 'Train' | 'Plan' | 'History' | 'Tools';

/**
 * Load the app and wait for hydration.
 *
 * Until IndexedDB has been read the shell renders a pulsing BOMPA placeholder,
 * so every test would otherwise race the first paint.
 */
export async function gotoApp(page: Page) {
  await page.goto('/');
  await expect(page.getByText('BOMPA', { exact: true })).toBeHidden({ timeout: 15_000 });
}

/** True when the app is sitting in first-run setup. */
export function setupHeading(page: Page) {
  return page.getByText(/^Setting up · /);
}

/** Dismiss setup without building a plan. Skipping is allowed, and sticks. */
export async function skipSetup(page: Page) {
  await expect(setupHeading(page)).toBeVisible();
  await page.getByRole('button', { name: 'Skip', exact: true }).click();
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
}

/** The routine builder sheet, whatever workout it is open on. */
export function builder(page: Page) {
  return page.getByRole('dialog', { name: /^Edit / });
}

/**
 * Add a lift to the open routine builder, by searching for it by name.
 *
 * `name` is matched against the movement library, so it must be a real exercise
 * — a typo here fails as "no results" rather than as a bad selector.
 */
export async function addLift(page: Page, name: string) {
  await builder(page).getByRole('button', { name: '+ Add a lift' }).click();
  const picker = page.getByRole('dialog', { name: 'Add a lift' });
  await expect(picker).toBeVisible();
  await picker.getByPlaceholder('Search by name, muscle or equipment').fill(name);
  await picker.getByRole('button', { name: new RegExp(name, 'i') }).first().click();
  await expect(picker).toBeHidden();
}

/** Save whatever the builder currently holds and wait for it to close. */
export async function saveBuilder(page: Page) {
  await builder(page).getByRole('button', { name: /^(Save workout|Done)$/ }).click();
  await expect(builder(page)).toBeHidden();
}

/**
 * Build one workout during setup's third step.
 *
 * Returns nothing — the workout is named by the app (`Workout 1`, `Workout 2`)
 * unless `rename` is given.
 */
export async function buildWorkoutInSetup(page: Page, lifts: string[], rename?: string) {
  await page.getByRole('button', { name: '+ New workout' }).click();
  await expect(builder(page)).toBeVisible();

  if (rename) {
    // The name field is the only text input in the sheet.
    await builder(page).getByRole('textbox').first().fill(rename);
  }
  for (const lift of lifts) await addLift(page, lift);
  await saveBuilder(page);
}

/**
 * Walk the whole of first-run setup and end with a live plan.
 *
 * Deliberately drives all five steps rather than short-circuiting: the setup
 * flow is itself one of the paths under test, and every other spec depending on
 * it means a break here surfaces immediately rather than as ten mystery
 * failures elsewhere.
 */
export async function completeSetup(
  page: Page,
  opts: { workouts?: string[][]; names?: string[] } = {},
) {
  const workouts = opts.workouts ?? [['Bench Press', 'Overhead Press']];

  await expect(setupHeading(page)).toBeVisible();

  // Step 1 — units. The default (kg) is what the tests assume.
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  // Step 2 — starting maxes. Optional, so pass straight through.
  await page.getByRole('button', { name: 'Next', exact: true }).click();

  // Step 3 — workouts. Next stays disabled until at least one exists.
  await expect(page.getByText('Build your workouts')).toBeVisible();
  for (const [i, lifts] of workouts.entries()) {
    await buildWorkoutInSetup(page, lifts, opts.names?.[i]);
  }
  await page.getByRole('button', { name: 'Next', exact: true }).click();

  // Step 4 — block shape.
  await page.getByRole('button', { name: 'Next', exact: true }).click();

  // Step 5 — done.
  await page.getByRole('button', { name: 'Build my plan' }).click();

  // Setup owns the viewport, so the tab bar appearing is the signal it is over.
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible({ timeout: 15_000 });
}

/** Move to a tab and wait for it to become current. */
export async function goToTab(page: Page, tab: TabName) {
  const nav = page.getByRole('navigation', { name: 'Main' });
  await nav.getByRole('button', { name: tab }).click();
  await expect(nav.getByRole('button', { name: tab })).toHaveAttribute('aria-current', 'page');
}

/** Read every routine currently in IndexedDB, for assertions storage-side. */
export async function readRoutines(page: Page) {
  return page.evaluate(async () => {
    const open = indexedDB.open('bompa');
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
    return new Promise<unknown[]>((resolve, reject) => {
      const request = database.transaction('routines').objectStore('routines').getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  });
}

/**
 * Train the workout Today is offering: start it, log one set, finish, and
 * come back to Today.
 *
 * Matching "Log set" as a prefix lets the button carry the weight and reps.
 */
export async function trainOneSession(page: Page) {
  await page.getByRole('button', { name: /^(Start workout|Train anyway|Resume workout)$/ }).click();
  await page.getByRole('button', { name: /^Log set/ }).click();
  await finishSession(page);
  await goToTab(page, 'Today');
}

/**
 * Start the next workout, log the given sets on its first lift, and finish it.
 * `'warmup'` logs that set as a warm-up; anything else is a working set.
 *
 * Every set type is picked before logging, so a set type left over from the
 * last one can't quietly change what gets written. Each logged set opens the
 * full-screen rest over the set-type buttons, so it is skipped before the next.
 */
export async function trainAndFinish(page: Page, sets: ('warmup' | 'working')[]) {
  await goToTab(page, 'Today');
  await page.getByRole('button', { name: /^(Start workout|Train anyway)$/ }).click();
  await goToTab(page, 'Train');
  for (const type of sets) {
    await page.getByRole('button', { name: type === 'warmup' ? 'Warm-up' : 'Working', exact: true }).click();
    await page.getByRole('button', { name: /^Log set/ }).click();
    if (await restScreen(page).isVisible()) await skipRest(page);
  }
  await finishSession(page);
}

/**
 * Close the summary that Finish opens, landing on Today.
 *
 * The summary covers the whole app, tab bar included, so any test that
 * finishes a session and then goes anywhere has to dismiss it first.
 */
export async function dismissSummary(page: Page) {
  const summary = page.getByRole('dialog', { name: 'Session summary' });
  await expect(summary).toBeVisible();
  await summary.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(summary).toBeHidden();
}

/** The full-screen rest countdown that logging a set opens. */
export function restScreen(page: Page) {
  return page.getByRole('dialog', { name: 'Resting' });
}

/** End a rest from the full-screen countdown, so the logger underneath is usable. */
export async function skipRest(page: Page) {
  await restScreen(page).getByRole('button', { name: 'Skip rest' }).click();
  await expect(restScreen(page)).toBeHidden();
}

/**
 * Finish the running session from Train and dismiss its summary, landing on
 * Today. Ends a running rest first: the full-screen countdown covers the
 * Finish button, just as it would for a person.
 */
export async function finishSession(page: Page) {
  if (await restScreen(page).isVisible()) await skipRest(page);
  await page.getByRole('button', { name: 'Finish', exact: true }).click();
  await dismissSummary(page);
}
