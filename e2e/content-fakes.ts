import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, type BrowserContext, type Page, type Route } from '@playwright/test';

// Fake exercise-content services for the end-to-end suite.
//
// The answers are built from the responses recorded for the adapters' own unit
// tests (lib/content/providers/fixtures), so a fake that drifts from what the
// real service sends shows up here instead of passing against a shape nobody
// serves. The routes answer the paths the adapters really call — change an
// adapter's URL and these stop matching, which is the point.

const FIXTURES = join(__dirname, '..', 'lib', 'content', 'providers', 'fixtures');

type Json = Record<string, unknown>;

function fixture(provider: 'wger' | 'exercisedb', name: string): Json {
  const body = JSON.parse(readFileSync(join(FIXTURES, provider, `${name}.json`), 'utf8')) as Json;
  // Transcribed fixtures carry a note on where they came from; no server sends it.
  delete body._provenance;
  return body;
}

// ─── wger ─────────────────────────────────────────────────────

export const WGER = 'https://wger.de';
const WGER_ENGLISH = 2;

/** The recorded Bench Press entry, exactly as wger sent it. */
export function wgerBenchPress(): Json {
  const results = fixture('wger', 'exerciseinfo-bench-press').results as Json[];
  return results[0]!;
}

export type WgerEntryShape = { id: number; uuid: string; name: string; steps: string[]; equipment?: string[] };

/**
 * A wger entry with its own name and steps, built on the recorded Bench Press
 * so every other field — licences, authors, images, muscles — is real-shaped.
 */
export function wgerEntry(shape: WgerEntryShape): Json {
  const base = wgerBenchPress();
  const translations = (base.translations as Json[]).map((t) =>
    t.language === WGER_ENGLISH
      ? { ...t, exercise: shape.id, name: shape.name, description: `<ol>${shape.steps.map((step) => `<li>${step}</li>`).join('')}</ol>` }
      : { ...t, exercise: shape.id },
  );
  const equipment = shape.equipment ? shape.equipment.map((name, index) => ({ id: index + 1, name })) : base.equipment;
  return { ...base, id: shape.id, uuid: shape.uuid, translations, equipment };
}

function englishName(entry: Json): string {
  const english = (entry.translations as Json[]).find((t) => t.language === WGER_ENGLISH);
  return String(english?.name ?? '');
}

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

export type FakeWgerOptions = {
  /** How the n-th lookup of one entry answers; 200 unless this says otherwise. */
  detailStatus?: (uuid: string, call: number) => number;
};

/**
 * Answer wger.de the way it really answers:
 *
 * - `/api/v2/exerciseinfo/?limit=1` — the connection test;
 * - `/api/v2/exerciseinfo/?name__search=…` — search;
 * - `/api/v2/exerciseinfo/?uuid=…` — one entry (the adapter never uses the
 *   `/exerciseinfo/<uuid>/` path, which wger answers with a 404);
 * - `/media/…` — pictures, sent with no CORS header, as wger's media host does.
 */
export async function fakeWger(context: BrowserContext, entries: Json[], opts: FakeWgerOptions = {}) {
  let detailCalls = 0;
  const cors = { 'access-control-allow-origin': '*' };
  await context.route(`${WGER}/**`, async (route: Route) => {
    const url = new URL(route.request().url());
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { ...cors, 'access-control-allow-headers': '*' } });
    if (url.pathname.startsWith('/media/')) return route.fulfill({ status: 200, contentType: 'image/png', body: PNG });
    if (!/^\/api\/v2\/exerciseinfo\/$/.test(url.pathname)) return route.fulfill({ status: 404, headers: cors, json: { detail: 'Not found.' } });

    const page = (results: Json[]) => route.fulfill({ status: 200, headers: cors, json: { count: results.length, next: null, previous: null, results } });

    const uuid = url.searchParams.get('uuid');
    if (uuid !== null) {
      detailCalls += 1;
      const status = opts.detailStatus?.(uuid, detailCalls) ?? 200;
      if (status !== 200) return route.fulfill({ status, headers: cors, json: { detail: 'Request was throttled.' } });
      return page(entries.filter((entry) => entry.uuid === uuid));
    }
    const term = (url.searchParams.get('name__search') ?? '').toLowerCase();
    const limit = Number(url.searchParams.get('limit') ?? 20);
    return page(entries.filter((entry) => englishName(entry).toLowerCase().includes(term)).slice(0, limit));
  });
}

// ─── ExerciseDB ───────────────────────────────────────────────

/** The RapidAPI gateway host the adapter calls. The key goes here and nowhere else. */
export const EXERCISEDB_API = 'https://edb-with-videos-and-images-by-ascendapi.p.rapidapi.com';

export function exercisedbFixture(name: 'liveness' | 'exercise-by-id' | 'exercises-by-name' | 'error-unauthorized'): Json {
  return fixture('exercisedb', name);
}

// ─── The Exercise instructions screen ─────────────────────────

export function providerRow(page: Page, name: string) {
  return page.getByRole('button', { name: new RegExp(`^${name}, (not )?connected$`) });
}

/** Connect wger from Settings → Exercise instructions. Assumes that screen is open. */
export async function connectWger(page: Page) {
  const testButton = page.getByRole('button', { name: 'Test connection' });
  // After a disconnect the row is still open on its connect panel; a second
  // tap would close it again.
  if (!(await testButton.isVisible())) await providerRow(page, 'wger').click();
  const connect = page.getByRole('button', { name: 'Connect', exact: true });
  await expect(connect).toBeDisabled();
  await testButton.click();
  await expect(page.getByRole('status').filter({ hasText: 'It works' })).toBeVisible();
  await expect(connect).toBeEnabled();
  await connect.click();
  await expect(providerRow(page, 'wger')).toHaveAccessibleName('wger, connected');
}

export async function reviewSheet(page: Page, providerName = 'wger') {
  await page.getByRole('button', { name: /^Review \d+ suggestions?$/ }).click();
  const sheet = page.getByRole('dialog', { name: `Suggested links from ${providerName}` });
  await expect(sheet).toBeVisible();
  return sheet;
}
