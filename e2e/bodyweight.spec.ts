import { expect, test, type Page } from '@playwright/test';
import { completeSetup, finishSession, goToTab, gotoApp, openSettings, settingsSheet, skipRest } from './helpers';

// A set of pull-ups is stored as zero kilograms. Once the lifter enters their
// bodyweight, the fatigue model counts the share of it each movement moves,
// so a session of pull-ups shows up in readiness instead of weighing nothing.
// And a lift the lifter marks as bodyweight stays marked, so added weight on
// it keeps reading "BW + 10 kg" after the screen, or the app, is left.

async function startTraining(page: Page) {
  await goToTab(page, 'Today');
  await page.getByRole('button', { name: /^(Start .+|Train anyway)$/ }).click();
  await goToTab(page, 'Train');
}

/** The Train weight figure, whatever it currently reads. */
function weightFigure(page: Page) {
  return page.getByRole('button', { name: /^(Weight [\d.]+ (kg|lb)|Bodyweight.*), tap to type$/ });
}

async function typeInto(page: Page, figure: ReturnType<Page['getByRole']>, text: string) {
  await figure.click();
  // The value arrives selected, so typing replaces it rather than appending.
  await page.keyboard.type(text);
  await page.keyboard.press('Enter');
}

/** Type a bodyweight in Settings, and leave the sheet open on it. */
async function setBodyweight(page: Page, kg: string) {
  await openSettings(page);
  await typeInto(page, page.getByRole('button', { name: /^Your bodyweight .*, tap to type$/ }), kg);
  await expect(page.getByRole('button', { name: `Your bodyweight ${kg} kg, tap to type` })).toBeVisible();
}

async function closeSettings(page: Page) {
  await page.keyboard.press('Escape');
  await expect(settingsSheet(page)).toBeHidden();
}

/** Three sets of the first lift at bodyweight, then finish. */
async function trainThreeAtBodyweight(page: Page) {
  await startTraining(page);
  // A library bodyweight lift may still carry a target weight; one tap is plain bodyweight.
  if ((await weightFigure(page).innerText()) !== 'Bodyweight') {
    await page.getByRole('button', { name: 'Bodyweight', exact: true }).click();
  }
  await expect(weightFigure(page)).toHaveText('Bodyweight');
  for (let i = 0; i < 3; i++) {
    await page.getByRole('button', { name: /^Log set/ }).click();
    await skipRest(page);
  }
  await finishSession(page);
}

const readiness = (page: Page) => page.getByText(/^Readiness \d+ out of 100/);

test.describe('pull-ups', () => {
  test.beforeEach(async ({ page }) => {
    await gotoApp(page);
    await completeSetup(page, { workouts: [['Pullups']], names: ['Pull-ups'] });
  });

  test('weigh nothing with no bodyweight entered', async ({ page }) => {
    await trainThreeAtBodyweight(page);
    await goToTab(page, 'Today');
    // The same session as below, and the model has nothing to read.
    await expect(page.getByText('Nothing to read yet')).toBeVisible();
    await expect(readiness(page)).toHaveCount(0);
  });

  test('move readiness once a bodyweight is entered, and the number is kept', async ({ page }) => {
    await trainThreeAtBodyweight(page);
    await setBodyweight(page, '80');
    await closeSettings(page);

    await expect(readiness(page)).toHaveCount(1);
    await expect(page.getByText('Nothing to read yet')).toHaveCount(0);

    await page.reload();
    await openSettings(page);
    await expect(page.getByRole('button', { name: 'Your bodyweight 80 kg, tap to type' })).toBeVisible();
    await closeSettings(page);
    await expect(readiness(page)).toHaveCount(1);
  });

  test('History reads the best set as bodyweight, never "0×10"', async ({ page }) => {
    await trainThreeAtBodyweight(page);
    await goToTab(page, 'History');
    await page.getByRole('button', { name: 'By lift' }).click();
    await expect(page.getByText(/^BW × \d+$/)).toBeVisible();
    await expect(page.getByText(/^0×\d+$/)).toHaveCount(0);
  });

  test('clearing the bodyweight puts the model back as it was', async ({ page }) => {
    await trainThreeAtBodyweight(page);
    await setBodyweight(page, '80');
    await typeInto(page, page.getByRole('button', { name: 'Your bodyweight 80 kg, tap to type' }), '0');
    await expect(page.getByRole('button', { name: 'Your bodyweight not set, tap to type' })).toBeVisible();
    await closeSettings(page);
    await expect(page.getByText('Nothing to read yet')).toBeVisible();
  });
});

test.describe('a lift marked as bodyweight', () => {
  test.beforeEach(async ({ page }) => {
    await gotoApp(page);
    // Filed under "Other" in the library, so only the lifter's mark makes it bodyweight.
    await completeSetup(page, { workouts: [['Back Extensions']], names: ['Back'] });
  });

  test('still reads "BW + 10 kg" after a reload, until the mark is taken off', async ({ page }) => {
    await startTraining(page);
    // Not a bodyweight lift yet, so the chip waits until the weight is at zero.
    await typeInto(page, weightFigure(page), '0');
    await page.getByRole('button', { name: 'Bodyweight', exact: true }).click();
    await expect(weightFigure(page)).toHaveText('Bodyweight');
    await typeInto(page, weightFigure(page), '10');
    await expect(page.getByRole('button', { name: 'Bodyweight plus 10 kilograms, tap to type' })).toBeVisible();
    await page.getByRole('button', { name: /^Log set/ }).click();
    await skipRest(page);

    // The session reopens after a reload; the mark has to come back with it.
    await page.reload();
    await goToTab(page, 'Train');
    // The logged set, and the figure, both still say bodyweight plus a plate.
    await expect(page.getByRole('button', { name: /^Edit set 1: \+10 kg × / })).toBeVisible();
    await typeInto(page, weightFigure(page), '10');
    await expect(page.getByRole('button', { name: 'Bodyweight plus 10 kilograms, tap to type' })).toBeVisible();
    await expect(page.getByText('BW +', { exact: true })).toBeVisible();

    // With plates on, the chip takes the mark back off and leaves the weight.
    await page.getByRole('button', { name: 'Bodyweight', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Weight 10 kg, tap to type' })).toBeVisible();
    await page.reload();
    await goToTab(page, 'Train');
    await typeInto(page, weightFigure(page), '10');
    await expect(page.getByRole('button', { name: 'Weight 10 kg, tap to type' })).toBeVisible();
  });
});
