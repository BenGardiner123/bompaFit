import { expect, test, type Page } from '@playwright/test';
import { completeSetup, finishToSummary, gotoApp, goToTab, restScreen, skipRest } from './helpers';

type StoredSet = { exerciseId: string; setNo: number; rpe: number; rpeEstimated: boolean };

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

// The Train screen's newer paths: the full-screen rest, the summary a finished
// session opens, swiping between lifts, the dots that reach a logged set, and
// the ways back from finishing or deleting. Each is something a person does
// with a thumb mid-workout, so each is driven the way they would drive it.

async function startSession(page: Page) {
  await goToTab(page, 'Today');
  await page.getByRole('button', { name: /^(Start .+|Train anyway)$/ }).click();
  await goToTab(page, 'Train');
  await expect(page.getByRole('button', { name: 'Log set' })).toBeVisible();
}

/** The name of the lift the logger is on, from its heading. */
function liftHeading(page: Page) {
  return page.getByRole('heading', { level: 2 });
}

/** Drag sideways across the centre of the screen, starting on the lift's name. */
async function swipe(page: Page, dx: number, dy = 0) {
  const box = (await liftHeading(page).boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  // Several steps, so the drag crosses the lock distance before it commits.
  await page.mouse.move(x + dx, y + dy, { steps: 10 });
  await page.mouse.up();
}

/** Open the session menu and press Finish session in it. */
async function pressFinish(page: Page) {
  await page.getByRole('button', { name: 'Session menu', exact: true }).click();
  await page.getByRole('dialog', { name: 'Session menu' }).getByRole('button', { name: 'Finish session' }).click();
}

/** Every planned slot, read straight from storage. */
async function plannedSlots(page: Page) {
  return page.evaluate(async () => {
    const open = indexedDB.open('bompa');
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
    return new Promise<{ id: number; status: string; date?: string; sessionId?: number }[]>((resolve, reject) => {
      const request = database.transaction('plannedSessions').objectStore('plannedSessions').getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  });
}

test.describe('the Train screen', () => {
  test.beforeEach(async ({ page }) => {
    await gotoApp(page);
    await completeSetup(page, { workouts: [['Bench Press', 'Overhead Press']], names: ['Push A'] });
  });

  test.describe('full-screen rest', () => {
    test('opens when a set is logged, over the whole screen', async ({ page }) => {
      await startSession(page);
      await page.getByRole('button', { name: 'Log set' }).click();

      const rest = restScreen(page);
      await expect(rest).toBeVisible();
      await expect(rest.getByRole('timer')).toBeVisible();
      await expect(rest.getByText('Resting', { exact: true })).toBeVisible();
      // What comes next, from the plan, so the lifter can set up without looking at the logger.
      await expect(rest.getByText('Bench Press · set 2', { exact: true })).toBeVisible();

      // It covers the tab bar as well as the logger. Polled, because the overlay
      // slides up as it opens: measured mid-slide it sits a fraction of a pixel short.
      const nav = (await page.getByRole('navigation', { name: 'Main' }).boundingBox())!;
      await expect
        .poll(async () => {
          const box = (await rest.boundingBox())!;
          return Math.round(box.y + box.height);
        })
        .toBeGreaterThanOrEqual(Math.round(nav.y + nav.height));
    });

    test('Minimise shrinks it to a pill in the header, and it comes back', async ({ page }) => {
      await startSession(page);
      await page.getByRole('button', { name: 'Log set' }).click();
      await restScreen(page).getByRole('button', { name: 'Minimise' }).click();

      await expect(restScreen(page)).toBeHidden();
      // Still resting — only smaller, with the logger usable around it.
      const pill = page.getByRole('button', { name: /^Rest, \d+:\d\d left/ });
      await expect(pill).toBeVisible();
      await expect(pill).toContainText(/^Rest \d+:\d\d$/);
      await expect(page.getByRole('button', { name: 'Log set' })).toBeVisible();

      await pill.click();
      await expect(restScreen(page)).toBeVisible();
    });

    test('once minimised, the next rest starts minimised, and RPE is asked on Train instead', async ({ page }) => {
      await startSession(page);
      await page.getByRole('button', { name: 'Log set' }).click();
      await restScreen(page).getByRole('button', { name: 'Minimise' }).click();

      // The question the rest screen would have asked, here instead.
      const asked = page.getByRole('region', { name: 'How did that feel?' });
      await expect(asked).toBeVisible();
      // Not the aim, so what is stored can only have come from the tap.
      await asked.getByRole('button', { name: 'RPE 9', exact: true }).click();
      await expect(asked).toBeHidden();
      await expect.poll(async () => (await readSets(page))[0]).toMatchObject({ rpe: 9, rpeEstimated: false });

      await page.getByRole('button', { name: /^Log set/ }).click();
      await expect(restScreen(page)).toBeHidden();
      await expect(page.getByRole('button', { name: /^Rest, / })).toBeVisible();
    });

    test('with the rest minimised, the toast sits above the Log button rather than over it', async ({ page }) => {
      await startSession(page);
      await page.getByRole('button', { name: 'Log set' }).click();
      await page.keyboard.press('Escape');
      await expect(restScreen(page)).toBeHidden();

      const toast = page.getByTestId('toast');
      await expect(toast).toContainText('Rest running');
      // Polled, because the toast slides up into place as it arrives.
      const gap = async () => {
        const box = (await toast.boundingBox())!;
        const log = (await page.getByRole('button', { name: /^Log set/ }).boundingBox())!;
        return Math.round(log.y - (box.y + box.height));
      };
      await expect.poll(gap).toBe(10);
    });

    test('Escape minimises rather than ending the rest', async ({ page }) => {
      await startSession(page);
      await page.getByRole('button', { name: 'Log set' }).click();
      await expect(restScreen(page)).toBeVisible();

      await page.keyboard.press('Escape');
      await expect(restScreen(page)).toBeHidden();
      await expect(page.getByRole('button', { name: /^Rest, / })).toBeVisible();
    });

    test('Skip ends the rest, including one brought back from the pill', async ({ page }) => {
      await startSession(page);
      await page.getByRole('button', { name: 'Log set' }).click();
      await skipRest(page);
      await expect(page.getByRole('timer')).toBeHidden();

      await page.getByRole('button', { name: 'Log set' }).click();
      await restScreen(page).getByRole('button', { name: 'Minimise' }).click();
      await page.getByRole('button', { name: /^Rest, / }).click();
      await skipRest(page);
      await expect(page.getByRole('button', { name: /^Rest, / })).toBeHidden();
    });

    test('the last ten seconds change the screen, and it closes itself at the end', async ({ page }) => {
      // Timers derive from the wall clock, so moving the clock is the honest
      // way to reach the end of a rest without waiting two and a half minutes.
      await page.clock.install();
      await page.reload();
      await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible({ timeout: 15_000 });
      await startSession(page);
      await page.getByRole('button', { name: 'Log set' }).click();

      const rest = restScreen(page);
      await expect(rest.getByText('Resting', { exact: true })).toBeVisible();

      await page.clock.fastForward('02:21');
      await expect(rest.getByText('Get under the bar')).toBeVisible();

      await page.clock.fastForward('00:15');
      await expect(rest).toBeHidden();
      await expect(page.getByRole('timer')).toBeHidden();
    });

    test('holding the ring changes the default rest, and the rest running keeps its length', async ({ page }) => {
      // The hold is timed on the page's clock, moved on by hand, so a slow
      // machine can neither cut it short nor stretch a tap into one.
      await page.clock.install();
      await page.reload();
      await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible({ timeout: 15_000 });
      await startSession(page);
      await page.getByRole('button', { name: 'Log set' }).click();
      const ring = restScreen(page).getByRole('timer');
      await expect(ring).toHaveAccessibleName(/of 2:30 rest left/);

      const box = (await ring.boundingBox())!;
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.clock.runFor(700);
      await page.mouse.up();

      const presets = page.getByRole('dialog', { name: 'Default rest' });
      await expect(presets).toBeVisible();
      await presets.getByRole('button', { name: '1:30 rest' }).click();
      await expect(presets).toBeHidden();
      await expect(ring).toHaveAccessibleName(/of 2:30 rest left/);

      await skipRest(page);
      await page.getByRole('button', { name: 'Log set' }).click();
      await expect(restScreen(page).getByRole('timer')).toHaveAccessibleName(/of 1:30 rest left/);
    });
  });

  test.describe('the finish summary', () => {
    test('Finish opens a summary of the session, and Done lands on Today', async ({ page }) => {
      await startSession(page);
      await page.getByRole('button', { name: 'Log set' }).click();
      // Rated on the rest screen, so the summary's top RPE is the lifter's own.
      const eight = restScreen(page).getByRole('button', { name: /^RPE 8(, your aim)?$/ });
      await eight.click();
      await expect(eight).toHaveAttribute('aria-pressed', 'true');
      await finishToSummary(page);

      const summary = page.getByRole('dialog', { name: 'Session summary' });
      await expect(summary.getByText(/^Session saved · Push A$/i)).toBeVisible();
      // One working set logged, one of a planned several on Bench; Press untouched.
      await expect(summary.getByText(/^1 × 8 @ \d+(\.\d+)? kg · top RPE 8$/)).toBeVisible();
      await expect(summary.getByText(/^1\/\d+$/)).toBeVisible();
      await expect(summary.getByText('Not trained today')).toBeVisible();
      // One set is too few to judge a lift, so the verdict does not pretend to;
      // it does say which planned lift was never started.
      await expect(summary.getByText(/^You didn't get to Overhead Press\b.*The rest was on target/)).toBeVisible();
      // Tomorrow's readiness leads. On a first session Today is still learning,
      // and the summary says the same rather than naming a band.
      await expect(summary.getByRole('img', { name: /^Tomorrow's readiness \d+, still learning\./ })).toBeVisible();
      await expect(summary.getByText('Still learning', { exact: true })).toBeVisible();
      // The same grey as on Today, not amber: amber is kept for things you can tap.
      await expect(summary.getByText('Still learning', { exact: true })).toHaveCSS('color', 'rgb(163, 163, 153)');
      await expect(summary.getByText(/^1 of \d+ done/)).toBeVisible();

      await summary.getByRole('button', { name: 'Done', exact: true }).click();
      await expect(summary).toBeHidden();
      await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Today' })).toHaveAttribute(
        'aria-current',
        'page',
      );
    });

    test('an empty session still gets a summary, and says it still counts', async ({ page }) => {
      await startSession(page);
      await finishToSummary(page);
      const summary = page.getByRole('dialog', { name: 'Session summary' });
      await expect(summary.getByText("Nothing logged, and that's fine — it still counts as a session.")).toBeVisible();
    });
  });

  test.describe('moving between lifts', () => {
    test('a swipe left moves to the next lift, and the ends stop rather than wrap', async ({ page }) => {
      await startSession(page);
      await expect(liftHeading(page)).toContainText('Bench Press');

      // Before the first lift there is nothing: the column gives, then springs back.
      await swipe(page, 160);
      await expect(liftHeading(page)).toContainText('Bench Press');

      await swipe(page, -160);
      await expect(liftHeading(page)).toContainText('Overhead Press');
      // Past the last lift, the same.
      await swipe(page, -160);
      await expect(liftHeading(page)).toContainText('Overhead Press');

      await swipe(page, 160);
      await expect(liftHeading(page)).toContainText('Bench Press');
    });

    test('a short or mostly vertical drag does not change lift, and a drag never presses a button', async ({ page }) => {
      await startSession(page);

      await swipe(page, -40);
      await expect(liftHeading(page)).toContainText('Bench Press');
      await swipe(page, -60, 120);
      await expect(liftHeading(page)).toContainText('Bench Press');

      // The drag began on the lift's name, which is a button. Letting go must
      // not open the How-to sheet as if it had been tapped.
      await swipe(page, -160);
      await expect(liftHeading(page)).toContainText('Overhead Press');
      await expect(page.getByRole('dialog')).toHaveCount(0);

      // And a plain tap still works after all that.
      await page.getByRole('button', { name: 'Increase reps' }).click();
      await expect(page.getByRole('button', { name: /^Log set .* × 9$/ })).toBeVisible();
    });

    test('the chips change lift by keyboard, the swipe’s alternative', async ({ page }) => {
      await startSession(page);
      const press = page.getByRole('button', { name: /^OHP, 0 of \d+ sets$/ });
      await press.focus();
      await page.keyboard.press('Enter');

      await expect(liftHeading(page)).toContainText('Overhead Press');
      await expect(press).toHaveAttribute('aria-pressed', 'true');
    });
  });

  test('a filled dot opens that set in the editor', async ({ page }) => {
    await startSession(page);
    await page.getByRole('button', { name: 'Log set' }).click();
    await skipRest(page);

    await page.getByRole('button', { name: /^Edit set 1\b/ }).click();
    await expect(page.getByRole('dialog', { name: 'Edit logged set' })).toBeVisible();
  });

  test('every control is at least 44px, on the logger and on the rest screen', async ({ page }) => {
    await startSession(page);
    await page.getByRole('button', { name: 'Log set' }).click();
    await skipRest(page);

    const check = async (where: string) => {
      const sizes = await page.locator('button:visible').evaluateAll((els) =>
        els.map((el) => {
          const r = el.getBoundingClientRect();
          return { name: el.getAttribute('aria-label') ?? el.textContent ?? '', w: r.width, h: r.height };
        }),
      );
      for (const size of sizes) {
        expect(Math.round(size.w), `${where}: "${size.name}" is too narrow`).toBeGreaterThanOrEqual(44);
        expect(Math.round(size.h), `${where}: "${size.name}" is too short`).toBeGreaterThanOrEqual(44);
      }
    };

    await check('logger');

    await page.getByRole('button', { name: 'Log set' }).click();
    await check('full-screen rest');

    await restScreen(page).getByRole('button', { name: 'Minimise' }).click();
    await check('logger with the rest minimised');
  });

  test.describe('finishing', () => {
    test('with a lift untrained, Finish asks first, and Keep going loses nothing', async ({ page }) => {
      await startSession(page);
      await page.getByRole('button', { name: 'Log set' }).click();
      await skipRest(page);

      await pressFinish(page);
      const guard = page.getByRole('dialog', { name: '1 lift not trained yet' });
      await expect(guard).toBeVisible();
      await expect(guard.getByText(/^Finish Push A$/i)).toBeVisible();
      await expect(guard.getByText('Overhead Press', { exact: true })).toBeVisible();
      await expect(guard.getByText(/^0 \/ \d+$/)).toBeVisible();
      // The safe answer is the one that takes focus.
      await expect(guard.getByRole('button', { name: 'Keep going' })).toBeFocused();

      await guard.getByRole('button', { name: 'Keep going' }).click();
      await expect(guard).toBeHidden();
      await expect(page.getByRole('button', { name: /^Edit set 1\b/ })).toBeVisible();

      await pressFinish(page);
      await guard.getByRole('button', { name: 'Finish anyway' }).click();
      await expect(page.getByRole('dialog', { name: 'Session summary' })).toBeVisible();
    });

    test('with every lift trained, Finish goes straight to the summary', async ({ page }) => {
      await startSession(page);
      await page.getByRole('button', { name: 'Log set' }).click();
      await skipRest(page);
      await page.getByRole('button', { name: /^OHP, / }).click();
      await page.getByRole('button', { name: 'Log set' }).click();
      await skipRest(page);

      await pressFinish(page);
      await expect(page.getByRole('dialog', { name: 'Session summary' })).toBeVisible();
      await expect(page.getByRole('dialog', { name: /not trained yet$/ })).toHaveCount(0);
    });

    test('Undo finish reopens the session and puts its slot back as it was, after a reload too', async ({ page }) => {
      await startSession(page);
      await page.getByRole('button', { name: 'Log set' }).click();
      await skipRest(page);
      const before = await plannedSlots(page);

      await finishToSummary(page);
      await expect.poll(async () => (await plannedSlots(page)).filter((p) => p.status === 'done')).toHaveLength(1);

      const summary = page.getByRole('dialog', { name: 'Session summary' });
      const undo = summary.getByRole('button', { name: /^Undo finish, \d+ seconds left$/ });
      await expect(undo).toContainText(/^Undo finish · 0:[0-3]\d$/);
      await undo.click();

      await expect(summary).toBeHidden();
      await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Train' })).toHaveAttribute(
        'aria-current',
        'page',
      );
      await expect(page.getByRole('button', { name: /^Edit set 1\b/ })).toBeVisible();
      // Pending again, with no date and no session: exactly the row it was.
      await expect.poll(() => plannedSlots(page)).toEqual(before);

      await page.reload();
      await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible({ timeout: 15_000 });
      await goToTab(page, 'Train');
      await expect(page.getByRole('button', { name: /^Edit set 1\b/ })).toBeVisible();
    });
  });

  test('deleting a set can be undone from the toast, and stays undone after a reload', async ({ page }) => {
    await startSession(page);
    await page.getByRole('button', { name: 'Log set' }).click();
    await skipRest(page);

    await page.getByRole('button', { name: /^Edit set 1\b/ }).click();
    await page.getByRole('dialog', { name: 'Edit logged set' }).getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(page.getByRole('button', { name: /^Edit set 1\b/ })).toBeHidden();

    const toast = page.getByTestId('toast');
    await expect(toast).toContainText('Deleted Bench set 1');
    await toast.getByRole('button', { name: 'Undo' }).click();
    await expect(page.getByRole('button', { name: /^Edit set 1\b/ })).toBeVisible();

    // Back in storage too, not just on screen.
    await page.reload();
    await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible({ timeout: 15_000 });
    await goToTab(page, 'Train');
    await expect(page.getByRole('button', { name: /^Edit set 1\b/ })).toBeVisible();
  });
});
