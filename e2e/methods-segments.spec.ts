import { expect, test, type Page } from '@playwright/test';
import path from 'node:path';
import { goToTab, gotoApp, restScreen, skipRest, skipSetup } from './helpers';

// Drop sets, clusters and rest-pause on the Train screen: one set made of
// several logged rows. What these check is that the pieces stay one set — in
// the rest timer, in history, in the Edit Set sheet and when deleted.

const FIXTURE = path.join(__dirname, 'fixtures', 'methods.json');

type Row = { id: number; sessionId: number; exerciseId: string; setNo: number; type: string; weightKg: number; reps: number; segment?: number };

/** Every logged row in IndexedDB, oldest first. */
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

async function importFixture(page: Page) {
  await goToTab(page, 'Tools');
  await page.getByLabel('Bompa backup file').setInputFiles(FIXTURE);
  await page.getByRole('button', { name: 'Import it' }).click();
  await expect.poll(async () => (await readSets(page)).length).toBe(4);
  // The restore writes to storage; a fresh load is what reads it back in.
  await page.reload();
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible({ timeout: 15_000 });
}

async function startPieces(page: Page) {
  await goToTab(page, 'Today');
  await page.getByRole('button', { name: 'Open workout library' }).click();
  const row = page
    .locator('div')
    .filter({ hasText: 'Methods · pieces' })
    .filter({ has: page.getByRole('button', { name: 'Start this workout' }) })
    .last();
  await row.getByRole('button', { name: 'Start this workout' }).click();
  await goToTab(page, 'Train');
  await expect(page.getByRole('heading', { name: /Bench Press/ })).toBeVisible();
}

function card(page: Page) {
  return page.getByRole('region', { name: 'Set in progress' });
}

function logButton(page: Page) {
  // Mid-set the button reads Log drop or Log piece.
  return page.getByRole('button', { name: /^Log (set|drop|piece)/ });
}

/** The weight the log button is about to write, read off its label. */
async function entryWeight(page: Page): Promise<number> {
  const text = (await logButton(page).textContent()) ?? '';
  const match = /([\d.]+)\s*×/.exec(text);
  return Number(match?.[1]);
}

async function pickLift(page: Page, short: string) {
  await page.getByRole('button', { name: new RegExp(`^${short}\\b`) }).first().click();
}

test.beforeEach(async ({ page }) => {
  await page.clock.install();
  await gotoApp(page);
  await skipSetup(page);
  await importFixture(page);
});

test.describe('a planned drop set', () => {
  test('the first piece starts no rest and the card moves on to the lighter drop', async ({ page }) => {
    await startPieces(page);
    const top = await entryWeight(page);

    await logButton(page).click();
    await expect(restScreen(page)).toBeHidden();
    await expect(card(page)).toContainText('Drop 1 of 2');
    await expect(card(page)).toContainText('as many as possible');
    const first = await entryWeight(page);
    expect(first).toBeLessThan(top);

    await logButton(page).click();
    await expect(restScreen(page)).toBeHidden();
    await expect(card(page)).toContainText('Drop 2 of 2');
    expect(await entryWeight(page)).toBeLessThan(first);

    // The last drop ends the set, and only then does the full rest start.
    await logButton(page).click();
    await expect(card(page)).toBeHidden();
    await expect(restScreen(page)).toBeVisible();

    const rows = (await readSets(page)).filter((row) => row.sessionId !== 1);
    expect(rows.map((row) => row.segment ?? 0)).toEqual([0, 1, 2]);
    expect(new Set(rows.map((row) => row.setNo)).size).toBe(1);
    expect(rows[1]!.weightKg).toBeLessThan(rows[0]!.weightKg);
    expect(rows[2]!.weightKg).toBeLessThan(rows[1]!.weightKg);
  });
  test('the three rows show as one set on the dots', async ({ page }) => {
    await startPieces(page);
    for (let i = 0; i < 3; i++) await logButton(page).click();
    await skipRest(page);
    await expect(page.getByRole('group', { name: '1 of 3 sets logged' })).toBeVisible();
  });

  test('End set finishes early and starts the full rest', async ({ page }) => {
    await startPieces(page);
    await logButton(page).click();
    await card(page).getByRole('button', { name: 'End set' }).click();
    await expect(card(page)).toBeHidden();
    await expect(restScreen(page)).toBeVisible();
    expect((await readSets(page)).filter((row) => row.sessionId !== 1)).toHaveLength(1);
  });

  test('changing lift mid-set ends the set where it stands', async ({ page }) => {
    await startPieces(page);
    await logButton(page).click();
    await expect(card(page)).toBeVisible();

    await pickLift(page, 'Dead');
    await expect(card(page)).toBeHidden();
    if (await restScreen(page).isVisible()) await skipRest(page);
    await expect(page.getByRole('heading', { name: /Deadlift/ })).toBeVisible();

    await logButton(page).click();
    const rows = (await readSets(page)).filter((row) => row.sessionId !== 1);
    expect(rows.map((row) => [row.exerciseId, row.segment ?? 0])).toEqual([
      ['barbell-bench-press', 0],
      ['deadlift', 0],
    ]);
  });

  test('a reload mid-set ends the set at the last piece logged', async ({ page }) => {
    await startPieces(page);
    await logButton(page).click();
    await expect(card(page)).toBeVisible();
    await expect.poll(async () => (await readSets(page)).length).toBe(5);

    await page.reload();
    await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible({ timeout: 15_000 });
    await goToTab(page, 'Train');
    await expect(card(page)).toBeHidden();

    // The next press is a new set, not a drop of the one before the reload.
    await logButton(page).click();
    await expect.poll(async () => (await readSets(page)).length).toBe(6);
    const rows = (await readSets(page)).filter((row) => row.sessionId !== 1);
    expect(rows.map((row) => [row.setNo, row.segment ?? 0])).toEqual([
      [1, 0],
      [2, 0],
    ]);
  });
});

test.describe('a mechanical drop', () => {
  test('keeps the weight and names what changes', async ({ page }) => {
    await startPieces(page);
    await pickLift(page, 'Fly');
    const top = await entryWeight(page);
    await logButton(page).click();
    await expect(card(page)).toContainText('Drop 1 of 1');
    await expect(card(page)).toContainText('now: flat');
    expect(await entryWeight(page)).toBe(top);
  });
});

test.describe('a cluster', () => {
  test('singles are separated by an inline countdown, never the full-screen rest', async ({ page }) => {
    await startPieces(page);
    await pickLift(page, 'Dead');

    await logButton(page).click();
    await expect(restScreen(page)).toBeHidden();
    await expect(card(page)).toContainText('Single 2 of 5');
    const timer = card(page).getByRole('timer');
    await expect(timer).toHaveAccessibleName('Next single in 0:15');

    // A locked phone: the page's clock jumps and nothing ticks in between.
    await page.clock.fastForward(10_000);
    await expect(timer).toHaveAccessibleName(/Next single in 0:0[45]/);
    await expect(restScreen(page)).toBeHidden();

    await page.clock.fastForward(6_000);
    await expect(timer).toBeHidden();
    await expect(card(page)).toContainText('Single 2 of 5');

    // The log button is live throughout, pause or not.
    for (let single = 2; single <= 4; single++) {
      await logButton(page).click();
      await expect(card(page)).toContainText(`Single ${single + 1} of 5`);
      await expect(restScreen(page)).toBeHidden();
    }
    await logButton(page).click();
    await expect(card(page)).toBeHidden();
    await expect(restScreen(page)).toBeVisible();

    const rows = (await readSets(page)).filter((row) => row.sessionId !== 1);
    expect(rows.map((row) => row.segment ?? 0)).toEqual([0, 1, 2, 3, 4]);
    expect(rows.every((row) => row.reps === 1 && row.setNo === 1)).toBe(true);
  });
});

test.describe('rest-pause to a total', () => {
  test('the set ends itself on the piece that reaches the total', async ({ page }) => {
    await startPieces(page);
    await pickLift(page, 'Pulldown');

    await logButton(page).click();
    await expect(card(page)).toContainText(/6 of 50 reps/);

    // Each piece defaults to what the last one managed, trimmed to what is left,
    // so eight more presses land exactly on 50.
    for (let i = 0; i < 7; i++) {
      await logButton(page).click();
      await expect(card(page)).toBeVisible();
    }
    await expect(card(page)).toContainText(/48 of 50 reps/);
    await logButton(page).click();
    await expect(card(page)).toBeHidden();
    await expect(restScreen(page)).toBeVisible();

    const rows = (await readSets(page)).filter((row) => row.sessionId !== 1);
    expect(rows.reduce((total, row) => total + row.reps, 0)).toBe(50);
  });
});

test.describe('an unplanned drop', () => {
  test('+ Drop on the rest screen cancels the rest and continues the set 20% lighter', async ({ page }) => {
    await startPieces(page);
    await pickLift(page, 'Fly');
    await logButton(page).click();
    await logButton(page).click();
    await expect(restScreen(page)).toBeVisible();

    await restScreen(page).getByRole('button', { name: 'Drop the weight and carry on this set' }).click();
    await expect(restScreen(page)).toBeHidden();
    await expect(card(page)).toContainText('Drop 2');
    const rows = (await readSets(page)).filter((row) => row.sessionId !== 1);
    const lastKg = rows[rows.length - 1]!.weightKg;
    const dropped = await entryWeight(page);
    expect(dropped).toBeLessThan(lastKg);
    expect(dropped).toBeGreaterThanOrEqual(lastKg * 0.8 - 2.5);

    await logButton(page).click();
    await expect(restScreen(page)).toBeVisible();
    const after = (await readSets(page)).filter((row) => row.sessionId !== 1);
    expect(after.map((row) => [row.setNo, row.segment ?? 0])).toEqual([
      [1, 0],
      [1, 1],
      [1, 2],
    ]);
  });

  test('is offered under the minimised rest too, and never after a warm-up', async ({ page }) => {
    await startPieces(page);
    await pickLift(page, 'Fly');
    await page.getByRole('button', { name: 'Warm-up', exact: true }).click();
    await logButton(page).click();
    await expect(restScreen(page)).toBeVisible();
    await expect(restScreen(page).getByRole('button', { name: 'Drop the weight and carry on this set' })).toBeHidden();
    await restScreen(page).getByRole('button', { name: 'Minimise' }).click();
    await expect(page.getByRole('button', { name: 'Drop the weight and carry on this set' })).toBeHidden();
    await page.getByRole('button', { name: 'Skip', exact: true }).click();

    await page.getByRole('button', { name: 'Working', exact: true }).click();
    await logButton(page).click();
    await logButton(page).click();
    await restScreen(page).getByRole('button', { name: 'Minimise' }).click();
    await page.getByRole('button', { name: 'Drop the weight and carry on this set' }).click();
    await expect(card(page)).toContainText('Drop 2');
  });
});

test.describe('history and editing', () => {
  async function openSession(page: Page) {
    await goToTab(page, 'History');
    await page.getByRole('button', { name: /^Show Methods · pieces on / }).click();
  }

  test('pieces sit under their set, on one line, and count as one set', async ({ page }) => {
    await goToTab(page, 'History');
    const row = page.getByRole('button', { name: /^Show Methods · pieces on / });
    await expect(row).toContainText(/2\s*sets/);
    await row.click();

    const set = page.getByRole('group', { name: 'Set 1 with 2 drops' });
    await expect(set).toContainText(/80 × 8\s*→\s*65 × 6\s*→\s*52\.5 × 5\s*kg/);
  });

  test('a piece opens in the Edit Set sheet as a drop of its set', async ({ page }) => {
    await openSession(page);
    await page.getByRole('button', { name: 'Edit drop 1 of set 1: 65 kg × 6' }).click();
    const sheet = page.getByRole('dialog', { name: 'Edit logged set' });
    await expect(sheet).toContainText('Drop 1 of set 1');
    // A piece has no type control of its own.
    await expect(sheet.getByRole('group', { name: 'Set type' })).toBeHidden();

    await sheet.getByRole('button', { name: 'Increase reps' }).click();
    await sheet.getByRole('button', { name: 'Save changes' }).click();
    await expect.poll(async () => (await readSets(page)).find((row) => row.id === 2)?.reps).toBe(7);
  });

  test("changing the set's type changes its pieces too", async ({ page }) => {
    await openSession(page);
    await page.getByRole('button', { name: 'Edit set 1: 80 kg × 8' }).click();
    const sheet = page.getByRole('dialog', { name: 'Edit logged set' });
    await sheet.getByRole('button', { name: 'Back-off', exact: true }).click();
    await expect(sheet).toContainText('Its 2 drops change with it.');
    await sheet.getByRole('button', { name: 'Save changes' }).click();

    await expect
      .poll(async () => (await readSets(page)).filter((row) => row.setNo === 1).map((row) => row.type))
      .toEqual(['backoff', 'backoff', 'backoff']);
  });

  test('deleting a set with two drops removes all three rows, and survives a reload', async ({ page }) => {
    await openSession(page);
    await page.getByRole('button', { name: 'Edit set 1: 80 kg × 8' }).click();
    const sheet = page.getByRole('dialog', { name: 'Edit logged set' });
    await expect(sheet).toContainText('Deleting this set deletes its 2 drops too.');
    await sheet.getByRole('button', { name: 'Delete', exact: true }).click();

    await expect.poll(async () => (await readSets(page)).map((row) => row.id)).toEqual([4]);
    await page.reload();
    await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible({ timeout: 15_000 });
    expect((await readSets(page)).map((row) => row.id)).toEqual([4]);
  });
});
