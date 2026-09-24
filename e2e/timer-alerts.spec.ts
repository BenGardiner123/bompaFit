import { expect, test, type Page } from '@playwright/test';
import { completeSetup, goToTab, gotoApp, restScreen, skipRest } from './helpers';

// Timer alerts: the beeps and buzzes at the end of a rest, and the switches in
// Tools that govern them. Nothing here listens for real sound. The page's
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
  await goToTab(page, 'Tools');
  // A one-minute rest keeps the fast-forward short.
  await page.getByRole('group', { name: 'Rest length' }).getByRole('button', { name: '1:00' }).click();
});

async function logSetAndRest(page: Page) {
  await goToTab(page, 'Today');
  await page.getByRole('button', { name: /^(Start workout|Train anyway)$/ }).click();
  await goToTab(page, 'Train');
  await page.getByRole('button', { name: 'Log set' }).click();
  await expect(restScreen(page)).toBeVisible();
}

const tones = (page: Page) => page.evaluate(() => window.__tones);
const buzzes = (page: Page) => page.evaluate(() => window.__buzzes);

test.describe('timer alerts', () => {
  test('counts down and sounds the end of rest once', async ({ page }) => {
    await logSetAndRest(page);
    await page.clock.runFor(50_000);
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

  test('plays nothing for a skipped rest', async ({ page }) => {
    await logSetAndRest(page);
    await page.clock.runFor(10_000);
    await restScreen(page).getByRole('button', { name: 'Skip rest' }).click();
    await page.clock.runFor(60_000);
    expect(await tones(page)).toEqual([]);
    expect(await buzzes(page)).toEqual([]);
  });

  test('stays silent with sound off, and still buzzes', async ({ page }) => {
    await page.getByRole('switch', { name: 'Sound' }).click();
    await expect(page.getByRole('switch', { name: 'Sound' })).toHaveAttribute('aria-checked', 'false');

    await logSetAndRest(page);
    await page.clock.runFor(62_000);
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
    await goToTab(page, 'Tools');
    await expect(page.getByRole('switch', { name: 'Rest notifications' })).toHaveAttribute('aria-checked', 'true');
  });

  test('keeps the switches across a reload', async ({ page }) => {
    const sound = page.getByRole('switch', { name: 'Sound' });
    const screenOn = page.getByRole('switch', { name: 'Keep screen on during workouts' });
    await expect(sound).toHaveAttribute('aria-checked', 'true');
    await sound.click();
    // Headless Chromium has no screen lock, so that switch is shown but disabled.
    if (await screenOn.isEnabled()) await screenOn.click();
    const screenOnAfter = await screenOn.getAttribute('aria-checked');

    await page.reload();
    await goToTab(page, 'Tools');
    await expect(sound).toHaveAttribute('aria-checked', 'false');
    await expect(screenOn).toHaveAttribute('aria-checked', screenOnAfter ?? 'false');
    // The browser refused notifications, so the switch says why instead of asking.
    await expect(page.getByText('Blocked in browser settings')).toBeVisible();
  });
});
