import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests run against the real static export, not `next dev`.
 *
 * That is not a preference. The service worker only registers in a production
 * build (app/page.tsx), so offline behaviour — and the app must work offline —
 * is untestable against the dev server.
 *
 * The viewport is the design's own device size (lib/tokens.ts DEVICE), which
 * is below FRAME_BREAKPOINT, so AndroidFrame renders the bare app rather than
 * a picture of a phone. Tests see what a phone sees.
 */
// E2E_PORT lets several copies of the repo run the suite at once without
// one attaching to another's server and testing the wrong build.
const PORT = Number(process.env.E2E_PORT ?? 4173);

export default defineConfig({
  testDir: './e2e',
  // Safe to parallelise: every test gets its own browser context, and a context
  // gets its own IndexedDB. There is no shared state to collide over.
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],

  use: {
    baseURL: `http://localhost:${PORT}`,
    viewport: { width: 412, height: 892 },
    // A phone, because that is what this app is. Touch changes hit targets and
    // some event handling, so testing a desktop mouse would test the wrong app.
    hasTouch: true,
    isMobile: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 412, height: 892 }, hasTouch: true, isMobile: true },
    },
  ],

  webServer: {
    // `out/` must already exist — `npm run test:e2e` builds first. Building here
    // instead would rebuild on every watch run for no reason.
    command: 'node scripts/serve-static.mjs',
    env: { PORT: String(PORT) },
    port: PORT,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
