import { expect, test, type Page } from '@playwright/test';
import { builder, completeSetup, goToTab, gotoApp, readRoutines, saveBuilder } from './helpers';

// Every scheduled session points at a shared workout. Editing one from a
// session in a block that shares it with another block must ask first: change
// it for this block only, or everywhere, knowingly.

type StoredRoutine = { id: string; name: string; versionOf?: { routineId: string; blockId: number } };

const views = (page: Page) => page.getByRole('group', { name: 'Plan view' });
const routines = async (page: Page) => (await readRoutines(page)) as StoredRoutine[];
const named = async (page: Page, name: string) => (await routines(page)).filter((r) => r.name === name);

test.beforeEach(async ({ page }) => {
  await gotoApp(page);
  // One strength block, four sessions a week over Push A, Legs B, Pull A, so
  // Push A comes up twice this week.
  await completeSetup(page, {
    workouts: [['Bench Press'], ['Back Squat'], ['Romanian Deadlift']],
    names: ['Push A', 'Legs B', 'Pull A'],
  });
  await goToTab(page, 'Plan');
});

test('a workout only this block uses has a single Edit', async ({ page }) => {
  await page.getByRole('button', { name: 'Options for Push A' }).first().click();
  await expect(page.getByRole('button', { name: 'Edit workout Push A' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Edit for this block only/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Edit everywhere/ })).toHaveCount(0);
});

test.describe('a workout two blocks share', () => {
  test.beforeEach(async ({ page }) => {
    // The added block runs the plan's own list, so it shares all three workouts.
    await views(page).getByRole('button', { name: 'Mesocycle' }).click();
    await page.getByRole('group', { name: 'Block type' }).getByRole('button', { name: /^Hypertrophy/ }).click();
    await page.getByRole('button', { name: 'Add block to calendar' }).click();
    await expect(views(page).getByRole('button', { name: 'Calendar' })).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: 'Options for Push A' }).first().click();
  });

  test('asks whether the edit is for this block or everywhere, and counts the blocks', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Edit for this block only' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Edit everywhere (2 blocks)' })).toBeVisible();
    // The plain Edit would be the unsafe one; it is gone while the question stands.
    await expect(page.getByRole('button', { name: 'Edit workout Push A' })).toHaveCount(0);
  });

  test('"everywhere" opens the shared workout and says who else uses it', async ({ page }) => {
    const before = (await routines(page)).length;
    await page.getByRole('button', { name: 'Edit everywhere (2 blocks)' }).click();
    await expect(builder(page)).toHaveAccessibleName('Edit Push A');
    await expect(builder(page).getByText('Used in: Strength block, Hypertrophy block — changes apply to all of them.')).toBeVisible();
    await saveBuilder(page);
    expect(await routines(page)).toHaveLength(before);
  });

  test('"this block only" makes one version, and every session in the block edits that same one', async ({ page }) => {
    const before = (await routines(page)).length;
    const original = (await named(page, 'Push A'))[0]!;

    await page.getByRole('button', { name: 'Edit for this block only' }).click();
    await expect(builder(page)).toHaveAccessibleName('Edit Push A (Strength)');
    await expect(builder(page).getByText('Version for the Strength block, made from Push A.')).toBeVisible();
    await saveBuilder(page);

    const [version] = await named(page, 'Push A (Strength)');
    expect(version!.versionOf).toEqual({ routineId: original.id, blockId: 1 });
    expect(await routines(page)).toHaveLength(before + 1);

    // Both of this week's Push A sessions now run the version, and its options
    // edit it directly — it belongs to this block alone.
    const options = page.getByRole('button', { name: 'Options for Push A (Strength)' });
    await expect(options).toHaveCount(2);
    await options.nth(1).click();
    await expect(page.getByRole('button', { name: /Edit for this block only/ })).toHaveCount(0);
    await page.getByRole('button', { name: 'Edit workout Push A (Strength)' }).click();
    await expect(builder(page)).toHaveAccessibleName('Edit Push A (Strength)');
    await saveBuilder(page);
    expect(await routines(page)).toHaveLength(before + 1);
  });

  test('asking again after an Undo goes back to the version already made', async ({ page }) => {
    const before = (await routines(page)).length;
    await page.getByRole('button', { name: 'Edit for this block only' }).click();
    await saveBuilder(page);
    await page.getByText(/^You made Push A \(Strength\) for this strength block/).locator('xpath=../..').getByRole('button', { name: 'Undo' }).click();
    await expect(page.getByRole('button', { name: 'Options for Push A', exact: true })).toHaveCount(2);

    await page.getByRole('button', { name: 'Options for Push A', exact: true }).first().click();
    await page.getByRole('button', { name: 'Edit for this block only' }).click();
    // The same copy, not "Push A (Strength) 2".
    await expect(builder(page)).toHaveAccessibleName('Edit Push A (Strength)');
    await saveBuilder(page);
    expect(await routines(page)).toHaveLength(before + 1);
    expect(await named(page, 'Push A (Strength) 2')).toHaveLength(0);
  });
});
