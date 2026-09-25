import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { completeSetup, gotoApp, goToTab, startFromWorkouts } from './helpers';

// The method explainers, opened the way a lifter opens them: from the tempo
// line and the method badge on Train. They are bundled with the app, so they
// have to open in a basement with no signal and without asking the network for
// anything.
//
// The sheet itself is covered for every guide in
// components/MethodGuideSheet.test.tsx. What only a browser can show is that
// the openers reach it, offline.

const FIXTURE = join(__dirname, 'fixtures', 'methods.json');

test.describe('method explainers', () => {
  test('open from Train with the network cut, and fetch nothing', async ({ page, context }) => {
    await gotoApp(page);
    await completeSetup(page);

    await goToTab(page, 'Workouts');
    await page.getByLabel('Bompa export file').setInputFiles({
      name: 'methods.json',
      mimeType: 'application/json',
      buffer: readFileSync(FIXTURE),
    });
    await page.getByRole('button', { name: 'Import it' }).click();
    await expect(page.getByText(/^Imported \d+ records/)).toBeVisible();

    // An import is read back on the next load, as the app itself says.
    await gotoApp(page);
    await page.evaluate(() => navigator.serviceWorker.ready);
    await startFromWorkouts(page, 'Methods · schemes');
    await expect(page.getByRole('button', { name: 'Session menu', exact: true })).toBeVisible();

    // From here on the network is gone: the guides ship with the app.
    await context.setOffline(true);
    const requests: string[] = [];
    page.on('request', (request) => requests.push(request.url()));

    await page.getByRole('button', { name: /^tempo \d/ }).first().click();
    const sheet = page.getByRole('dialog', { name: 'Tempo explained' });
    await expect(sheet).toBeVisible();
    for (const heading of ['What it is', 'How to do it', 'How Bompa logs it', 'What Bompa counts', 'Watch out for']) {
      await expect(sheet.getByRole('heading', { level: 3, name: heading })).toBeVisible();
    }
    await expect(sheet).toContainText('2110 is two seconds down');

    await sheet.getByRole('button', { name: 'Close' }).click();
    await expect(sheet).toBeHidden();

    // Anything served by the worker still shows up as a request; nothing may
    // leave the device.
    expect(requests.filter((url) => !url.startsWith(new URL(page.url()).origin))).toEqual([]);
  });
});
