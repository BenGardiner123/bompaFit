import { expect, test, type Locator, type Page } from '@playwright/test';
import { builder, completeSetup, goToTab, gotoApp, settingsSheet, skipRest } from './helpers';

/**
 * Press Tab until `target` has focus. A control that cannot be reached this way
 * cannot be operated by anyone not using a mouse.
 */
async function tabTo(page: Page, target: Locator, max = 80) {
  for (let i = 0; i < max; i++) {
    const focused = await target.evaluate((el) => el === document.activeElement).catch(() => false);
    if (focused) return;
    await page.keyboard.press('Tab');
  }
  await expect(target).toBeFocused();
}

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
    await expect(page.getByText(/^Step 2 of 5 · Maxes/)).toBeVisible();
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
    await goToTab(page, 'Workouts');
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
    await page.getByRole('button', { name: /^(Start .+|Train anyway)$/ }).click();
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
  /** The button that opens it — on the Train screen, or inside the sheet `via` opens. */
  opener: string | RegExp;
  /** A button on Train to press first, when the opener lives inside another sheet. */
  via?: RegExp;
  /** The dialog's accessible name. */
  dialog: string | RegExp;
  /** The close control inside it. */
  close: string;
  /**
   * For a sheet with no button on Train to open it: how to open it, and what
   * focus goes back to. `opener` and `via` are then unused.
   */
  custom?: { open: (page: Page) => Promise<void>; origin: (page: Page) => Locator };
};

/** The rest screen's ring, which opens the default-rest sheet when held. */
const restRing = (page: Page) => page.getByRole('dialog', { name: 'Resting' }).getByRole('timer');

const SHEETS: SheetCase[] = [
  { sheet: 'How-to', opener: /How to$/, dialog: /^How to perform /, close: 'Close' },
  // A prefix, because the row's full name goes on to describe the set.
  { sheet: 'Edit set', opener: /^Edit set 1\b/, dialog: 'Edit logged set', close: 'Cancel' },
  { sheet: 'Set types', opener: 'What do the set types mean?', dialog: 'What the set types mean', close: 'Close' },
  { sheet: 'Session menu', opener: 'Session menu', dialog: 'Session menu', close: 'Close' },
  // Opened from inside the session menu, which closes on the way, so focus goes
  // back to the button that opened that one.
  { sheet: 'Add a lift', via: /^Session menu$/, opener: 'Add a lift', dialog: 'Add a lift', close: 'Close' },
  { sheet: 'Finish guard', via: /^Session menu$/, opener: 'Finish session', dialog: /not trained yet$/, close: 'Close' },
  // The catch-up line's sheet: leaving Bench with its set unrated puts the line up.
  {
    sheet: 'Rate (catch-up)',
    opener: 'Rate Bench',
    dialog: 'Rate Bench Press',
    close: 'Close',
    custom: {
      open: async (page) => {
        const rate = page.getByRole('button', { name: 'Rate Bench', exact: true });
        if (!(await rate.isVisible())) await page.getByRole('button', { name: /^OHP, / }).click();
        await rate.click();
      },
      origin: (page) => page.getByRole('button', { name: 'Rate Bench', exact: true }),
    },
  },
  // Held open from the rest screen's ring; the keyboard way is the context-menu key.
  {
    sheet: 'Default rest',
    opener: 'Default rest',
    dialog: 'Default rest',
    close: 'Close',
    custom: {
      open: async (page) => {
        if (!(await restRing(page).isVisible())) await page.getByRole('button', { name: 'Log set' }).click();
        await restRing(page).focus();
        await page.keyboard.press('Shift+F10');
      },
      origin: restRing,
    },
  },
];

test.describe('bottom sheets', () => {
  test.beforeEach(async ({ page }) => {
    await gotoApp(page);
    await completeSetup(page);
    await goToTab(page, 'Today');
    await page.getByRole('button', { name: /^(Start .+|Train anyway)$/ }).click();
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
    const open = async (page: import('@playwright/test').Page) => {
      if (c.custom) return c.custom.open(page);
      if (c.via) await page.getByRole('button', { name: c.via }).click();
      await opener(page).click();
    };
    // Where focus should land once the sheet is gone.
    const origin = (page: import('@playwright/test').Page) =>
      c.custom ? c.custom.origin(page) : c.via ? page.getByRole('button', { name: c.via }) : opener(page);

    test(`${c.sheet}: a named modal dialog that closes three ways and hands focus back`, async ({ page }) => {
      // Escape.
      await open(page);
      await expect(dialog(page)).toBeVisible();
      await expect(dialog(page)).toHaveAttribute('aria-modal', 'true');
      await page.keyboard.press('Escape');
      await expect(dialog(page)).toBeHidden();
      await expect(origin(page)).toBeFocused();

      // Its own close control.
      await open(page);
      await dialog(page).getByRole('button', { name: c.close, exact: true }).click();
      await expect(dialog(page)).toBeHidden();
      await expect(origin(page)).toBeFocused();

      // A tap on the dimmed area. The dialog element is the full-screen scrim
      // with the panel at the bottom, so its top-left corner is scrim.
      await open(page);
      await dialog(page).click({ position: { x: 5, y: 5 } });
      await expect(dialog(page)).toBeHidden();
      await expect(origin(page)).toBeFocused();
    });

    test(`${c.sheet}: every control inside is at least 44px square`, async ({ page }) => {
      await open(page);
      await expect(dialog(page)).toBeVisible();

      const small = await dialog(page).evaluate((root) =>
        [...root.querySelectorAll('button, input, select, textarea, a[href]')]
          // A link inside a sentence is exempt from the target-size rule — it
          // is sized by the line of text it sits in, like any inline link.
          .filter((el) => !(el.tagName === 'A' && getComputedStyle(el).display === 'inline'))
          // A file input is never touched: a visible button opens it.
          .filter((el) => !(el instanceof HTMLInputElement && el.type === 'file'))
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

  test('the rest ring takes focus, and the context-menu key opens Default rest on the current length', async ({ page }) => {
    await page.getByRole('button', { name: 'Log set' }).click();
    await tabTo(page, restRing(page));
    await page.keyboard.press('Shift+F10');
    const presets = page.getByRole('dialog', { name: 'Default rest' });
    await expect(presets).toBeVisible();
    await expect(presets.getByRole('button', { name: '2:30 rest' })).toHaveAttribute('aria-pressed', 'true');
    await expect(presets.getByRole('button', { name: '1:30 rest' })).toHaveAttribute('aria-pressed', 'false');
  });

  test('Add a lift puts focus straight into the search box', async ({ page }) => {
    // Typing is the only reason to open it, so the keyboard should already be there.
    await page.getByRole('button', { name: 'Session menu', exact: true }).click();
    await page.getByRole('dialog', { name: 'Session menu' }).getByRole('button', { name: 'Add a lift' }).click();
    const picker = page.getByRole('dialog', { name: 'Add a lift' });
    await expect(picker.getByPlaceholder('Search by name, muscle or equipment')).toBeFocused();
    // A real label, not just a placeholder that disappears on the first keystroke.
    await expect(picker.getByRole('textbox', { name: 'Search movements' })).toBeVisible();
  });
});

test.describe('the Settings sheet and the Workouts tab', () => {
  test.beforeEach(async ({ page }) => {
    await gotoApp(page);
    await completeSetup(page);
  });

  test('the gear is reached by keyboard, opens a named modal, and hands focus back three ways', async ({ page }) => {
    const gear = page.getByRole('button', { name: 'Settings', exact: true });
    await tabTo(page, gear);
    await page.keyboard.press('Enter');
    await expect(settingsSheet(page)).toBeVisible();
    await expect(settingsSheet(page)).toHaveAttribute('aria-modal', 'true');

    // Keyboard reach inside: the backup buttons and the destructive row.
    await tabTo(page, settingsSheet(page).getByRole('button', { name: 'Export backup' }));
    await tabTo(page, settingsSheet(page).getByRole('button', { name: 'Erase everything…' }));

    await page.keyboard.press('Escape');
    await expect(settingsSheet(page)).toBeHidden();
    await expect(gear).toBeFocused();

    await gear.click();
    await settingsSheet(page).getByRole('button', { name: 'Close', exact: true }).click();
    await expect(settingsSheet(page)).toBeHidden();
    await expect(gear).toBeFocused();

    await gear.click();
    await settingsSheet(page).click({ position: { x: 5, y: 5 } });
    await expect(settingsSheet(page)).toBeHidden();
    await expect(gear).toBeFocused();
  });

  test('every control in Settings is at least 44px square', async ({ page }) => {
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    const small = await settingsSheet(page).evaluate((root) =>
      [...root.querySelectorAll('button, input, select, textarea, a[href]')]
        .filter((el) => !(el.tagName === 'A' && getComputedStyle(el).display === 'inline'))
        .filter((el) => !(el instanceof HTMLInputElement && el.type === 'file'))
        .map((el) => {
          const box = el.getBoundingClientRect();
          return { control: (el.getAttribute('aria-label') ?? el.textContent ?? el.tagName).trim().slice(0, 40), w: box.width, h: box.height };
        })
        .filter((box) => Math.round(box.w) < 44 || Math.round(box.h) < 44),
    );
    expect(small).toEqual([]);
  });

  test('the Workouts tab, its rows and its tools are reached by keyboard', async ({ page }) => {
    const tab = page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Workouts' });
    await tabTo(page, tab);
    await page.keyboard.press('Enter');
    await expect(tab).toHaveAttribute('aria-current', 'page');

    await tabTo(page, page.getByRole('button', { name: 'New workout' }));
    await tabTo(page, page.getByRole('button', { name: /^Start / }).first());
    const timer = page.getByRole('button', { name: /^Interval timer/ });
    await tabTo(page, timer);
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: 'Interval timer', level: 1 })).toBeVisible();

    const back = page.getByRole('button', { name: 'Back to Workouts' });
    await tabTo(page, back);
    await page.keyboard.press('Enter');
    await tabTo(page, page.getByRole('button', { name: /^1RM calculator/ }));
    await page.keyboard.press('Enter');
    await tabTo(page, page.getByRole('button', { name: 'Increase Weight' }));
  });
});
