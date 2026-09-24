import { expect, test } from '@playwright/test';
import { addLift, builder, completeSetup, goToTab, gotoApp, readRoutines, saveBuilder } from './helpers';

// The workout library and builder, after setup is behind you.

test.beforeEach(async ({ page }) => {
  await gotoApp(page);
  await completeSetup(page, { workouts: [['Bench Press', 'Overhead Press']], names: ['Push A'] });
  await goToTab(page, 'Today');
  await page.getByRole('button', { name: 'Open workout library' }).click();
  await expect(page.getByText('Workouts', { exact: true })).toBeVisible();
});

test.describe('the library', () => {
  test('lists your workouts under Mine', async ({ page }) => {
    await expect(page.getByText('Push A')).toBeVisible();
  });

  test('offers a way to build one from nothing', async ({ page }) => {
    // The path that was missing: after setup, the only route to a new workout
    // was copying a template and stripping it back, which is not creating one.
    await page.getByRole('button', { name: '+ New workout' }).click();
    await expect(builder(page)).toBeVisible();

    await builder(page).getByRole('textbox').first().fill('Arms');
    await addLift(page, 'Hammer Curl');
    await saveBuilder(page);

    await expect(page.getByText('Arms')).toBeVisible();
  });

  test('does not offer to create while browsing templates', async ({ page }) => {
    // Templates are not yours to add to — copy one instead.
    await page.getByRole('button', { name: 'Templates', exact: true }).click();
    await expect(page.getByRole('button', { name: '+ New workout' })).toBeHidden();
  });

  test('keeps templates behind their own filter', async ({ page }) => {
    // Templates are never scheduled directly — mixing them into Mine is how
    // "Wendler 5/3/1" stops meaning Wendler 5/3/1.
    await expect(page.getByText('Push Day')).toBeHidden();
    await page.getByRole('button', { name: 'Templates', exact: true }).click();
    await expect(page.getByText('Push Day')).toBeVisible();
  });

  test('copying a template makes an editable copy and leaves the original', async ({ page }) => {
    await page.getByRole('button', { name: 'Templates', exact: true }).click();
    await page.getByRole('button', { name: /Copy/ }).first().click();

    await expect(builder(page)).toBeVisible();
    await saveBuilder(page);

    // The template is still there, unchanged.
    await page.getByRole('button', { name: 'Templates', exact: true }).click();
    await expect(page.getByText('Push Day')).toBeVisible();
  });

  test('a workout can be renamed and gains lifts', async ({ page }) => {
    await page.getByRole('button', { name: /^Edit/ }).first().click();
    await builder(page).getByRole('textbox').first().fill('Chest Focus');
    await addLift(page, 'Cable Fly');
    await saveBuilder(page);

    await expect(page.getByText('Chest Focus')).toBeVisible();
  });

  test('a lift can be removed and reordered', async ({ page }) => {
    await page.getByRole('button', { name: /^Edit/ }).first().click();

    await builder(page).getByRole('button', { name: 'Move down' }).first().click();
    await builder(page).getByRole('button', { name: 'Remove lift' }).first().click();
    await saveBuilder(page);

    await page.getByRole('button', { name: /^Edit/ }).first().click();
    await expect(builder(page).getByRole('button', { name: 'Remove lift' })).toHaveCount(1);
  });

  test('deleting a workout asks first and then removes it', async ({ page }) => {
    page.on('dialog', (dialog) => void dialog.accept());

    await page.getByRole('button', { name: /^Edit/ }).first().click();
    await builder(page).getByRole('button', { name: 'Delete', exact: true }).click();

    await expect(builder(page)).toBeHidden();
    await expect(page.getByText('Push A')).toBeHidden();
  });

  test('a workout with no lifts cannot be saved', async ({ page }) => {
    await page.getByRole('button', { name: /^Edit/ }).first().click();
    await builder(page).getByRole('button', { name: 'Remove lift' }).first().click();
    await builder(page).getByRole('button', { name: 'Remove lift' }).first().click();

    // Nothing to perform is not a workout — the save is disabled rather than
    // writing an empty one and failing later.
    await expect(builder(page).getByRole('button', { name: /^(Save workout|Done)$/ })).toBeDisabled();
  });

  test('Escape closes the builder', async ({ page }) => {
    await page.getByRole('button', { name: /^Edit/ }).first().click();
    await expect(builder(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(builder(page)).toBeHidden();
  });
});

test.describe('the library hero', () => {
  test('leads with what the week still owes', async ({ page }) => {
    // The figure itself is hidden from assistive technology; the sentence
    // beside it is what a screen reader hears, so that is what is checked.
    await expect(page.getByText(/^\d+ sessions? left this week, 0 of \d+ done$/)).toBeAttached();
    // The workout the week is waiting on says so on its row.
    await expect(page.getByText('THIS WEEK', { exact: true })).toBeVisible();
  });

  test('Close returns to where you were', async ({ page }) => {
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Open workout library' })).toBeVisible();
  });
});

test.describe('templates are copied, never trained', () => {
  test('a template offers a copy and nothing else', async ({ page }) => {
    await page.getByRole('button', { name: 'Templates', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Templates', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('button', { name: 'Copy to my workouts' }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Start this workout' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Edit / })).toHaveCount(0);
  });
});

test.describe('one session at a time', () => {
  test('with a session open, only that workout can be continued', async ({ page }) => {
    // A second workout, so there is something that must not start.
    await page.getByRole('button', { name: 'Templates', exact: true }).click();
    await page.getByRole('button', { name: 'Copy to my workouts' }).first().click();
    await saveBuilder(page);
    await page.getByRole('button', { name: 'Close', exact: true }).click();

    await page.getByRole('button', { name: /^(Start workout|Train anyway)$/ }).click();
    await goToTab(page, 'Today');
    await page.getByRole('button', { name: 'Open workout library' }).click();

    await expect(page.getByRole('button', { name: 'Back to session', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Continue session' })).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Finish current session first' })).toBeDisabled();
  });
});

test.describe('importing', () => {
  const file = {
    name: 'bompa-export.json',
    mimeType: 'application/json',
    buffer: Buffer.from(
      JSON.stringify({
        version: 1,
        exportedAt: '2026-09-01T00:00:00.000Z',
        routines: [{ id: 'imported-legs', name: 'Imported Legs', source: 'import', phase: 'strength', estMinutes: 40, slots: [] }],
      }),
    ),
  };

  test('shows what a file holds before writing any of it', async ({ page }) => {
    const before = (await readRoutines(page)).length;

    await page.getByLabel('Bompa export file').setInputFiles(file);
    const found = page.getByRole('group', { name: 'Found in that file' });
    await expect(found).toContainText('1');
    await expect(found).toContainText('routines');
    // Previewing wrote nothing.
    expect((await readRoutines(page)).length).toBe(before);

    // Cancelling writes nothing either, and puts the picker back.
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Choose file' })).toBeVisible();
    expect((await readRoutines(page)).length).toBe(before);

    // Only "Import it" writes.
    await page.getByLabel('Bompa export file').setInputFiles(file);
    await page.getByRole('button', { name: 'Import it' }).click();
    await expect(page.getByRole('button', { name: 'Choose file' })).toBeVisible();
    await expect.poll(async () => (await readRoutines(page)).length).toBe(before + 1);
  });
});
