import { expect, test, type Page } from '@playwright/test';
import { completeSetup, goToTab, gotoApp, skipRest } from './helpers';

// RPE on Train: one compact button that opens a sheet with every value in it.
//
// The sheet's grid replaced a single scrolling row that put 9, 9.5 and 10 off
// screen at 412px — so the hardest sets, the ones adaptation is most sensitive
// to, were the only ones needing a sideways scroll to reach. The geometry checks
// below keep that true now the grid lives in a sheet.

const VALUES = ['6', '6.5', '7', '7.5', '8', '8.5', '9', '9.5', '10'];

type Row = { rpe: number; rpeEstimated: boolean };

/** Every logged set in IndexedDB, oldest first. */
async function readSets(page: Page): Promise<Row[]> {
  const rows = await page.evaluate(async () => {
    const open = indexedDB.open('bompa');
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
    return new Promise<unknown[]>((resolve, reject) => {
      const request = database.transaction('sets').objectStore('sets').getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  });
  return rows as Row[];
}

const rpeButton = (page: Page) => page.getByRole('button', { name: /^RPE: not set, target \d+(\.\d+)? — choose$|^RPE \d+(\.\d+)? — change$/ });
const sheet = (page: Page) => page.getByRole('dialog', { name: 'How hard was that set?' });

async function openPicker(page: Page) {
  await rpeButton(page).click();
  await expect(sheet(page)).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await gotoApp(page);
  await completeSetup(page, { workouts: [['Bench Press']], names: ['Push A'] });
  await goToTab(page, 'Today');
  await page.getByRole('button', { name: /^(Start workout|Train anyway)$/ }).click();
  await goToTab(page, 'Train');
});

test.describe('the RPE button on Train', () => {
  test('unset, it names the target, and no grid sits on the screen', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'RPE: not set, target 8 — choose' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'RPE: not set, target 8 — choose' })).toContainText('RPE 8 · target');
    // The chips only exist inside the sheet.
    await expect(page.getByRole('button', { name: 'RPE 9', exact: true })).toHaveCount(0);
  });

  test('clears the 44px touch minimum', async ({ page }) => {
    const box = await rpeButton(page).boundingBox();
    expect(box!.height, 'the RPE button is too short to hit').toBeGreaterThanOrEqual(44);
    expect(box!.width, 'the RPE button is too narrow to hit').toBeGreaterThanOrEqual(44);
  });

  test('choosing 9 closes the sheet in one tap and the button shows it', async ({ page }) => {
    await openPicker(page);
    await sheet(page).getByRole('button', { name: 'RPE 9', exact: true }).click();
    await expect(sheet(page)).toBeHidden();
    const chosen = page.getByRole('button', { name: 'RPE 9 — change' });
    await expect(chosen).toContainText('RPE 9');
    await expect(chosen).toContainText('One rep left in the tank.');
  });

  test('a chosen value is logged as said, not as an estimate', async ({ page }) => {
    await openPicker(page);
    await sheet(page).getByRole('button', { name: 'RPE 9', exact: true }).click();
    await page.getByRole('button', { name: /^Log set/ }).click();
    await expect.poll(async () => (await readSets(page)).length).toBe(1);
    const [row] = await readSets(page);
    expect(row!.rpe).toBe(9);
    expect(row!.rpeEstimated).toBe(false);

    // The reading belongs to the set it was given for; the next set starts unset.
    await skipRest(page);
    await expect(page.getByRole('button', { name: 'RPE: not set, target 8 — choose' })).toBeVisible();
  });

  test('left alone, the target is logged and marked as an estimate', async ({ page }) => {
    await page.getByRole('button', { name: /^Log set/ }).click();
    await expect.poll(async () => (await readSets(page)).length).toBe(1);
    const [row] = await readSets(page);
    expect(row!.rpe).toBe(8);
    expect(row!.rpeEstimated).toBe(true);
  });

  test('Clear goes back to logging the target', async ({ page }) => {
    await openPicker(page);
    // Nothing chosen yet, so there is nothing to clear.
    await expect(sheet(page).getByRole('button', { name: 'Clear — log my target' })).toHaveCount(0);
    await sheet(page).getByRole('button', { name: 'RPE 9', exact: true }).click();

    await openPicker(page);
    await sheet(page).getByRole('button', { name: 'Clear — log my target' }).click();
    await expect(sheet(page)).toBeHidden();
    await expect(page.getByRole('button', { name: 'RPE: not set, target 8 — choose' })).toBeVisible();

    await page.getByRole('button', { name: /^Log set/ }).click();
    await expect.poll(async () => (await readSets(page)).length).toBe(1);
    expect((await readSets(page))[0]!.rpeEstimated).toBe(true);
  });

  test('Escape closes the sheet without changing anything', async ({ page }) => {
    await openPicker(page);
    await sheet(page).getByRole('button', { name: 'RPE 9', exact: true }).click();

    await openPicker(page);
    await page.keyboard.press('Escape');
    await expect(sheet(page)).toBeHidden();
    await expect(page.getByRole('button', { name: 'RPE 9 — change' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'RPE 9 — change' })).toBeFocused();
  });
});

test.describe('the RPE picker sheet', () => {
  test.beforeEach(async ({ page }) => {
    await openPicker(page);
  });

  test('every value is on screen at 412px, none needs a scroll', async ({ page }) => {
    for (const value of VALUES) {
      const stop = sheet(page).getByRole('button', { name: `RPE ${value}`, exact: true });
      await expect(stop).toBeInViewport({ ratio: 1 });
      const box = await stop.boundingBox();
      expect(box, `RPE ${value} should be rendered`).not.toBeNull();
      expect(box!.x, `RPE ${value} starts off the left edge`).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width, `RPE ${value} runs past the right edge`).toBeLessThanOrEqual(412);
    }
  });

  test('the sheet sits over the Log button, not under it', async ({ page }) => {
    // The picker is drawn outside the swiping column; inside it, the column's
    // transform would trap the sheet beneath the sticky Log button.
    const log = await page.getByRole('button', { name: /^Log set/ }).boundingBox();
    const onTop = await page.evaluate(
      ({ x, y }) => Boolean(document.elementFromPoint(x, y)?.closest('[role="dialog"]')),
      { x: log!.x + log!.width / 2, y: log!.y + log!.height / 2 },
    );
    expect(onTop, 'a tap where the Log button is should land on the sheet').toBe(true);
  });

  test('every stop clears the 44px touch minimum', async ({ page }) => {
    for (const value of VALUES) {
      const box = await sheet(page).getByRole('button', { name: `RPE ${value}`, exact: true }).boundingBox();
      expect(box!.width, `RPE ${value} is too narrow to hit`).toBeGreaterThanOrEqual(44);
      expect(box!.height, `RPE ${value} is too short to hit`).toBeGreaterThanOrEqual(44);
    }
  });

  test('unset, it says what happens if you leave it', async ({ page }) => {
    await expect(sheet(page).getByText(/Leave it and I'll record your target of 8/)).toBeVisible();
  });

  test('tapping the chosen value again clears it', async ({ page }) => {
    // Unset has to have a way back, and the chip itself is the obvious one.
    await sheet(page).getByRole('button', { name: 'RPE 8.5', exact: true }).click();
    await expect(page.getByRole('button', { name: 'RPE 8.5 — change' })).toContainText('Between one and two reps left.');

    await openPicker(page);
    await sheet(page).getByRole('button', { name: 'RPE 8.5', exact: true }).click();
    await expect(sheet(page)).toBeHidden();
    await expect(page.getByRole('button', { name: 'RPE: not set, target 8 — choose' })).toBeVisible();
  });

  test('the explainer still opens for the fuller story, and closing it lands back on the button', async ({ page }) => {
    // A link beside the meaning line rather than a lone "?", so it says what it opens.
    await sheet(page).getByRole('button', { name: /^What.s RPE\?$/ }).click();
    const explainer = page.getByRole('dialog', { name: 'What RPE means' });
    await expect(explainer).toBeVisible();
    await expect(sheet(page)).toBeHidden();

    await page.keyboard.press('Escape');
    await expect(explainer).toBeHidden();
    await expect(page.getByRole('button', { name: 'RPE: not set, target 8 — choose' })).toBeFocused();
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
