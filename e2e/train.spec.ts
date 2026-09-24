import { expect, test, type Page } from '@playwright/test';
import { completeSetup, gotoApp, goToTab, restScreen, skipRest } from './helpers';

// The Train screen's newer paths: the full-screen rest, the summary a finished
// session opens, swiping between lifts, and the dots that reach a logged set.
// Each is something a person does with a thumb mid-workout, so each is driven
// the way they would drive it.

async function startSession(page: Page) {
  await goToTab(page, 'Today');
  await page.getByRole('button', { name: /^(Start workout|Train anyway)$/ }).click();
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
      await expect(rest.getByText('RESTING', { exact: true })).toBeVisible();
      // What comes next, so the lifter can set up without looking at the logger.
      await expect(rest.getByText('Bench Press', { exact: true })).toBeVisible();
      await expect(rest.getByText(/^Set 2 · /)).toBeVisible();

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

    test('Minimise shrinks it to a card on the logger, and it comes back', async ({ page }) => {
      await startSession(page);
      await page.getByRole('button', { name: 'Log set' }).click();
      await restScreen(page).getByRole('button', { name: 'Minimise' }).click();

      await expect(restScreen(page)).toBeHidden();
      // Still resting — only smaller, with the logger usable around it.
      await expect(page.getByRole('timer', { name: 'Rest timer' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Log set' })).toBeVisible();

      await page.getByRole('button', { name: 'Show the rest timer full screen' }).click();
      await expect(restScreen(page)).toBeVisible();
    });

    test('Escape minimises rather than ending the rest', async ({ page }) => {
      await startSession(page);
      await page.getByRole('button', { name: 'Log set' }).click();
      await expect(restScreen(page)).toBeVisible();

      await page.keyboard.press('Escape');
      await expect(restScreen(page)).toBeHidden();
      await expect(page.getByRole('timer', { name: 'Rest timer' })).toBeVisible();
    });

    test('Skip ends the rest from either size', async ({ page }) => {
      await startSession(page);
      await page.getByRole('button', { name: 'Log set' }).click();
      await skipRest(page);
      await expect(page.getByRole('timer')).toBeHidden();

      await page.getByRole('button', { name: 'Log set' }).click();
      await restScreen(page).getByRole('button', { name: 'Minimise' }).click();
      await page.getByRole('button', { name: 'Skip', exact: true }).click();
      await expect(page.getByRole('timer')).toBeHidden();
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
      await expect(rest.getByText('RESTING', { exact: true })).toBeVisible();

      await page.clock.fastForward('02:21');
      await expect(rest.getByText('GET UNDER THE BAR')).toBeVisible();

      await page.clock.fastForward('00:15');
      await expect(rest).toBeHidden();
      await expect(page.getByRole('timer')).toBeHidden();
    });
  });

  test.describe('the finish summary', () => {
    test('Finish opens a summary of the session, and Done lands on Today', async ({ page }) => {
      await startSession(page);
      await page.getByRole('button', { name: 'RPE 8', exact: true }).click();
      await page.getByRole('button', { name: 'Log set' }).click();
      await skipRest(page);
      await page.getByRole('button', { name: 'Finish' }).click();

      const summary = page.getByRole('dialog', { name: 'Session summary' });
      await expect(summary).toBeVisible();
      await expect(summary.getByText(/^Session saved · Push A$/i)).toBeVisible();
      // One working set logged, one of a planned several on Bench; Press untouched.
      await expect(summary.getByText(/^1 × 8 @ \d+(\.\d+)? kg · top RPE 8$/)).toBeVisible();
      await expect(summary.getByText(/^1\/\d+$/)).toBeVisible();
      await expect(summary.getByText('Not trained today')).toBeVisible();
      // One set is too few to judge a lift, so the verdict does not pretend to.
      await expect(summary.getByText('On target across the board. Nothing to change.')).toBeVisible();
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
      await page.getByRole('button', { name: 'Finish' }).click();
      const summary = page.getByRole('dialog', { name: 'Session summary' });
      await expect(summary.getByText("Nothing logged, and that's fine — it still counts as a session.")).toBeVisible();
    });
  });

  test.describe('moving between lifts', () => {
    test('a swipe left moves to the next lift, and a swipe right wraps round', async ({ page }) => {
      await startSession(page);
      await expect(liftHeading(page)).toContainText('Bench Press');

      await swipe(page, -160);
      await expect(liftHeading(page)).toContainText('Overhead Press');

      // Past the last lift is the first one again, in either direction.
      await swipe(page, 160);
      await expect(liftHeading(page)).toContainText('Bench Press');
      await swipe(page, 160);
      await expect(liftHeading(page)).toContainText('Overhead Press');
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
      const press = page.getByRole('button', { name: /^OHP \d/ });
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
        expect(size.w, `${where}: "${size.name}" is too narrow`).toBeGreaterThanOrEqual(44);
        expect(size.h, `${where}: "${size.name}" is too short`).toBeGreaterThanOrEqual(44);
      }
    };

    await check('logger');

    await page.getByRole('button', { name: 'Log set' }).click();
    await check('full-screen rest');

    await restScreen(page).getByRole('button', { name: 'Minimise' }).click();
    await check('rest card');
  });
});
