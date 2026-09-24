import { expect, test } from '@playwright/test';
import { completeSetup, finishSession, goToTab, gotoApp, skipRest } from './helpers';

// "Reload mid-flow — does state survive?" A phone can kill the tab at any
// moment, and a half-finished session must still be there when it comes back.

test.beforeEach(async ({ page }) => {
  await gotoApp(page);
  await completeSetup(page, { workouts: [['Bench Press', 'Overhead Press']], names: ['Push A'] });
});

test.describe('reload survives', () => {
  test('an open session and its logged sets', async ({ page }) => {
    await goToTab(page, 'Today');
    await page.getByRole('button', { name: /^(Start workout|Train anyway)$/ }).click();
    await goToTab(page, 'Train');
    await page.getByRole('button', { name: 'Log set' }).click();
    await skipRest(page);
    await expect(page.getByRole('button', { name: /^Edit set 1\b/ })).toBeVisible();

    await page.reload();
    await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible({ timeout: 15_000 });
    await goToTab(page, 'Train');

    // The session is still open and the set is still on it — a reload mid-set
    // must not cost the set or strand the session.
    await expect(page.getByRole('button', { name: /^Edit set 1\b/ })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Log set' })).toBeVisible();
  });

  test('the workouts you built', async ({ page }) => {
    await page.reload();
    await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible({ timeout: 15_000 });
    await goToTab(page, 'Today');
    await page.getByRole('button', { name: 'Open workout library' }).click();
    await expect(page.getByText('Push A')).toBeVisible();
  });

  test('a deleted set stays deleted', async ({ page }) => {
    await goToTab(page, 'Today');
    await page.getByRole('button', { name: /^(Start workout|Train anyway)$/ }).click();
    await goToTab(page, 'Train');
    await page.getByRole('button', { name: 'Log set' }).click();
    await skipRest(page);
    // Deleting lives in the set's editor, reached from its dot.
    await page.getByRole('button', { name: /^Edit set 1\b/ }).click();
    const sheet = page.getByRole('dialog', { name: 'Edit logged set' });
    await sheet.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(sheet).toBeHidden();
    await expect(page.getByRole('button', { name: /^Edit set 1\b/ })).toBeHidden();

    await page.reload();
    await goToTab(page, 'Train');
    await expect(page.getByRole('button', { name: 'Log set' })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Edit set 1\b/ })).toBeHidden();
  });

  test('a finished session reaches History under its own name', async ({ page }) => {
    await goToTab(page, 'Today');
    await page.getByRole('button', { name: /^(Start workout|Train anyway)$/ }).click();
    await goToTab(page, 'Train');
    await page.getByRole('button', { name: 'Log set' }).click();
    await finishSession(page);

    await page.reload();
    await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible({ timeout: 15_000 });
    await goToTab(page, 'History');

    // The workout appears under its own name. Until this view existed, History
    // sliced by lift only, so a session's work scattered across as many chips
    // as it had exercises and the session itself was on no screen.
    await expect(page.getByText('Push A')).toBeVisible();

    // And it opens to show what was actually done.
    await page.getByRole('button', { name: /^Show Push A on / }).click();
    await expect(page.getByText('Bench Press')).toBeVisible();
  });

  test('the by-lift view is still there behind the toggle', async ({ page }) => {
    await goToTab(page, 'Today');
    await page.getByRole('button', { name: /^(Start workout|Train anyway)$/ }).click();
    await goToTab(page, 'Train');
    await page.getByRole('button', { name: 'Log set' }).click();
    await finishSession(page);
    await goToTab(page, 'History');

    await page.getByRole('button', { name: 'By lift' }).click();
    await expect(page.getByText('Recent sessions')).toBeVisible();
    await expect(page.getByText(/1 sets ·/)).toBeVisible();
  });
});
