import { expect, test, type Page } from '@playwright/test';
import { gotoApp, setupHeading } from './helpers';

// Downloaded exercise images live in their own Cache Storage bucket so a deploy
// cannot wipe them, and the worker serves them from there when the phone has
// no signal. Nothing here touches a real network: the other site is a made-up
// host, and every request to it is answered or refused by the test.

const BUCKET = 'bompa-content-v1';
const HOST = 'https://media.provider.test';

// A 1x1 transparent PNG, so an <img> that gets it has a real natural width.
const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

/** Wait until the worker is active and actually controlling this page. */
async function workerInControl(page: Page) {
  await page.evaluate(() => navigator.serviceWorker.ready);
  if (!(await page.evaluate(() => Boolean(navigator.serviceWorker.controller)))) {
    // clients.claim() can land a moment after ready resolves.
    await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  }
}

/** Store an image in a named cache under `url`, as the app's download step would. */
async function putImage(page: Page, cacheName: string, url: string) {
  await page.evaluate(
    async ({ cacheName, url, base64 }) => {
      const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      const cache = await caches.open(cacheName);
      await cache.put(new Request(url), new Response(bytes, { headers: { 'Content-Type': 'image/png' } }));
    },
    { cacheName, url, base64: PNG_BASE64 },
  );
}

/** Put an <img> on the page and report whether it loaded. */
function loadImage(page: Page, url: string) {
  return page.evaluate(
    (src) =>
      new Promise<{ loaded: boolean; width: number }>((resolve) => {
        const img = document.createElement('img');
        img.onload = () => resolve({ loaded: true, width: img.naturalWidth });
        img.onerror = () => resolve({ loaded: false, width: 0 });
        img.src = src;
        document.body.appendChild(img);
      }),
    url,
  );
}

test.describe('downloaded exercise content', () => {
  test('survives a new service worker version activating', async ({ page }) => {
    await gotoApp(page);
    await workerInControl(page);

    const image = `${HOST}/squat.png`;
    await putImage(page, BUCKET, image);
    // A leftover from an older build. The cleanup must delete this one, or the
    // test could not tell "the bucket was spared" from "cleanup never ran".
    await page.evaluate(async () => {
      const cache = await caches.open('bompa-0123456789ab');
      await cache.put('/stale.js', new Response('stale'));
    });

    // Registering the same scope with a different script URL makes the browser
    // treat it as a new worker version: it installs, skips waiting, and runs
    // the real activate cleanup, exactly as a deploy would. The test server
    // ignores the query string, so the bytes are this build's worker.
    const activated = await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.register('/sw.js?next-version=1');
      const scriptOf = () => registration.active?.scriptURL ?? '';
      if (!scriptOf().includes('next-version')) {
        await new Promise<void>((resolve) => {
          navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), { once: true });
        });
      }
      return scriptOf();
    });
    expect(activated).toContain('next-version=1');

    // Activate's cleanup runs inside waitUntil, so the old cache is gone by the
    // time the new worker takes control. Poll anyway rather than trust timing.
    await expect.poll(() => page.evaluate(() => caches.keys())).not.toContain('bompa-0123456789ab');

    const keys = await page.evaluate(() => caches.keys());
    expect(keys).toContain(BUCKET);
    const stillThere = await page.evaluate(
      async ({ bucket, url }) => Boolean(await (await caches.open(bucket)).match(url)),
      { bucket: BUCKET, url: image },
    );
    expect(stillThere).toBe(true);
  });

  test('an image saved in the bucket loads with the network cut', async ({ page, context }) => {
    const image = `${HOST}/bench-press.png`;
    let reachedNetwork = 0;
    await context.route(`${HOST}/**`, (route) => {
      reachedNetwork += 1;
      return route.abort();
    });

    await gotoApp(page);
    await workerInControl(page);
    await putImage(page, BUCKET, image);

    await context.setOffline(true);
    const result = await loadImage(page, image);

    expect(result).toEqual({ loaded: true, width: 1 });
    expect(reachedNetwork).toBe(0);
  });

  test('an image not in the bucket is not served from any cache', async ({ page, context }) => {
    const image = `${HOST}/deadlift.png`;
    await context.route(`${HOST}/**`, (route) => route.abort());
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));

    await gotoApp(page);
    await workerInControl(page);
    // The same URL sitting in some other cache must not leak out: only the
    // download bucket is allowed to answer for another site.
    await putImage(page, 'bompa-not-content', image);

    await context.setOffline(true);
    const result = await loadImage(page, image);

    expect(result.loaded).toBe(false);
    expect(errors).toEqual([]);
    // Still a working app afterwards: the failed image broke nothing.
    await expect(setupHeading(page)).toBeVisible();
  });
});
