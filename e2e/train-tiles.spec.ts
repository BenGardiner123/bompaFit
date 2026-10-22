import { expect, test, type Page } from '@playwright/test';
import { completeSetup, gotoApp, goToTab, skipRest, trainOneSession } from './helpers';

// Weight and reps sit side by side as two tiles, and one row of − / + changes
// whichever is selected. Weight is the one changed most between sets, so it is
// selected whenever a set is about to be entered fresh.

async function startSession(page: Page) {
  await goToTab(page, 'Today');
  await page.getByRole('button', { name: /^(Start .+|Train anyway|Resume workout)$/ }).click();
  await goToTab(page, 'Train');
  await expect(page.getByRole('button', { name: 'Log set' })).toBeVisible();
}

const logButton = (page: Page) => page.getByRole('button', { name: /^Log set/ });
const increaseWeight = (page: Page) => page.getByRole('button', { name: /^Increase weight by / });
const increaseReps = (page: Page) => page.getByRole('button', { name: 'Increase reps', exact: true });
const selectReps = (page: Page) => page.getByRole('button', { name: /^Select reps, now \d+$/ });
const selectWeight = (page: Page) => page.getByRole('button', { name: /^Select weight, now / });

test.beforeEach(async ({ page }) => {
  await gotoApp(page);
  await completeSetup(page);
});

test.describe('the weight and reps tiles', () => {
  test.beforeEach(async ({ page }) => {
    await startSession(page);
  });

  test('weight is selected when the lift opens, so the steppers change the weight', async ({ page }) => {
    await expect(page.getByRole('button', { name: /^Weight [\d.]+ kg, tap to type$/ })).toBeVisible();
    await expect(selectReps(page)).toBeVisible();
    await expect(increaseReps(page)).toHaveCount(0);

    await expect(logButton(page)).toContainText('35 × 8');
    await increaseWeight(page).click();
    await expect(logButton(page)).toContainText('37.5 × 8');
  });

  test('the steppers say the step and its unit', async ({ page }) => {
    await expect(increaseWeight(page)).toContainText('2.5 kg');
  });

  test('selecting reps moves the steppers to the reps, a whole rep at a time', async ({ page }) => {
    await selectReps(page).click();
    await expect(increaseWeight(page)).toHaveCount(0);
    await expect(selectWeight(page)).toBeVisible();

    await increaseReps(page).click();
    await expect(logButton(page)).toContainText('35 × 9');
    await expect(increaseReps(page)).toContainText('1');
  });

  test('tapping a tile to select it does not open the keyboard', async ({ page }) => {
    await selectReps(page).click();
    await expect(page.getByRole('textbox')).toHaveCount(0);
    // Tapping the selected figure is what types.
    await page.getByRole('button', { name: /^Reps \d+, tap to type$/ }).click();
    await expect(page.getByRole('textbox', { name: 'Reps' })).toBeFocused();
  });

  test('reps never step below one', async ({ page }) => {
    await selectReps(page).click();
    const decrease = page.getByRole('button', { name: 'Decrease reps', exact: true });
    for (let i = 0; i < 10; i++) await decrease.click();
    await expect(logButton(page)).toContainText('× 1');
  });

  test('weight is selected again after a set is logged', async ({ page }) => {
    await selectReps(page).click();
    await logButton(page).click();
    await skipRest(page);
    await expect(selectReps(page)).toBeVisible();
    await expect(increaseWeight(page)).toBeVisible();
  });

  test('weight is selected again on another lift', async ({ page }) => {
    await selectReps(page).click();
    await page.getByRole('button', { name: /^OHP, / }).click();
    await expect(selectReps(page)).toBeVisible();
  });

  test('the selected tile is ringed and the other is dimmed', async ({ page }) => {
    const weightTile = page.getByRole('button', { name: /^Weight [\d.]+ kg, tap to type$/ }).locator('xpath=ancestor::*[@data-tile][1]');
    await expect(weightTile).toHaveAttribute('data-selected', 'true');
    const repsTile = selectReps(page);
    await expect(repsTile).toHaveAttribute('data-selected', 'false');
  });
});

test.describe('last time', () => {
  test('there is no line before the lift has ever been trained', async ({ page }) => {
    await startSession(page);
    await expect(page.getByText(/^Last time /)).toHaveCount(0);
  });

  test('the next session shows the last working set of the lift', async ({ page }) => {
    await trainOneSession(page);
    await startSession(page);
    // Logged unrated, so the aim that stood in for a rating is not repeated.
    await expect(page.getByText('Last time 35 × 8', { exact: true })).toBeVisible();
  });
});
