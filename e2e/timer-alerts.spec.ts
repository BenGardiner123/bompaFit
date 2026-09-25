import { expect, test, type Page } from '@playwright/test';
import { C } from '../lib/tokens';
import { completeSetup, goToTab, gotoApp, openSettingsView, restScreen, skipRest } from './helpers';

// Timer alerts: the beeps and buzzes at the end of a rest, and the switches in
// Settings that govern them. Nothing here listens for real sound. The page's
// audio and vibration are wrapped before the app loads, and the test reads
// back what the app asked them to do.

// Must match the first note of each cue in components/alertOutput.ts. Pitch is
// what tells a tick from the end tone, so it is what the test counts.
const TICK_HZ = 880;
const ZERO_HZ = 784;

declare global {
  interface Window {
    __tones: number[];
    __buzzes: number[][];
  }
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.__tones = [];
    window.__buzzes = [];
    const create = AudioContext.prototype.createOscillator;
    AudioContext.prototype.createOscillator = function (this: AudioContext) {
      const osc = create.call(this);
      const start = osc.start.bind(osc);
      osc.start = (when?: number) => {
        window.__tones.push(osc.frequency.value);
        start(when);
      };
      return osc;
    };
    navigator.vibrate = ((pattern: VibratePattern) => {
      window.__buzzes.push(Array.isArray(pattern) ? [...pattern] : [pattern]);
      return true;
    }) as typeof navigator.vibrate;
    // Settle the notification question up front, so it stays out of the way.
    if ('Notification' in window) Object.defineProperty(Notification, 'permission', { configurable: true, get: () => 'denied' });
  });
  await page.clock.install();
  await gotoApp(page);
  await completeSetup(page, { workouts: [['Bench Press', 'Overhead Press']] });
});

/**
 * The default rest, which every test here runs out. The clock is fake, so the
 * length costs nothing to fast-forward; changing the default is covered where
 * it is changed, by holding the rest ring.
 */
const REST_MS = 150_000;

async function logSetAndRest(page: Page) {
  await goToTab(page, 'Today');
  await page.getByRole('button', { name: /^(Start .+|Train anyway)$/ }).click();
  await goToTab(page, 'Train');
  await page.getByRole('button', { name: 'Log set' }).click();
  await expect(restScreen(page)).toBeVisible();
}

const tones = (page: Page) => page.evaluate(() => window.__tones);
const buzzes = (page: Page) => page.evaluate(() => window.__buzzes);

test.describe('timer alerts', () => {
  test('counts down and sounds the end of rest once', async ({ page }) => {
    await logSetAndRest(page);
    await page.clock.runFor(REST_MS - 10_000);
    expect(await tones(page)).toEqual([]);

    await page.clock.runFor(12_000);
    await expect(restScreen(page)).toBeHidden();
    const heard = await tones(page);
    expect(heard.filter((hz) => hz === TICK_HZ)).toHaveLength(3);
    expect(heard.filter((hz) => hz === ZERO_HZ)).toHaveLength(1);
    // Three short buzzes and one long one.
    const felt = await buzzes(page);
    expect(felt).toHaveLength(4);
    expect(felt.at(-1)!.length).toBeGreaterThan(1);

    // Nothing more once it is over.
    await page.clock.runFor(10_000);
    expect(await tones(page)).toHaveLength(heard.length);
  });

  test('the last ten seconds turn the screen amber and show seconds only', async ({ page }) => {
    await logSetAndRest(page);
    const rest = restScreen(page);
    await expect(rest.getByText('Resting', { exact: true })).toBeVisible();

    await page.clock.runFor(REST_MS - 8_000);
    await expect(rest.getByText('Get under the bar')).toBeVisible();
    // Amber edge to edge, the phone's status bar included, so it reads from across the room.
    await expect(rest).toHaveCSS('background-color', 'rgb(245, 158, 11)');
    await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', C.amber);
    // Seconds only: "8 sec", not "0:08".
    const clock = rest.getByRole('timer', { name: /^\d+ seconds of rest left$/ });
    await expect(clock).toBeVisible();
    await expect(clock).toHaveText(/^\d{1,2}sec$/);
    // Nothing to rate in the last seconds; the question waits.
    await expect(rest.getByText('How did that feel?')).toHaveCount(0);
    // "I'm going" ends the rest, as Skip does.
    await rest.getByRole('button', { name: 'I’m going' }).click();
    await expect(rest).toBeHidden();
  });

  test('plays nothing for a skipped rest', async ({ page }) => {
    await logSetAndRest(page);
    await page.clock.runFor(10_000);
    await restScreen(page).getByRole('button', { name: 'Skip rest' }).click();
    await page.clock.runFor(60_000);
    expect(await tones(page)).toEqual([]);
    expect(await buzzes(page)).toEqual([]);
  });

  test('stays silent with sound off, and still buzzes', async ({ page }) => {
    await openSettingsView(page, 'Timer alerts');
    await page.getByRole('switch', { name: 'Sound' }).click();
    await expect(page.getByRole('switch', { name: 'Sound' })).toHaveAttribute('aria-checked', 'false');

    await logSetAndRest(page);
    await page.clock.runFor(REST_MS + 2_000);
    await expect(restScreen(page)).toBeHidden();
    expect(await tones(page)).toEqual([]);
    expect(await buzzes(page)).toHaveLength(4);
  });

  test('asks about notifications once, when the first rest starts', async ({ page }) => {
    // A browser that has not been asked yet, and says yes when it is.
    await page.addInitScript(() => {
      let answer: NotificationPermission = 'default';
      Object.defineProperty(Notification, 'permission', { configurable: true, get: () => answer });
      Notification.requestPermission = () => {
        answer = 'granted';
        return Promise.resolve(answer);
      };
    });
    await page.reload();
    await expect(page.getByRole('region', { name: 'Rest notifications' })).toBeHidden();

    await logSetAndRest(page);
    const question = page.getByRole('region', { name: 'Rest notifications' });
    await question.getByRole('button', { name: 'Turn on' }).click();
    await expect(question).toBeHidden();

    await skipRest(page);
    await openSettingsView(page, 'Timer alerts');
    await expect(page.getByRole('switch', { name: 'Rest notifications' })).toHaveAttribute('aria-checked', 'true');
  });

  test('keeps the switches across a reload', async ({ page }) => {
    await openSettingsView(page, 'Timer alerts');
    const sound = page.getByRole('switch', { name: 'Sound' });
    const screenOn = page.getByRole('switch', { name: 'Keep screen on during workouts' });
    await expect(sound).toHaveAttribute('aria-checked', 'true');
    await sound.click();
    // Headless Chromium has no screen lock, so that switch is shown but disabled.
    if (await screenOn.isEnabled()) await screenOn.click();
    const screenOnAfter = await screenOn.getAttribute('aria-checked');

    await page.reload();
    await openSettingsView(page, 'Timer alerts');
    await expect(sound).toHaveAttribute('aria-checked', 'false');
    await expect(screenOn).toHaveAttribute('aria-checked', screenOnAfter ?? 'false');
    // The browser refused notifications, so the switch says why instead of asking.
    await expect(page.getByText('Blocked in browser settings')).toBeVisible();
  });
});
