import { expect, test } from '@playwright/test';
import { completeSetup, goToTab, gotoApp } from './helpers';

// How the week's slots are drawn: tight rows that still leave a thumb-sized
// control, and a line under each name that reads as English.

test.beforeEach(async ({ page }) => {
  await gotoApp(page);
  await completeSetup(page, {
    workouts: [['Bench Press'], ['Back Squat', 'Romanian Deadlift']],
    names: ['Solo', 'Legs A'],
  });
  await goToTab(page, 'Plan');
});

test('a workout with one lift says "1 lift", not "1 lifts"', async ({ page }) => {
  await expect(page.getByText(/^1 lift · /).first()).toBeVisible();
  await expect(page.getByText(/\b1 lifts\b/)).toHaveCount(0);
  await expect(page.getByText(/^2 lifts · /).first()).toBeVisible();
});

test('slot rows sit about 52px apart, and each options button is still 44px', async ({ page }) => {
  const options = page.getByRole('button', { name: /^Options for / });
  expect(await options.count()).toBeGreaterThanOrEqual(2);
  const first = (await options.nth(0).boundingBox())!;
  const second = (await options.nth(1).boundingBox())!;

  expect(first.height).toBeGreaterThanOrEqual(44);
  expect(first.width).toBeGreaterThanOrEqual(44);
  // The design draws them 52px apart. They were about 69 when the row kept its
  // full padding around a 44px button.
  expect(Math.abs(second.y - first.y - 52)).toBeLessThanOrEqual(2);
});
