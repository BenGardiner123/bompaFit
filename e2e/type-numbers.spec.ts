import { expect, test, type Page } from '@playwright/test';
import { builder, completeSetup, goToTab, gotoApp, readRoutines, saveBuilder, skipRest } from './helpers';

// Every weight and rep count can be typed as well as stepped. Going from 40 kg
// to 120 kg mid-set is three keys, not thirty-two taps on +. What these check
// is that a typed value lands in storage exactly as a stepped one would:
// kilograms, converted once.

type StoredSet = { weightKg: number; reps: number; exerciseId: string };

/** Every logged set in IndexedDB, oldest first. */
async function readSets(page: Page): Promise<StoredSet[]> {
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
  return rows as StoredSet[];
}

async function lastSet(page: Page): Promise<StoredSet | undefined> {
  const rows = await readSets(page);
  return rows[rows.length - 1];
}

async function startTraining(page: Page) {
  await goToTab(page, 'Today');
  await page.getByRole('button', { name: /^(Start workout|Train anyway)$/ }).click();
  await goToTab(page, 'Train');
}

/** The Train weight figure, whatever it currently reads. */
function weightFigure(page: Page) {
  return page.getByRole('button', { name: /^(Weight [\d.]+ (kg|lb)|Bodyweight.*), tap to type$/ });
}

async function typeInto(page: Page, figure: ReturnType<Page['getByRole']>, text: string) {
  await figure.click();
  // The value arrives selected, so typing replaces it rather than appending.
  await page.keyboard.type(text);
  await page.keyboard.press('Enter');
}

test.beforeEach(async ({ page }) => {
  await gotoApp(page);
  await completeSetup(page, { workouts: [['Bench Press', 'Overhead Press']], names: ['Push A'] });
});

test.describe('on Train', () => {
  test('a typed weight is logged as that many kilograms', async ({ page }) => {
    await startTraining(page);
    await typeInto(page, weightFigure(page), '120');
    await expect(page.getByRole('button', { name: 'Weight 120 kg, tap to type' })).toBeVisible();

    await page.getByRole('button', { name: /^Log set/ }).click();
    await expect.poll(async () => (await lastSet(page))?.weightKg).toBe(120);
  });

  test('a weight typed in pounds is converted to kilograms once, when logged', async ({ page }) => {
    await goToTab(page, 'Tools');
    await page.getByRole('button', { name: 'LB', exact: true }).click();
    await startTraining(page);

    await typeInto(page, weightFigure(page), '120');
    await expect(page.getByRole('button', { name: 'Weight 120 lb, tap to type' })).toBeVisible();
    await page.getByRole('button', { name: /^Log set/ }).click();

    await expect.poll(async () => (await lastSet(page))?.weightKg).toBeCloseTo(54.43, 2);
  });

  test('typed reps are logged', async ({ page }) => {
    await startTraining(page);
    await typeInto(page, page.getByRole('button', { name: /^Reps \d+, tap to type$/ }), '11');
    await page.getByRole('button', { name: /^Log set/ }).click();
    await expect.poll(async () => (await lastSet(page))?.reps).toBe(11);
  });

  test('Escape puts the old weight back', async ({ page }) => {
    await startTraining(page);
    const before = await weightFigure(page).getAttribute('aria-label');

    await weightFigure(page).click();
    await page.keyboard.type('999');
    await page.keyboard.press('Escape');

    await expect(page.getByRole('textbox', { name: /^Weight/ })).toBeHidden();
    await expect(weightFigure(page)).toHaveAttribute('aria-label', before ?? '');
  });

  test('typing something that is not a number changes nothing', async ({ page }) => {
    await startTraining(page);
    const before = await weightFigure(page).getAttribute('aria-label');
    await weightFigure(page).click();
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Enter');
    await expect(weightFigure(page)).toHaveAttribute('aria-label', before ?? '');
  });

  test('Bodyweight is one tap, and + adds a plate on top of it', async ({ page }) => {
    await startTraining(page);
    await page.getByRole('button', { name: 'Bodyweight', exact: true }).click();
    await expect(weightFigure(page)).toHaveText('Bodyweight');
    await expect(page.getByRole('button', { name: 'Bodyweight, tap to type' })).toBeVisible();

    await page.getByRole('button', { name: /^Log set/ }).click();
    await expect.poll(async () => (await lastSet(page))?.weightKg).toBe(0);
    await skipRest(page);

    await page.getByRole('button', { name: 'Increase weight' }).click();
    await expect(page.getByRole('button', { name: 'Bodyweight plus 2.5 kilograms, tap to type' })).toBeVisible();
    await expect(page.getByText('BW +', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: /^Log set/ }).click();
    await expect.poll(async () => (await lastSet(page))?.weightKg).toBe(2.5);
  });
});

test('Edit set takes a typed weight and reps, and they survive a reload', async ({ page }) => {
  await startTraining(page);
  await page.getByRole('button', { name: /^Log set/ }).click();
  await skipRest(page);

  await page.getByRole('button', { name: /^Edit set 1\b/ }).click();
  const sheet = page.getByRole('dialog', { name: 'Edit logged set' });
  await typeInto(page, sheet.getByRole('button', { name: /^Weight [\d.]+ kg, tap to type$/ }), '77.5');
  await typeInto(page, sheet.getByRole('button', { name: /^Reps \d+, tap to type$/ }), '11');
  // Enter keeps the number; it must not close the sheet or save it early.
  await expect(sheet).toBeVisible();
  await sheet.getByRole('button', { name: 'Save changes' }).click();
  await expect(sheet).toBeHidden();

  await expect.poll(async () => (await lastSet(page))?.weightKg).toBe(77.5);
  await page.reload();
  await goToTab(page, 'Train');
  await expect(page.getByRole('button', { name: /^Edit set 1: 77\.5 kg × 11 / })).toBeAttached();
});

test('Escape inside Edit set cancels the number, not the sheet', async ({ page }) => {
  await startTraining(page);
  await page.getByRole('button', { name: /^Log set/ }).click();
  await skipRest(page);

  await page.getByRole('button', { name: /^Edit set 1\b/ }).click();
  const sheet = page.getByRole('dialog', { name: 'Edit logged set' });
  await sheet.getByRole('button', { name: /^Reps \d+, tap to type$/ }).click();
  await page.keyboard.press('Escape');
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole('textbox')).toBeHidden();
});

test('a typed starting max reads back unchanged after a reload', async ({ page }) => {
  await goToTab(page, 'Tools');
  const max = page.getByRole('button', { name: /^Starting max for Bench Press (not set|[\d.]+ kg), tap to type$/ });
  await max.scrollIntoViewIfNeeded();
  await typeInto(page, max, '140');
  await expect(max).toHaveText('140');

  await page.reload();
  await goToTab(page, 'Tools');
  await expect(max).toHaveText('140');
});

type StoredSlot = { sets: number; reps: number; targetPct1RM: number | null; targetWeightKg: number | null };

async function openBuilder(page: Page) {
  await goToTab(page, 'Today');
  await page.getByRole('button', { name: 'Open workout library' }).click();
  await page.getByRole('button', { name: /^Edit/ }).first().click();
  await expect(builder(page)).toBeVisible();
}

async function storedSlots(page: Page): Promise<StoredSlot[]> {
  const routines = (await readRoutines(page)) as { name: string; slots: StoredSlot[] }[];
  return routines.find((routine) => routine.name === 'Push A')!.slots;
}

test('the workout builder takes typed sets, reps, weights and percentages', async ({ page }) => {
  await openBuilder(page);

  await typeInto(page, builder(page).getByRole('button', { name: /^Reps \d+, tap to type$/ }).first(), '12');
  await typeInto(page, builder(page).getByRole('button', { name: /^Sets \d+, tap to type$/ }).first(), '4');
  await typeInto(page, builder(page).getByRole('button', { name: /^Weight \(kg\) [\d.]+, tap to type$/ }).nth(1), '62.5');
  // The first lift switches to a percentage of its max, which is typed too.
  await builder(page).getByRole('button', { name: 'kg', exact: true }).first().click();
  await typeInto(page, builder(page).getByRole('button', { name: /^Percent \d+, tap to type$/ }).first(), '82');
  // Enter keeps the number; the builder, which also closes on Escape, stays.
  await expect(builder(page)).toBeVisible();
  await saveBuilder(page);

  const [first, second] = await storedSlots(page);
  expect(first!.reps).toBe(12);
  expect(first!.sets).toBe(4);
  expect(first!.targetPct1RM).toBeCloseTo(0.82, 5);
  expect(second!.targetWeightKg).toBe(62.5);
});

test('the builder can set a lift to bodyweight', async ({ page }) => {
  await openBuilder(page);
  await builder(page).getByRole('button', { name: 'Bodyweight', exact: true }).first().click();
  await expect(builder(page).getByRole('button', { name: 'Bodyweight, tap to type' }).first()).toHaveText('BW');
  await saveBuilder(page);

  expect((await storedSlots(page))[0]!.targetWeightKg).toBe(0);
});

test('the 1RM calculator takes a typed weight and reps', async ({ page }) => {
  await goToTab(page, 'Tools');
  // Neither is the calculator's starting value, so both have to be written.
  await typeInto(page, page.getByRole('button', { name: /^Weight [\d.]+ kg, tap to type$/ }), '120');
  await typeInto(page, page.getByRole('button', { name: /^Reps \d+, tap to type$/ }), '3');
  await expect(page.getByRole('button', { name: 'Weight 120 kg, tap to type' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reps 3, tap to type' })).toBeVisible();
  // 120 × (1 + 3/30) = 132.0
  await expect(page.getByText('132.0', { exact: true })).toBeVisible();
});
