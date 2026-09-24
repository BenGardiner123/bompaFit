import { expect, test, type Page } from '@playwright/test';
import { completeSetup, goToTab, gotoApp, readRoutines, skipSetup } from './helpers';

// Adding one of your own workouts to the plan, from the calendar. Added work is
// planned work: the week expects it, so it is never counted as extra.

type StoredSlot = { id: number; weekStart: string; slotIndex: number; routineId: string; status: string; userModified?: boolean; date?: string };

/** Every planned row in IndexedDB, for checking weeks the screen does not show. */
async function readPlanned(page: Page): Promise<StoredSlot[]> {
  return page.evaluate(async () => {
    const open = indexedDB.open('bompa');
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
    return new Promise<StoredSlot[]>((resolve, reject) => {
      const request = database.transaction('plannedSessions').objectStore('plannedSessions').getAll();
      request.onsuccess = () => resolve(request.result as StoredSlot[]);
      request.onerror = () => reject(request.error);
    });
  });
}

async function routineId(page: Page, name: string): Promise<string> {
  const routines = (await readRoutines(page)) as { id: string; name: string }[];
  return routines.find((r) => r.name === name)!.id;
}

function countByWeek(rows: StoredSlot[], routine?: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const row of rows) {
    if (routine && row.routineId !== routine) continue;
    out.set(row.weekStart, (out.get(row.weekStart) ?? 0) + 1);
  }
  return out;
}

const slotOptions = (page: Page) => page.getByRole('button', { name: /^Options for / });

test.describe('with a plan', () => {
  test.beforeEach(async ({ page }) => {
    await gotoApp(page);
    await completeSetup(page, {
      workouts: [['Bench Press', 'Overhead Press'], ['Back Squat', 'Romanian Deadlift']],
      names: ['Push A', 'Legs A'],
    });
    await goToTab(page, 'Plan');
  });

  test('lists your own workouts when opened', async ({ page }) => {
    await page.getByRole('button', { name: 'Add a workout' }).click();
    await expect(page.getByRole('button', { name: 'Add a workout' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('button', { name: 'Choose Push A' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Choose Legs A' })).toBeVisible();
  });

  test('just this week adds a pending slot that survives a reload', async ({ page }) => {
    const heading = page.getByRole('heading', { name: /^This week · \d+ of \d+ done$/ });
    const total = async () => Number((await heading.textContent())!.match(/of (\d+) done/)![1]);
    const before = await total();

    await page.getByRole('button', { name: 'Add a workout' }).click();
    await page.getByRole('button', { name: 'Choose Legs A' }).click();
    await page.getByRole('button', { name: 'Add Legs A just this week' }).click();

    // On the list straight away, as the last slot, pending.
    await expect(heading).toHaveText(`This week · 0 of ${before + 1} done`);
    await expect(slotOptions(page).last()).toHaveAccessibleName('Options for Legs A');
    await expect(page.getByText(/You rearranged this week/)).toBeVisible();

    // Planned, so the week expects it — nothing calls it extra.
    await goToTab(page, 'Today');
    await expect(page.getByText(/over what this week was built for/)).toHaveCount(0);

    await page.reload();
    await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible({ timeout: 15_000 });
    await goToTab(page, 'Plan');
    await expect(heading).toHaveText(`This week · 0 of ${before + 1} done`);

    // Only this week gained a row, and it carries no date because it has not been trained.
    const legs = await routineId(page, 'Legs A');
    const rows = await readPlanned(page);
    const thisWeek = rows.reduce((min, r) => (r.weekStart < min ? r.weekStart : min), rows[0]!.weekStart);
    const added = rows.filter((r) => r.weekStart === thisWeek && r.userModified);
    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({ routineId: legs, status: 'plan', slotIndex: before });
    expect(added[0]!.date).toBeUndefined();
    expect(rows.filter((r) => r.weekStart !== thisWeek && r.userModified)).toHaveLength(0);
  });

  test('the same workout can go in twice', async ({ page }) => {
    const before = await slotOptions(page).count();
    for (let i = 0; i < 2; i++) {
      await page.getByRole('button', { name: 'Add a workout' }).click();
      await page.getByRole('button', { name: 'Choose Push A' }).click();
      await page.getByRole('button', { name: 'Add Push A just this week' }).click();
      await expect(slotOptions(page)).toHaveCount(before + i + 1);
    }
  });

  test('an added workout can be dropped again', async ({ page }) => {
    const before = await slotOptions(page).count();
    await page.getByRole('button', { name: 'Add a workout' }).click();
    await page.getByRole('button', { name: 'Choose Legs A' }).click();
    await page.getByRole('button', { name: 'Add Legs A just this week' }).click();
    await expect(slotOptions(page)).toHaveCount(before + 1);

    await slotOptions(page).last().click();
    await page.getByRole('button', { name: 'Drop', exact: true }).click();
    await expect(slotOptions(page)).toHaveCount(before);

    // Gone from storage too, not only from the screen.
    await page.reload();
    await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible({ timeout: 15_000 });
    await goToTab(page, 'Plan');
    await expect(slotOptions(page)).toHaveCount(before);
  });

  test('every week from now puts it in this week and each week after it', async ({ page }) => {
    const legs = await routineId(page, 'Legs A');
    const rowsBefore = await readPlanned(page);
    const totalsBefore = countByWeek(rowsBefore);
    const legsBefore = countByWeek(rowsBefore, legs);
    const before = await slotOptions(page).count();

    await page.getByRole('button', { name: 'Add a workout' }).click();
    await page.getByRole('button', { name: 'Choose Legs A' }).click();
    await page.getByRole('button', { name: 'Add Legs A every week from now' }).click();
    await expect(slotOptions(page)).toHaveCount(before + 1);

    // Storage is written after the screen updates, so wait for it to catch up.
    await expect.poll(async () => (await readPlanned(page)).length).toBe(rowsBefore.length + totalsBefore.size);

    const rowsAfter = await readPlanned(page);
    const totalsAfter = countByWeek(rowsAfter);
    const legsAfter = countByWeek(rowsAfter, legs);
    // The plan starts this week, so every week in it is this week or later —
    // and every one of them gained exactly one Legs A.
    for (const [week, count] of totalsBefore) {
      expect(totalsAfter.get(week)).toBe(count + 1);
      expect(legsAfter.get(week)).toBe((legsBefore.get(week) ?? 0) + 1);
    }

    // Each week's order stays dense, and the new slot sits at the end of it.
    for (const week of totalsAfter.keys()) {
      const indices = rowsAfter
        .filter((r) => r.weekStart === week)
        .map((r) => r.slotIndex)
        .sort((a, b) => a - b);
      expect(indices).toEqual(indices.map((_, i) => i));
    }

    // Survives a reload.
    await page.reload();
    await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible({ timeout: 15_000 });
    await goToTab(page, 'Plan');
    await expect(slotOptions(page)).toHaveCount(before + 1);
  });
});

test.describe('without a plan', () => {
  test('says there is no week to add to instead of offering a button', async ({ page }) => {
    await gotoApp(page);
    await skipSetup(page);
    await goToTab(page, 'Plan');
    await expect(page.getByText(/No plan yet, so there is no week to add a workout to/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add a workout' })).toHaveCount(0);
  });
});
