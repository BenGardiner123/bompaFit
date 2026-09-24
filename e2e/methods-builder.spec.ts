import { expect, test, type Page } from '@playwright/test';
import { builder, completeSetup, goToTab, gotoApp, readRoutines, saveBuilder } from './helpers';

// Choosing training methods in the workout builder: presets, the inputs each
// method reveals, and that what is chosen is what is stored.

type StoredSlot = {
  exerciseId: string;
  sets: number;
  reps: number;
  tempo?: unknown;
  scheme?: { reps: number; restSec?: number; load?: { kind: string; x: number } }[];
  segments?: unknown;
  repStyle?: string;
  restSec?: number;
  gapAfterSec?: number;
  note?: string;
};
type StoredRoutine = { name: string; slots: StoredSlot[] };

async function openBuilder(page: Page) {
  await goToTab(page, 'Today');
  await page.getByRole('button', { name: 'Open workout library' }).click();
  await page.getByRole('button', { name: /^Edit/ }).first().click();
  await expect(builder(page)).toBeVisible();
}

function methodSheet(page: Page) {
  return page.getByRole('dialog', { name: /^Method for / });
}

async function openMethod(page: Page, lift = 0) {
  await builder(page).getByRole('button', { name: /^Method / }).nth(lift).click();
  await expect(methodSheet(page)).toBeVisible();
}

async function closeMethod(page: Page) {
  await methodSheet(page).getByRole('button', { name: 'Close', exact: true }).click();
  await expect(methodSheet(page)).toBeHidden();
}

async function firstSlot(page: Page): Promise<StoredSlot> {
  const routines = (await readRoutines(page)) as StoredRoutine[];
  const mine = routines.find((routine) => routine.name === 'Push A');
  return mine!.slots[0]!;
}

function summaries(page: Page) {
  return builder(page).getByTestId('method-row-summary');
}

test.beforeEach(async ({ page }) => {
  await gotoApp(page);
  await completeSetup(page, { workouts: [['Bench Press', 'Overhead Press']], names: ['Push A'] });
});

test('a lift with no method reads Straight sets', async ({ page }) => {
  await openBuilder(page);
  await expect(summaries(page).first()).toHaveText('Straight sets');
});

test('the Wave 7/5/3 preset fills a six-set scheme that survives saving and reloading', async ({ page }) => {
  await openBuilder(page);
  await openMethod(page);
  await methodSheet(page).getByRole('button', { name: /^Wave 7\/5\/3 ×2/ }).click();
  await expect(methodSheet(page).getByTestId('method-summary')).toHaveText('Wave 7/5/3 ×2 · rest 2:30');
  await closeMethod(page);

  await expect(summaries(page).first()).toHaveText('Wave 7/5/3 ×2 · rest 2:30');
  await saveBuilder(page);

  const slot = await firstSlot(page);
  expect(slot.sets).toBe(6);
  expect(slot.scheme?.map((entry) => entry.reps)).toEqual([7, 5, 3, 7, 5, 3]);
  expect(slot.restSec).toBe(150);

  await page.reload();
  await openBuilder(page);
  await expect(summaries(page).first()).toHaveText('Wave 7/5/3 ×2 · rest 2:30');
});

test('a typed tempo is read back in words, stored as four phases and summarised', async ({ page }) => {
  await openBuilder(page);
  await openMethod(page);

  const tempo = methodSheet(page).getByRole('textbox', { name: 'Tempo' });
  await tempo.fill('21');
  await expect(methodSheet(page).getByTestId('tempo-reading')).toHaveText(/^Not a tempo yet/);
  await tempo.fill('2110');
  await expect(methodSheet(page).getByTestId('tempo-reading')).toHaveText(
    'lower for 2 seconds, pause 1, lift in 1, no pause at the top',
  );
  await closeMethod(page);

  await expect(summaries(page).first()).toHaveText('tempo 2110');
  await saveBuilder(page);
  expect((await firstSlot(page)).tempo).toEqual([2, 1, 1, 0]);
});

test('edits in the per-set editor persist through a reload', async ({ page }) => {
  await openBuilder(page);
  await openMethod(page);
  await methodSheet(page).getByRole('button', { name: /^5\/4\/3\/2\/1/ }).click();

  const firstSet = methodSheet(page).getByRole('group', { name: 'Set 1', exact: true });
  await firstSet.getByRole('spinbutton', { name: 'Reps' }).fill('6');
  await firstSet.getByRole('spinbutton', { name: 'Rest (s)' }).fill('75');
  await closeMethod(page);
  await saveBuilder(page);

  await page.reload();
  const slot = await firstSlot(page);
  expect(slot.scheme?.[0]).toMatchObject({ reps: 6, restSec: 75 });
  expect(slot.scheme).toHaveLength(5);

  await openBuilder(page);
  await openMethod(page);
  const reopened = methodSheet(page).getByRole('group', { name: 'Set 1', exact: true });
  await expect(reopened.getByRole('spinbutton', { name: 'Reps' })).toHaveValue('6');
  await expect(reopened.getByRole('spinbutton', { name: 'Rest (s)' })).toHaveValue('75');
});

test('No method clears every method field', async ({ page }) => {
  await openBuilder(page);
  await openMethod(page);
  await methodSheet(page).getByRole('button', { name: /^Wave 5\/3\/1 ×2/ }).click();
  await methodSheet(page).getByRole('button', { name: 'Intensity techniques', exact: true }).click();
  await methodSheet(page).getByRole('button', { name: /^Drop set ×2/ }).click();
  await methodSheet(page).getByRole('textbox', { name: 'Tempo' }).fill('3110');
  await methodSheet(page).getByRole('textbox', { name: /^Note/ }).fill('pause on the chest');
  await expect(methodSheet(page).getByTestId('method-summary')).toContainText('Drop ×2');

  await methodSheet(page).getByRole('button', { name: 'No method', exact: true }).click();
  await expect(methodSheet(page).getByTestId('method-summary')).toHaveText('Straight sets');
  await expect(methodSheet(page).getByRole('textbox', { name: 'Tempo' })).toHaveValue('');
  await closeMethod(page);
  await saveBuilder(page);

  const slot = await firstSlot(page);
  for (const field of ['tempo', 'scheme', 'segments', 'repStyle', 'restSec', 'gapAfterSec', 'note'] as const) {
    expect(slot[field], field).toBeUndefined();
  }
  // Clearing a six-set wave leaves six straight sets rather than guessing.
  expect(slot.sets).toBe(6);
});

test('a method sheet shows only the inputs its method uses', async ({ page }) => {
  await openBuilder(page);
  await openMethod(page);
  const sheet = methodSheet(page);
  await expect(sheet.getByRole('spinbutton', { name: 'Pause (s)' })).toHaveCount(0);
  await expect(sheet.getByRole('spinbutton', { name: 'Seconds per hold' })).toHaveCount(0);
  // Not in a group, so there is no gap to set.
  await expect(sheet.getByRole('spinbutton', { name: /Gap after this lift/ })).toHaveCount(0);

  await sheet.getByRole('group', { name: 'Within each set' }).getByRole('button', { name: 'Cluster', exact: true }).click();
  await expect(sheet.getByRole('spinbutton', { name: 'Pause (s)' })).toHaveValue('15');
  await sheet.getByRole('group', { name: 'Rep style' }).getByRole('button', { name: 'Hold', exact: true }).click();
  await expect(sheet.getByRole('spinbutton', { name: 'Seconds per hold' })).toHaveValue('10');
});

test('Escape closes the method sheet and leaves the builder open', async ({ page }) => {
  await openBuilder(page);
  await openMethod(page);
  await page.keyboard.press('Escape');
  await expect(methodSheet(page)).toBeHidden();
  await expect(builder(page)).toBeVisible();
});

test.describe('groups', () => {
  test.beforeEach(async ({ page }) => {
    // Replace the two-lift workout with four so every group size can be built.
    await openBuilder(page);
    for (const name of ['Cable Fly', 'Rope Extension']) {
      await builder(page).getByRole('button', { name: '+ Add a lift' }).click();
      const picker = page.getByRole('dialog', { name: 'Add a lift' });
      await picker.getByPlaceholder('Search by name, muscle or equipment').fill(name);
      await picker.getByRole('button', { name: new RegExp(name, 'i') }).first().click();
      await expect(picker).toBeHidden();
    }
  });

  async function tag(page: Page, count: number) {
    for (let i = 0; i < count; i++) {
      await builder(page).locator('button', { hasText: /^A$/ }).nth(i).click();
    }
  }

  test('three lifts read Triset and four read Giant set', async ({ page }) => {
    await tag(page, 2);
    await expect(builder(page).getByText(/^SUPERSET A ·/)).toBeVisible();
    await tag(page, 3);
    await expect(builder(page).getByText(/^TRISET A ·/)).toBeVisible();
    await tag(page, 4);
    await expect(builder(page).getByText(/^GIANT SET A ·/)).toBeVisible();
  });

  test('each member can set its own gap and rest, and they are stored', async ({ page }) => {
    await tag(page, 3);
    const gaps = [10, 10];
    for (const [lift, gap] of gaps.entries()) {
      await openMethod(page, lift);
      await methodSheet(page).getByRole('spinbutton', { name: /Gap after this lift/ }).fill(String(gap));
      await closeMethod(page);
    }
    await openMethod(page, 2);
    await methodSheet(page).getByRole('spinbutton', { name: 'Rest after a set (s)' }).fill('180');
    await closeMethod(page);

    await expect(summaries(page).nth(0)).toHaveText('gap 10 s');
    await expect(summaries(page).nth(2)).toHaveText('rest 3:00');
    await saveBuilder(page);

    const routines = (await readRoutines(page)) as StoredRoutine[];
    const slots = routines.find((routine) => routine.name === 'Push A')!.slots;
    expect(slots.slice(0, 3).map((slot) => [slot.gapAfterSec, slot.restSec])).toEqual([
      [10, undefined],
      [10, undefined],
      [undefined, 180],
    ]);
  });
});
