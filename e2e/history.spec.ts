import { expect, test } from '@playwright/test';
import { completeSetup, goToTab, gotoApp, openSettings, settingsSheet, trainAndFinish } from './helpers';

// History answers two questions about the same sets: "what did I do on
// Tuesday" (by session) and "how is my bench going" (by lift). Both have to be
// reachable, and a session has to open to show what was actually done.

test.beforeEach(async ({ page }) => {
  await gotoApp(page);
  await completeSetup(page, { workouts: [['Bench Press', 'Overhead Press']], names: ['Push A'] });
});

test('with nothing finished yet, By session says so rather than showing a blank sheet', async ({ page }) => {
  await goToTab(page, 'History');
  await expect(page.getByRole('button', { name: 'By session' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText('No finished sessions yet.', { exact: false })).toBeVisible();
  // The week's hero still renders, at zero, so the screen keeps its shape.
  await expect(page.getByText(/tonnes lifted in the last 7 days/)).toBeAttached();
});

test('with nothing logged, By lift says there is no estimate in words rather than a giant dash', async ({ page }) => {
  await goToTab(page, 'History');
  await page.getByRole('button', { name: 'By lift' }).click();
  await expect(page.getByText('No estimate yet', { exact: true })).toBeVisible();
  await expect(page.getByText('nothing logged yet', { exact: true })).toBeVisible();
  // An em dash at hero size draws as a solid bar, which reads as a broken chart.
  // (The starting-max fields below still show a dash for "not set", at body size.)
  for (const dash of await page.getByText('—', { exact: true }).all()) {
    expect(parseFloat(await dash.evaluate((el) => getComputedStyle(el).fontSize))).toBeLessThan(40);
  }
});

test('By session lists a finished session and opens it to its sets', async ({ page }) => {
  await trainAndFinish(page, ['warmup', 'working', 'working']);
  await goToTab(page, 'History');

  // The week's volume and how heavy it was, which used to sit on Today.
  await expect(page.getByText('7-day volume', { exact: true })).toBeVisible();
  await expect(page.getByRole('term').filter({ hasText: /^7-day intensity$/ })).toBeVisible();
  // Two working sets, not three: the warm-up is not the work.
  const row = page.getByRole('button', { name: /^Show Push A on / });
  await expect(row).toBeVisible();
  await expect(row).toHaveAttribute('aria-expanded', 'false');
  await expect(row).toContainText(/2\s*sets/);

  await row.click();
  const open = page.getByRole('button', { name: /^Hide Push A on / });
  await expect(open).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByRole('heading', { name: 'Bench Press' })).toBeVisible();
  // The warm-up is still listed, marked W, because it happened.
  const panel = page.locator(`#${await open.getAttribute('aria-controls')}`);
  await expect(panel.getByText('W', { exact: true })).toBeVisible();
  await expect(panel.getByText(/reps$/)).toHaveCount(3);

  await open.click();
  await expect(page.getByRole('heading', { name: 'Bench Press' })).toBeHidden();
  await expect(row).toHaveAttribute('aria-expanded', 'false');
});

test('By lift shows the estimated max, records and recent days for a trained lift', async ({ page }) => {
  await trainAndFinish(page, ['working', 'working']);
  await goToTab(page, 'History');

  await page.getByRole('button', { name: 'By lift' }).click();
  await expect(page.getByRole('button', { name: 'By lift' })).toHaveAttribute('aria-pressed', 'true');

  // Only lifts you have trained get a chip, and the one on screen is marked.
  await expect(page.getByRole('button', { name: 'Bench Press', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Overhead Press', exact: true })).toHaveCount(0);

  await expect(page.getByText('Estimated 1RM', { exact: true })).toBeVisible();
  await expect(page.getByText(/^Bench Press: estimated one-rep max \d/)).toBeAttached();
  await expect(page.getByRole('heading', { name: 'Personal records' })).toBeVisible();
  await expect(page.getByText('Est. 1RM', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Recent sessions' })).toBeVisible();
  await expect(page.getByText(/^2 sets · /)).toBeVisible();

  // And back again.
  await page.getByRole('button', { name: 'By session' }).click();
  await expect(page.getByRole('button', { name: /^Show Push A on / })).toBeVisible();
});

test('By lift opens with the starting maxes, above the records', async ({ page }) => {
  await trainAndFinish(page, ['working']);
  await goToTab(page, 'History');
  await page.getByRole('button', { name: 'By lift' }).click();

  const maxes = page.getByRole('heading', { name: 'Starting maxes' });
  const records = page.getByRole('heading', { name: 'Personal records' });
  await expect(maxes).toBeVisible();
  expect((await maxes.boundingBox())!.y).toBeLessThan((await records.boundingBox())!.y);

  // The same stepper rows as before, so a max set here is the one percentage workouts read.
  await page.getByRole('button', { name: 'Raise starting max for Bench Press' }).click();
  await expect(page.getByRole('button', { name: /^Starting max for Bench Press [\d.]+ kg, tap to type$/ })).toBeVisible();
});

test.describe('starting maxes, at the top of By lift', () => {
  async function byLift(page: import('@playwright/test').Page) {
    await goToTab(page, 'History');
    await page.getByRole('button', { name: 'By lift' }).click();
  }

  test('offers the big four and the lifts in your workouts, not the whole library', async ({ page }) => {
    await byLift(page);
    // Setup built one workout of Bench Press and Overhead Press, both in the
    // big four, so the list is exactly those four lifts.
    const raises = page.getByRole('button', { name: /^Raise starting max for / });
    await expect(raises).toHaveCount(4);
    for (const lift of ['Back Squat', 'Bench Press', 'Deadlift', 'Overhead Press']) {
      await expect(page.getByRole('button', { name: `Raise starting max for ${lift}`, exact: true })).toBeAttached();
    }
  });

  test('a max entered in pounds reads back unchanged after a reload', async ({ page }) => {
    await openSettings(page);
    await settingsSheet(page).getByRole('button', { name: 'lb', exact: true }).click();
    await page.keyboard.press('Escape');
    await byLift(page);

    // Exact, because the library also holds "Bench Press - Powerlifting" and friends.
    const raise = page.getByRole('button', { name: 'Raise starting max for Bench Press', exact: true });
    await raise.scrollIntoViewIfNeeded();
    await raise.click();
    await raise.click();

    // Stored in kilograms, shown in pounds: a round trip that drifted would
    // read back as 9.9 or 10.1 rather than the 10 that was entered.
    // The steppers either side are icons, so the row's text is the figure alone.
    await expect(raise.locator('..')).toHaveText(/^10$/);

    await page.reload();
    await byLift(page);
    await expect(raise.locator('..')).toHaveText(/^10$/);
  });
});
