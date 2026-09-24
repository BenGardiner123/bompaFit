import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db';
import type { ContentLink, HowTo, ProviderConnection, ProviderHowTo } from '@/lib/types';
import { FETCH_TIMEOUT_MS, providerFetch, readJson, resetBackoff } from './fetcher';
import type { CachePolicy, ContentProvider } from './provider';
import { downloadContent, resolveHowTo, statusSentence, type ResolveInput, type ResolvedHowTo } from './resolve';
import { CONTENT_BUCKET, cacheRowFor, writeCache } from './store';

const T0 = Date.UTC(2026, 8, 20, 10);
const DAY = 86_400_000;
const FOREVER: CachePolicy = { textMaxAgeMs: null, imageMaxAgeMs: null, cacheVideo: false };

const PROVIDER_HOWTO: ProviderHowTo = {
  externalId: 'sq',
  steps: ['Provider step one', 'Provider step two'],
  muscles: 'Quads',
  media: [
    { kind: 'image', url: 'https://p.example.org/media/sq.png' },
    { kind: 'video', url: 'https://p.example.org/media/sq.mp4' },
  ],
  credit: { line: 'Instructions from P', licence: 'CC-BY-SA 4', author: 'someone' },
};

const BUNDLED: HowTo = { exerciseId: 'back-squat', muscles: 'Legs', mediaNote: '', steps: ['Bundled step'], fault: 'Knees in' };
const USER = { steps: ['My own cue'] };

const CONNECTION: ProviderConnection = { providerId: 'p', connectedAt: T0, cachingAllowed: false, rank: 0 };
const confirmed: ContentLink = { providerId: 'p', exerciseId: 'back-squat', externalId: 'sq', status: 'confirmed', method: 'manual', at: T0 };

function fakeProvider(overrides: Partial<ContentProvider> = {}): ContentProvider {
  return {
    id: 'p',
    name: 'P',
    auth: { kind: 'none' },
    capabilities: { search: true, steps: true, images: true, video: true },
    apiHosts: ['p.example.org'],
    mediaHosts: ['p.example.org'],
    cachePolicy: () => FOREVER,
    test: async () => ({ ok: true }),
    search: async () => [],
    fetchHowTo: vi.fn(async () => PROVIDER_HOWTO),
    ...overrides,
  };
}

function input(over: Partial<ResolveInput> & { provider?: ContentProvider; link?: ContentLink | null } = {}): ResolveInput {
  const provider = over.provider ?? fakeProvider();
  const link = over.link === undefined ? confirmed : over.link;
  return {
    exerciseId: 'back-squat',
    userCues: null,
    seeded: BUNDLED,
    loadBundled: vi.fn(async () => BUNDLED),
    candidates: [{ connection: CONNECTION, name: 'P', ...(link ? { link } : {}) }],
    loadProvider: vi.fn(async () => provider),
    online: () => true,
    now: () => T0,
    ...over,
  };
}

let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  await db.delete();
  await db.open();
  resetBackoff();
  fetchSpy = vi.fn(async () => new Response('{}'));
  vi.stubGlobal('fetch', fetchSpy);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('the user\'s own cues win', () => {
  it('returns them synchronously and reads neither the provider cache nor the network', async () => {
    const readSpy = vi.spyOn(db.contentCache, 'get');
    const args = input({ userCues: USER, link: null });
    const result = resolveHowTo(args);
    expect(result.first).toMatchObject({ text: USER, textSource: 'user', loading: false });
    expect(await result.done).toBe(result.first);
    expect(readSpy).not.toHaveBeenCalled();
    expect(args.loadBundled).not.toHaveBeenCalled();
    expect(args.loadProvider).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('even with a linked provider online, the text stays theirs and nothing is fetched', async () => {
    const provider = fakeProvider();
    const result = resolveHowTo(input({ userCues: USER, provider }));
    expect(result.first.text).toEqual(USER);
    const done = await result.done;
    expect(done.text).toEqual(USER);
    expect(done.textSource).toBe('user');
    expect(provider.fetchHowTo).not.toHaveBeenCalled();
  });

  it('shows a saved provider image beside them, credited to the provider for the image only', async () => {
    const row = cacheRowFor('p', PROVIDER_HOWTO, FOREVER, T0)!;
    await writeCache({ ...row, imageUrl: PROVIDER_HOWTO.media[0]!.url, imageExpiresAt: null });
    const done = await resolveHowTo(input({ userCues: USER, online: () => false })).done;
    expect(done.text).toEqual(USER);
    expect(done.textCredit).toBeUndefined();
    expect(done.media.map((m) => m.kind)).toEqual(['image']);
    expect(done.mediaCredit?.line).toBe('Instructions from P');
  });
});

describe('only a confirmed link supplies content', () => {
  it('a suggested link supplies nothing; the same link confirmed does', async () => {
    const provider = fakeProvider();
    const suggested = { ...confirmed, status: 'suggested' as const };
    const before = await resolveHowTo(input({ provider, link: suggested })).done;
    expect(before.textSource).toBe('bundled');
    expect(provider.fetchHowTo).not.toHaveBeenCalled();

    const after = await resolveHowTo(input({ provider, link: confirmed })).done;
    expect(after.textSource).toBe('provider');
    expect(after.text?.steps).toEqual(PROVIDER_HOWTO.steps);
    expect(after.textCredit?.licence).toBe('CC-BY-SA 4');
  });

  it('a connected provider without a link says so, quietly', () => {
    const result = resolveHowTo(input({ link: null }));
    expect(result.first.status).toEqual({ kind: 'not-linked', providerId: 'p', providerName: 'P' });
    expect(result.first.textSource).toBe('bundled');
  });
});

describe('what is on screen while the network is consulted', () => {
  it('shows bundled cues at once, "Checking", then the provider\'s, and saves them', async () => {
    const updates: ResolvedHowTo[] = [];
    const result = resolveHowTo(input(), (next) => updates.push(next));
    expect(result.first).toMatchObject({ textSource: 'bundled', loading: false });
    const done = await result.done;
    expect(updates.some((u) => u.status.kind === 'checking' && u.textSource === 'bundled' && !u.loading)).toBe(true);
    expect(done.textSource).toBe('provider');
    expect(await db.contentCache.get(['p', 'sq'])).toBeDefined();
    // Saved, so it will be there offline too.
    expect(done.onlineOnly).toBeUndefined();
  });

  it('keeps bundled cues and says so when the provider cannot be reached', async () => {
    const provider = fakeProvider({ fetchHowTo: vi.fn(async () => null) });
    const done = await resolveHowTo(input({ provider })).done;
    expect(done.textSource).toBe('bundled');
    expect(done.status).toEqual({ kind: 'unreachable', providerName: 'P' });
    expect(statusSentence(done.status)).toBe("Couldn't reach P — showing Bompa's cues.");
  });

  it('with nothing to show and a provider that never answers, loading ends within eight seconds in a sentence', async () => {
    vi.useFakeTimers();
    const provider = fakeProvider({ fetchHowTo: vi.fn(() => new Promise<ProviderHowTo | null>(() => {})) });
    const result = resolveHowTo(input({ provider, seeded: null, loadBundled: async () => null }));
    expect(result.first.loading).toBe(true);
    await vi.advanceTimersByTimeAsync(FETCH_TIMEOUT_MS);
    const done = await result.done;
    expect(done.loading).toBe(false);
    expect(done.status.kind).toBe('unavailable');
    expect(statusSentence(done.status)).toBe("Couldn't reach P, and Bompa has no cues of its own for this movement.");
  });
});

describe('offline', () => {
  it('a saved, fresh copy shows exactly as it would online, without a request', async () => {
    const provider = fakeProvider();
    await writeCache(cacheRowFor('p', PROVIDER_HOWTO, FOREVER, T0)!);
    const done = await resolveHowTo(input({ provider, online: () => false })).done;
    expect(done.textSource).toBe('provider');
    expect(done.textCredit?.line).toBe('Instructions from P');
    expect(done.onlineOnly).toBeUndefined();
    // Video only ever plays online, and this image was never saved.
    expect(done.media).toEqual([]);
    expect(provider.fetchHowTo).not.toHaveBeenCalled();
  });

  it('never downloaded: bundled cues and the sentence saying so, with no loading state', async () => {
    const result = resolveHowTo(input({ online: () => false }));
    expect(result.first.loading).toBe(false);
    const done = await result.done;
    expect(done.textSource).toBe('bundled');
    expect(done.status).toEqual({ kind: 'not-downloaded', providerName: 'P' });
    expect(statusSentence(done.status)).toMatch(/haven't been downloaded yet/);
  });

  it('an expired copy is not shown, even offline', async () => {
    const policy = { ...FOREVER, textMaxAgeMs: DAY };
    const provider = fakeProvider({ cachePolicy: () => policy });
    await writeCache(cacheRowFor('p', PROVIDER_HOWTO, policy, T0)!);
    const done = await resolveHowTo(input({ provider, online: () => false, now: () => T0 + 2 * DAY })).done;
    expect(done.textSource).toBe('bundled');
    expect(done.status).toEqual({ kind: 'expired', providerName: 'P' });
  });

  it('a plan that forbids saving: shown online and never written, then the reason offline', async () => {
    const provider = fakeProvider({ cachePolicy: () => ({ ...FOREVER, textMaxAgeMs: 0, imageMaxAgeMs: 0 }) });
    const online = await resolveHowTo(input({ provider })).done;
    expect(online.textSource).toBe('provider');
    // Said, so the sheet does not promise it offline.
    expect(online.onlineOnly).toBe(true);
    expect(await db.contentCache.count()).toBe(0);

    const offline = await resolveHowTo(input({ provider, online: () => false })).done;
    expect(offline.status).toEqual({ kind: 'no-storage', providerName: 'P' });
  });
});

describe('with no provider connected', () => {
  it('nothing leaves the device', async () => {
    const seededOnly = resolveHowTo(input({ candidates: [] }));
    expect(seededOnly.first.textSource).toBe('bundled');
    await seededOnly.done;

    const loadBundled = vi.fn(async () => BUNDLED);
    const ingested = await resolveHowTo(input({ candidates: [], seeded: null, loadBundled })).done;
    expect(ingested.textSource).toBe('bundled');
    expect(loadBundled).toHaveBeenCalledTimes(1);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────

describe('download for offline', () => {
  const links = ['sq', 'bp', 'dl'].map((externalId, i) => ({ ...confirmed, exerciseId: `lift-${i}`, externalId }));

  /** An adapter that really goes through the network helper, so a 429 behaves as it would. */
  function networkProvider(policy: CachePolicy = FOREVER): ContentProvider {
    const provider = fakeProvider({ cachePolicy: () => policy });
    provider.fetchHowTo = async (externalId, ctx) => {
      const result = await providerFetch(provider, `https://p.example.org/api/${externalId}`, ctx);
      if (!result.ok) return null;
      const body = (await readJson(result.response)) as { steps?: string[] } | undefined;
      return { ...PROVIDER_HOWTO, externalId, media: [{ kind: 'image', url: `https://p.example.org/media/${externalId}.png` }], steps: body?.steps ?? ['x'] };
    };
    return provider;
  }

  it('saves each how-to one at a time and reports progress', async () => {
    fetchSpy.mockImplementation(async () => new Response(JSON.stringify({ steps: ['Go'] })));
    const progress: number[] = [];
    const run = await downloadContent({
      provider: networkProvider(),
      connection: CONNECTION,
      links,
      now: () => T0,
      signal: new AbortController().signal,
      onProgress: (done) => progress.push(done),
    });
    expect(run).toMatchObject({ done: 3, total: 3 });
    expect(progress).toEqual([0, 1, 2, 3]);
    expect(await db.contentCache.count()).toBe(3);
  });

  it('stops at a 429', async () => {
    fetchSpy
      .mockResolvedValueOnce(new Response(JSON.stringify({ steps: ['Go'] })))
      .mockResolvedValueOnce(new Response('', { status: 429 }));
    const run = await downloadContent({ provider: networkProvider(), connection: CONNECTION, links, now: () => T0, signal: new AbortController().signal });
    expect(run).toMatchObject({ done: 1, total: 3, stoppedBy: 'quota' });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('saves nothing when the plan allows no storage', async () => {
    const run = await downloadContent({
      provider: networkProvider({ ...FOREVER, textMaxAgeMs: 0 }),
      connection: CONNECTION,
      links,
      now: () => T0,
      signal: new AbortController().signal,
    });
    expect(run.stoppedBy).toBe('not-allowed');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('ignores suggestions and saves one image per entry with its own expiry', async () => {
    const saved = new Map<string, Response>();
    vi.stubGlobal('caches', {
      open: async (name: string) => {
        expect(name).toBe(CONTENT_BUCKET);
        return { put: async (url: string, r: Response) => void saved.set(url, r), delete: async () => true, keys: async () => [] };
      },
    });
    fetchSpy.mockImplementation(async () => new Response(JSON.stringify({ steps: ['Go'] })));
    const nextMonday = Date.UTC(2026, 8, 21);
    const policy: CachePolicy = { textMaxAgeMs: 7 * DAY, imageMaxAgeMs: 7 * DAY, expireBefore: () => nextMonday, cacheVideo: false };
    const run = await downloadContent({
      provider: networkProvider(policy),
      connection: CONNECTION,
      links: [links[0]!, { ...links[1]!, status: 'suggested' }],
      now: () => T0,
      signal: new AbortController().signal,
    });
    expect(run).toMatchObject({ done: 1, total: 1, images: 1 });
    expect([...saved.keys()]).toEqual(['https://p.example.org/media/sq.png']);
    expect(await db.contentCache.get(['p', 'sq'])).toMatchObject({ imageExpiresAt: nextMonday, expiresAt: nextMonday });
  });
});
