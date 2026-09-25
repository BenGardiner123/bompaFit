import { expect, test, type Page } from '@playwright/test';
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
    await expect(page.getByText('Order is a suggestion', { exact: true })).toBeVisible();
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
    await page.getByRole('button', { name: 'Later', exact: true }).click();
    await page.getByRole('button', { name: 'Close options' }).click();

    const after = await order();

    // Moving is a reorder, not an addition — the count is the thing that must
    // not change, because that is what separates moving from adding.
    expect(after).toHaveLength(before.length);
    expect(after[0]).toBe(before[1]);
    expect(after[1]).toBe(before[0]);
  });

  test('a move says what happened and can be undone from the toast', async ({ page }) => {
    const order = () =>
      page
        .getByRole('button', { name: /^Options for / })
        .evaluateAll((els) => els.map((el) => el.getAttribute('aria-label')));
    const before = await order();

    await page.getByRole('button', { name: /^Options for / }).first().click();
    await page.getByRole('button', { name: 'Later', exact: true }).click();

    await page.getByRole('button', { name: 'Close options' }).click();

    const toast = page.getByTestId('toast');
    await expect(toast).toContainText('moved to position 2 this week');
    await toast.getByRole('button', { name: 'Undo' }).click();

    await expect.poll(order).toEqual(before);
  });

  test('a toast can be closed before it times out', async ({ page }) => {
    await page.getByRole('button', { name: /^Options for / }).first().click();
    await page.getByRole('button', { name: 'Later', exact: true }).click();

    const toast = page.getByTestId('toast');
    await expect(toast).toBeVisible();
    await toast.getByRole('button', { name: 'Dismiss' }).click();
    await expect(toast).toBeHidden();
  });

  test('a toast sits just above the tab bar, clear of it', async ({ page }) => {
    await page.getByRole('button', { name: /^Options for / }).first().click();
    await page.getByRole('button', { name: 'Later', exact: true }).click();

    // Polled, because the toast slides up into place as it arrives.
    const gap = async () => {
      const toast = (await page.getByTestId('toast').boundingBox())!;
      const nav = (await page.getByRole('navigation', { name: 'Main' }).boundingBox())!;
      return Math.round(nav.y - (toast.y + toast.height));
    };
    await expect.poll(gap).toBe(12);
  });


  test('rearranging the week says so, and Bompa does not take the credit', async ({ page }) => {
    // Nothing has been touched yet, so the week is still the generator's.
    await expect(page.getByText(/You rearranged this week/)).toHaveCount(0);

    await page.getByRole('button', { name: /^Options for / }).first().click();
    await page.getByRole('button', { name: 'Later', exact: true }).click();
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

  test('a drop can be undone from the toast, and the slot comes back where it was', async ({ page }) => {
    const order = () =>
      page
        .getByRole('button', { name: /^Options for / })
        .evaluateAll((els) => els.map((el) => el.getAttribute('aria-label')));
    const before = await order();
    const ids = async () => ((await readPlanned(page)) as { id: number }[]).map((r) => r.id).sort((a, b) => a - b);
    const storedBefore = await ids();

    await page.getByRole('button', { name: /^Options for / }).nth(1).click();
    await page.getByRole('button', { name: 'Drop', exact: true }).click();
    await expect(page.getByRole('button', { name: /^Options for / })).toHaveCount(before.length - 1);

    const toast = page.getByTestId('toast');
    await expect(toast).toContainText('Dropped');
    await toast.getByRole('button', { name: 'Undo' }).click();

    // Same order, and the same stored row: the id comes back with it, so
    // nothing that pointed at the slot is left pointing at nothing.
    await expect.poll(order).toEqual(before);
    await expect.poll(ids).toEqual(storedBefore);
    // Dropping and undoing is not a rearrangement.
    await expect(page.getByText(/You rearranged this week/)).toHaveCount(0);

    // And it is back for good, not only on screen.
    await page.reload();
    await goToTab(page, 'Plan');
    await expect.poll(order).toEqual(before);
  });

  test('a drop writes nothing to what I changed, because it was your decision', async ({ page }) => {
    await page.getByRole('button', { name: /^Options for / }).first().click();
    await page.getByRole('button', { name: 'Drop', exact: true }).click();
    await expect(page.getByText('Nothing live. The plan is exactly as you built it.')).toBeVisible();
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
    await page.getByRole('button', { name: /^(Start .+|Train anyway)$/ }).click();
    await goToTab(page, 'Train');
    await page.getByRole('button', { name: 'Log set' }).click();
    await finishSession(page);

    await goToTab(page, 'Plan');
    // One slot is now done. Nothing anywhere should call this a missed session.
    await expect(page.getByText(/missed|skipped/i)).toHaveCount(0);
  });
});

test.describe('one view', () => {
  test('there are no view tabs: the week, the changes, the meet and the blocks are all on one page', async ({ page }) => {
    await expect(page.getByRole('group', { name: 'Plan view' })).toHaveCount(0);
    for (const heading of [/^This week · \d+ of \d+ done$/, /^What I changed$/, /^Meet$/, /^Blocks in your plan$/]) {
      await expect(page.getByRole('heading', { name: heading })).toBeVisible();
    }
    await expect(page.getByRole('button', { name: 'Add a block', exact: true })).toBeVisible();
  });

  test('the hero leads with where you are in the macrocycle', async ({ page }) => {
    await expect(page.getByText(/^Plan · \d+-week macrocycle$/)).toBeVisible();
    // The big number is hidden from screen readers; its label says what it means.
    await expect(page.getByText(/^Week \d+ of \d+\./)).toBeAttached();
    await expect(page.getByRole('img', { name: /\d+ weeks?/ })).toBeVisible();
  });

  test('the fitness and fatigue curve is no longer on this screen', async ({ page }) => {
    await expect(page.getByText('Fitness and fatigue')).toHaveCount(0);
    await expect(page.getByText(/Fitness is currently/)).toHaveCount(0);
  });

  test('what I changed is always shown, even when nothing is live', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'What I changed' })).toBeVisible();
  });

  test('the next slot is tagged in ink, not amber, because amber means something to tap', async ({ page }) => {
    const next = page.getByText('NEXT', { exact: true });
    await expect(next).toHaveCount(1);
    await expect(next).toHaveCSS('background-color', 'rgb(20, 20, 16)');
  });
});

test.describe('the block builder', () => {
  test.beforeEach(async ({ page }) => {
    await page.getByRole('button', { name: 'Add a block', exact: true }).click();
  });

  test('opens as a sheet over the plan, and closes without adding anything', async ({ page }) => {
    const sheet = page.getByRole('dialog', { name: 'Add a block' });
    await expect(sheet).toBeVisible();
    await sheet.getByRole('button', { name: 'Close' }).click();
    await expect(sheet).toHaveCount(0);
    await expect(page.getByRole('list', { name: 'Blocks in your plan' }).getByRole('listitem')).toHaveCount(1);
  });

  test('picking a block type and length says what will be added', async ({ page }) => {
    const types = page.getByRole('group', { name: 'Block type' });
    const power = types.getByRole('button', { name: /^Power/ });
    await power.click();
    await expect(power).toHaveAttribute('aria-pressed', 'true');
    await expect(types.getByRole('button', { name: /^Strength/ })).toHaveAttribute('aria-pressed', 'false');

    const lengths = page.getByRole('group', { name: 'Block length in weeks' });
    await lengths.getByRole('button', { name: '6', exact: true }).click();
    await expect(lengths.getByRole('button', { name: '6', exact: true })).toHaveAttribute('aria-pressed', 'true');

    await expect(page.getByText('New power block, 6 weeks plus a deload week. Speed · RPE 7.')).toBeVisible();
  });

  test('block types can be picked from the keyboard', async ({ page }) => {
    const hypertrophy = page.getByRole('group', { name: 'Block type' }).getByRole('button', { name: /^Hypertrophy/ });
    await hypertrophy.focus();
    await page.keyboard.press('Enter');
    await expect(hypertrophy).toHaveAttribute('aria-pressed', 'true');
  });

  test('adding a block closes the sheet and lengthens the macrocycle', async ({ page }) => {
    const eyebrow = page.getByText(/^Plan · \d+-week macrocycle$/);
    const before = Number((await eyebrow.textContent())!.match(/\d+/)![0]);

    await page.getByRole('group', { name: 'Block length in weeks' }).getByRole('button', { name: '3', exact: true }).click();
    await page.getByRole('button', { name: 'Add block to calendar' }).click();

    await expect(page.getByRole('dialog', { name: 'Add a block' })).toHaveCount(0);
    // Three weeks and a deload longer.
    await expect(page.getByText(`Plan · ${before + 4}-week macrocycle`, { exact: true })).toBeVisible();
  });
});

test.describe('the meet', () => {
  test('with no meet set, the row says so and offers to set one', async ({ page }) => {
    await expect(page.getByText('No meet set')).toBeVisible();
    await expect(page.getByText(/work the whole build backwards/)).toBeVisible();
  });

  test('setting a meet in its sheet counts down to it on the plan and on Today', async ({ page }) => {
    await page.getByRole('button', { name: 'Set a meet' }).click();
    const sheet = page.getByRole('dialog', { name: 'Set a meet' });
    await expect(sheet).toBeVisible();

    // Thirty days from whatever today is, so the count is known exactly.
    const meet = await page.evaluate(() => {
      const d = new Date();
      d.setDate(d.getDate() + 30);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    });
    await sheet.getByLabel('Name', { exact: true }).fill('Spring Classic');
    await sheet.getByLabel('Date', { exact: true }).fill(meet);
    await sheet.getByLabel('Where', { exact: true }).fill('Leeds');
    await sheet.getByRole('button', { name: 'Set meet day' }).click();

    // The sheet stays open so the taper it has just worked out can be read.
    const saved = page.getByRole('dialog', { name: 'Edit meet' });
    await expect(saved.getByRole('button', { name: 'Update meet' })).toBeVisible();
    await expect(saved.getByRole('heading', { name: 'Reverse taper' })).toBeVisible();

    await saved.getByRole('button', { name: 'Close' }).click();
    await expect(page.getByText('Spring Classic · 30 days', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Edit meet' })).toBeVisible();

    await goToTab(page, 'Today');
    await expect(page.getByRole('term').filter({ hasText: /^to meet$/ }).locator('xpath=following-sibling::dd')).toHaveText('30days');
  });
});

/** The stored slots, read straight from the database, so a check sees what survives a reload. */
async function readPlanned(page: Page): Promise<unknown[]> {
  return page.evaluate(async () => {
    const open = indexedDB.open('bompa');
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
    return new Promise<unknown[]>((resolve, reject) => {
      const request = database.transaction('plannedSessions').objectStore('plannedSessions').getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  });
}

