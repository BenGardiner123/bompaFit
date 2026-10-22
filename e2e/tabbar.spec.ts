import { expect, test } from '@playwright/test';
import { C, onInk } from '../lib/tokens';
import { completeSetup, goToTab, gotoApp, type TabName } from './helpers';

// Five tabs, one bar that follows the surface above it: dark under Train,
// which is dark all the way down, and white under every other screen. The
// current tab is the strongest colour on its bar and the rest are muted.

const TABS: TabName[] = ['Today', 'Train', 'Plan', 'History', 'Workouts'];

/** A token as the browser reports a computed colour. */
function rgb(hex: string) {
  const n = Number.parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
}

test.beforeEach(async ({ page }) => {
  await gotoApp(page);
  await completeSetup(page);
});

test('names the five tabs in order, with Tools gone', async ({ page }) => {
  const nav = page.getByRole('navigation', { name: 'Main' });
  await expect(nav.getByRole('button')).toHaveText(TABS);
  await expect(nav.getByRole('button', { name: 'Tools' })).toHaveCount(0);
});

for (const tab of TABS) {
  const dark = tab === 'Train';
  test(`is ${dark ? 'ink' : 'white'} on ${tab}, with ${tab} ${dark ? 'white' : 'ink'} and the others muted`, async ({ page }) => {
    await goToTab(page, tab);
    const nav = page.getByRole('navigation', { name: 'Main' });
    await expect(nav).toHaveCSS('background-color', rgb(dark ? C.ink : C.card));
    const current = dark ? C.white : C.ink;
    const muted = dark ? onInk.muted : C.tertiary;
    for (const other of TABS) {
      await expect(nav.getByRole('button', { name: other })).toHaveCSS('color', rgb(other === tab ? current : muted));
    }
  });
}
