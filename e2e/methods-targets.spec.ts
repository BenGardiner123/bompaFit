import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { completeSetup, gotoApp, goToTab, openWorkoutRow, restScreen, skipRest, startFromWorkouts } from './helpers';

// Per-set targets on Train: a wave or a pyramid asks for something different
// every set, so the target line, the steppers and the rest have to follow the
// set, not the lift. The routines come from a fixture backup, imported through
// the library exactly as a person would bring one in.

const FIXTURE = path.join(__dirname, 'fixtures', 'methods.json');

test.beforeEach(async ({ page }) => {
  await gotoApp(page);
  await completeSetup(page);
  await goToTab(page, 'Workouts');
  await page.getByLabel('Bompa export file').setInputFiles(FIXTURE);
  await page.getByRole('button', { name: 'Import it' }).click();
  await expect(page.getByText(/^Imported \d+ records/)).toBeVisible();
  // An import is read back on the next load, as the app itself says.
  await gotoApp(page);
  await goToTab(page, 'Workouts');
  await openWorkoutRow(page, 'Methods · schemes');
  await expect(page.getByRole('button', { name: 'Edit Methods · schemes' })).toBeVisible();
});

/** Start one of the fixture's workouts from the Workouts tab; starting lands on Train. */
async function startWorkout(page: Page, name: string) {
  await startFromWorkouts(page, name);
  await expect(page.getByRole('button', { name: 'Session menu', exact: true })).toBeVisible();
}

/** The lift chip at this position in the row, the keyboard way to change lift. */
async function pickLift(page: Page, index: number) {
  await page.locator('[data-chip]').nth(index).getByRole('button').click();
}

function logButton(page: Page) {
  return page.getByRole('button', { name: /^Log (AMRAP set|set|drop|piece)/ });
}

/** Log whatever the entry card holds, then clear the rest so the card is usable again. */
async function logAndSkip(page: Page) {
  await logButton(page).click();
  await expect(restScreen(page)).toBeVisible();
  await skipRest(page);
}

function targetLine(page: Page) {
  return page.getByText(/^(Set \d+ of \d+|Extra set) · /);
}

function currentStep(page: Page) {
  return page.getByRole('list', { name: 'Every set of this lift' }).locator('[aria-current="step"]');
}

test('a 7/5/3 wave loads each set’s reps and weight in turn, and the strip follows', async ({ page }) => {
  await startWorkout(page, 'Methods · schemes');

  await expect(targetLine(page)).toHaveText('Set 1 of 6 · 7 reps @ 85 kg · aim RPE 8');
  await expect(currentStep(page)).toContainText('7');
  await expect(logButton(page)).toContainText('85 × 7');

  await logAndSkip(page);
  await expect(targetLine(page)).toHaveText('Set 2 of 6 · 5 reps @ 90 kg · aim RPE 8');
  await expect(currentStep(page)).toContainText('Set 2');
  await expect(logButton(page)).toContainText('90 × 5');

  await logAndSkip(page);
  await expect(targetLine(page)).toHaveText('Set 3 of 6 · 3 reps @ 95 kg · aim RPE 8');
  await expect(logButton(page)).toContainText('95 × 3');

  // The second wave starts a little heavier than the first.
  await logAndSkip(page);
  await expect(targetLine(page)).toHaveText('Set 4 of 6 · 7 reps @ 87.5 kg · aim RPE 8');
  await expect(currentStep(page)).toContainText('Set 4');
  await expect(page.getByRole('group', { name: '3 of 6 sets logged' })).toBeVisible();
});

test('the tempo shows spaced on the target line and opens its guide', async ({ page }) => {
  await startWorkout(page, 'Methods · schemes');

  const tempo = page.getByRole('button', { name: /^tempo 2 1 1 0/ });
  await expect(tempo).toBeVisible();
  await expect(tempo).toHaveAccessibleName(/lower for 2 seconds.*Opens the tempo guide/);
  await tempo.click();
  // The slot's note sits under it.
  await expect(page.getByText('Two down, one hold, one up.')).toBeVisible();
});

test('a scheme with descending rests runs 90, 60, 45 and 30 seconds after sets one to four', async ({ page }) => {
  await startWorkout(page, 'Methods · schemes');
  await pickLift(page, 1);
  await expect(targetLine(page)).toHaveText(/^Set 1 of 5 · 5 reps @ /);

  for (const clock of [/1:(30|29|28)/, /(1:00|0:59|0:58)/, /0:4[345]/, /0:(30|29|28)/]) {
    await logButton(page).click();
    await expect(restScreen(page)).toContainText(clock);
    await skipRest(page);
  }
});

test('an AMRAP set shows its minimum as N+, needs no RPE target, and logs what was done', async ({ page }) => {
  await startWorkout(page, 'Methods · schemes');
  await pickLift(page, 2);

  await logAndSkip(page);
  await logAndSkip(page);

  await expect(targetLine(page)).toHaveText(/^Set 3 of 3 · 5\+ reps @ \d+(\.\d+)? kg$/);
  await expect(page.getByText('5+ · as many as you can')).toBeVisible();
  await expect(page.getByRole('button', { name: /^AMRAP/ })).toBeVisible();

  await page.getByRole('button', { name: 'Increase reps' }).click();
  await page.getByRole('button', { name: 'Increase reps' }).click();
  await expect(logButton(page)).toHaveText(/^Log AMRAP set.*× 7$/);
  await logButton(page).click();
  await expect(restScreen(page)).toBeVisible();
});

test('a scheme entry typed back-off pre-selects back-off when the logger reaches it', async ({ page }) => {
  await startWorkout(page, 'Methods · schemes');
  await pickLift(page, 3);

  const types = page.getByRole('group', { name: 'Set type' });
  await expect(types.getByRole('button', { name: 'Working', exact: true })).toHaveAttribute('aria-pressed', 'true');
  for (let i = 0; i < 4; i++) await logAndSkip(page);

  await expect(targetLine(page)).toHaveText(/^Set 5 of 6 · 10 reps @ /);
  await expect(types.getByRole('button', { name: 'Back-off', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: /^Back-off\. Opens its guide/ })).toBeVisible();
});

test('rep styles read in words on the target line', async ({ page }) => {
  await startWorkout(page, 'Methods · schemes');

  const badges: [number, RegExp][] = [
    [4, /^1½ reps\./],
    [5, /^21s\./],
    [6, /^Partials\./],
    [7, /^Eccentric only\./],
    [8, /^Hold 10 s\./],
  ];
  for (const [index, name] of badges) {
    await pickLift(page, index);
    await expect(page.getByRole('button', { name })).toBeVisible();
  }
  // Holds are counted, and each one's length has its own stepper.
  await expect(page.getByText('holds', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Longer hold' })).toBeVisible();
});

test('the pieces of a drop set never add sets or dots', async ({ page }) => {
  await startWorkout(page, 'Methods · pieces');
  await expect(page.getByRole('button', { name: /^Drop ×2\./ })).toBeVisible();

  // The set, then its two drops. The rest only starts once the last is done.
  await logButton(page).click();
  await expect(restScreen(page)).toBeHidden();
  await logButton(page).click();
  await expect(restScreen(page)).toBeHidden();
  await logButton(page).click();
  await expect(restScreen(page)).toBeVisible();
  await skipRest(page);

  await expect(page.getByText(/^\d+:\d+ · 1 of \d+ sets · /)).toBeVisible();
  await expect(page.getByRole('group', { name: '1 of 3 sets logged' })).toBeVisible();
  await expect(page.getByRole('group', { name: '1 of 3 sets logged' }).getByRole('button')).toHaveCount(1);
  await expect(page.getByRole('button', { name: /^Bench, 1 of 3 sets$/ })).toBeVisible();
});
