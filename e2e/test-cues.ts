import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BrowserContext } from '@playwright/test';

// The cue file the app fetches for imported movements, replaced with a small
// one written for the tests. These tests check that the file is fetched on
// demand and saved for offline use, not what it says, and the real file is not
// part of every copy of this repository, so they must not depend on it.

const TEST_CUES = readFileSync(join(__dirname, 'fixtures', 'howtos.json'), 'utf8');

/** A step from the test cue file, to check the sheet shows what was served. */
export const TEST_CUE_STEP = /^Test cue: hang from the bar/;

/**
 * Serve the test cue file for every request to it, including the service
 * worker's own fetch when it saves the file at install. Call before the page
 * first loads, or the worker will already have saved whatever was there.
 */
export async function serveTestCues(context: BrowserContext): Promise<void> {
  await context.route('**/howtos.json', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json; charset=utf-8', body: TEST_CUES }),
  );
}

/** The test cue file's body, for a test that holds the request back and answers it later. */
export function testCuesBody(): string {
  return TEST_CUES;
}
