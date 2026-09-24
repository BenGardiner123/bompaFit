import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db';
import type { ContentCacheRow, ContentLink, ProviderHowTo } from '@/lib/types';
import type { CachePolicy } from './provider';
import {
  CONTENT_BUCKET,
  cacheRowFor,
  countCached,
  deleteConnection,
  deleteLink,
  expiryFor,
  readCache,
  recordImage,
  saveImage,
  sweepExpired,
  writeCache,
} from './store';

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 8, 20, 10); // a Sunday

const howTo = (externalId: string): ProviderHowTo => ({
  externalId,
  steps: ['Brace', 'Stand up'],
  media: [{ kind: 'image', url: `https://media.example.org/${externalId}.png` }],
  credit: { line: 'Instructions from P' },
});

const FOREVER: CachePolicy = { textMaxAgeMs: null, imageMaxAgeMs: null, cacheVideo: false };

/** A stand-in for the browser's Cache Storage, enough to see what is saved and deleted. */
function fakeCaches() {
  const buckets = new Map<string, Map<string, Response>>();
  const open = async (name: string) => {
    if (!buckets.has(name)) buckets.set(name, new Map());
    const bucket = buckets.get(name)!;
    return {
      put: async (url: string, response: Response) => void bucket.set(url, response),
      delete: async (request: string | { url: string }) => bucket.delete(typeof request === 'string' ? request : request.url),
      keys: async () => [...bucket.keys()].map((url) => ({ url })),
    };
  };
  return { api: { open }, saved: (name = CONTENT_BUCKET) => [...(buckets.get(name)?.keys() ?? [])] };
}

let bucket: ReturnType<typeof fakeCaches>;

beforeEach(async () => {
  await db.delete();
  await db.open();
  bucket = fakeCaches();
  vi.stubGlobal('caches', bucket.api);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function withImage(row: ContentCacheRow, imageExpiresAt: number | null = null) {
  await writeCache(row);
  const url = row.howTo.media[0]!.url;
  await saveImage(url, new Response('png'));
  await recordImage(row.providerId, row.externalId, url, imageExpiresAt);
  return url;
}

describe('expiry is fixed when content is written', () => {
  it('no limit means no expiry', () => {
    expect(expiryFor(null, FOREVER, T0)).toBeNull();
  });

  it('a duration counts from when it was fetched', () => {
    expect(expiryFor(7 * DAY, FOREVER, T0)).toBe(T0 + 7 * DAY);
  });

  it('a calendar boundary wins when it comes first', () => {
    const monday = Date.UTC(2026, 8, 21);
    const policy: CachePolicy = { ...FOREVER, expireBefore: () => monday };
    expect(expiryFor(7 * DAY, policy, T0)).toBe(monday);
    expect(expiryFor(null, policy, T0)).toBe(monday);
  });

  it('terms that allow no storage produce no row at all', () => {
    expect(cacheRowFor('p', howTo('a'), { ...FOREVER, textMaxAgeMs: 0 }, T0)).toBeNull();
    expect(cacheRowFor('p', howTo('a'), FOREVER, T0)).toMatchObject({ expiresAt: null, fetchedAt: T0 });
  });
});

describe('an expired copy is never shown', () => {
  it('is deleted by the sweep and not returned by a read, with the clock advanced and no network', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const row = cacheRowFor('p', howTo('a'), { ...FOREVER, textMaxAgeMs: DAY }, T0)!;
    await withImage(row);
    await writeCache(cacheRowFor('p', howTo('kept'), FOREVER, T0)!);

    expect(await readCache('p', 'a', T0 + DAY - 1)).toMatchObject({ kind: 'fresh' });
    expect(await sweepExpired(T0 + DAY)).toBe(1);
    expect(await readCache('p', 'a', T0 + DAY)).toEqual({ kind: 'missing' });
    expect(await db.contentCache.count()).toBe(1);
    expect(bucket.saved()).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('a read past expiry deletes the row itself, even if no sweep has run', async () => {
    await writeCache(cacheRowFor('p', howTo('a'), { ...FOREVER, textMaxAgeMs: DAY }, T0)!);
    expect(await readCache('p', 'a', T0 + 2 * DAY)).toEqual({ kind: 'expired' });
    expect(await db.contentCache.count()).toBe(0);
  });

  it('a picture can expire before its words', async () => {
    const row = cacheRowFor('p', howTo('a'), FOREVER, T0)!;
    await withImage(row, T0 + DAY);
    const read = await readCache('p', 'a', T0 + DAY);
    expect(read.kind).toBe('fresh');
    expect(read.kind === 'fresh' && read.row.imageUrl).toBeFalsy();
    expect(bucket.saved()).toEqual([]);
  });

  it('the sweep removes a saved image nothing points at any more', async () => {
    await saveImage('https://media.example.org/orphan.png', new Response('png'));
    await sweepExpired(T0);
    expect(bucket.saved()).toEqual([]);
  });
});

describe('unlinking and disconnecting', () => {
  const link = (exerciseId: string, externalId: string): ContentLink => ({
    providerId: 'p',
    exerciseId,
    externalId,
    status: 'confirmed',
    method: 'manual',
    at: T0,
  });

  it('unlinking deletes that movement\'s content, unless another movement still uses the entry', async () => {
    await db.contentLinks.bulkPut([link('back-squat', 'sq'), link('high-bar-squat', 'sq'), link('bench', 'bp')]);
    await writeCache(cacheRowFor('p', howTo('sq'), FOREVER, T0)!);
    const benchImage = await withImage(cacheRowFor('p', howTo('bp'), FOREVER, T0)!);

    await deleteLink('p', 'back-squat');
    expect(await db.contentCache.get(['p', 'sq'])).toBeDefined();

    await deleteLink('p', 'high-bar-squat');
    expect(await db.contentCache.get(['p', 'sq'])).toBeUndefined();

    await deleteLink('p', 'bench');
    expect(await db.contentCache.count()).toBe(0);
    expect(bucket.saved()).not.toContain(benchImage);
    expect(await db.contentLinks.count()).toBe(0);
  });

  it('disconnecting deletes the key, the text and the images, and keeps the links', async () => {
    await db.providerConnections.put({ providerId: 'p', connectedAt: T0, apiKey: 'secret', cachingAllowed: true, rank: 0 });
    await db.providerConnections.put({ providerId: 'q', connectedAt: T0, cachingAllowed: true, rank: 1 });
    await db.contentLinks.put(link('bench', 'bp'));
    await withImage(cacheRowFor('p', howTo('bp'), FOREVER, T0)!);
    await writeCache(cacheRowFor('q', howTo('other'), FOREVER, T0)!);
    expect(await countCached('p')).toEqual({ text: 1, images: 1 });

    await deleteConnection('p');
    expect(await db.providerConnections.get('p')).toBeUndefined();
    expect(await db.providerConnections.get('q')).toBeDefined();
    expect(await countCached('p')).toEqual({ text: 0, images: 0 });
    expect(await countCached('q')).toEqual({ text: 1, images: 0 });
    expect(bucket.saved()).toEqual([]);
    expect(await db.contentLinks.count()).toBe(1);
  });

  it('can also forget the links when asked', async () => {
    await db.contentLinks.put(link('bench', 'bp'));
    await deleteConnection('p', { forgetLinks: true });
    expect(await db.contentLinks.count()).toBe(0);
  });

  it('never writes to the sync queue', async () => {
    await db.contentLinks.put(link('bench', 'bp'));
    await deleteLink('p', 'bench');
    await deleteConnection('p');
    expect(await db.syncQueue.count()).toBe(0);
  });
});

describe('without Cache Storage', () => {
  it('saving an image reports failure instead of throwing', async () => {
    vi.unstubAllGlobals();
    vi.stubGlobal('caches', undefined);
    expect(await saveImage('https://media.example.org/a.png', new Response('png'))).toBe(false);
  });
});
