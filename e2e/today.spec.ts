import { expect, test } from '@playwright/test';
import { completeSetup, goToTab, gotoApp, trainOneSession } from './helpers';

// Today's week strip. Tapping a slot *loads* that workout so you can see what
// is in it and decide — selecting is not starting. The order of a week is a
// suggestion, so picking a different one has to cost nothing.

test.beforeEach(async ({ page }) => {
  await gotoApp(page);
  await completeSetup(page, {
    workouts: [['Bench Press', 'Overhead Press'], ['Back Squat', 'Romanian Deadlift']],
    names: ['Push A', 'Legs A'],
  });
  await goToTab(page, 'Today');
});

test.describe("this week's slots", () => {
  test('a pending slot is a control; a done one is not', async ({ page }) => {
    // The cards used to be plain divs. They looked pressable and did nothing.
    await expect(page.getByRole('button', { name: /^Show .*, slot 1$/ })).toBeVisible();
  });

  test('tapping one loads it without starting anything', async ({ page }) => {
    const second = page.getByRole('button', { name: /^Show .*, slot 2$/ });
    await second.click();

    // The card below now describes slot 2 rather than what is next...
    await expect(page.getByText(/^#2 · /)).toBeVisible();
    // ...and nothing has begun: still an invitation to start, not to resume.
    await expect(page.getByRole('button', { name: /^Start / })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Resume workout' })).toHaveCount(0);
  });

  test('the loaded workout is the one that starts', async ({ page }) => {
    const second = page.getByRole('button', { name: /^Show .*, slot 2$/ });
    const label = (await second.getAttribute('aria-label')) ?? '';
    const name = label.replace(/^Show /, '').replace(/, slot \d+$/, '');

    await second.click();
    // The button names what it starts, so there is no guessing which one.
    await page.getByRole('button', { name: `Start ${name}`, exact: true }).click();

    // The logger opens on the workout that was on screen when it was tapped.
    await expect(page.getByText(name).first()).toBeVisible();
  });

  test('going back to the next one is just another tap', async ({ page }) => {
    await page.getByRole('button', { name: /^Show .*, slot 2$/ }).click();
    await expect(page.getByText(/^#2 · /)).toBeVisible();

    await page.getByRole('button', { name: /^Show .*, slot 1$/ }).click();
    await expect(page.getByText(/^Next up · /)).toBeVisible();
  });

  test('the row says which slot the card is showing', async ({ page }) => {
    const first = page.getByRole('button', { name: /^Show .*, slot 1$/ });
    const second = page.getByRole('button', { name: /^Show .*, slot 2$/ });
    await expect(first).toHaveAttribute('aria-pressed', 'true');
    await second.click();
    await expect(second).toHaveAttribute('aria-pressed', 'true');
    await expect(first).toHaveAttribute('aria-pressed', 'false');
  });

  test('every slot is a chip a full thumb high', async ({ page }) => {
    const box = await page.getByRole('button', { name: /^Show .*, slot 1$/ }).boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(44);
  });

  test('a trained slot stops being a control but is still announced', async ({ page }) => {
    await trainOneSession(page);

    await expect(page.getByRole('button', { name: /^Show .*, slot 1$/ })).toHaveCount(0);
    await expect(page.getByText(/, slot 1, done$/)).toHaveCount(1);
    await expect(page.getByText(/^Next up · 1 of \d+ done$/)).toBeVisible();
  });
});

test.describe('readiness hero', () => {
  test('before any training it says there is nothing to read, with no number or curve', async ({ page }) => {
    await expect(page.getByText('Nothing to read yet')).toBeVisible();
    await expect(page.getByText(/^Readiness \d+ out of 100/)).toHaveCount(0);
    await expect(page.getByText(/^fatigue \d+$/)).toHaveCount(0);
  });

  test('after a session the number is read out with what it means', async ({ page }) => {
    await trainOneSession(page);
    // The big figure is hidden from assistive technology; this sentence stands in for it.
    await expect(page.getByText(/^Readiness \d+ out of 100, /)).toHaveCount(1);
    await expect(page.getByText('Nothing to read yet')).toHaveCount(0);
  });

  test('the number is white, because amber is kept for things you can tap', async ({ page }) => {
    await trainOneSession(page);
    const numeral = page.getByText(/^Readiness \d+ out of 100, /).locator('xpath=following-sibling::div/span[1]');
    await expect(numeral).toHaveText(/^\d+$/);
    await expect(numeral).toHaveCSS('color', 'rgb(255, 255, 255)');
  });

  test('"Still learning" is not amber, because amber is kept for things you can tap', async ({ page }) => {
    await trainOneSession(page);
    const word = page.getByText('Still learning', { exact: true });
    await expect(word).toBeVisible();
    await expect(word).not.toHaveCSS('color', 'rgb(251, 191, 36)');
    await expect(word).not.toHaveCSS('color', 'rgb(245, 158, 11)');
  });

  test('the number counts a session finished moments after its last set', async ({ page }) => {
    // Finishing within a second of the last set once left the session out of
    // the score until a reload, so the number changed with nothing new logged.
    await trainOneSession(page);
    const spoken = page.getByText(/^Readiness \d+ out of 100/);
    const before = await spoken.innerText();

    await page.reload();
    await goToTab(page, 'Today');
    await expect(spoken).toHaveText(before);
  });

  test('the fitness and fatigue curve appears once there are two sessions to draw', async ({ page }) => {
    await trainOneSession(page);
    await expect(page.getByText(/^fatigue \d+$/)).toHaveCount(0);

    await trainOneSession(page);
    // The labels beside the curve are its legend, and say how far back it looks.
    await expect(page.getByText('fitness', { exact: true })).toBeVisible();
    await expect(page.getByText(/^fatigue \d+$/)).toBeVisible();
    await expect(page.getByText('28 days', { exact: true })).toBeVisible();
    // The chart is a picture; the numbers behind it are said in words.
    await expect(page.getByText(/^Over the last 28 days: fitness is now \d+ and fatigue \d+\./)).toHaveCount(1);
  });

  test('after one session there is no trend, because there is nothing before it to compare with', async ({ page }) => {
    await trainOneSession(page);
    // Neither the visible line nor the spoken sentence mentions it.
    await expect(page.getByText(/(since|with) last session/i)).toHaveCount(0);
  });

  test('after a second session the trend against the last one is shown and read out', async ({ page }) => {
    await trainOneSession(page);
    await trainOneSession(page);

    // Shown beside the numeral...
    await expect(page.getByText(/^(↑|↓) \d+ since last session$|^level with last session$/)).toBeVisible();
    // ...and said in words as part of the numeral's own sentence.
    await expect(page.getByText(/^Readiness \d+ out of 100, .*(Up \d+|Down \d+|Level with last session)(?: since last session)?\.$/)).toHaveCount(1);
  });
});

test.describe('the sheet', () => {
  test('lists the lifts of the workout on offer', async ({ page }) => {
    await expect(page.getByText(/^\d+ lifts · ~\d+ min$/)).toBeVisible();
    await expect(page.getByText('01', { exact: true })).toBeVisible();
    await expect(page.getByText('02', { exact: true })).toBeVisible();
  });

  test('"Other workouts" under Start opens the Workouts tab', async ({ page }) => {
    await page.getByRole('button', { name: 'Other workouts', exact: true }).click();
    const nav = page.getByRole('navigation', { name: 'Main' });
    await expect(nav.getByRole('button', { name: 'Workouts' })).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('heading', { name: 'Workouts', level: 1 })).toBeVisible();
  });

  test('the gear in the hero opens Settings', async ({ page }) => {
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible();
  });

  test('three figures, each named, and all of them on screen at once', async ({ page }) => {
    const terms = page.getByRole('term');
    await expect(terms).toHaveText(['load vs usual', 'since rest', 'to meet']);
    // Volume and intensity are a look back, and live on History now.
    await expect(page.getByRole('term').filter({ hasText: /^(7-day volume|intensity|to peak)$/ })).toHaveCount(0);
    await expect(page.getByText(/Acute:chr/)).toHaveCount(0);

    // A grid that fits, not a strip that scrolls: every figure is inside the screen.
    const width = page.viewportSize()!.width;
    for (const term of await terms.all()) {
      const box = (await term.boundingBox())!;
      expect(box.x + box.width).toBeLessThanOrEqual(width);
    }
  });

  test('with nothing logged, days since rest is a dash rather than "0 days"', async ({ page }) => {
    const figure = page.getByRole('term').filter({ hasText: /^since rest$/ }).locator('xpath=following-sibling::dd');
    await expect(figure).toHaveText('—');
  });

  test('with no meet set, the days to meet say so rather than showing a number', async ({ page }) => {
    const toMeet = page.getByRole('term').filter({ hasText: /^to meet$/ }).locator('xpath=following-sibling::dd');
    await expect(toMeet).toHaveText('—');
  });
});
