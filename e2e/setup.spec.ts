import { expect, test } from '@playwright/test';
import { buildWorkoutInSetup, completeSetup, gotoApp, goToTab, setupHeading, skipSetup } from './helpers';

// First-run setup. Every other spec depends on this flow working, so it
// is tested first and in full.

test.beforeEach(async ({ page }) => {
  await gotoApp(page);
});

test.describe('first launch', () => {
  test('a fresh install lands on setup, not Today', async ({ page }) => {
    await expect(setupHeading(page)).toContainText('Units');
    // Setup owns the viewport — the tab bar must not be reachable behind it.
    await expect(page.getByRole('navigation', { name: 'Main' })).toBeHidden();
  });

  test('no plan is written until the final step', async ({ page }) => {
    const countPlans = async () =>
      page.evaluate(async () => {
        const open = indexedDB.open('bompa');
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
          open.onsuccess = () => resolve(open.result);
          open.onerror = () => reject(open.error);
        });
        if (!db.objectStoreNames.contains('plans')) return 0;
        return new Promise<number>((resolve) => {
          const request = db.transaction('plans').objectStore('plans').count();
          request.onsuccess = () => resolve(request.result);
        });
      });

    expect(await countPlans()).toBe(0);

    // Walk to the last step without pressing Build my plan.
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await buildWorkoutInSetup(page, ['Bench Press']);
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Build my plan' })).toBeVisible();

    // Still nothing — the plan is the last step's doing, not a side effect of
    // wandering through the flow.
    expect(await countPlans()).toBe(0);

    await page.getByRole('button', { name: 'Build my plan' }).click();
    await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
    expect(await countPlans()).toBe(1);
  });

  test('steps through all five and reports where it is', async ({ page }) => {
    await expect(setupHeading(page)).toContainText('Units');
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(setupHeading(page)).toContainText('Maxes');
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(setupHeading(page)).toContainText('Workouts');

    await buildWorkoutInSetup(page, ['Bench Press']);
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(setupHeading(page)).toContainText('Block');
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(setupHeading(page)).toContainText('Done');
  });

  test('Back returns to the previous step without losing work', async ({ page }) => {
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await buildWorkoutInSetup(page, ['Bench Press'], 'Chest Day');
    await expect(page.getByText('Chest Day')).toBeVisible();

    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await page.getByRole('button', { name: 'Back', exact: true }).click();

    await expect(setupHeading(page)).toContainText('Workouts');
    await expect(page.getByText('Chest Day')).toBeVisible();
  });

  test('will not leave the workouts step with nothing built', async ({ page }) => {
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(setupHeading(page)).toContainText('Workouts');

    // Next is disabled until a workout exists — a rotation of nothing generates
    // a plan of nothing.
    await expect(page.getByRole('button', { name: 'Next', exact: true })).toBeDisabled();

    await buildWorkoutInSetup(page, ['Bench Press']);
    await expect(page.getByRole('button', { name: 'Next', exact: true })).toBeEnabled();
  });

  test('copies a template into a workout of your own', async ({ page }) => {
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(page.getByText('Or start from a template')).toBeVisible();

    await page.getByRole('button', { name: /Push Day/ }).first().click();
    // Copying opens the builder on the copy, so it can be changed immediately.
    await expect(page.getByRole('dialog', { name: /^Edit / })).toBeVisible();
  });
});

test.describe('skipping setup', () => {
  test('skip reaches the app with an explanatory empty state', async ({ page }) => {
    await skipSetup(page);
    await expect(page.getByText(/No workouts yet/)).toBeVisible();
  });

  test('a skipped setup is not re-prompted on reload', async ({ page }) => {
    await skipSetup(page);
    await page.reload();
    await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible({ timeout: 15_000 });
    await expect(setupHeading(page)).toBeHidden();
  });
});

test.describe('after setup', () => {
  test('builds a plan and lands on Today', async ({ page }) => {
    await completeSetup(page);
    await goToTab(page, 'Today');
    await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
  });

  test('does not re-prompt setup on reload', async ({ page }) => {
    await completeSetup(page);
    await page.reload();
    await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible({ timeout: 15_000 });
    await expect(setupHeading(page)).toBeHidden();
  });
});

test.describe('finding your way to a new workout', () => {
  test('with nothing built, Today offers to build one rather than to train', async ({ page }) => {
    await skipSetup(page);
    // "Train anyway" with no workouts sent people hunting for a screen that
    // did not exist.
    await expect(page.getByRole('button', { name: 'Build a workout' })).toBeVisible();
  });

  test('that button reaches the Workouts tab, which can create one', async ({ page }) => {
    await skipSetup(page);
    await page.getByRole('button', { name: 'Build a workout' }).click();
    await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Workouts' })).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('button', { name: 'New workout', exact: true })).toBeVisible();
  });
});

test.describe('the RPE explainer is reachable from setup', () => {
  test('not only from the logger, which you first reach mid-set', async ({ page }) => {
    await gotoApp(page);
    await page.getByRole('button', { name: 'Next', exact: true }).click(); // units
    await page.getByRole('button', { name: 'Next', exact: true }).click(); // maxes
    await buildWorkoutInSetup(page, ['Bench Press'], 'Push A');
    await page.getByRole('button', { name: 'Next', exact: true }).click(); // workouts
    await page.getByRole('button', { name: 'Next', exact: true }).click(); // block

    // The closing step, before the plan is built.
    const help = page.getByRole('button', { name: /What is RPE/ });
    await expect(help).toBeVisible();
    await help.click();
    await expect(page.getByRole('dialog', { name: 'What RPE means' })).toBeVisible();
  });
});

test.describe('the steps themselves', () => {
  test('units are two big choices, and the chosen one says so', async ({ page }) => {
    const kg = page.getByRole('button', { name: /^KG/ });
    const lb = page.getByRole('button', { name: /^LB/ });
    await expect(kg).toHaveAttribute('aria-pressed', 'true');
    await lb.click();
    await expect(lb).toHaveAttribute('aria-pressed', 'true');
    await expect(kg).toHaveAttribute('aria-pressed', 'false');
  });

  test('each step leads with its question on a light header, not a giant step number', async ({ page }) => {
    await expect(page.getByRole('heading', { level: 1, name: 'Kilograms or pounds?' })).toBeVisible();
    await expect(page.getByText('01', { exact: true })).toHaveCount(0);
    const header = page.locator('header');
    await expect(header).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  });

  test('the step number is read as a position, and Back only exists from step two', async ({ page }) => {
    await expect(page.getByText('Step 1 of 5', { exact: true })).toBeAttached();
    await expect(page.getByRole('button', { name: 'Back', exact: true })).toHaveCount(0);

    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(page.getByText('Step 2 of 5', { exact: true })).toBeAttached();
    await expect(page.getByRole('button', { name: 'Back', exact: true })).toBeVisible();
  });

  test('the block step shows what week one will hold', async ({ page }) => {
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await buildWorkoutInSetup(page, ['Bench Press'], 'Push A');
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(setupHeading(page)).toContainText('Block');

    const perWeek = page.getByRole('group', { name: 'Sessions a week' });
    await perWeek.getByRole('button', { name: '3', exact: true }).click();
    await expect(perWeek.getByRole('button', { name: '3', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByText('Week one: Push A · Push A · Push A', { exact: true })).toBeVisible();

    const hypertrophy = page.getByRole('button', { name: /^Hypertrophy/ });
    await hypertrophy.click();
    await expect(hypertrophy).toHaveAttribute('aria-pressed', 'true');
  });
});
