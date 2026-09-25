import { expect, test, type Page } from '@playwright/test';
import { completeSetup, finishSession, gotoApp, goToTab, restScreen, skipRest } from './helpers';

// The logger — the path the app exists for. Everything here runs against real
// IndexedDB in a real browser, which is what separates it from the provider
// tests: those prove the state transitions, these prove a person can reach them.

async function startSession(page: Page) {
  await goToTab(page, 'Today');
  await page.getByRole('button', { name: /^(Start .+|Train anyway)$/ }).click();
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
    await expect(page.getByRole('button', { name: /^Bench, 1 of \d+ sets$/ })).toBeVisible();
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

  test('holding a weight stepper cycles the step, and the steppers use it', async ({ page }) => {
    // The hold is timed on the page's clock, moved on by hand, so a slow
    // machine can neither cut it short nor stretch a tap into one.
    await page.clock.install();
    await page.reload();
    await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible({ timeout: 15_000 });
    await startSession(page);
    const plus = page.getByRole('button', { name: /^Increase weight by/ });
    await expect(plus).toHaveAccessibleName('Increase weight by 2.5 kg. Hold to change the step.');
    await expect(plus).toContainText('2.5');

    // Held for longer than half a second: the step moves on, and the tap that
    // ends the hold does not also add weight.
    await plus.hover();
    await page.mouse.down();
    await page.clock.runFor(700);
    await page.mouse.up();
    await expect(page.getByText('Step 5 kg')).toBeVisible();
    await expect(plus).toHaveAccessibleName('Increase weight by 5 kg. Hold to change the step.');
    await expect(page.getByRole('button', { name: 'Log set 40 × 8' })).toBeVisible();

    // The keyboard way: the context-menu key on the focused stepper.
    await plus.focus();
    await page.keyboard.press('Shift+F10');
    await expect(plus).toHaveAccessibleName('Increase weight by 1.25 kg. Hold to change the step.');

    // An ordinary tap steps by it.
    await plus.click();
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
    await expect(page.getByRole('button', { name: /^Bench, 0 of \d+ sets$/ })).toBeVisible();
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
    await page.getByRole('button', { name: 'Session menu', exact: true }).click();
    await page.getByRole('dialog', { name: 'Session menu' }).getByRole('button', { name: 'Add a lift' }).click();

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
    await finishSession(page);

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
