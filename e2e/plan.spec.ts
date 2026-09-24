import { expect, test } from '@playwright/test';
import { completeSetup, finishSession, goToTab, gotoApp } from './helpers';

// Flexible scheduling. The week is an ordered list of slots, not a
// timetable: moving is not adding, and dropping is not missing.

test.beforeEach(async ({ page }) => {
  await gotoApp(page);
  await completeSetup(page, {
    workouts: [['Bench Press', 'Overhead Press'], ['Back Squat', 'Romanian Deadlift']],
    names: ['Push A', 'Legs A'],
  });
  await goToTab(page, 'Plan');
});

test.describe('the week', () => {
  test('lists this week as ordered slots, not weekdays', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /^This week · \d+ of \d+ done$/ })).toBeVisible();
    // No weekday names — the plan does not claim a day.
    await expect(page.getByText(/^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)$/)).toHaveCount(0);
  });

  test("a slot's options open its workout for editing", async ({ page }) => {
    // People look for the workout where they see it scheduled, not only in the library.
    const first = page.getByRole('button', { name: /^Options for / }).first();
    const name = (await first.getAttribute('aria-label'))!.replace('Options for ', '');
    await first.click();
    await page.getByRole('button', { name: `Edit workout ${name}` }).click();
    await expect(page.getByRole('dialog', { name: `Edit ${name}` })).toBeVisible();
  });

  test('says out loud that order is a suggestion', async ({ page }) => {
    await expect(page.getByText(/Order is a suggestion, not a schedule/)).toBeVisible();
  });

  test('a slot can be moved later without changing what the week expects', async ({ page }) => {
    // The options button names itself after its workout, so the aria-labels in
    // document order are the week's running order.
    const order = () =>
      page
        .getByRole('button', { name: /^Options for / })
        .evaluateAll((els) => els.map((el) => el.getAttribute('aria-label')));

    const before = await order();
    expect(before.length).toBeGreaterThan(1);

    await page.getByRole('button', { name: /^Options for / }).first().click();
    await page.getByRole('button', { name: '↓ Later' }).click();
    await page.getByRole('button', { name: 'Close options' }).click();

    const after = await order();

    // Moving is a reorder, not an addition — the count is the thing that must
    // not change, because that is what separates moving from adding.
    expect(after).toHaveLength(before.length);
    expect(after[0]).toBe(before[1]);
    expect(after[1]).toBe(before[0]);
  });


  test('rearranging the week says so, and Bompa does not take the credit', async ({ page }) => {
    // Nothing has been touched yet, so the week is still the generator's.
    await expect(page.getByText(/You rearranged this week/)).toHaveCount(0);

    await page.getByRole('button', { name: /^Options for / }).first().click();
    await page.getByRole('button', { name: '↓ Later' }).click();
    await page.getByRole('button', { name: 'Close options' }).click();

    await expect(page.getByText(/You rearranged this week/)).toBeVisible();

    // And it survives a reload, because the flag is on the rows rather than in
    // component state.
    await page.reload();
    await goToTab(page, 'Plan');
    await expect(page.getByText(/You rearranged this week/)).toBeVisible();
  });

  test('a slot can be swapped for another workout', async ({ page }) => {
    await page.getByRole('button', { name: /^Options for / }).first().click();
    const swap = page.getByRole('button', { name: /^Swap for / }).first();
    await expect(swap).toBeVisible();
    await swap.click();
    await expect(page.getByRole('heading', { name: /^This week/ })).toBeVisible();
  });

  test('a slot can be dropped, and dropping is not missing', async ({ page }) => {
    const before = await page.getByRole('button', { name: /^Options for / }).count();

    await page.getByRole('button', { name: /^Options for / }).first().click();
    await page.getByRole('button', { name: 'Drop', exact: true }).click();

    await expect(page.getByRole('button', { name: /^Options for / })).toHaveCount(before - 1);
  });

  test('the week survives a reload', async ({ page }) => {
    const before = await page.getByRole('button', { name: /^Options for / }).count();
    await page.reload();
    await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible({ timeout: 15_000 });
    await goToTab(page, 'Plan');
    await expect(page.getByRole('button', { name: /^Options for / })).toHaveCount(before);
  });
});

test.describe('training on any day', () => {
  test('starting a workout fills its slot rather than counting as extra', async ({ page }) => {
    await goToTab(page, 'Today');
    await page.getByRole('button', { name: /^(Start workout|Train anyway)$/ }).click();
    await goToTab(page, 'Train');
    await page.getByRole('button', { name: 'Log set' }).click();
    await finishSession(page);

    await goToTab(page, 'Plan');
    // One slot is now done. Nothing anywhere should call this a missed session.
    await expect(page.getByText(/missed|skipped/i)).toHaveCount(0);
  });
});

test.describe('the hero', () => {
  test('the view picker says which view is showing', async ({ page }) => {
    const views = page.getByRole('group', { name: 'Plan view' });
    await expect(views.getByRole('button', { name: 'Calendar' })).toHaveAttribute('aria-pressed', 'true');
    await views.getByRole('button', { name: 'Mesocycle' }).click();
    await expect(views.getByRole('button', { name: 'Mesocycle' })).toHaveAttribute('aria-pressed', 'true');
    await expect(views.getByRole('button', { name: 'Calendar' })).toHaveAttribute('aria-pressed', 'false');
  });

  test('the calendar leads with where you are in the macrocycle', async ({ page }) => {
    await expect(page.getByText(/^Macrocycle · \d+ weeks$/)).toBeVisible();
    // The big number is hidden from screen readers; its label says what it means.
    await expect(page.getByText(/^Week \d+ of \d+\./)).toBeAttached();
    await expect(page.getByRole('img', { name: /\d+ weeks?/ })).toBeVisible();
  });

  test('the fitness and fatigue curve is no longer on this screen', async ({ page }) => {
    await expect(page.getByText('Fitness and fatigue')).toHaveCount(0);
    await expect(page.getByText(/Fitness is currently/)).toHaveCount(0);
  });

  test('what Bompa changed is always shown, even when nothing is live', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'What Bompa changed' })).toBeVisible();
  });
});

test.describe('the block builder', () => {
  test.beforeEach(async ({ page }) => {
    await page.getByRole('group', { name: 'Plan view' }).getByRole('button', { name: 'Mesocycle' }).click();
  });

  test('picking a block type and length updates the hero', async ({ page }) => {
    const types = page.getByRole('group', { name: 'Block type' });
    const power = types.getByRole('button', { name: /^Power/ });
    await power.click();
    await expect(power).toHaveAttribute('aria-pressed', 'true');
    await expect(types.getByRole('button', { name: /^Strength/ })).toHaveAttribute('aria-pressed', 'false');

    const lengths = page.getByRole('group', { name: 'Block length in weeks' });
    await lengths.getByRole('button', { name: '6', exact: true }).click();
    await expect(lengths.getByRole('button', { name: '6', exact: true })).toHaveAttribute('aria-pressed', 'true');

    await expect(page.getByText('New power block, 6 weeks plus a deload week. Speed · RPE 7.')).toBeAttached();
  });

  test('block types can be picked from the keyboard', async ({ page }) => {
    const hypertrophy = page.getByRole('group', { name: 'Block type' }).getByRole('button', { name: /^Hypertrophy/ });
    await hypertrophy.focus();
    await page.keyboard.press('Enter');
    await expect(hypertrophy).toHaveAttribute('aria-pressed', 'true');
  });

  test('adding a block lengthens the macrocycle', async ({ page }) => {
    await page.getByRole('group', { name: 'Plan view' }).getByRole('button', { name: 'Calendar' }).click();
    const eyebrow = page.getByText(/^Macrocycle · \d+ weeks$/);
    const before = Number((await eyebrow.textContent())!.match(/\d+/)![0]);

    await page.getByRole('group', { name: 'Plan view' }).getByRole('button', { name: 'Mesocycle' }).click();
    await page.getByRole('group', { name: 'Block length in weeks' }).getByRole('button', { name: '3', exact: true }).click();
    await page.getByRole('button', { name: 'Add block to calendar' }).click();

    // Adding lands back on the calendar, three weeks and a deload longer.
    await expect(page.getByText(`Macrocycle · ${before + 4} weeks`, { exact: true })).toBeVisible();
  });
});

test.describe('peak mode', () => {
  test('setting a meet counts down to it in the hero', async ({ page }) => {
    await page.getByRole('group', { name: 'Plan view' }).getByRole('button', { name: 'Peak mode' }).click();
    await expect(page.getByText(/work the whole build backwards/)).toBeVisible();

    // Thirty days from whatever today is, so the count is known exactly.
    const meet = await page.evaluate(() => {
      const d = new Date();
      d.setDate(d.getDate() + 30);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    });
    await page.getByLabel('Name', { exact: true }).fill('Spring Classic');
    await page.getByLabel('Date', { exact: true }).fill(meet);
    await page.getByLabel('Where', { exact: true }).fill('Leeds');
    await page.getByRole('button', { name: 'Set meet day' }).click();

    await expect(page.getByText(/^30 days until Spring Classic · .+ · Leeds\.$/)).toBeAttached();
    await expect(page.getByRole('button', { name: 'Update meet' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Reverse taper' })).toBeVisible();
  });
});
