import { expect, test } from '@playwright/test';
import { builder, completeSetup, goToTab, gotoApp, skipRest } from './helpers';

// "Keyboard only — can you reach and operate everything?" Someone who cannot
// use a mouse or a touchscreen still has to be able to train.

test.describe('keyboard and labels', () => {
  test('setup can be walked with the keyboard alone', async ({ page }) => {
    await gotoApp(page);

    // Tab until Next has focus, then activate it. A control that cannot be
    // reached this way cannot be operated by anyone not using a mouse.
    const next = page.getByRole('button', { name: 'Next', exact: true });
    for (let i = 0; i < 12; i++) {
      const focused = await next.evaluate((el) => el === document.activeElement).catch(() => false);
      if (focused) break;
      await page.keyboard.press('Tab');
    }
    await expect(next).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByText(/^Setting up · Maxes/)).toBeVisible();
  });

  test('every icon-only button carries an accessible name', async ({ page }) => {
    await gotoApp(page);
    await completeSetup(page);

    // A button whose content is an svg and whose aria-label is missing is
    // invisible to a screen reader — and this app leans on icon buttons.
    const unnamed = await page.evaluate(() =>
      [...document.querySelectorAll('button')]
        .filter((el) => {
          const text = (el.textContent ?? '').trim();
          const label = el.getAttribute('aria-label');
          return text.length === 0 && !label;
        })
        .map((el) => el.outerHTML.slice(0, 120)),
    );
    expect(unnamed).toEqual([]);
  });

  test('the tab bar is a landmark with a current page', async ({ page }) => {
    await gotoApp(page);
    await completeSetup(page);

    const nav = page.getByRole('navigation', { name: 'Main' });
    await expect(nav).toBeVisible();
    await expect(nav.getByRole('button', { name: 'Today' })).toHaveAttribute('aria-current', 'page');

    await goToTab(page, 'Plan');
    await expect(nav.getByRole('button', { name: 'Today' })).not.toHaveAttribute('aria-current', 'page');
  });

  test('dialogs are modal and close on Escape', async ({ page }) => {
    await gotoApp(page);
    await completeSetup(page);
    await goToTab(page, 'Today');
    await page.getByRole('button', { name: 'Open workout library' }).click();
    await page.getByRole('button', { name: /^Edit/ }).first().click();

    const sheet = builder(page);
    await expect(sheet).toHaveAttribute('aria-modal', 'true');
    // Exactly one — two stacked modals is what the setup step used to do.
    await expect(page.getByRole('dialog', { name: /^Edit / })).toHaveCount(1);

    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();
  });

  test('the rest timer announces itself as a timer', async ({ page }) => {
    await gotoApp(page);
    await completeSetup(page);
    await goToTab(page, 'Today');
    await page.getByRole('button', { name: /^(Start workout|Train anyway)$/ }).click();
    await goToTab(page, 'Train');
    await page.getByRole('button', { name: 'Log set' }).click();

    await expect(page.getByRole('timer')).toBeVisible();
  });
});

// Every bottom sheet behaves the same way, whichever one it is: it is a named
// modal dialog, it closes by Escape, by its own close control and by a tap on
// the dimmed area around it, and focus goes back to whatever opened it — a
// keyboard user who dismisses a sheet should land where they were, not at the
// top of the page.
type SheetCase = {
  sheet: string;
  /** The button on the Train screen that opens it. */
  opener: string | RegExp;
  /** The dialog's accessible name. */
  dialog: string | RegExp;
  /** The close control inside it. */
  close: string;
};

const SHEETS: SheetCase[] = [
  { sheet: 'How-to', opener: /How to ›$/, dialog: /^How to perform /, close: 'Close' },
  // A prefix, because the row's full name goes on to describe the set.
  { sheet: 'Edit set', opener: /^Edit set 1\b/, dialog: 'Edit logged set', close: 'Cancel' },
  { sheet: 'RPE', opener: /^What.s RPE\?$/, dialog: 'What RPE means', close: 'Close' },
  { sheet: 'Set types', opener: 'What do the set types mean?', dialog: 'What the set types mean', close: 'Close' },
  { sheet: 'Add a lift', opener: 'Add a lift to this session', dialog: 'Add a lift', close: 'Close' },
];

test.describe('bottom sheets', () => {
  test.beforeEach(async ({ page }) => {
    await gotoApp(page);
    await completeSetup(page);
    await goToTab(page, 'Today');
    await page.getByRole('button', { name: /^(Start workout|Train anyway)$/ }).click();
    await goToTab(page, 'Train');
    // One logged set, so there is a row for the Edit set sheet to open on.
    await page.getByRole('button', { name: 'Log set' }).click();
    // Logging opens the full-screen rest, which covers every opener below.
    await skipRest(page);
    await expect(page.getByRole('button', { name: 'Edit set 1' })).toBeVisible();
  });

  for (const c of SHEETS) {
    const opener = (page: import('@playwright/test').Page) => page.getByRole('button', { name: c.opener, exact: true });
    const dialog = (page: import('@playwright/test').Page) => page.getByRole('dialog', { name: c.dialog });

    test(`${c.sheet}: a named modal dialog that closes three ways and hands focus back`, async ({ page }) => {
      // Escape.
      await opener(page).click();
      await expect(dialog(page)).toBeVisible();
      await expect(dialog(page)).toHaveAttribute('aria-modal', 'true');
      await page.keyboard.press('Escape');
      await expect(dialog(page)).toBeHidden();
      await expect(opener(page)).toBeFocused();

      // Its own close control.
      await opener(page).click();
      await dialog(page).getByRole('button', { name: c.close, exact: true }).click();
      await expect(dialog(page)).toBeHidden();
      await expect(opener(page)).toBeFocused();

      // A tap on the dimmed area. The dialog element is the full-screen scrim
      // with the panel at the bottom, so its top-left corner is scrim.
      await opener(page).click();
      await dialog(page).click({ position: { x: 5, y: 5 } });
      await expect(dialog(page)).toBeHidden();
      await expect(opener(page)).toBeFocused();
    });

    test(`${c.sheet}: every control inside is at least 44px square`, async ({ page }) => {
      await opener(page).click();
      await expect(dialog(page)).toBeVisible();

      const small = await dialog(page).evaluate((root) =>
        [...root.querySelectorAll('button, input, select, textarea, a[href]')]
          // A link inside a sentence is exempt from the target-size rule — it
          // is sized by the line of text it sits in, like any inline link.
          .filter((el) => !(el.tagName === 'A' && getComputedStyle(el).display === 'inline'))
          .map((el) => {
            const box = el.getBoundingClientRect();
            return { control: (el.getAttribute('aria-label') ?? el.textContent ?? el.tagName).trim().slice(0, 40), w: box.width, h: box.height };
          })
          // Rounded because a 44px box can measure 43.99 after sub-pixel layout.
          .filter((box) => Math.round(box.w) < 44 || Math.round(box.h) < 44),
      );
      expect(small).toEqual([]);
    });
  }

  test('Add a lift puts focus straight into the search box', async ({ page }) => {
    // Typing is the only reason to open it, so the keyboard should already be there.
    await page.getByRole('button', { name: 'Add a lift to this session' }).click();
    const picker = page.getByRole('dialog', { name: 'Add a lift' });
    await expect(picker.getByPlaceholder('Search by name, muscle or equipment')).toBeFocused();
    // A real label, not just a placeholder that disappears on the first keystroke.
    await expect(picker.getByRole('textbox', { name: 'Search movements' })).toBeVisible();
  });
});
