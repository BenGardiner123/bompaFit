import { expect, test, type Page } from '@playwright/test';
import { completeSetup, goToTab, gotoApp, trainOneSession } from './helpers';

// Plan is a way through the whole plan, not just this week: arrows step a
// week at a time, tapping the macrocycle bar or a block jumps there, a week
// behind you shows what was trained, and a week ahead shows what is planned.

const WEDNESDAY = new Date('2026-10-07T10:00:00');
const A_WEEK_LATER = new Date('2026-10-14T10:00:00');

test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: WEDNESDAY });
  await gotoApp(page);
  await completeSetup(page, {
    workouts: [['Bench Press', 'Overhead Press'], ['Back Squat', 'Romanian Deadlift']],
    names: ['Push A', 'Legs A'],
  });
});

const weekNav = (page: Page) => page.getByRole('group', { name: 'Week' });

test('the arrows step through the weeks, and Back to this week returns', async ({ page }) => {
  await goToTab(page, 'Plan');
  await expect(page.getByRole('heading', { name: /^This week · / })).toBeVisible();
  await expect(weekNav(page)).toContainText('Oct 5 – Oct 11');
  await expect(weekNav(page).getByRole('button', { name: 'Previous week' })).toBeDisabled();

  await weekNav(page).getByRole('button', { name: 'Next week' }).click();
  await expect(page.getByRole('heading', { name: /^Next week · \d+ planned$/ })).toBeVisible();
  await expect(weekNav(page)).toContainText('Oct 12 – Oct 18');
  await expect(weekNav(page)).toContainText(/week 2 of \d+/);

  await weekNav(page).getByRole('button', { name: 'Back to this week' }).click();
  await expect(page.getByRole('heading', { name: /^This week · / })).toBeVisible();
  await expect(weekNav(page).getByRole('button', { name: 'Back to this week' })).toHaveCount(0);
});

test('a week ahead lists what is planned, and a workout opens to its lifts', async ({ page }) => {
  await goToTab(page, 'Plan');
  await weekNav(page).getByRole('button', { name: 'Next week' }).click();

  const first = page.getByRole('button', { name: /^Show .+, slot 1$/ });
  await expect(first).toHaveAttribute('aria-expanded', 'false');
  await first.click();
  // Open, its name turns from Show to Hide.
  await expect(page.getByRole('button', { name: /^Hide .+, slot 1$/ })).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByRole('listitem').filter({ hasText: /^(Bench Press|Back Squat)/ }).first()).toContainText(/\d+ × \d+ @ /);
  // Nothing about a week ahead can be rearranged from here.
  await expect(page.getByRole('button', { name: /^Options for / })).toHaveCount(0);
});

test('a week behind shows what was trained, set by set', async ({ page }) => {
  await goToTab(page, 'Today');
  await trainOneSession(page);

  await page.clock.setSystemTime(A_WEEK_LATER);
  await gotoApp(page);
  await goToTab(page, 'Plan');
  await weekNav(page).getByRole('button', { name: 'Previous week' }).click();

  await expect(page.getByRole('heading', { name: /^Last week · 1 of \d+ done$/ })).toBeVisible();
  await page.getByRole('button', { name: /^Show (Push A|Legs A) on / }).click();
  await expect(page.getByRole('button', { name: /^Hide (Push A|Legs A) on / })).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByRole('heading', { level: 3 }).first()).toBeVisible();
  // The weeks that rolled over without being trained say so.
  await expect(page.getByText('SKIPPED').first()).toBeVisible();
});

test('tapping a block shows its first week', async ({ page }) => {
  await goToTab(page, 'Plan');
  const blocks = page.getByRole('list', { name: 'Blocks in your plan' }).getByRole('button');
  await expect(blocks.first()).toHaveAccessibleName(/^Show the \w+ block, Oct 5 to /);
  // The block holding this week keeps this week rather than jumping back to its start.
  await blocks.first().click();
  await expect(page.getByRole('heading', { name: /^This week · / })).toBeVisible();
});

test('tapping the macrocycle bar shows that week, outlined on the bar', async ({ page }) => {
  await goToTab(page, 'Plan');
  const bar = page.locator('[data-macrocycle-bar]');
  const box = (await bar.boundingBox())!;
  // The last few pixels of the bar are the last week of the plan.
  await page.mouse.click(box.x + box.width - 2, box.y + box.height / 2);

  await expect(page.getByRole('heading', { name: /^In \d+ weeks · \d+ planned$/ })).toBeVisible();
  await expect(page.locator('[data-viewing-week]')).toBeVisible();
  await expect(weekNav(page).getByRole('button', { name: 'Next week' })).toBeDisabled();
});
