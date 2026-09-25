import { expect, test } from '@playwright/test';
import { completeSetup, goToTab, gotoApp, openSettings, openSettingsView, readRoutines, settingsSheet, setupHeading } from './helpers';

// The Settings sheet, opened from the gear on Today: you, your data, the
// longer settings as screens of their own, and starting over.

test.beforeEach(async ({ page }) => {
  await gotoApp(page);
  await completeSetup(page, { workouts: [['Bench Press', 'Overhead Press']], names: ['Push A'] });
});

test.describe('opening and closing', () => {
  test('the gear on Today opens it, and the close button and Escape shut it', async ({ page }) => {
    await openSettings(page);
    await settingsSheet(page).getByRole('button', { name: 'Close', exact: true }).click();
    await expect(settingsSheet(page)).toBeHidden();

    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await expect(settingsSheet(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(settingsSheet(page)).toBeHidden();
  });

  test('covers the tab bar, so nothing behind it can be tapped by mistake', async ({ page }) => {
    await openSettings(page);
    const nav = page.getByRole('navigation', { name: 'Main' });
    // Whatever is drawn where the Plan tab sits belongs to the sheet.
    const tab = (await nav.getByRole('button', { name: 'Plan' }).boundingBox())!;
    const onTop = await page.evaluate(
      ({ x, y }) => Boolean(document.elementFromPoint(x, y)?.closest('[role="dialog"][aria-label="Settings"]')),
      { x: tab.x + tab.width / 2, y: tab.y + tab.height / 2 },
    );
    expect(onTop).toBe(true);
  });
});

test.describe('you', () => {
  test('units switch between kilograms and pounds, and survive a reload', async ({ page }) => {
    await openSettings(page);
    const units = settingsSheet(page).getByRole('group', { name: 'Units' });
    await units.getByRole('button', { name: 'lb', exact: true }).click();
    await expect(units.getByRole('button', { name: 'lb', exact: true })).toHaveAttribute('aria-pressed', 'true');

    // The setting is a display preference; storage always stays in kilograms.
    await page.reload();
    await openSettings(page);
    await expect(settingsSheet(page).getByRole('group', { name: 'Units' }).getByRole('button', { name: 'lb', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  test('the unit choice reaches the logger', async ({ page }) => {
    await openSettings(page);
    await settingsSheet(page).getByRole('button', { name: 'lb', exact: true }).click();
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: /^(Start .+|Train anyway)$/ }).click();
    await goToTab(page, 'Train');
    await expect(page.getByText(/lb/i).first()).toBeVisible();
  });

  test('week start switches and survives a reload', async ({ page }) => {
    await openSettings(page);
    const week = settingsSheet(page).getByRole('group', { name: 'Week starts' });
    await expect(week.getByRole('button', { name: 'Mon', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await week.getByRole('button', { name: 'Sun', exact: true }).click();

    await page.reload();
    await openSettings(page);
    await expect(settingsSheet(page).getByRole('group', { name: 'Week starts' }).getByRole('button', { name: 'Sun', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });
});

test.describe('your data', () => {
  test('exports a complete JSON backup, and says how old the last one is', async ({ page }) => {
    await openSettings(page);
    // No save dialog and no share sheet, so the plain download is what runs.
    // Set after load rather than in an init script: Chromium installs its own
    // picker after init scripts run, over the top of anything put there.
    await page.evaluate(() => {
      delete (window as { showSaveFilePicker?: unknown }).showSaveFilePicker;
      Object.defineProperty(navigator, 'canShare', { value: () => false, configurable: true });
    });
    await expect(settingsSheet(page).getByText(/^No backup yet/)).toBeVisible();

    const download = page.waitForEvent('download');
    await settingsSheet(page).getByRole('button', { name: 'Export backup' }).click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/\.json$/);
    // A download cannot report whether it landed, so the message says where to look.
    await expect(page.getByText('Backup downloaded. Check your downloads for the file.')).toBeVisible();
    await expect(settingsSheet(page).getByText('Last backup today.')).toBeVisible();

    // Remembered, because a line that forgot on reload would say "never" about
    // a backup that exists.
    await page.reload();
    await openSettings(page);
    await expect(settingsSheet(page).getByText('Last backup today.')).toBeVisible();
  });

  test('with a save dialog, the backup is recorded only once the file is written, and not at all when the dialog is closed', async ({ page }) => {
    await openSettings(page);
    // Stands in for the browser's save dialog: the first call is closed, the
    // second writes. Nothing reaches a real disk.
    await page.evaluate(() => {
      let calls = 0;
      (window as unknown as { savedBytes: number }).savedBytes = 0;
      (window as unknown as { showSaveFilePicker: () => Promise<unknown> }).showSaveFilePicker = async () => {
        calls += 1;
        if (calls === 1) throw new DOMException('closed', 'AbortError');
        return {
          createWritable: async () => ({
            write: async (blob: Blob) => {
              (window as unknown as { savedBytes: number }).savedBytes += blob.size;
            },
            close: async () => undefined,
          }),
        };
      };
    });
    const exportButton = settingsSheet(page).getByRole('button', { name: 'Export backup' });

    await exportButton.click();
    await expect(settingsSheet(page).getByText(/^No backup yet/)).toBeVisible();

    await exportButton.click();
    await expect(page.getByText('Saved. That file is a complete backup.')).toBeVisible();
    await expect(settingsSheet(page).getByText('Last backup today.')).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { savedBytes: number }).savedBytes)).toBeGreaterThan(0);
  });

  test('a restore shows what the file holds and writes nothing until "Import it"', async ({ page }) => {
    const file = {
      name: 'bompa-backup.json',
      mimeType: 'application/json',
      buffer: Buffer.from(
        JSON.stringify({
          version: 1,
          exportedAt: '2026-09-01T00:00:00.000Z',
          routines: [{ id: 'restored-legs', name: 'Restored Legs', source: 'import', phase: 'strength', estMinutes: 40, slots: [] }],
        }),
      ),
    };
    await openSettings(page);
    const sheet = settingsSheet(page);
    const before = (await readRoutines(page)).length;

    await sheet.getByLabel('Bompa backup file').setInputFiles(file);
    await expect(sheet.getByRole('group', { name: 'Found in that file' })).toContainText('routines');
    expect((await readRoutines(page)).length).toBe(before);

    await sheet.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(sheet.getByRole('group', { name: 'Found in that file' })).toBeHidden();
    expect((await readRoutines(page)).length).toBe(before);

    await sheet.getByLabel('Bompa backup file').setInputFiles(file);
    await sheet.getByRole('button', { name: 'Import it' }).click();
    await expect.poll(async () => (await readRoutines(page)).length).toBe(before + 1);
  });

  test('a file that is not a backup is refused in words, shown over the sheet', async ({ page }) => {
    await openSettings(page);
    await settingsSheet(page)
      .getByLabel('Bompa backup file')
      .setInputFiles({ name: 'notes.json', mimeType: 'application/json', buffer: Buffer.from('not json at all') });

    const said = page.getByText("That file isn't valid JSON. Check it's the file Bompa exported.");
    await expect(said).toBeVisible();
    // Drawn on top of the sheet, not hidden underneath it.
    const box = (await said.boundingBox())!;
    const onTop = await page.evaluate(
      ({ x, y }) => Boolean(document.elementFromPoint(x, y)?.closest('[role="status"]')),
      { x: box.x + box.width / 2, y: box.y + box.height / 2 },
    );
    expect(onTop).toBe(true);
    await expect(settingsSheet(page)).toBeVisible();
  });

  test('says which build this is', async ({ page }) => {
    // Version, the commit it was built from, and the build date: how to tell
    // an installed copy has picked up a new deploy.
    await openSettings(page);
    await expect(settingsSheet(page).getByText(/^Bompa \d+\.\d+\.\d+ · build [0-9a-f]{7}|dev · \d{4}-\d{2}-\d{2}$/)).toBeAttached();
  });
});

test.describe('the longer settings', () => {
  for (const [row, heading, inside] of [
    ['Timer alerts', 'Alerts', 'Sound'],
    ['Default warm-up', 'Warm-up', 'Default warm-up'],
    ['Exercise instructions', 'Exercise instructions', 'Exercise instruction library'],
  ] as const) {
    test(`${row} opens a screen of its own, and Back returns to the sheet`, async ({ page }) => {
      await openSettingsView(page, row);
      await expect(page.getByRole('heading', { name: heading, level: 1 })).toBeVisible();
      await expect(page.getByText(inside, { exact: true }).first()).toBeVisible();

      await page.getByRole('button', { name: 'Back to Settings' }).click();
      await expect(settingsSheet(page)).toBeVisible();
    });
  }
});

test.describe('starting over', () => {
  test('Run setup again opens setup', async ({ page }) => {
    await openSettings(page);
    await settingsSheet(page).getByRole('button', { name: 'Run setup again' }).click();
    await expect(setupHeading(page)).toBeVisible();
    await expect(settingsSheet(page)).toBeHidden();
  });

  test('Erase asks first, and Cancel goes back to Settings with everything where it was', async ({ page }) => {
    await openSettings(page);
    await settingsSheet(page).getByRole('button', { name: 'Erase everything…' }).click();

    const ask = page.getByRole('dialog', { name: 'Erase everything?' });
    await expect(ask).toBeVisible();
    await expect(settingsSheet(page)).toBeHidden();
    await ask.getByRole('button', { name: 'Cancel' }).click();
    await expect(ask).toBeHidden();
    await expect(settingsSheet(page)).toBeVisible();
    await expect(setupHeading(page)).toBeHidden();
  });

  test('Erase clears the database and returns to setup', async ({ page }) => {
    await openSettings(page);
    await settingsSheet(page).getByRole('button', { name: 'Erase everything…' }).click();
    await page.getByRole('dialog', { name: 'Erase everything?' }).getByRole('button', { name: 'Erase everything', exact: true }).click();

    // Erase deletes the database, so setupComplete goes with it and the app
    // legitimately starts over with setup.
    await expect(setupHeading(page)).toBeVisible({ timeout: 15_000 });
  });
});
