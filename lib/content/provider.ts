// The shape every exercise-content adapter implements.
//
// An adapter is the small piece of code that knows how to talk to one service
// and turn its answers into Bompa's shape. Bompa ships adapters, never the
// content: instructions and pictures come from the user's own account, fetched
// to their own device.
//
// Two rules the types cannot express:
//
// - An adapter never throws for an ordinary failure. No match is `[]`, an
//   unknown id is `null`, a refused key is `{ ok: false, reason: 'unauthorised' }`.
//   Throwing is for bugs. A How-to sheet must never fail because a service had
//   a bad afternoon.
// - An adapter does its own normalisation and clamping. Nothing outside the
//   adapter's own file ever sees a provider's raw JSON, so nothing downstream
//   has to defend against it.

import type { ProviderConnection, ProviderCredit, ProviderHowTo } from '@/lib/types';

export type { ContentLink, ProviderConnection, ProviderCredit, ProviderHowTo, ProviderMedia } from '@/lib/types';

/** What one provider can and cannot do. Declared, never discovered at runtime. */
export type ProviderCapabilities = {
  search: boolean;
  steps: boolean;
  images: boolean;
  /** Video is streamed only, never saved. */
  video: boolean;
};

export type AuthRequirement =
  | { kind: 'none' }
  | {
      kind: 'apiKey';
      /** The header the key travels in, e.g. 'X-RapidAPI-Key'. */
      headerName: string;
      /** Fixed headers the provider also needs, e.g. a gateway host name. Never secrets. */
      extraHeaders?: Record<string, string>;
      /** Where the user gets a key. */
      helpUrl: string;
    };

/**
 * How long a provider's terms let the device keep what it sends, in
 * milliseconds. 0 means "may not store at all": shown while online and never
 * written down. null means no time limit (Creative Commons, for instance).
 */
export type CachePolicy = {
  textMaxAgeMs: number | null;
  imageMaxAgeMs: number | null;
  /**
   * Some terms end on a calendar boundary rather than after a duration — media
   * links that rotate every Monday, say. Given when something was fetched,
   * returns the moment it must be gone by.
   */
  expireBefore?: (fetchedAt: number) => number;
  /** Video is never saved. Every provider that states a rule forbids or restricts it. */
  cacheVideo: false;
};

/** One search result from a provider. */
export type ExternalMatch = {
  /** The provider's own stable id for the entry. */
  externalId: string;
  name: string;
  equipment?: string;
  muscle?: string;
  thumbUrl?: string;
};

export type FailureReason = 'unauthorised' | 'quota' | 'network' | 'blocked' | 'unexpected';

export type TestResult = { ok: true; quotaRemaining?: number } | { ok: false; reason: FailureReason; detail?: string };

export type ProviderContext = {
  /** Absent for providers that need no key. */
  apiKey?: string;
  /** Only honoured for adapters that set `allowsBaseUrl`. */
  baseUrl?: string;
  /** Every call is cancellable, and time-limited by the network helper. */
  signal: AbortSignal;
};

export type ContentProvider = {
  /** Stable slug stored on every link and cache row: 'wger', 'exercisedb'. */
  id: string;
  name: string;
  auth: AuthRequirement;
  capabilities: ProviderCapabilities;
  /**
   * The hosts API calls may go to, and the only hosts the key is ever sent
   * to. The network helper refuses every other host for an API call, so
   * neither a bug nor a hand-edited link can send one provider's key anywhere
   * else.
   */
  apiHosts: string[];
  /**
   * The hosts pictures may be downloaded from for offline use. A request here
   * never carries the key, cookies or a referrer — a media host is often a
   * CDN run by someone else, and it gets exactly what an <img> would send.
   * Separate from `apiHosts` so that saving a picture never means trusting
   * its host with the key.
   */
  mediaHosts: string[];
  /**
   * Set for a service people can run themselves. The host of the user's base
   * URL then replaces both lists entirely, rather than adding to them: a
   * self-hosted server serves its own API and its own pictures.
   */
  allowsBaseUrl?: boolean;
  /** The rules for keeping this provider's content. May depend on what the user said about their plan. */
  cachePolicy: (connection: ProviderConnection) => CachePolicy;
  /** The cheapest real call, spending at most one unit of the user's quota. */
  test: (ctx: ProviderContext) => Promise<TestResult>;
  search: (query: string, ctx: ProviderContext) => Promise<ExternalMatch[]>;
  fetchHowTo: (externalId: string, ctx: ProviderContext) => Promise<ProviderHowTo | null>;
};

/**
 * How an adapter is listed before it is loaded.
 *
 * `load` is a dynamic import, so an adapter's code is only downloaded once
 * someone connects that service — people who never connect one never pay for
 * it at startup.
 */
export type ProviderEntry = {
  id: string;
  name: string;
  load: () => Promise<ContentProvider>;
};

export const MAX_STEPS = 20;
export const MAX_STEP_CHARS = 400;
/** Search strings and ids are short; anything longer is not a real one. */
export const MAX_ID_CHARS = 200;

function clampText(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > MAX_STEP_CHARS ? `${flat.slice(0, MAX_STEP_CHARS - 1).trimEnd()}…` : flat;
}

/**
 * Hold a normalised how-to to the limits every adapter promises: plain
 * one-line strings, 1–20 steps of at most 400 characters, no empty steps.
 * Returns null when nothing usable is left, which callers treat exactly like
 * "the provider has no instructions for this".
 *
 * Adapters call it last; the resolver calls it again on anything read back
 * from storage, because a stored row is plain data that could have been
 * written by an older adapter.
 */
export function clampHowTo(howTo: ProviderHowTo): ProviderHowTo | null {
  const steps = howTo.steps
    .filter((step): step is string => typeof step === 'string')
    .map(clampText)
    .filter((step) => step.length > 0)
    .slice(0, MAX_STEPS);
  if (steps.length === 0) return null;
  const fault = typeof howTo.fault === 'string' ? clampText(howTo.fault) : '';
  const muscles = typeof howTo.muscles === 'string' ? clampText(howTo.muscles) : '';
  return {
    externalId: howTo.externalId,
    steps,
    ...(fault ? { fault } : {}),
    ...(muscles ? { muscles } : {}),
    media: Array.isArray(howTo.media) ? howTo.media.filter(isHttpsMedia) : [],
    credit: clampCredit(howTo.credit),
  };
}

function clampCredit(credit: ProviderCredit): ProviderCredit {
  return {
    line: clampText(String(credit?.line ?? '')),
    ...(credit?.licence ? { licence: clampText(credit.licence) } : {}),
    // A link without a name to hang it on would have nothing to show.
    ...(credit?.licence && credit.licenceUrl && isHttps(credit.licenceUrl) ? { licenceUrl: credit.licenceUrl } : {}),
    ...(credit?.author ? { author: clampText(credit.author) } : {}),
    ...(credit?.url && isHttps(credit.url) ? { url: credit.url } : {}),
  };
}

function isHttps(url: string): boolean {
  try {
    return new URL(url).protocol === 'https:';
  } catch {
    return false;
  }
}

// A `javascript:` or `data:` URL in a provider's answer must never reach an
// <img> or a link. Only plain https survives.
function isHttpsMedia(media: { kind: string; url: string }): boolean {
  return (media.kind === 'image' || media.kind === 'video') && typeof media.url === 'string' && isHttps(media.url);
}
