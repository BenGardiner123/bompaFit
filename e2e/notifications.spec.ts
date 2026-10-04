import { expect, test, type Page } from '@playwright/test';
import { completeSetup, goToTab, gotoApp } from './helpers';

// What Bompa changed lives behind a bell beside Settings, not in the middle of
// Today. Each note can be dismissed without undoing the change, and Undo says
// what it does.

test.beforeEach(async ({ page }) => {
  await gotoApp(page);
  await completeSetup(page, {
    workouts: [['Bench Press'], ['Back Squat']],
    names: ['Push A', 'Legs A'],
  });
});

/** Swap the first slot of this week, which Bompa records as a change it can undo. */
async function swapASlot(page: Page) {
  await goToTab(page, 'Plan');
  await page.getByRole('button', { name: /^Options for / }).first().click();
  await page.getByRole('button', { name: /^Swap for / }).first().click();
  await expect(page.getByRole('heading', { name: /^This week/ })).toBeVisible();
  await goToTab(page, 'Today');
}

const bell = (page: Page) => page.getByRole('button', { name: /^Notifications/ });
const list = (page: Page) => page.getByRole('dialog', { name: 'Notifications' });

test('a change shows on the bell, not on Today, and dismissing it keeps the change', async ({ page }) => {
  await swapASlot(page);

  await expect(bell(page)).toHaveAccessibleName('Notifications, 1 new');
  // Nothing about it in the page itself until the bell is opened.
  await expect(page.getByText(/^You swapped/)).toHaveCount(0);

  await bell(page).click();
  await expect(bell(page)).toHaveAttribute('aria-expanded', 'true');
  await expect(list(page).getByText(/^You swapped/)).toBeVisible();
  await expect(list(page).getByRole('button', { name: /^Undo this change: You swapped/ })).toBeVisible();

  await list(page).getByRole('button', { name: /^Dismiss: You swapped/ }).click();
  await expect(list(page).getByText(/^Nothing new/)).toBeVisible();
  await expect(bell(page)).toHaveAccessibleName('Notifications');

  // Dismissed is remembered; the swap itself still stands.
  await page.reload();
  await goToTab(page, 'Today');
  await expect(bell(page)).toHaveAccessibleName('Notifications');
  await goToTab(page, 'Plan');
  await expect(page.getByText(/You swapped/).first()).toBeVisible();
});

test('Undo this change reverses it, and the note goes with it', async ({ page }) => {
  await swapASlot(page);
  await bell(page).click();
  await list(page).getByRole('button', { name: /^Undo this change: / }).click();
  await expect(list(page).getByText(/^Nothing new/)).toBeVisible();
  await expect(page.getByText(/^Reverted/)).toBeVisible();
});

test('Escape and a tap outside close the list, and Escape hands focus back to the bell', async ({ page }) => {
  await goToTab(page, 'Today');
  await bell(page).click();
  await expect(list(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(list(page)).toHaveCount(0);
  await expect(bell(page)).toBeFocused();

  await bell(page).click();
  await expect(list(page)).toBeVisible();
  await page.getByRole('button', { name: /^Start / }).hover();
  await page.mouse.down();
  await expect(list(page)).toHaveCount(0);
  await page.mouse.up();
});
