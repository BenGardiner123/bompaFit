import { expect, test, type Page } from '@playwright/test';
import path from 'node:path';
import { completeSetup, finishToSummary, goToTab, gotoApp, openSettings, restScreen, settingsSheet, skipRest, skipSetup, startFromWorkouts } from './helpers';

// RPE is asked after the set, on the rest screen, when the lifter knows how it
// felt and has nothing else to do. Train itself has no RPE control. Anything
// left unrated can be caught up: from a line on Train after leaving the lift,
// and from the summary once the session is finished.

const FIXTURE = path.join(__dirname, 'fixtures', 'methods.json');

type Row = { exerciseId: string; setNo: number; rpe: number; rpeEstimated: boolean; segment?: number };

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

/** A chip on the rest screen or in a rating row. The aim's name says so. */
function chip(scope: ReturnType<Page['getByRole']>, rpe: number) {
  return scope.getByRole('button', { name: new RegExp(`^RPE ${String(rpe).replace('.', '\\.')}(, your aim)?$`) });
}

function logSet(page: Page) {
  return page.getByRole('button', { name: /^Log (set|drop|piece)/ }).click();
}

test.describe('RPE after the set', () => {
  test.beforeEach(async ({ page }) => {
    await gotoApp(page);
    await completeSetup(page, { workouts: [['Bench Press', 'Overhead Press']], names: ['Push A'] });
    await goToTab(page, 'Today');
    await page.getByRole('button', { name: /^(Start .+|Train anyway)$/ }).click();
    await goToTab(page, 'Train');
  });

  test('Train has no RPE control; the rest screen asks, with the aim marked', async ({ page }) => {
    await expect(page.getByRole('button', { name: /RPE/ })).toHaveCount(0);

    await logSet(page);
    const rest = restScreen(page);
    await expect(rest.getByText('How did that feel?')).toBeVisible();
    const row = rest.getByRole('group', { name: /^RPE for Bench set 1$/ });
    await expect(row.getByRole('button')).toHaveCount(7);
    await expect(row.getByRole('button', { name: 'RPE 8, your aim' })).toContainText('aim');
  });

  test('a chosen value is logged as said; one left alone logs the aim as an estimate', async ({ page }) => {
    await logSet(page);
    await chip(restScreen(page), 9).click();
    await skipRest(page);
    await logSet(page);
    await skipRest(page);

    await expect
      .poll(async () => (await readSets(page)).map(({ rpe, rpeEstimated }) => ({ rpe, rpeEstimated })))
      .toEqual([
        { rpe: 9, rpeEstimated: false },
        { rpe: 8, rpeEstimated: true },
      ]);
  });

  test('a rating stays on screen and can be changed, and every chip clears 44px', async ({ page }) => {
    await logSet(page);
    const rest = restScreen(page);
    await chip(rest, 9).click();
    await expect(chip(rest, 9)).toHaveAttribute('aria-pressed', 'true');
    await chip(rest, 7).click();
    await expect(chip(rest, 7)).toHaveAttribute('aria-pressed', 'true');
    await expect(chip(rest, 9)).toHaveAttribute('aria-pressed', 'false');
    await expect.poll(async () => (await readSets(page))[0]?.rpe).toBe(7);

    const boxes = await rest.getByRole('group', { name: /^RPE for / }).getByRole('button').evaluateAll((els) =>
      els.map((el) => el.getBoundingClientRect()).map((r) => ({ w: Math.round(r.width), h: Math.round(r.height), right: r.right })),
    );
    for (const box of boxes) {
      expect(box.w).toBeGreaterThanOrEqual(44);
      expect(box.h).toBeGreaterThanOrEqual(44);
      // All seven on screen at 412px, none needing a scroll.
      expect(box.right).toBeLessThanOrEqual(412);
    }
  });

  test('What’s RPE? opens the explainer over the rest screen', async ({ page }) => {
    await logSet(page);
    await restScreen(page).getByRole('button', { name: /^What.s RPE\?$/ }).click();
    const explainer = page.getByRole('dialog', { name: 'What RPE means' });
    await expect(explainer).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(explainer).toBeHidden();
    // Escape closed the explainer, not the rest screen under it.
    await expect(restScreen(page)).toBeVisible();
  });

  test('leaving a lift unrated shows a catch-up line, and its sheet rates the set', async ({ page }) => {
    await logSet(page);
    await skipRest(page);
    await page.getByRole('button', { name: /^OHP, / }).click();

    const line = page.getByRole('status').filter({ hasText: 'unrated' });
    await expect(line).toHaveText(/^Bench · 1 set unratedRate$/);
    await line.getByRole('button', { name: 'Rate Bench' }).click();

    const sheet = page.getByRole('dialog', { name: 'Rate Bench Press' });
    await expect(sheet.getByText(/^Set 1 · 40 kg × 8$/)).toBeVisible();
    await chip(sheet, 9).click();
    await expect(chip(sheet, 9)).toHaveAttribute('aria-pressed', 'true');
    await sheet.getByRole('button', { name: 'Done' }).click();

    await expect(line).toBeHidden();
    await expect.poll(async () => (await readSets(page))[0]).toMatchObject({ rpe: 9, rpeEstimated: false });
  });

  test('the catch-up line goes when the next set is logged', async ({ page }) => {
    await logSet(page);
    await skipRest(page);
    await page.getByRole('button', { name: /^OHP, / }).click();
    const line = page.getByRole('status').filter({ hasText: 'unrated' });
    await expect(line).toBeVisible();

    await logSet(page);
    await skipRest(page);
    await expect(line).toBeHidden();
  });

  test('the summary offers Rate for a lift with unrated sets, and the rating sticks', async ({ page }) => {
    await logSet(page);
    await skipRest(page);
    await finishToSummary(page);

    const summary = page.getByRole('dialog', { name: 'Session summary' });
    await expect(summary.getByText(/^1 × 8 @ 40 kg · 1 set unrated$/)).toBeVisible();
    await summary.getByRole('button', { name: 'Rate Bench Press' }).click();

    const sheet = page.getByRole('dialog', { name: 'Rate Bench Press' });
    await chip(sheet, 9).click();
    await sheet.getByRole('button', { name: 'Done' }).click();

    await expect(summary.getByText(/^1 × 8 @ 40 kg · top RPE 9$/)).toBeVisible();
    await expect(summary.getByRole('button', { name: 'Rate Bench Press' })).toHaveCount(0);
  });

  test('the last planned set opens "That’s the plan done", which can finish or carry on', async ({ page }) => {
    // Train Bench until its plan runs out, then Press.
    for (const lift of ['Bench', 'OHP']) {
      await page.getByRole('button', { name: new RegExp(`^${lift}, `) }).click();
      for (let i = 0; i < 12; i++) {
        const chipName = await page.getByRole('button', { name: new RegExp(`^${lift}, `) }).getAttribute('aria-label');
        const [, done, planned] = /(\d+) of (\d+)/.exec(chipName ?? '') ?? [];
        if (done === planned) break;
        await logSet(page);
        if (await restScreen(page).getByRole('button', { name: 'Skip rest' }).isVisible()) await skipRest(page);
      }
    }

    const complete = page.getByRole('dialog', { name: 'Session complete' });
    await expect(complete.getByText('That’s the plan done')).toBeVisible();
    // No countdown on this one.
    await expect(complete.getByRole('timer')).toHaveCount(0);
    // The set just logged, and every other set still unrated, in one place.
    await expect(complete.getByText('Still unrated from this session')).toBeVisible();

    await complete.getByRole('button', { name: 'Keep training' }).click();
    await expect(complete).toBeHidden();

    await page.getByRole('button', { name: 'Session menu', exact: true }).click();
    await page.getByRole('dialog', { name: 'Session menu' }).getByRole('button', { name: 'Finish session' }).click();
    // Every lift trained, so it finishes without asking.
    await expect(page.getByRole('dialog', { name: 'Session summary' })).toBeVisible();
  });

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

test.describe('sets without a full rest of their own', () => {
  test.beforeEach(async ({ page }) => {
    await gotoApp(page);
    await skipSetup(page);
    await openSettings(page);
    await settingsSheet(page).getByLabel('Bompa backup file').setInputFiles(FIXTURE);
    await settingsSheet(page).getByRole('button', { name: 'Import it' }).click();
    await expect.poll(async () => (await readSets(page)).length).toBe(4);
    await page.reload();
    await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible({ timeout: 15_000 });
  });

  async function start(page: Page, name: string) {
    await startFromWorkouts(page, name);
  }

  test('a cluster is asked about once, after its last single, as one set', async ({ page }) => {
    await start(page, 'Methods · pieces');
    await page.getByRole('button', { name: /^Dead, / }).click();

    await logSet(page);
    // Between singles the pause stays on the entry card, and nothing is asked.
    for (let i = 0; i < 10 && !(await restScreen(page).isVisible()); i++) {
      await expect(restScreen(page)).toBeHidden();
      await logSet(page);
    }
    const rest = restScreen(page);
    await expect(rest.getByText(/^Just logged · Dead cluster · \d+ × \d+$/)).toBeVisible();
    await expect(rest.getByRole('group', { name: /^RPE for / })).toHaveCount(1);

    await chip(rest, 9).click();
    await expect
      .poll(async () => (await readSets(page)).filter((row) => row.exerciseId === 'deadlift').every((row) => row.rpe === 9 && !row.rpeEstimated))
      .toBe(true);
  });

  test('a superset asks nothing mid-round, then one row per set after the round', async ({ page }) => {
    await start(page, 'Methods · groups');
    const members = await page.getByRole('button', { name: /, 0 of \d+ sets$/ }).count();
    expect(members).toBeGreaterThan(0);

    // Group B leads the workout; log one set of each member.
    await logSet(page);
    await expect(restScreen(page)).toBeHidden();
    for (let i = 0; i < 6 && !(await restScreen(page).isVisible()); i++) await logSet(page);

    const rest = restScreen(page);
    await expect(rest.getByText('Just logged · the round')).toBeVisible();
    await expect(rest.getByRole('group', { name: /^RPE for / })).toHaveCount(3);
  });
});
