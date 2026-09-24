import { expect, test } from '@playwright/test';
import { completeSetup, goToTab, gotoApp } from './helpers';

// The RPE chip grid. It replaced a single scrolling row that put 9, 9.5 and 10 off
// screen at 412px — so the hardest sets, the ones adaptation is most sensitive
// to, were the only ones needing a sideways scroll to reach.

const VALUES = ['6', '6.5', '7', '7.5', '8', '8.5', '9', '9.5', '10'];

test.beforeEach(async ({ page }) => {
  await gotoApp(page);
  await completeSetup(page, { workouts: [['Bench Press']], names: ['Push A'] });
  await goToTab(page, 'Today');
  await page.getByRole('button', { name: /^(Start workout|Train anyway)$/ }).click();
  await goToTab(page, 'Train');
});

test.describe('the RPE picker', () => {
  test('every value is on screen at 412px, none needs a scroll', async ({ page }) => {
    for (const value of VALUES) {
      const stop = page.getByRole('button', { name: `RPE ${value}`, exact: true });
      const box = await stop.boundingBox();
      expect(box, `RPE ${value} should be rendered`).not.toBeNull();
      expect(box!.x, `RPE ${value} starts off the left edge`).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width, `RPE ${value} runs past the right edge`).toBeLessThanOrEqual(412);
    }
  });

  test('every stop clears the 44px touch minimum', async ({ page }) => {
    for (const value of VALUES) {
      const box = await page.getByRole('button', { name: `RPE ${value}`, exact: true }).boundingBox();
      expect(box!.width, `RPE ${value} is too narrow to hit`).toBeGreaterThanOrEqual(44);
      expect(box!.height, `RPE ${value} is too short to hit`).toBeGreaterThanOrEqual(44);
    }
  });

  test('picking a value shows what it means, without opening anything', async ({ page }) => {
    await page.getByRole('button', { name: 'RPE 9', exact: true }).click();
    await expect(page.getByText('One rep left in the tank.')).toBeVisible();

    // The half steps had no copy at all until the ruler needed them.
    await page.getByRole('button', { name: 'RPE 8.5', exact: true }).click();
    await expect(page.getByText('Between one and two reps left.')).toBeVisible();
  });

  test('unset says what happens if you leave it', async ({ page }) => {
    await expect(page.getByText(/Leave it and I'll record your target/)).toBeVisible();

    await page.getByRole('button', { name: 'RPE 8', exact: true }).click();
    await expect(page.getByText(/Leave it and I'll record your target/)).toBeHidden();

    // Tapping the chosen one again clears it — unset has to have a way back.
    await page.getByRole('button', { name: 'RPE 8', exact: true }).click();
    await expect(page.getByText(/Leave it and I'll record your target/)).toBeVisible();
  });

  test('the explainer still opens for the fuller story', async ({ page }) => {
    // A link beside the meaning line rather than a lone "?", so it says what it opens.
    await page.getByRole('button', { name: /^What.s RPE\?$/ }).click();
    await expect(page.getByRole('dialog', { name: 'What RPE means' })).toBeVisible();
  });
});

test.describe('the set-type explainer', () => {
  test('the set types explain themselves', async ({ page }) => {
    // Set type is the field whose mistake never shows on screen, so three
    // unlabelled words are not enough on their own.
    await page.getByRole('button', { name: 'What do the set types mean?' }).click();
    const sheet = page.getByRole('dialog', { name: 'What the set types mean' });
    await expect(sheet).toBeVisible();

    await expect(sheet.getByText(/lighter sets after the heavy ones/i)).toBeVisible();
    // It says what each one costs, which is the part that matters.
    await expect(sheet.getByText(/Discounted by how close it got/i)).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();
  });
});
