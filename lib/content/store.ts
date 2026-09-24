// Links, cached content and connections, on the device.
//
// Nothing in here goes through the sync queue. The queue is the payload a sync
// feature would one day upload, and an API key or a provider's content in it
// would one day be sent somewhere. One rule — these tables are local — is
// easier to keep than a split.

import { db } from '@/lib/db';
import type { ContentCacheRow, ContentLink, ProviderConnection, ProviderHowTo } from '@/lib/types';
import type { CachePolicy } from './provider';

/**
 * The Cache Storage bucket for saved images. The service worker never deletes
 * a cache whose name starts `bompa-content-`, and serves cross-origin images
 * from it; the `-v1` lets a future format move on and delete this one on
 * purpose.
 */
export const CONTENT_BUCKET = 'bompa-content-v1';

// ─────────────────────────────────────────────────────────────
// Links
// ─────────────────────────────────────────────────────────────

export function readLinks(): Promise<ContentLink[]> {
  return db.contentLinks.toArray();
}

export async function putLinks(links: ContentLink[]): Promise<void> {
  if (links.length) await db.contentLinks.bulkPut(links);
}

/**
 * Remove a link and the content it brought. The cached entry is kept only
 * while another movement is still confirmed to the same entry — two Bompa
 * movements can reasonably share one provider page.
 */
export async function deleteLink(providerId: string, exerciseId: string): Promise<void> {
  const image = await db.transaction('rw', db.contentLinks, db.contentCache, async () => {
    const link = await db.contentLinks.get([providerId, exerciseId]);
    await db.contentLinks.delete([providerId, exerciseId]);
    if (!link?.externalId) return undefined;
    const stillUsed = await db.contentLinks
      .where('providerId')
      .equals(providerId)
      .filter((other) => other.externalId === link.externalId && other.status === 'confirmed')
      .count();
    if (stillUsed > 0) return undefined;
    const row = await db.contentCache.get([providerId, link.externalId]);
    await db.contentCache.delete([providerId, link.externalId]);
    return row?.imageUrl;
  });
  if (image) await deleteImages([image]);
}

// ─────────────────────────────────────────────────────────────
// Connections
// ─────────────────────────────────────────────────────────────

export function readConnections(): Promise<ProviderConnection[]> {
  return db.providerConnections.orderBy('providerId').toArray();
}

export async function putConnection(connection: ProviderConnection): Promise<void> {
  await db.providerConnections.put(connection);
}

/**
 * Disconnect: the key, the cached text and the saved images go, in one
 * transaction for the rows — deleted, not marked disabled. Links stay unless
 * asked, because they are the user's own work and reveal nothing.
 */
export async function deleteConnection(providerId: string, opts: { forgetLinks?: boolean } = {}): Promise<void> {
  const images = await db.transaction('rw', db.providerConnections, db.contentCache, db.contentLinks, async () => {
    const rows = await db.contentCache.where('providerId').equals(providerId).toArray();
    await db.providerConnections.delete(providerId);
    await db.contentCache.where('providerId').equals(providerId).delete();
    if (opts.forgetLinks) await db.contentLinks.where('providerId').equals(providerId).delete();
    return rows.map((row) => row.imageUrl).filter((url): url is string => Boolean(url));
  });
  await deleteImages(images);
}

// ─────────────────────────────────────────────────────────────
// Cached content
// ─────────────────────────────────────────────────────────────

/** Earliest of a duration and a calendar boundary; null when neither applies. */
export function expiryFor(maxAgeMs: number | null, policy: CachePolicy, fetchedAt: number): number | null {
  const candidates: number[] = [];
  if (maxAgeMs !== null) candidates.push(fetchedAt + maxAgeMs);
  // The boundary bounds everything, text included: the stored row carries the
  // provider's media links, and those stop working at the boundary.
  if (policy.expireBefore) candidates.push(policy.expireBefore(fetchedAt));
  return candidates.length ? Math.min(...candidates) : null;
}

/**
 * The row to store for freshly fetched content, or null when the provider's
 * terms do not allow keeping it. Expiry is fixed here, at write time, from
 * the terms as they stood when it was fetched.
 */
export function cacheRowFor(providerId: string, howTo: ProviderHowTo, policy: CachePolicy, fetchedAt: number): ContentCacheRow | null {
  if (policy.textMaxAgeMs === 0) return null;
  return {
    providerId,
    externalId: howTo.externalId,
    howTo,
    fetchedAt,
    expiresAt: expiryFor(policy.textMaxAgeMs, policy, fetchedAt),
  };
}

export async function writeCache(row: ContentCacheRow): Promise<void> {
  await db.contentCache.put(row);
}

export type CacheRead = { kind: 'fresh'; row: ContentCacheRow } | { kind: 'expired' } | { kind: 'missing' };

/**
 * Read one cached entry. An expired row is deleted on the spot and reported
 * as expired, never returned: the terms say it must be gone, and "the phone
 * was offline" does not change that.
 */
export async function readCache(providerId: string, externalId: string, now: number): Promise<CacheRead> {
  const row = await db.contentCache.get([providerId, externalId]);
  if (!row) return { kind: 'missing' };
  if (row.expiresAt !== null && row.expiresAt <= now) {
    await db.contentCache.delete([providerId, externalId]);
    if (row.imageUrl) await deleteImages([row.imageUrl]);
    return { kind: 'expired' };
  }
  if (row.imageUrl && row.imageExpiresAt != null && row.imageExpiresAt <= now) {
    // The text may outlive its picture — terms often allow keeping words longer
    // than media.
    const { imageUrl, ...rest } = row;
    const trimmed: ContentCacheRow = { ...rest, imageExpiresAt: null };
    await db.contentCache.put(trimmed);
    await deleteImages([imageUrl]);
    return { kind: 'fresh', row: trimmed };
  }
  return { kind: 'fresh', row };
}

/**
 * Delete everything past its expiry. Run on hydration, before anything could
 * be shown, and cheap: `expiresAt` is indexed and rows with no limit are left
 * out of the index entirely.
 */
export async function sweepExpired(now: number): Promise<number> {
  const { removed, images } = await db.transaction('rw', db.contentCache, async () => {
    const expired = await db.contentCache.where('expiresAt').belowOrEqual(now).toArray();
    await db.contentCache.bulkDelete(expired.map((row) => [row.providerId, row.externalId] as [string, string]));
    const urls = expired.map((row) => row.imageUrl).filter((url): url is string => Boolean(url));

    const staleImages = await db.contentCache
      .filter((row) => Boolean(row.imageUrl) && row.imageExpiresAt != null && row.imageExpiresAt <= now)
      .toArray();
    for (const row of staleImages) {
      urls.push(row.imageUrl as string);
      const { imageUrl: _dropped, ...rest } = row;
      void _dropped;
      await db.contentCache.put({ ...rest, imageExpiresAt: null });
    }
    return { removed: expired.length, images: urls };
  });
  await deleteImages(images);
  await pruneOrphanImages();
  return removed;
}

/**
 * Remove any saved image no stored row points at. An image delete can fail
 * after its row is already gone; this is what stops such an image lingering
 * past the terms it was saved under.
 */
async function pruneOrphanImages(): Promise<void> {
  if (!bucketAvailable()) return;
  try {
    const bucket = await caches.open(CONTENT_BUCKET);
    const saved = await bucket.keys();
    if (saved.length === 0) return;
    const wanted = new Set((await db.contentCache.toArray()).map((row) => row.imageUrl).filter(Boolean));
    await Promise.all(saved.filter((request) => !wanted.has(request.url)).map((request) => bucket.delete(request)));
  } catch {
    /* storage unavailable; nothing is being shown from it either */
  }
}

/** For "Saved: 18 instructions, 15 images". */
export async function countCached(providerId: string): Promise<{ text: number; images: number }> {
  const rows = await db.contentCache.where('providerId').equals(providerId).toArray();
  return { text: rows.length, images: rows.filter((row) => row.imageUrl).length };
}

// ─────────────────────────────────────────────────────────────
// Images
// ─────────────────────────────────────────────────────────────

function bucketAvailable(): boolean {
  return typeof caches !== 'undefined';
}

/** Store an image response under its own URL, so an <img> for that URL finds it offline. */
export async function saveImage(url: string, response: Response): Promise<boolean> {
  if (!bucketAvailable()) return false;
  try {
    const bucket = await caches.open(CONTENT_BUCKET);
    await bucket.put(url, response);
    return true;
  } catch {
    // Quota exceeded or storage blocked. The image simply isn't available
    // offline; the text still is.
    return false;
  }
}

export async function deleteImages(urls: string[]): Promise<void> {
  if (!bucketAvailable() || urls.length === 0) return;
  try {
    const bucket = await caches.open(CONTENT_BUCKET);
    await Promise.all(urls.map((url) => bucket.delete(url)));
  } catch {
    /* the next sweep's orphan check removes whatever this could not */
  }
}

export async function recordImage(providerId: string, externalId: string, imageUrl: string, imageExpiresAt: number | null): Promise<void> {
  await db.contentCache.update([providerId, externalId], { imageUrl, imageExpiresAt });
}
