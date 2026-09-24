import { expect, test } from '@playwright/test';
import { completeSetup, goToTab, gotoApp, trainAndFinish } from './helpers';

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

test('By session lists a finished session and opens it to its sets', async ({ page }) => {
  await trainAndFinish(page, ['warmup', 'working', 'working']);
  await goToTab(page, 'History');

  await expect(page.getByText('Last 7 days', { exact: true })).toBeVisible();
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
  await expect(page.getByRole('button', { name: 'Bench Press' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Overhead Press' })).toHaveCount(0);

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
