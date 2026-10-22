import { expect, test } from '@playwright/test';
import { completeSetup, gotoApp } from './helpers';

// The next-up card on Today names the first three lifts and counts the rest,
// so it stays the same height however long the workout is.

test.beforeEach(async ({ page }) => {
  await gotoApp(page);
  await completeSetup(page, { workouts: [['Bench Press', 'Overhead Press', 'Barbell Row', 'Back Squat']], names: ['Full Body'] });
});

test('shows three lifts and a count of the rest', async ({ page }) => {
  for (const name of ['Bench Press', 'Overhead Press', 'Barbell Row']) {
    await expect(page.getByText(name, { exact: true })).toBeVisible();
  }
  await expect(page.getByText('Back Squat', { exact: true })).toHaveCount(0);
  await expect(page.getByText('+1 more', { exact: true })).toBeVisible();
  // The count in the corner is still the whole workout.
  await expect(page.getByText(/^4 lifts · ~\d+ min$/)).toBeVisible();
});

test('the start button inside the card names the workout', async ({ page }) => {
  await expect(page.getByRole('button', { name: 'Start Full Body', exact: true })).toBeVisible();
});
