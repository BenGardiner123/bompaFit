import { expect, test, type Page } from '@playwright/test';
import { addLift, builder, completeSetup, goToTab, gotoApp, readRoutines, saveBuilder, trainOneSession } from './helpers';

// Each block can run its own versions of your workouts: picked when the block
// is added, made from a session's options, or swapped in across the block.
// Whatever happens, trained and skipped sessions keep the workout they had.

type StoredSlot = { id: number; blockId: number; weekStart: string; slotIndex: number; routineId: string; status: string };
type StoredBlock = { id: number; phase: string; startDate: string; rotation?: string[] };

async function readTable<T>(page: Page, table: string): Promise<T[]> {
  return page.evaluate(async (name) => {
    const open = indexedDB.open('bompa');
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
    return new Promise<unknown[]>((resolve, reject) => {
      const request = database.transaction(name).objectStore(name).getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }, table) as Promise<T[]>;
}

const readPlanned = (page: Page) => readTable<StoredSlot>(page, 'plannedSessions');
const readBlocks = (page: Page) => readTable<StoredBlock>(page, 'blocks');

async function idOf(page: Page, name: string): Promise<string> {
  const routines = (await readRoutines(page)) as { id: string; name: string }[];
  return routines.find((r) => r.name === name)!.id;
}

/** How many of a block's slots use a workout, split by whether they are still to do. */
function count(rows: StoredSlot[], blockId: number, routineId: string, pending: boolean): number {
  return rows.filter((r) => r.blockId === blockId && r.routineId === routineId && (r.status === 'plan') === pending).length;
}

const openBuilder = (page: Page) => page.getByRole('button', { name: 'Add a block', exact: true }).click();
const blockList = (page: Page) => page.getByRole('list', { name: 'Blocks in your plan' }).getByRole('listitem');

async function addBlock(page: Page) {
  await openBuilder(page);
  await page.getByRole('button', { name: 'Add block to calendar' }).click();
  await expect(page.getByRole('dialog', { name: 'Add a block' })).toHaveCount(0);
}

/** The Undo beside the adjustment whose sentence matches. */
function undoFor(page: Page, narrative: RegExp) {
  return page.getByText(narrative).locator('xpath=../..').getByRole('button', { name: 'Undo' });
}

test.beforeEach(async ({ page }) => {
  await gotoApp(page);
  // A strength block, four sessions a week over Push A, Legs B, Pull A.
  await completeSetup(page, {
    workouts: [['Bench Press'], ['Back Squat'], ['Romanian Deadlift']],
    names: ['Push A', 'Legs B', 'Pull A'],
  });
});

test('a new block runs the workouts picked for it, in the order picked', async ({ page }) => {
  const [push, pull] = [await idOf(page, 'Push A'), await idOf(page, 'Pull A')];
  await goToTab(page, 'Plan');
  await openBuilder(page);

  // Starts on the plan's own list.
  for (const name of ['Push A', 'Legs B', 'Pull A']) {
    await expect(page.getByRole('button', { name: `Use ${name}` })).toHaveAttribute('aria-pressed', 'true');
  }
  await page.getByRole('button', { name: 'Use Legs B' }).click();
  await expect(page.getByRole('button', { name: 'Use Legs B' })).toHaveAttribute('aria-pressed', 'false');
  await page.getByRole('button', { name: 'Move Pull A earlier' }).click();
  await page.getByRole('button', { name: 'Add block to calendar' }).click();

  await expect.poll(async () => (await readBlocks(page)).length).toBe(2);
  const added = (await readBlocks(page)).find((b) => b.id === 2)!;
  expect(added.rotation).toEqual([pull, push]);
  expect('rotation' in (await readBlocks(page)).find((b) => b.id === 1)!).toBe(false);

  await expect.poll(async () => (await readPlanned(page)).filter((r) => r.blockId === 2).length).toBeGreaterThan(0);
  const rows = (await readPlanned(page)).filter((r) => r.blockId === 2);
  expect(new Set(rows.map((r) => r.routineId))).toEqual(new Set([pull, push]));
  const firstWeek = rows.filter((r) => r.weekStart === added.startDate).sort((a, b) => a.slotIndex - b.slotIndex);
  expect(firstWeek.map((r) => r.routineId)).toEqual([pull, push, pull, push]);

  // The plan says which block runs what.
  await expect(blockList(page).nth(0)).toContainText('Push A, Legs B, Pull A');
  await expect(blockList(page).nth(1)).toContainText('Its own workouts: Pull A, Push A');
});

test('a version for this block replaces the workout here only, and can be undone', async ({ page }) => {
  const push = await idOf(page, 'Push A');
  // Push A is first in the week, so training once leaves it done in block 1.
  await trainOneSession(page);
  await goToTab(page, 'Plan');
  await addBlock(page);
  await expect.poll(async () => (await readPlanned(page)).filter((r) => r.blockId === 2).length).toBeGreaterThan(0);

  await page.getByRole('button', { name: 'Options for Push A' }).click();
  await page.getByRole('button', { name: 'Edit for this block only' }).click();
  await expect(builder(page)).toHaveAccessibleName('Edit Push A (Strength)');
  await addLift(page, 'Overhead Press');
  await saveBuilder(page);

  // The pending slot runs the version; the one already trained keeps the original.
  await expect(page.getByRole('button', { name: 'Options for Push A (Strength)' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Options for Push A', exact: true })).toHaveCount(0);
  await expect(page.getByText('Push A', { exact: true })).toBeVisible();

  const version = await idOf(page, 'Push A (Strength)');
  const saved = ((await readRoutines(page)) as { id: string; slots: unknown[] }[]).find((r) => r.id === version)!;
  expect(saved.slots).toHaveLength(2);

  const rows = await readPlanned(page);
  expect(count(rows, 1, push, true)).toBe(0);
  expect(count(rows, 1, version, true)).toBeGreaterThan(0);
  expect(count(rows, 1, push, false)).toBe(1);
  expect(count(rows, 1, version, false)).toBe(0);
  // The later block never heard of it.
  expect(count(rows, 2, version, true)).toBe(0);
  expect(count(rows, 2, push, true)).toBeGreaterThan(0);

  await expect(blockList(page).nth(0)).toContainText('Its own workouts: Push A (Strength), Legs B, Pull A');
  await expect(blockList(page).nth(1)).toContainText('Push A, Legs B, Pull A');
  await expect(blockList(page).nth(1)).not.toContainText('Its own workouts');

  // One Undo puts every slot and the block's list back.
  await undoFor(page, /^You made Push A \(Strength\) for this strength block/).click();
  await expect(page.getByRole('button', { name: 'Options for Push A', exact: true })).toBeVisible();
  await expect.poll(async () => count(await readPlanned(page), 1, version, true)).toBe(0);
  expect(count(await readPlanned(page), 1, push, true)).toBe(count(rows, 1, version, true));
  await expect.poll(async () => 'rotation' in (await readBlocks(page)).find((b) => b.id === 1)!).toBe(false);
  // The version itself stays in the library; only the plan went back.
  expect(await idOf(page, 'Push A (Strength)')).toBe(version);
});

test('a swap for every week in the block changes that block only, and can be undone', async ({ page }) => {
  const [legs, pull] = [await idOf(page, 'Legs B'), await idOf(page, 'Pull A')];
  await goToTab(page, 'Plan');
  await addBlock(page);
  await expect.poll(async () => (await readPlanned(page)).filter((r) => r.blockId === 2).length).toBeGreaterThan(0);
  const before = await readPlanned(page);
  const legsInBlock = count(before, 1, legs, true);
  const pullInBlock = count(before, 1, pull, true);
  expect(legsInBlock).toBeGreaterThan(1);

  await page.getByRole('button', { name: 'Options for Legs B' }).click();
  const scope = page.getByRole('group', { name: 'Swap in' });
  await expect(scope.getByRole('button', { name: 'Just this week' })).toHaveAttribute('aria-pressed', 'true');
  await scope.getByRole('button', { name: 'Every week in block' }).click();
  await page.getByRole('button', { name: 'Swap for Pull A' }).click();
  await expect(page.getByRole('button', { name: 'Options for Legs B' })).toHaveCount(0);

  await expect.poll(async () => count(await readPlanned(page), 1, legs, true)).toBe(0);
  const after = await readPlanned(page);
  expect(count(after, 1, pull, true)).toBe(pullInBlock + legsInBlock);
  expect(count(after, 2, legs, true)).toBe(count(before, 2, legs, true));
  // Every week keeps its dense order.
  for (const week of new Set(after.map((r) => r.weekStart))) {
    const indices = after.filter((r) => r.weekStart === week).map((r) => r.slotIndex).sort((a, b) => a - b);
    expect(indices).toEqual(indices.map((_, i) => i));
  }

  await undoFor(page, /^You swapped Legs B for Pull A in every week left in this block/).click();
  await expect(page.getByRole('button', { name: 'Options for Legs B' })).toBeVisible();
  await expect.poll(async () => count(await readPlanned(page), 1, legs, true)).toBe(legsInBlock);
  expect(count(await readPlanned(page), 1, pull, true)).toBe(pullInBlock);
});
