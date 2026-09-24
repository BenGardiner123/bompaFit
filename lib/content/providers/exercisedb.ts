// ExerciseDB v2, sold by AscendAPI through RapidAPI.
//
// The user brings their own RapidAPI key. What comes back is their licensed
// access, not open content: there is no licence to show and nothing here may
// be redistributed, so the credit line names the service and nothing more.
//
// Where the shapes below come from. Endpoint paths, headers and response
// fields were read from AscendAPI's published documentation on 2026-09-24 —
// the OpenAPI spec (docs.ascendapi.com/api-reference/exercisedb-v2/exercisedb-v2.json),
// the product overview (docs.ascendapi.com/products/edb-v2/overview.md), the
// caching guide (docs.ascendapi.com/guides/caching.md) and the errors page.
// They were NOT checked against a live response, because that needs a key.
// Worth knowing when re-recording the fixtures:
//
// - v2 really does live under /api/v1/... on the v2 RapidAPI host. The version
//   in the path is the API's, the v2 is the dataset's.
// - The quota header name is an assumption. RapidAPI's gateway conventionally
//   sends `x-ratelimit-requests-remaining`; the design's CORS probe saw
//   `x-ratelimit-remaining` exposed. Both are read; neither is required.
// - The gateway answers 401 (bad key), 403 (not subscribed) and 429 (quota)
//   itself, with a body the docs do not describe, so only the status is used.

import { providerFetch, readJson } from '../fetcher';
import { MAX_ID_CHARS, clampHowTo, type CachePolicy, type ContentProvider, type ExternalMatch, type ProviderContext, type ProviderHowTo, type ProviderMedia, type TestResult } from '../provider';

export const EXERCISEDB_HOST = 'edb-with-videos-and-images-by-ascendapi.p.rapidapi.com';
/** Where AscendAPI serves pictures and clips. Reached without the key. */
export const EXERCISEDB_MEDIA_HOST = 'cdn.exercisedb.dev';
const BASE = `https://${EXERCISEDB_HOST}/api/v1`;
const LISTING_URL = 'https://rapidapi.com/ascendapi/api/edb-with-videos-and-images-by-ascendapi';

/** Documented maximum is 25; ten is plenty for the matcher and costs the same one call. */
const SEARCH_LIMIT = 10;

const DAY_MS = 86_400_000;
/** AscendAPI recommends seven days or longer for text; seven is the conservative end. */
export const TEXT_MAX_AGE_MS = 7 * DAY_MS;

// Ids look like `exr_41n2hxnFMotsXTj3`. Anything else is not one of theirs,
// and refusing it here means a hand-edited link cannot smuggle a path or a
// query string into the request.
const ID_PATTERN = /^[A-Za-z0-9_-]+$/;

/**
 * The first Monday 00:00 UTC strictly after `at`.
 *
 * AscendAPI rotates every media link at that moment, and a plan that allows
 * caching must still let go of them before it. Strictly after, so something
 * fetched at exactly midnight on a Monday gets the whole week rather than
 * expiring on arrival. UTC arithmetic, so no daylight-saving hour can shift it.
 */
export function nextMondayUtc(at: number): number {
  const d = new Date(at);
  const midnight = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  // getUTCDay: Sunday 0 … Saturday 6. On a Monday this is 0, meaning "next week".
  const daysAhead = (8 - d.getUTCDay()) % 7 || 7;
  return midnight + daysAhead * DAY_MS;
}

/**
 * The user's answer to "Does your plan allow caching?" decides everything.
 * No (the default) means nothing is written down at all — AscendAPI: "you must
 * not store any data returned by the API".
 */
export function exercisedbCachePolicy(connection: { cachingAllowed: boolean }): CachePolicy {
  if (!connection.cachingAllowed) {
    return { textMaxAgeMs: 0, imageMaxAgeMs: 0, cacheVideo: false };
  }
  return {
    textMaxAgeMs: TEXT_MAX_AGE_MS,
    // The Monday boundary below always comes first; the week is a backstop.
    imageMaxAgeMs: TEXT_MAX_AGE_MS,
    expireBefore: nextMondayUtc,
    cacheVideo: false,
  };
}

// ─────────────────────────────────────────────────────────────
// Reading their JSON without trusting it
// ─────────────────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.map(str).filter((s): s is string => s !== undefined) : [];
}

// The docs show both "BARBELL" and "Barbell" for the same field. Shouting
// looks wrong on the sheet, so upper-case-only values are softened; anything
// already mixed-case is left as they wrote it.
function tidy(label: string): string {
  if (label !== label.toUpperCase() || !/[A-Z]/.test(label)) return label;
  return label.toLowerCase().replace(/(^|[\s-])([a-z])/g, (_, lead: string, ch: string) => lead + ch.toUpperCase());
}

/**
 * A media URL, kept only when it is https on the media host. Anything else in
 * an answer would have the phone fetch a picture from a host nobody declared,
 * telling it the user's address.
 */
function mediaUrl(value: unknown): string | undefined {
  const raw = str(value);
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' && exercisedb.mediaHosts.includes(url.host) ? raw : undefined;
  } catch {
    return undefined;
  }
}

function toMatch(item: unknown): ExternalMatch | null {
  if (!isRecord(item)) return null;
  const externalId = str(item.exerciseId);
  const name = str(item.name);
  if (!externalId || !name || !ID_PATTERN.test(externalId) || externalId.length > MAX_ID_CHARS) return null;
  const equipment = strings(item.equipments)[0];
  const muscle = strings(item.targetMuscles)[0];
  const thumbUrl = mediaUrl(item.imageUrl);
  return {
    externalId,
    name,
    ...(equipment ? { equipment: tidy(equipment) } : {}),
    ...(muscle ? { muscle: tidy(muscle) } : {}),
    ...(thumbUrl ? { thumbUrl } : {}),
  };
}

function toMedia(data: Record<string, unknown>): ProviderMedia[] {
  const sizes = isRecord(data.imageUrls) ? data.imageUrls : {};
  // One still image, the size the sheet shows best. The download step saves
  // the first image only, so a 1080p first would spend storage for nothing.
  // `gifUrl` is v1's field; harmless to read if a v2 entry ever carries it.
  const image = mediaUrl(sizes['720p']) ?? mediaUrl(data.imageUrl) ?? mediaUrl(sizes['480p']) ?? mediaUrl(sizes['1080p']) ?? mediaUrl(sizes['360p']) ?? mediaUrl(data.gifUrl);
  const video = mediaUrl(data.videoUrl);
  return [...(image ? [{ kind: 'image' as const, url: image }] : []), ...(video ? [{ kind: 'video' as const, url: video }] : [])];
}

function toHowTo(externalId: string, data: Record<string, unknown>): ProviderHowTo | null {
  const muscles = [...new Set([...strings(data.targetMuscles), ...strings(data.secondaryMuscles)].map(tidy))].join(', ');
  return clampHowTo({
    externalId,
    steps: strings(data.instructions),
    ...(muscles ? { muscles } : {}),
    media: toMedia(data),
    credit: { line: 'ExerciseDB via RapidAPI', url: LISTING_URL },
  });
}

function quotaFrom(headers: Headers): number | undefined {
  const raw = headers.get('x-ratelimit-requests-remaining') ?? headers.get('x-ratelimit-remaining');
  if (raw === null) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : undefined;
}

// ─────────────────────────────────────────────────────────────
// The adapter
// ─────────────────────────────────────────────────────────────

export const exercisedb: ContentProvider = {
  id: 'exercisedb',
  name: 'ExerciseDB',
  auth: {
    kind: 'apiKey',
    headerName: 'X-RapidAPI-Key',
    // Required by RapidAPI on every request; it names the API, it is not a secret.
    extraHeaders: { 'X-RapidAPI-Host': EXERCISEDB_HOST },
    helpUrl: LISTING_URL,
  },
  capabilities: { search: true, steps: true, images: true, video: true },
  // The key goes to the gateway and nowhere else. Pictures and clips come
  // from the CDN, which is never sent the key — not when an <img> shows one,
  // and not when one is saved for offline.
  apiHosts: [EXERCISEDB_HOST],
  mediaHosts: [EXERCISEDB_MEDIA_HOST],
  cachePolicy: exercisedbCachePolicy,

  async test(ctx: ProviderContext): Promise<TestResult> {
    // The liveness route is the cheapest authenticated call: one request, no
    // exercise data, and the gateway still checks the key and subscription.
    const outcome = await providerFetch(exercisedb, `${BASE}/liveness`, ctx);
    if (!outcome.ok) return { ok: false, reason: outcome.reason, ...(outcome.detail ? { detail: outcome.detail } : {}) };
    const body = await readJson(outcome.response);
    if (!isRecord(body)) return { ok: false, reason: 'unexpected', detail: 'not JSON' };
    const quotaRemaining = quotaFrom(outcome.response.headers);
    return quotaRemaining === undefined ? { ok: true } : { ok: true, quotaRemaining };
  },

  async search(query: string, ctx: ProviderContext): Promise<ExternalMatch[]> {
    const q = query.trim();
    if (!q || q.length > MAX_ID_CHARS) return [];
    // The filter route rather than /exercises/search: both match names
    // fuzzily, but only this one returns equipment and muscles, which the
    // matcher scores on.
    const url = `${BASE}/exercises?name=${encodeURIComponent(q)}&limit=${SEARCH_LIMIT}`;
    const outcome = await providerFetch(exercisedb, url, ctx);
    if (!outcome.ok) return [];
    const body = await readJson(outcome.response);
    if (!isRecord(body) || !Array.isArray(body.data)) return [];
    return body.data.map(toMatch).filter((m): m is ExternalMatch => m !== null);
  },

  async fetchHowTo(externalId: string, ctx: ProviderContext): Promise<ProviderHowTo | null> {
    if (!ID_PATTERN.test(externalId) || externalId.length > MAX_ID_CHARS) return null;
    const outcome = await providerFetch(exercisedb, `${BASE}/exercises/${encodeURIComponent(externalId)}`, ctx);
    if (!outcome.ok) return null;
    const body = await readJson(outcome.response);
    if (!isRecord(body) || !isRecord(body.data)) return null;
    return toHowTo(externalId, body.data);
  },
};
