import { expect, test, type Page } from '@playwright/test';
import { completeSetup, dismissSummary, gotoApp, goToTab, restScreen, skipRest } from './helpers';

// The logger — the path the app exists for. Everything here runs against real
// IndexedDB in a real browser, which is what separates it from the provider
// tests: those prove the state transitions, these prove a person can reach them.

async function startSession(page: Page) {
  await goToTab(page, 'Today');
  await page.getByRole('button', { name: /^(Start workout|Train anyway)$/ }).click();
  await goToTab(page, 'Train');
  await expect(page.getByRole('button', { name: 'Log set' })).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await gotoApp(page);
  await completeSetup(page, { workouts: [['Bench Press', 'Overhead Press']] });
});

test.describe('logging sets', () => {
  test('logs a working set and starts the rest timer', async ({ page }) => {
    await startSession(page);
    await page.getByRole('button', { name: 'Log set' }).click();

    // The timer is a wall-clock countdown rendered from an end stamp, because
    // phones throttle background timers and a decrementing counter drifts.
    await expect(page.getByRole('timer')).toBeVisible();
  });

  test('the set lands immediately, without waiting on IndexedDB', async ({ page }) => {
    await startSession(page);
    await page.getByRole('button', { name: 'Log set' }).click();
    await skipRest(page);
    // The write is fire-and-forget, so the set's dot must be on screen
    // before storage has been asked anything.
    await expect(page.getByRole('button', { name: /^Edit set 1\b/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Bench 1\/\d/ })).toBeVisible();
  });

  test('steppers change the entry without touching stored units', async ({ page }) => {
    await startSession(page);
    await expect(page.getByRole('button', { name: 'Log set 40 × 8' })).toBeVisible();

    await page.getByRole('button', { name: 'Increase weight' }).click();
    await page.getByRole('button', { name: 'Increase reps' }).click();
    await expect(page.getByRole('button', { name: 'Log set 42.5 × 9' })).toBeVisible();
    await page.getByRole('button', { name: 'Log set' }).click();
    await expect(page.getByRole('timer')).toBeVisible();
  });

  test('the step button cycles through the unit’s increments', async ({ page }) => {
    await startSession(page);
    const step = page.getByRole('button', { name: /^Weight step/ });
    await expect(step).toHaveText('±2.5');
    await step.click();
    await expect(step).toHaveText('±5');
    await step.click();
    await expect(step).toHaveText('±1.25');

    // And the stepper uses it.
    await page.getByRole('button', { name: 'Increase weight' }).click();
    await expect(page.getByRole('button', { name: 'Log set 41.25 × 8' })).toBeVisible();
  });

  test('a warm-up does not start a rest timer race with working sets', async ({ page }) => {
    await startSession(page);
    await page.getByRole('button', { name: 'Warm-up', exact: true }).click();
    await page.getByRole('button', { name: 'Log set' }).click();

    // Warm-ups are excluded from load and chip counts, but they still rest.
    await expect(page.getByRole('timer')).toBeVisible();
    await skipRest(page);
    // The type resets to Working so the next set is not silently a warm-up too.
    await expect(page.getByRole('button', { name: 'Working', exact: true })).toHaveAttribute('aria-pressed', 'true');
    // The warm-up still gets its own dot, so it can be found and corrected.
    await expect(page.getByRole('button', { name: /^Edit set 1 \(Warm-up\)/ })).toBeVisible();
    // And the chip count ignores it.
    await expect(page.getByRole('button', { name: /^Bench 0\/\d/ })).toBeVisible();
  });

  test('rest can be extended, shortened and skipped', async ({ page }) => {
    await startSession(page);
    await page.getByRole('button', { name: 'Log set' }).click();
    const rest = restScreen(page);
    await expect(rest.getByRole('timer')).toBeVisible();

    await rest.getByRole('button', { name: '+30' }).click();
    await expect(rest.getByText('of 3:00')).toBeVisible();
    await rest.getByRole('button', { name: '−30' }).click();
    await rest.getByRole('button', { name: 'Skip rest' }).click();

    await expect(page.getByRole('timer')).toBeHidden();
  });

  test('a lift can be added to a running session', async ({ page }) => {
    await startSession(page);
    await page.getByRole('button', { name: 'Add a lift to this session' }).click();

    const picker = page.getByRole('dialog');
    await expect(picker).toBeVisible();
    await picker.getByPlaceholder('Search by name, muscle or equipment').fill('Deadlift');
    await picker.getByRole('button', { name: /Deadlift/i }).first().click();
    await expect(picker).toBeHidden();
  });

  test('finishing a session closes it', async ({ page }) => {
    await startSession(page);
    await page.getByRole('button', { name: 'Log set' }).click();
    await skipRest(page);
    await page.getByRole('button', { name: 'Finish' }).click();
    await dismissSummary(page);

    // Finishing returns to Today deliberately — there is nothing left to do on
    // the logger, and leaving someone staring at an empty form is worse.
    await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Today' })).toHaveAttribute(
      'aria-current',
      'page',
    );

    await goToTab(page, 'Train');
    await expect(page.getByText('No session running.')).toBeVisible();
  });
});

test.describe('the logger without a session', () => {
  test('says so rather than rendering an empty form', async ({ page }) => {
    await goToTab(page, 'Train');
    await expect(page.getByText('No session running.')).toBeVisible();
  });
});
