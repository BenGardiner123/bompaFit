// The fixtures under ./fixtures/exercisedb were built from AscendAPI's
// published documentation (OpenAPI spec and product overview), not recorded
// from the live API — no key was available. Each file says so in its
// `_provenance` field. Re-record them with a real key before trusting these
// tests as evidence about the live service.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db';
import type { ContentLink, HowTo, ProviderConnection } from '@/lib/types';
import { providerFetch, providerFetchImage, resetBackoff } from '../fetcher';
import { MAX_STEPS, MAX_STEP_CHARS } from '../provider';
import { isKnownProvider, loadProvider, resetProviderCache } from '../registry';
import { resolveHowTo } from '../resolve';
import { cacheRowFor, expiryFor } from '../store';
import { EXERCISEDB_HOST, EXERCISEDB_MEDIA_HOST, TEXT_MAX_AGE_MS, exercisedb, nextMondayUtc } from './exercisedb';
import byId from './fixtures/exercisedb/exercise-by-id.json';
import byName from './fixtures/exercisedb/exercises-by-name.json';
import unauthorised from './fixtures/exercisedb/error-unauthorized.json';
import liveness from './fixtures/exercisedb/liveness.json';

const KEY = 'test-key-123';
const DAY = 86_400_000;
const ctx = () => ({ apiKey: KEY, signal: new AbortController().signal });

// 2026-09-27 is a Sunday; 2026-09-28 the Monday after it.
const SUNDAY_EVENING = Date.UTC(2026, 8, 27, 22, 30);
const NEXT_MONDAY = Date.UTC(2026, 8, 28);

const allowed = (cachingAllowed: boolean): ProviderConnection => ({ providerId: 'exercisedb', connectedAt: 0, apiKey: KEY, cachingAllowed, rank: 0 });

let fetchMock: ReturnType<typeof vi.fn>;

function respond(body: unknown, init: ResponseInit = {}) {
  fetchMock.mockImplementation(async () => new Response(JSON.stringify(body), { status: 200, ...init }));
}

function respondImage() {
  fetchMock.mockImplementation(async () => new Response('webp', { status: 200, headers: { 'content-type': 'image/webp' } }));
}

function call(n = 0): { url: string; init: RequestInit; headers: Record<string, string> } {
  const [url, init] = fetchMock.mock.calls[n] as [string, RequestInit];
  return { url, init, headers: init.headers as Record<string, string> };
}

beforeEach(() => {
  resetBackoff();
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('registration', () => {
  it('is listed, and its lazy entry loads this adapter', async () => {
    resetProviderCache();
    expect(isKnownProvider('exercisedb')).toBe(true);
    expect(await loadProvider('exercisedb')).toBe(exercisedb);
  });
});

describe('where the key goes', () => {
  it('the key may go to the RapidAPI gateway only; pictures come from the CDN', () => {
    expect(exercisedb.apiHosts).toEqual([EXERCISEDB_HOST]);
    expect(exercisedb.mediaHosts).toEqual([EXERCISEDB_MEDIA_HOST]);
    expect(exercisedb.apiHosts).not.toContain(EXERCISEDB_MEDIA_HOST);
  });

  it('an API call to the CDN is refused, so the key never reaches it', async () => {
    const outcome = await providerFetch(exercisedb, `https://${EXERCISEDB_MEDIA_HOST}/api/v1/liveness`, ctx());
    expect(outcome).toMatchObject({ ok: false, reason: 'blocked' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('saving a picture from the CDN sends no key', async () => {
    respondImage();
    const image = (byId as { data: { imageUrls: Record<string, string> } }).data.imageUrls['720p']!;
    expect(await providerFetchImage(exercisedb, image, ctx())).not.toBeNull();
    const [url, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(new URL(url).host).toBe(EXERCISEDB_MEDIA_HOST);
    expect(init.headers).toBeUndefined();
    expect(JSON.stringify(init)).not.toContain(KEY);
  });

  it('drops media on any host but the CDN, so no answer can point the phone somewhere else', async () => {
    const data = structuredClone((byId as { data: Record<string, unknown> }).data);
    data.imageUrl = 'https://tracker.example.net/a.webp';
    data.imageUrls = { '720p': 'https://tracker.example.net/b.webp' };
    data.videoUrl = 'https://tracker.example.net/c.mp4';
    respond({ success: true, data });
    const howTo = await exercisedb.fetchHowTo('exr_41n2hxnFMotsXTj3', ctx());
    expect(howTo!.media).toEqual([]);
  });

  it('sends the key and the host header to the gateway, and never puts the key in the URL', async () => {
    respond(byId);
    await exercisedb.fetchHowTo('exr_41n2hxnFMotsXTj3', ctx());
    respond(byName);
    await exercisedb.search('bench press', ctx());
    respond(liveness);
    await exercisedb.test(ctx());

    expect(fetchMock).toHaveBeenCalledTimes(3);
    for (let i = 0; i < 3; i++) {
      const { url, headers } = call(i);
      expect(new URL(url).host).toBe(EXERCISEDB_HOST);
      expect(url).not.toContain(KEY);
      expect(headers['X-RapidAPI-Key']).toBe(KEY);
      expect(headers['X-RapidAPI-Host']).toBe(EXERCISEDB_HOST);
    }
  });

  it('an id that is not one of theirs never becomes a request', async () => {
    for (const bad of ['../../evil', 'exr_1?x=1', 'https://evil.example.net/', '', 'a'.repeat(201)]) {
      expect(await exercisedb.fetchHowTo(bad, ctx())).toBeNull();
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('without a key nothing is sent at all', async () => {
    respond(liveness);
    expect(await exercisedb.test({ signal: new AbortController().signal })).toMatchObject({ ok: false, reason: 'unauthorised' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('search', () => {
  it('uses the documented filter route and normalises each result', async () => {
    respond(byName);
    const matches = await exercisedb.search('  bench press ', ctx());
    const url = new URL(call().url);
    expect(url.pathname).toBe('/api/v1/exercises');
    expect(url.searchParams.get('name')).toBe('bench press');
    expect(url.searchParams.get('limit')).toBe('10');

    expect(matches).toHaveLength(3);
    expect(matches[0]).toEqual({
      externalId: 'exr_41n2hxnFMotsXTj3',
      name: 'Bench Press',
      equipment: 'Barbell',
      muscle: 'Pectoralis Major Sternal Head',
      thumbUrl: 'https://cdn.exercisedb.dev/media/images/CNKJtB2O5Y.webp',
    });
    // An empty imageUrl is no thumbnail, not a broken one.
    expect(matches[1]).not.toHaveProperty('thumbUrl');
  });

  it('an empty query costs nothing', async () => {
    expect(await exercisedb.search('   ', ctx())).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('drops entries it cannot use and never throws on a strange body', async () => {
    respond({ success: true, data: [{ name: 'No id' }, { exerciseId: 'bad id!', name: 'Bad' }, 7, { exerciseId: 'exr_ok', name: 'Fine' }] });
    expect(await exercisedb.search('x', ctx())).toEqual([{ externalId: 'exr_ok', name: 'Fine' }]);
    respond({ success: false });
    expect(await exercisedb.search('x', ctx())).toEqual([]);
    fetchMock.mockImplementation(async () => new Response('<html>', { status: 200 }));
    expect(await exercisedb.search('x', ctx())).toEqual([]);
    fetchMock.mockImplementation(async () => {
      throw new TypeError('Failed to fetch');
    });
    expect(await exercisedb.search('x', ctx())).toEqual([]);
  });
});

describe('fetchHowTo', () => {
  it('turns the documented example into plain steps, muscles, media and a credit', async () => {
    respond(byId);
    const howTo = await exercisedb.fetchHowTo('exr_41n2hxnFMotsXTj3', ctx());
    expect(new URL(call().url).pathname).toBe('/api/v1/exercises/exr_41n2hxnFMotsXTj3');
    expect(howTo).not.toBeNull();
    expect(howTo!.externalId).toBe('exr_41n2hxnFMotsXTj3');
    expect(howTo!.steps).toHaveLength(4);
    expect(howTo!.steps[1]).toBe('Slowly lower the barbell down to your chest while keeping your elbows at a 90-degree angle.');
    expect(howTo!.muscles).toBe('Pectoralis Major Sternal Head, Pectoralis Major Clavicular Head, Anterior Deltoid, Triceps Brachii');
    expect(howTo!.media).toEqual([
      { kind: 'image', url: 'https://cdn.exercisedb.dev/media/images/AetqvRI4jK.webp' },
      { kind: 'video', url: 'https://cdn.exercisedb.dev/videos/Trn4QDW/41n2hxnFMotsXTj3__Barbell-Bench-Press_Chest2_.mp4' },
    ]);
    // Licensed access, not open content: a service name and a link, no licence.
    expect(howTo!.credit).toEqual({ line: 'ExerciseDB via RapidAPI', url: 'https://rapidapi.com/ascendapi/api/edb-with-videos-and-images-by-ascendapi' });
  });

  it('clamps step count and length, and drops media that is not https', async () => {
    const long = 'x'.repeat(MAX_STEP_CHARS + 50);
    respond({
      success: true,
      data: {
        ...byId.data,
        instructions: [long, ...Array.from({ length: 30 }, (_, i) => `Step ${i}`), 42, '   '],
        imageUrls: { '720p': 'javascript:alert(1)' },
        imageUrl: 'http://cdn.exercisedb.dev/plain.webp',
        videoUrl: 'data:video/mp4;base64,AAAA',
      },
    });
    const howTo = await exercisedb.fetchHowTo('exr_41n2hxnFMotsXTj3', ctx());
    expect(howTo!.steps).toHaveLength(MAX_STEPS);
    expect(howTo!.steps[0]!.length).toBe(MAX_STEP_CHARS);
    expect(howTo!.steps[0]!.endsWith('…')).toBe(true);
    expect(howTo!.media).toEqual([]);
  });

  it('null, never a throw, for an unknown id, no instructions, or a failed call', async () => {
    fetchMock.mockImplementation(async () => new Response('{"error":{"code":"NOT_FOUND"}}', { status: 404 }));
    expect(await exercisedb.fetchHowTo('exr_missing', ctx())).toBeNull();
    respond({ success: true, data: { ...byId.data, instructions: [] } });
    expect(await exercisedb.fetchHowTo('exr_41n2hxnFMotsXTj3', ctx())).toBeNull();
    respond({ success: true, data: 'nope' });
    expect(await exercisedb.fetchHowTo('exr_41n2hxnFMotsXTj3', ctx())).toBeNull();
    fetchMock.mockImplementation(async () => {
      throw new TypeError('Failed to fetch');
    });
    expect(await exercisedb.fetchHowTo('exr_41n2hxnFMotsXTj3', ctx())).toBeNull();
  });
});

describe('test connection', () => {
  it('calls the liveness route once and reports the quota the gateway states', async () => {
    respond(liveness, { headers: { 'x-ratelimit-requests-remaining': '482' } });
    expect(await exercisedb.test(ctx())).toEqual({ ok: true, quotaRemaining: 482 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(new URL(call().url).pathname).toBe('/api/v1/liveness');
  });

  it('passes without a quota figure when the gateway does not send one', async () => {
    respond(liveness);
    expect(await exercisedb.test(ctx())).toEqual({ ok: true });
  });

  it.each([
    [401, 'unauthorised'],
    [403, 'unauthorised'],
    [429, 'quota'],
    [500, 'unexpected'],
  ] as const)('HTTP %i becomes %s', async (status, reason) => {
    resetBackoff();
    respond(unauthorised, { status });
    expect(await exercisedb.test(ctx())).toMatchObject({ ok: false, reason });
  });

  it('an unreachable gateway is a network failure, not a throw', async () => {
    fetchMock.mockImplementation(async () => {
      throw new TypeError('Failed to fetch');
    });
    expect(await exercisedb.test(ctx())).toMatchObject({ ok: false, reason: 'network' });
  });
});

describe('cache policy', () => {
  it('defaults to storing nothing when the plan does not allow caching', () => {
    const policy = exercisedb.cachePolicy(allowed(false));
    expect(policy).toMatchObject({ textMaxAgeMs: 0, imageMaxAgeMs: 0, cacheVideo: false });
    expect(policy.expireBefore).toBeUndefined();
  });

  it('with caching allowed: text for at most seven days, video never', () => {
    const policy = exercisedb.cachePolicy(allowed(true));
    expect(policy.textMaxAgeMs).toBe(TEXT_MAX_AGE_MS);
    expect(TEXT_MAX_AGE_MS).toBe(7 * DAY);
    expect(policy.cacheVideo).toBe(false);
  });

  it('nextMondayUtc is the first Monday midnight strictly after, across a week and a month boundary', () => {
    expect(nextMondayUtc(SUNDAY_EVENING)).toBe(NEXT_MONDAY);
    expect(nextMondayUtc(NEXT_MONDAY - 1)).toBe(NEXT_MONDAY);
    // Fetched at exactly Monday midnight: the whole week, not zero.
    expect(nextMondayUtc(NEXT_MONDAY)).toBe(NEXT_MONDAY + 7 * DAY);
    // Tuesday 2026-09-29 → Monday 2026-10-05, across the month end.
    expect(nextMondayUtc(Date.UTC(2026, 8, 29, 1))).toBe(Date.UTC(2026, 9, 5));
    // Saturday 2026-12-26 → Monday 2026-12-28; Thursday 2026-12-31 → Monday 2027-01-04.
    expect(nextMondayUtc(Date.UTC(2026, 11, 26, 12))).toBe(Date.UTC(2026, 11, 28));
    expect(nextMondayUtc(Date.UTC(2026, 11, 31, 23, 59))).toBe(Date.UTC(2027, 0, 4));
  });

  it('an image cached on a Sunday expires at the following Monday 00:00 UTC', () => {
    const policy = exercisedb.cachePolicy(allowed(true));
    expect(expiryFor(policy.imageMaxAgeMs, policy, SUNDAY_EVENING)).toBe(NEXT_MONDAY);
    // The stored text carries the same media links, so it goes at the same moment.
    const row = cacheRowFor('exercisedb', { externalId: 'e', steps: ['s'], media: [], credit: { line: 'l' } }, policy, SUNDAY_EVENING);
    expect(row!.expiresAt).toBe(NEXT_MONDAY);
  });

  it('early in the week the Monday boundary still wins over seven days', () => {
    const policy = exercisedb.cachePolicy(allowed(true));
    const tuesday = Date.UTC(2026, 8, 29, 9);
    expect(expiryFor(policy.imageMaxAgeMs, policy, tuesday)).toBe(Date.UTC(2026, 9, 5));
  });
});

describe('caching declared not allowed', () => {
  const BUNDLED: HowTo = { exerciseId: 'bench-press', muscles: 'Chest', mediaNote: '', steps: ['Bundled step'] };
  const link: ContentLink = { providerId: 'exercisedb', exerciseId: 'bench-press', externalId: 'exr_41n2hxnFMotsXTj3', status: 'confirmed', method: 'manual', at: 0 };

  beforeEach(async () => {
    await db.delete();
    await db.open();
  });

  it('content is shown online and no row is written to the cache', async () => {
    respond(byId);
    const done = await resolveHowTo({
      exerciseId: 'bench-press',
      userCues: null,
      seeded: BUNDLED,
      loadBundled: async () => BUNDLED,
      candidates: [{ connection: allowed(false), name: 'ExerciseDB', link }],
      loadProvider: async () => exercisedb,
      online: () => true,
      now: () => SUNDAY_EVENING,
    }).done;

    expect(done.textSource).toBe('provider');
    expect(done.text?.steps[0]).toMatch(/^Grip the barbell/);
    expect(await db.contentCache.count()).toBe(0);
  });
});
