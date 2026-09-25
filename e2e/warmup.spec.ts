import { expect, test, type Page } from '@playwright/test';
import { builder, completeSetup, gotoApp, goToTab, openSettingsView, openWorkoutRow, readRoutines, restScreen, saveBuilder, skipRest } from './helpers';

// The warm-up checklist: built in the workout builder, ticked on Train. It is a
// reminder, not training data, so ticking never logs a set.

test.beforeEach(async ({ page }) => {
  await gotoApp(page);
  await completeSetup(page, { workouts: [['Bench Press']], names: ['Push A'] });
});

async function editWorkout(page: Page, name: string) {
  await goToTab(page, 'Workouts');
  await openWorkoutRow(page, name);
  await page.getByRole('button', { name: `Edit ${name}` }).click();
  await expect(builder(page)).toBeVisible();
  return builder(page).getByRole('region', { name: 'Warm-up' });
}

async function startWorkout(page: Page) {
  await goToTab(page, 'Today');
  await page.getByRole('button', { name: /^(Start .+|Train anyway)$/ }).click();
  await goToTab(page, 'Train');
}

function card(page: Page) {
  return page.getByRole('region', { name: 'Warm-up' });
}

test('a warm-up built from common moves and a typed item is a checklist on Train that logs nothing', async ({ page }) => {
  const section = await editWorkout(page, 'Push A');
  await section.getByRole('button', { name: '+ Add from common moves' }).click();
  const moves = section.getByRole('group', { name: 'Common moves' });
  await moves.getByRole('button', { name: 'Cat-cow', exact: true }).click();
  await moves.getByRole('button', { name: 'Hip aeroplanes', exact: true }).click();
  // Picked once is picked: the chip now reads as added and can't add twice.
  await expect(moves.getByRole('button', { name: 'Cat-cow', exact: true })).toBeDisabled();
  await section.getByRole('button', { name: 'Done adding common moves' }).click();

  await section.getByRole('textbox', { name: 'Warm-up move' }).fill('Kettlebell halos');
  await section.getByRole('textbox', { name: 'How much' }).fill('5 each way');
  await section.getByRole('textbox', { name: 'How much' }).press('Enter');
  await expect(section.getByRole('list', { name: 'Warm-up moves' }).getByRole('listitem')).toHaveCount(3);
  await saveBuilder(page);

  const stored = (await readRoutines(page)) as { name: string; warmup?: { name: string; dose?: string }[] }[];
  const push = stored.find((routine) => routine.name === 'Push A');
  expect(push?.warmup?.map((item) => item.name)).toEqual(['Cat-cow', 'Hip aeroplanes', 'Kettlebell halos']);
  expect(push?.warmup?.[2]?.dose).toBe('5 each way');

  await startWorkout(page);
  await expect(card(page)).toBeVisible();
  await expect(card(page).getByText('Kettlebell halos')).toBeVisible();
  await expect(card(page).getByTestId('warmup-progress')).toHaveText('0 of 3 done');

  await card(page).getByRole('button', { name: 'Cat-cow', exact: true }).click();
  await card(page).getByRole('button', { name: 'Kettlebell halos', exact: true }).click();
  await expect(card(page).getByTestId('warmup-progress')).toHaveText('2 of 3 done');
  await expect(card(page).getByRole('button', { name: 'Cat-cow', exact: true })).toHaveAttribute('aria-pressed', 'true');

  // A common move carries a one-line cue behind its name; a move of your own doesn't.
  await card(page).getByRole('button', { name: 'How to do Hip aeroplanes' }).click();
  await expect(card(page).getByRole('button', { name: 'How to do Hip aeroplanes' })).toHaveAttribute('aria-expanded', 'true');
  await expect(card(page).getByRole('button', { name: 'How to do Kettlebell halos' })).toHaveCount(0);

  // Ticking logged nothing; logging a set still works underneath the card.
  await expect(page.getByText(/· 0 of \d+ sets ·/)).toBeVisible();
  await page.getByRole('button', { name: /^Log set/ }).click();
  if (await restScreen(page).isVisible()) await skipRest(page);
  await expect(page.getByText(/· 1 of \d+ sets ·/)).toBeVisible();

  // Hide folds the list away and keeps the count.
  await card(page).getByRole('button', { name: 'Hide warm-up' }).click();
  await expect(card(page).getByText('Kettlebell halos')).toBeHidden();
  await expect(card(page).getByTestId('warmup-progress')).toHaveText('2 of 3 done');

  // A reload mid-session keeps the list and the ticks.
  await gotoApp(page);
  await goToTab(page, 'Train');
  await expect(card(page).getByText('Hip aeroplanes')).toBeVisible();
  await expect(card(page).getByTestId('warmup-progress')).toHaveText('2 of 3 done');
});

test('a workout set to use the default shows the default list', async ({ page }) => {
  await openSettingsView(page, 'Default warm-up');
  const tools = page;
  await tools.getByRole('textbox', { name: 'Warm-up move' }).fill('Leg swings');
  await tools.getByRole('textbox', { name: 'How much' }).fill('10 each way');
  await tools.getByRole('button', { name: 'Add move' }).click();
  await expect(tools.getByRole('list', { name: 'Warm-up moves' }).getByText('Leg swings')).toBeVisible();

  const section = await editWorkout(page, 'Push A');
  await section.getByRole('button', { name: 'Use my default warm-up' }).click();
  await expect(section.getByText(/Leg swings/)).toBeVisible();
  await saveBuilder(page);

  await startWorkout(page);
  await expect(card(page).getByText('Leg swings')).toBeVisible();
  await expect(card(page).getByText('10 each way')).toBeVisible();
  await expect(card(page).getByTestId('warmup-progress')).toHaveText('0 of 1 done');
});

test('a workout without a warm-up shows no card', async ({ page }) => {
  await startWorkout(page);
  await expect(page.getByRole('button', { name: /^Log set/ })).toBeVisible();
  await expect(card(page)).toHaveCount(0);
});
