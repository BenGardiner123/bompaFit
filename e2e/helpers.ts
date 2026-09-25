import { expect, type Page } from '@playwright/test';

// Shared flows for the end-to-end suite.
//
// Everything here drives the real interface rather than seeding IndexedDB
// directly. Writing rows straight into storage would be faster, but it would
// duplicate the schema in test code, and the copy would drift the first time
// version(3) lands — the tests would keep passing against a shape the app no
// longer writes.

/** Tab labels, as the tab bar renders them. */
export type TabName = 'Today' | 'Train' | 'Plan' | 'History' | 'Workouts';

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
  return page.getByText(/^Step \d+ of \d+ · /);
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

/** The Settings sheet, opened from the gear on Today. */
export function settingsSheet(page: Page) {
  return page.getByRole('dialog', { name: 'Settings' });
}

/** Go to Today and open Settings from its gear. */
export async function openSettings(page: Page) {
  await goToTab(page, 'Today');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(settingsSheet(page)).toBeVisible();
}

/**
 * Open one of the settings too long for the sheet, which push a screen of
 * their own: 'Timer alerts', 'Default warm-up' or 'Exercise instructions'.
 */
export async function openSettingsView(page: Page, row: 'Timer alerts' | 'Default warm-up' | 'Exercise instructions') {
  await openSettings(page);
  await settingsSheet(page).getByRole('button', { name: new RegExp(`^${row}`) }).click();
  await expect(settingsSheet(page)).toBeHidden();
  await expect(page.getByRole('button', { name: 'Back to Settings' })).toBeVisible();
}

/** Open a tool from the Workouts tab: 'Interval timer' or '1RM calculator'. */
export async function openTool(page: Page, tool: 'Interval timer' | '1RM calculator') {
  await goToTab(page, 'Workouts');
  await page.getByRole('button', { name: new RegExp(`^${tool}`) }).click();
  await expect(page.getByRole('heading', { name: tool, level: 1 })).toBeVisible();
}

/**
 * Open a workout's row on the Workouts tab, so its Start and Edit buttons
 * show. One row is open at a time; the others are a line with a chevron.
 */
export async function openWorkoutRow(page: Page, name: string) {
  // The row's name is the workout's name, then its tag or its lift count.
  const row = new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}( |$)`);
  const closed = page.getByRole('button', { name: row, expanded: false });
  if (await closed.count()) await closed.first().click();
  await expect(page.getByRole('button', { name: row, expanded: true })).toBeVisible();
}

/** Start a workout from the Workouts tab, by name. Lands on Train. */
export async function startFromWorkouts(page: Page, name: string) {
  await goToTab(page, 'Workouts');
  await openWorkoutRow(page, name);
  await page.getByRole('button', { name: `Start ${name}`, exact: true }).click();
  await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Train' })).toHaveAttribute('aria-current', 'page');
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
  await page.getByRole('button', { name: /^(Start .+|Train anyway|Resume workout)$/ }).click();
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
  await page.getByRole('button', { name: /^(Start .+|Train anyway)$/ }).click();
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

/**
 * The full-screen screen that logging a set opens: the rest countdown, or
 * "That's the plan done" after the last planned set.
 */
export function restScreen(page: Page) {
  return page.getByRole('dialog', { name: /^(Resting|Session complete)$/ });
}

/**
 * Get the rest screen out of the way, so the logger underneath is usable: Skip
 * rest, or Keep training on the plan-done screen.
 */
export async function skipRest(page: Page) {
  const screen = restScreen(page);
  const skip = screen.getByRole('button', { name: 'Skip rest' });
  if (await skip.isVisible()) await skip.click();
  else await screen.getByRole('button', { name: 'Keep training' }).click();
  await expect(screen).toBeHidden();
}

/**
 * Finish the running session from Train, through the session menu, and stop
 * at the summary. With a planned lift untrained the finish guard asks first,
 * and this answers "Finish anyway".
 */
export async function finishToSummary(page: Page) {
  if (await restScreen(page).isVisible()) await skipRest(page);
  await page.getByRole('button', { name: 'Session menu', exact: true }).click();
  await page.getByRole('dialog', { name: 'Session menu' }).getByRole('button', { name: 'Finish session' }).click();
  const guard = page.getByRole('dialog', { name: /not trained yet$/ });
  const summary = page.getByRole('dialog', { name: 'Session summary' });
  await expect(guard.or(summary)).toBeVisible();
  if (await guard.isVisible()) await guard.getByRole('button', { name: 'Finish anyway' }).click();
  await expect(summary).toBeVisible();
}

/** Finish the running session and dismiss its summary, landing on Today. */
export async function finishSession(page: Page) {
  await finishToSummary(page);
  await dismissSummary(page);
}
