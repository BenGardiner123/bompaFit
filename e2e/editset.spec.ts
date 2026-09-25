import { expect, test } from '@playwright/test';
import { completeSetup, goToTab, gotoApp, skipRest } from './helpers';

// Amending a set that is already logged. Until this existed the only correction
// was to delete the row and log it again, which loses the original timestamp.

test.beforeEach(async ({ page }) => {
  await gotoApp(page);
  await completeSetup(page, { workouts: [['Bench Press', 'Overhead Press']], names: ['Push A'] });
  await goToTab(page, 'Today');
  await page.getByRole('button', { name: /^(Start .+|Train anyway)$/ }).click();
  await goToTab(page, 'Train');
  await page.getByRole('button', { name: 'Log set' }).click();
  // Logging opens the full-screen rest over the set dots.
  await skipRest(page);
  await expect(page.getByRole('button', { name: 'Edit set 1' })).toBeVisible();
});

test.describe('editing a logged set', () => {
  test("a set's dot opens the editor, and the editor is where it is deleted", async ({ page }) => {
    // Train shows sets as dots, so amending and deleting both live in the sheet.
    await page.getByRole('button', { name: 'Edit set 1' }).click();
    const sheet = page.getByRole('dialog', { name: 'Edit logged set' });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole('button', { name: 'Delete', exact: true })).toBeVisible();
  });

  test('changes reps and RPE, and they stick through a reload', async ({ page }) => {
    await page.getByRole('button', { name: 'Edit set 1' }).click();
    const sheet = page.getByRole('dialog', { name: 'Edit logged set' });

    await sheet.getByRole('button', { name: 'Increase reps' }).click();
    await sheet.getByRole('button', { name: 'RPE 9.5' }).click();
    await sheet.getByRole('button', { name: 'Save changes' }).click();

    await expect(sheet).toBeHidden();
    // The dot's name carries the set's detail, which is how Train reports it.
    await expect(page.getByRole('button', { name: /^Edit set 1\b.*@9\.5/ })).toBeAttached();

    await page.reload();
    await goToTab(page, 'Train');
    await expect(page.getByRole('button', { name: /^Edit set 1\b.*@9\.5/ })).toBeAttached();
  });

  test('cancelling writes nothing', async ({ page }) => {
    const before = await page.getByRole('button', { name: 'Edit set 1' }).innerText();

    await page.getByRole('button', { name: 'Edit set 1' }).click();
    const sheet = page.getByRole('dialog', { name: 'Edit logged set' });
    await sheet.getByRole('button', { name: 'Increase reps' }).click();
    await sheet.getByRole('button', { name: 'Cancel' }).click();

    await expect(sheet).toBeHidden();
    expect(await page.getByRole('button', { name: 'Edit set 1' }).innerText()).toBe(before);
  });

  test('Escape closes it', async ({ page }) => {
    await page.getByRole('button', { name: 'Edit set 1' }).click();
    const sheet = page.getByRole('dialog', { name: 'Edit logged set' });
    await expect(sheet).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();
  });

  test('a tap inside keeps it open; a backdrop tap closes it', async ({ page }) => {
    await page.getByRole('button', { name: 'Edit set 1' }).click();
    const sheet = page.getByRole('dialog', { name: 'Edit logged set' });

    // Exact, because "RPE 8" is also a prefix of "RPE 8.5".
    await sheet.getByRole('button', { name: 'RPE 8', exact: true }).click();
    await expect(sheet).toBeVisible();

    // The dialog element is the full-screen backdrop with the sheet sitting at
    // the bottom of it, so its top-left corner is backdrop rather than sheet.
    await sheet.click({ position: { x: 5, y: 5 } });
    await expect(sheet).toBeHidden();
  });

  test('Delete in the editor removes the set', async ({ page }) => {
    await page.getByRole('button', { name: 'Edit set 1' }).click();
    const sheet = page.getByRole('dialog', { name: 'Edit logged set' });
    await sheet.getByRole('button', { name: 'Delete', exact: true }).click();

    await expect(sheet).toBeHidden();
    await expect(page.getByRole('button', { name: 'Edit set 1' })).toBeHidden();

    // Gone from storage too, not just from the screen.
    await page.reload();
    await goToTab(page, 'Train');
    await expect(page.getByRole('button', { name: 'Log set' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Edit set 1' })).toBeHidden();
  });

  test('a set can be corrected to a warm-up, which drops it from the count', async ({ page }) => {
    // The chip counts working sets only, so reclassifying has to move it.
    await page.getByRole('button', { name: 'Edit set 1' }).click();
    const sheet = page.getByRole('dialog', { name: 'Edit logged set' });
    await sheet.getByRole('button', { name: 'Warm-up', exact: true }).click();
    await sheet.getByRole('button', { name: 'Save changes' }).click();

    await expect(sheet).toBeHidden();
    // Warm-ups render as W rather than a set number.
    await expect(page.getByRole('button', { name: 'Edit set 1' })).toContainText('W');
  });
});
