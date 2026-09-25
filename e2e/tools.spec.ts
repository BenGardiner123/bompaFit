import { expect, test, type Page } from '@playwright/test';
import { completeSetup, goToTab, gotoApp, openTool } from './helpers';

// The tools on the Workouts tab: the interval timer and the 1RM calculator,
// each a screen of its own with a way back.

test.beforeEach(async ({ page }) => {
  await gotoApp(page);
  await completeSetup(page, { workouts: [['Bench Press', 'Overhead Press']], names: ['Push A'] });
});

/** The hero behind the clock. Its colour is how "urgent" reads from across the room. */
async function heroBackground(page: Page) {
  return page.getByRole('timer').evaluate((el) => getComputedStyle(el.parentElement!).backgroundColor);
}

const INK = 'rgb(20, 20, 16)';
const INK80 = 'rgb(61, 61, 54)';

test.describe('interval timer', () => {
  test.beforeEach(async ({ page }) => {
    await openTool(page, 'Interval timer');
  });

  test('switches between stopwatch, AMRAP and EMOM', async ({ page }) => {
    const modes = page.getByRole('group', { name: 'Timer mode' });
    await expect(modes.getByRole('button', { name: 'Stopwatch' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('timer')).toContainText('Stopwatch 0:00');

    await modes.getByRole('button', { name: 'AMRAP' }).click();
    await expect(modes.getByRole('button', { name: 'AMRAP' })).toHaveAttribute('aria-pressed', 'true');
    await expect(modes.getByRole('button', { name: 'Stopwatch' })).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByRole('timer')).toContainText('12:00 left of 12 minutes');

    // A cap chip resets the clock to the new cap.
    const caps = page.getByRole('group', { name: 'Time cap' });
    await caps.getByRole('button', { name: '8m' }).click();
    await expect(caps.getByRole('button', { name: '8m' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('timer')).toContainText('8:00 left of 8 minutes');

    await modes.getByRole('button', { name: 'EMOM' }).click();
    await expect(page.getByRole('timer')).toContainText('1:00 left in round 1');
    await expect(page.getByRole('group', { name: 'Interval length' }).getByRole('button', { name: '1m' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  test('keeps time from the wall clock, and pauses, resumes and resets', async ({ page }) => {
    // Installed after setup so the fake clock only governs the timer itself.
    await page.clock.install();
    await page.reload();
    await openTool(page, 'Interval timer');

    await page.getByRole('button', { name: 'Start', exact: true }).click();
    // A jump, not a stream of ticks: a clock that counted its own intervals
    // would show one tick's worth here, which is what a locked phone does to it.
    await page.clock.fastForward('01:05');
    await expect(page.getByRole('timer')).toContainText('Stopwatch 1:05');

    await page.getByRole('button', { name: 'Pause', exact: true }).click();
    await page.clock.fastForward('00:30');
    await expect(page.getByRole('timer')).toContainText('Stopwatch 1:05');

    await page.getByRole('button', { name: 'Resume', exact: true }).click();
    await page.clock.fastForward('00:10');
    await expect(page.getByRole('timer')).toContainText('Stopwatch 1:15');

    await page.getByRole('button', { name: 'Reset', exact: true }).click();
    await expect(page.getByRole('timer')).toContainText('Stopwatch 0:00');
    await expect(page.getByRole('button', { name: 'Start', exact: true })).toBeVisible();
  });

  test('turns urgent in the last seconds of an AMRAP cap', async ({ page }) => {
    await page.clock.install();
    await page.reload();
    await openTool(page, 'Interval timer');

    await page.getByRole('group', { name: 'Timer mode' }).getByRole('button', { name: 'AMRAP' }).click();
    await page.getByRole('group', { name: 'Time cap' }).getByRole('button', { name: '8m' }).click();
    await page.getByRole('button', { name: 'Start', exact: true }).click();
    await expect.poll(() => heroBackground(page)).toBe(INK);

    await page.clock.fastForward('07:52');
    await expect(page.getByRole('timer')).toContainText('0:08 left of 8 minutes');
    await expect.poll(() => heroBackground(page)).toBe(INK80);

    // Pausing ends the urgency: nothing is running out any more.
    await page.getByRole('button', { name: 'Pause', exact: true }).click();
    await expect.poll(() => heroBackground(page)).toBe(INK);
  });
});

test.describe('1RM calculator', () => {
  test.beforeEach(async ({ page }) => {
    await openTool(page, '1RM calculator');
  });

  test('reports both estimators', async ({ page }) => {
    // Exact, because the explainer text below repeats both names.
    await expect(page.getByText('Epley', { exact: true })).toBeVisible();
    await expect(page.getByText('Brzycki', { exact: true })).toBeVisible();
  });

  test('recomputes as the inputs step', async ({ page }) => {
    const epley = page.getByText('Epley', { exact: true }).locator('..');
    const before = await epley.textContent();
    await page.getByRole('button', { name: 'Increase Weight' }).click();
    await expect(epley).not.toHaveText(before ?? '');
  });
});

test.describe('pushed views', () => {
  test('keep the Workouts tab lit, and Back returns to the list', async ({ page }) => {
    const nav = page.getByRole('navigation', { name: 'Main' });
    for (const tool of ['Interval timer', '1RM calculator'] as const) {
      await openTool(page, tool);
      await expect(nav.getByRole('button', { name: 'Workouts' })).toHaveAttribute('aria-current', 'page');
      await page.getByRole('button', { name: 'Back to Workouts' }).click();
      await expect(page.getByRole('heading', { name: 'Workouts', level: 1 })).toBeVisible();
    }
  });

  test('a tab tap leaves the view behind', async ({ page }) => {
    await openTool(page, 'Interval timer');
    await goToTab(page, 'Plan');
    await goToTab(page, 'Workouts');
    await expect(page.getByRole('heading', { name: 'Workouts', level: 1 })).toBeVisible();
    await expect(page.getByRole('timer')).toHaveCount(0);
  });
});
