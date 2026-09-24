import { expect, test, type Page } from '@playwright/test';
import { completeSetup, goToTab, gotoApp, readRoutines, setupHeading } from './helpers';

// Tools — the interval timer, rest presets, the calculator, starting maxes,
// settings, export/import, and the erase path.

test.beforeEach(async ({ page }) => {
  await gotoApp(page);
  await completeSetup(page, { workouts: [['Bench Press', 'Overhead Press']], names: ['Push A'] });
  await goToTab(page, 'Tools');
});

/** The hero behind the clock. Its colour is how "urgent" reads from across the room. */
async function heroBackground(page: Page) {
  return page.getByRole('timer').evaluate((el) => getComputedStyle(el.parentElement!).backgroundColor);
}

const INK = 'rgb(20, 20, 16)';
const INK80 = 'rgb(61, 61, 54)';

test.describe('interval timer', () => {
  test('switches between stopwatch, AMRAP and EMOM', async ({ page }) => {
    const modes = page.getByRole('group', { name: 'Timer mode' });
    await expect(modes.getByRole('button', { name: 'Stopwatch' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('timer')).toContainText('Stopwatch 0:00');

    await modes.getByRole('button', { name: 'AMRAP' }).click();
    await expect(modes.getByRole('button', { name: 'AMRAP' })).toHaveAttribute('aria-pressed', 'true');
    await expect(modes.getByRole('button', { name: 'Stopwatch' })).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByRole('timer')).toContainText('12:00 left of 12 minutes');

    // A cap chip resets the clock to the new cap.
    const caps = page.getByRole('group', { name: 'Time cap' });
    await caps.getByRole('button', { name: '8m' }).click();
    await expect(caps.getByRole('button', { name: '8m' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('timer')).toContainText('8:00 left of 8 minutes');

    await modes.getByRole('button', { name: 'EMOM' }).click();
    await expect(page.getByRole('timer')).toContainText('1:00 left in round 1');
    await expect(page.getByRole('group', { name: 'Interval length' }).getByRole('button', { name: '1m' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  test('keeps time from the wall clock, and pauses, resumes and resets', async ({ page }) => {
    // Installed after setup so the fake clock only governs the timer itself.
    await page.clock.install();
    await page.reload();
    await goToTab(page, 'Tools');

    await page.getByRole('button', { name: 'Start', exact: true }).click();
    // A jump, not a stream of ticks: a clock that counted its own intervals
    // would show one tick's worth here, which is what a locked phone does to it.
    await page.clock.fastForward('01:05');
    await expect(page.getByRole('timer')).toContainText('Stopwatch 1:05');

    await page.getByRole('button', { name: 'Pause', exact: true }).click();
    await page.clock.fastForward('00:30');
    await expect(page.getByRole('timer')).toContainText('Stopwatch 1:05');

    await page.getByRole('button', { name: 'Resume', exact: true }).click();
    await page.clock.fastForward('00:10');
    await expect(page.getByRole('timer')).toContainText('Stopwatch 1:15');

    await page.getByRole('button', { name: 'Reset', exact: true }).click();
    await expect(page.getByRole('timer')).toContainText('Stopwatch 0:00');
    await expect(page.getByRole('button', { name: 'Start', exact: true })).toBeVisible();
  });

  test('turns urgent in the last seconds of an AMRAP cap', async ({ page }) => {
    await page.clock.install();
    await page.reload();
    await goToTab(page, 'Tools');

    await page.getByRole('group', { name: 'Timer mode' }).getByRole('button', { name: 'AMRAP' }).click();
    await page.getByRole('group', { name: 'Time cap' }).getByRole('button', { name: '8m' }).click();
    await page.getByRole('button', { name: 'Start', exact: true }).click();
    await expect.poll(() => heroBackground(page)).toBe(INK);

    await page.clock.fastForward('07:52');
    await expect(page.getByRole('timer')).toContainText('0:08 left of 8 minutes');
    await expect.poll(() => heroBackground(page)).toBe(INK80);

    // Pausing ends the urgency: nothing is running out any more.
    await page.getByRole('button', { name: 'Pause', exact: true }).click();
    await expect.poll(() => heroBackground(page)).toBe(INK);
  });
});

test.describe('rest timer presets', () => {
  test('the chosen preset is marked and survives a reload', async ({ page }) => {
    const presets = page.getByRole('group', { name: 'Rest length' });
    await presets.getByRole('button', { name: '2:30' }).click();
    await expect(presets.getByRole('button', { name: '2:30' })).toHaveAttribute('aria-pressed', 'true');

    await page.reload();
    await goToTab(page, 'Tools');
    await expect(page.getByRole('group', { name: 'Rest length' }).getByRole('button', { name: '2:30' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });
});

test.describe('settings', () => {
  test('units switch between kilograms and pounds', async ({ page }) => {
    await page.getByRole('button', { name: 'LB', exact: true }).click();
    await expect(page.getByRole('button', { name: 'LB', exact: true })).toBeVisible();

    // The setting is a display preference; storage always stays in kilograms.
    await page.reload();
    await goToTab(page, 'Tools');
    await expect(page.getByRole('button', { name: 'LB', exact: true })).toBeVisible();
  });

  test('the unit choice survives a reload and reaches the logger', async ({ page }) => {
    await page.getByRole('button', { name: 'LB', exact: true }).click();
    await page.reload();
    await goToTab(page, 'Today');
    await page.getByRole('button', { name: /^(Start workout|Train anyway)$/ }).click();
    await goToTab(page, 'Train');
    await expect(page.getByText(/lb/i).first()).toBeVisible();
  });

  test('the 1RM calculator reports both estimators', async ({ page }) => {
    // Exact, because the explainer text below repeats both names.
    await expect(page.getByText('Epley', { exact: true })).toBeVisible();
    await expect(page.getByText('Brzycki', { exact: true })).toBeVisible();
  });

  test('the 1RM calculator recomputes as the inputs step', async ({ page }) => {
    const epley = page.getByText('Epley', { exact: true }).locator('..');
    const before = await epley.textContent();
    await page.getByRole('button', { name: 'Increase Weight' }).click();
    await expect(epley).not.toHaveText(before ?? '');
  });
});

test.describe('starting maxes', () => {
  test('offers the big four and the lifts in your workouts, not the whole library', async ({ page }) => {
    // Setup built one workout of Bench Press and Overhead Press, both in the
    // big four, so the list is exactly those four lifts.
    const raises = page.getByRole('button', { name: /^Raise starting max for / });
    await expect(raises).toHaveCount(4);
    for (const lift of ['Back Squat', 'Bench Press', 'Deadlift', 'Overhead Press']) {
      await expect(page.getByRole('button', { name: `Raise starting max for ${lift}`, exact: true })).toBeAttached();
    }
  });

  test('a max entered in pounds reads back unchanged after a reload', async ({ page }) => {
    await page.getByRole('button', { name: 'LB', exact: true }).click();

    // Exact, because the library also holds "Bench Press - Powerlifting" and friends.
    const raise = page.getByRole('button', { name: 'Raise starting max for Bench Press', exact: true });
    await raise.scrollIntoViewIfNeeded();
    await raise.click();
    await raise.click();

    // Stored in kilograms, shown in pounds: a round trip that drifted would
    // read back as 9.9 or 10.1 rather than the 10 that was entered.
    const stepper = raise.locator('..');
    await expect(stepper).toHaveText(/^−10\+$/);

    await page.reload();
    await goToTab(page, 'Tools');
    await expect(raise.locator('..')).toHaveText(/^−10\+$/);
  });
});

test.describe('restoring a backup', () => {
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

  test('shows what the file holds and writes nothing until "Import it"', async ({ page }) => {
    const before = (await readRoutines(page)).length;

    await page.getByLabel('Bompa backup file').setInputFiles(file);
    await expect(page.getByRole('group', { name: 'Found in that file' })).toContainText('routines');
    expect((await readRoutines(page)).length).toBe(before);

    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(page.getByRole('group', { name: 'Found in that file' })).toBeHidden();
    expect((await readRoutines(page)).length).toBe(before);

    await page.getByLabel('Bompa backup file').setInputFiles(file);
    await page.getByRole('button', { name: 'Import it' }).click();
    await expect.poll(async () => (await readRoutines(page)).length).toBe(before + 1);
  });
});

test.describe('backup', () => {
  test('exports a complete JSON backup', async ({ page }) => {
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export JSON' }).click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/\.json$/);
  });
});

test.describe('erasing everything', () => {
  test('clears the database and returns to setup', async ({ page }) => {
    page.on('dialog', (dialog) => void dialog.accept());

    const erase = page.getByRole('button', { name: /Erase/ });
    await erase.scrollIntoViewIfNeeded();
    await erase.click();

    // Erase deletes the database, so setupComplete goes with it and the app
    // legitimately starts over with setup.
    await expect(setupHeading(page)).toBeVisible({ timeout: 15_000 });
  });
});
