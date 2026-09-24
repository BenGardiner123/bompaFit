import { expect, test, type Page } from '@playwright/test';
import { addLift, builder, completeSetup, goToTab, gotoApp, saveBuilder } from './helpers';

// Supersets, through the interface. The pure logic has 54 unit tests; what
// these add is that a person can actually build a group, see it, and have the
// rest timer behave when they log through it.

/** Open the builder on the workout setup just made. */
async function openBuilder(page: Page) {
  await goToTab(page, 'Today');
  await page.getByRole('button', { name: 'Open workout library' }).click();
  await page.getByRole('button', { name: /^Edit/ }).first().click();
  await expect(builder(page)).toBeVisible();
}

/** Tag the nth lift card in the builder with a superset letter. */
async function setLetter(page: Page, index: number, letter: string) {
  const rows = builder(page).locator('button', { hasText: new RegExp(`^${letter}$`) });
  await rows.nth(index).click();
}

test.beforeEach(async ({ page }) => {
  await gotoApp(page);
  await completeSetup(page, { workouts: [['Cable Fly', 'Rope Extension']] });
});

test.describe('building a superset', () => {
  test('tagging two lifts with the same letter groups them', async ({ page }) => {
    await openBuilder(page);
    await setLetter(page, 0, 'A');
    await setLetter(page, 1, 'A');

    await expect(builder(page).getByText(/SUPERSET A · NO REST BETWEEN THESE/)).toBeVisible();
    await saveBuilder(page);
  });

  test('a group offers a deliberate gap, defaulting to none', async ({ page }) => {
    await openBuilder(page);
    await setLetter(page, 0, 'A');
    await setLetter(page, 1, 'A');

    // The header states the gap in words, so "no rest" cannot silently become a
    // lie once one is set.
    await expect(builder(page).getByText(/SUPERSET A · NO REST BETWEEN THESE/)).toBeVisible();
    await builder(page).getByRole('button', { name: '15s', exact: true }).click();
    await expect(builder(page).getByText(/SUPERSET A · 15S BETWEEN THESE/)).toBeVisible();

    await saveBuilder(page);
  });

  test('the gap is written to storage, not just held on screen', async ({ page }) => {
    await openBuilder(page);
    await setLetter(page, 0, 'A');
    await setLetter(page, 1, 'A');
    await builder(page).getByRole('button', { name: '15s', exact: true }).click();
    await saveBuilder(page);

    const rests = await page.evaluate(async () => {
      const open = indexedDB.open('bompa');
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        open.onsuccess = () => resolve(open.result);
        open.onerror = () => reject(open.error);
      });
      const rows = await new Promise<{ source: string; supersetRest?: Record<string, number> }[]>((resolve) => {
        const request = db.transaction('routines').objectStore('routines').getAll();
        request.onsuccess = () => resolve(request.result);
      });
      return rows.filter((r) => r.source === 'user').map((r) => r.supersetRest);
    });

    expect(rests).toContainEqual({ A: 15 });
  });

  test('ungrouping the last member drops the stored gap', async ({ page }) => {
    await openBuilder(page);
    await setLetter(page, 0, 'A');
    await setLetter(page, 1, 'A');
    await builder(page).getByRole('button', { name: '15s', exact: true }).click();
    await saveBuilder(page);

    await page.getByRole('button', { name: /^Edit/ }).first().click();
    // Both members back to None — the group no longer exists, so neither should
    // its gap, or the next pair tagged A would inherit it.
    const noneButtons = builder(page).getByRole('button', { name: 'None', exact: true });
    await noneButtons.first().click();
    await noneButtons.first().click();
    await saveBuilder(page);

    const rests = await page.evaluate(async () => {
      const open = indexedDB.open('bompa');
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        open.onsuccess = () => resolve(open.result);
        open.onerror = () => reject(open.error);
      });
      const rows = await new Promise<{ source: string; supersetRest?: Record<string, number> }[]>((resolve) => {
        const request = db.transaction('routines').objectStore('routines').getAll();
        request.onsuccess = () => resolve(request.result);
      });
      return rows.filter((r) => r.source === 'user').map((r) => r.supersetRest);
    });

    expect(rests).toContainEqual({});
  });
});

test.describe('logging through a superset', () => {
  async function groupedSession(page: Page, gap?: '10s' | '15s' | '30s') {
    await openBuilder(page);
    await setLetter(page, 0, 'A');
    await setLetter(page, 1, 'A');
    if (gap) await builder(page).getByRole('button', { name: gap, exact: true }).click();
    await saveBuilder(page);

    await goToTab(page, 'Today');
    await page.getByRole('button', { name: /^(Start workout|Train anyway)$/ }).click();
    await goToTab(page, 'Train');
    await expect(page.getByRole('button', { name: 'Log set' })).toBeVisible();
  }

  test('the first member advances without resting', async ({ page }) => {
    await groupedSession(page);
    await expect(page.getByText(/Superset A · round 1 of/)).toBeVisible();

    await page.getByRole('button', { name: 'Log set' }).click();

    // Straight into the next lift, no timer — the whole point of the format.
    await expect(page.getByRole('timer')).toBeHidden();
    await expect(page.getByRole('heading', { name: 'Rope Extension' })).toBeVisible();
  });

  test('completing the round starts the full rest', async ({ page }) => {
    await groupedSession(page);
    await page.getByRole('button', { name: 'Log set' }).click();
    await page.getByRole('button', { name: 'Log set' }).click();

    await expect(page.getByRole('timer')).toBeVisible();
    // And back to the top of the group, so every round reads the same way.
    await expect(page.getByText(/Superset A · round 2 of/)).toBeVisible();
  });

  test('a gap runs a short timer between the lifts', async ({ page }) => {
    await groupedSession(page, '15s');
    await expect(page.getByText(/15s between lifts, full rest after the round/)).toBeVisible();

    await page.getByRole('button', { name: 'Log set' }).click();
    // A timer runs mid-round now, which without a gap it would not.
    await expect(page.getByRole('timer')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Rope Extension' })).toBeVisible();
  });

  test('the banner states the gap rather than claiming there is none', async ({ page }) => {
    await groupedSession(page);
    await expect(page.getByText(/no rest until the round is done/)).toBeVisible();
  });

  test('both members carry the group letter on their chips', async ({ page }) => {
    await groupedSession(page);
    // "Fly · A", "Rope · A": the row reads as one group, not unrelated lifts.
    await expect(page.getByRole('button', { name: / · A \d/ })).toHaveCount(2);
  });

  test('the full rest after a round runs full screen, and names the lift that is next', async ({ page }) => {
    await groupedSession(page);
    await page.getByRole('button', { name: 'Log set' }).click();
    await page.getByRole('button', { name: 'Log set' }).click();

    // Back to the top of the group for round two.
    const rest = page.getByRole('dialog', { name: 'Resting' });
    await expect(rest).toBeVisible();
    await expect(rest.getByText('Cable Fly', { exact: true })).toBeVisible();
    await expect(rest.getByText(/^Set 2 · /)).toBeVisible();
  });
});
