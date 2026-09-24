// The one way provider code reaches the network.
//
// Every request to a content provider goes through here, so the rules that
// protect the user are written once rather than trusted to each adapter:
//
// - Only hosts the adapter declared. API calls go to its API hosts, which are
//   the only places a key is attached; pictures come from its media hosts,
//   which never see the key.
// - No cookies, no referrer. The provider learns what it must (the key, the
//   search string, its own id) and not which screen the user was on.
// - Eight seconds, then give up. A How-to sheet never waits longer than that.
// - After a 429, leave that provider alone for fifteen minutes. Hammering a
//   quota that is already spent wastes the user's calls and their battery.
//
// This is the only file in lib/ that calls fetch against another origin.

import type { ContentProvider, FailureReason, ProviderContext } from './provider';

export const FETCH_TIMEOUT_MS = 8_000;
export const BACKOFF_MS = 15 * 60_000;

export type FetchOutcome =
  | { ok: true; response: Response }
  | { ok: false; reason: FailureReason; status?: number; detail?: string };

type FetchTarget = Pick<ContentProvider, 'id' | 'apiHosts' | 'mediaHosts' | 'auth' | 'allowsBaseUrl'>;

/** An API call (may carry the key) or a picture (never does). */
export type HostKind = 'api' | 'media';

// Per provider id: the moment it may be called again. Module state rather than
// storage on purpose — a reload is a reasonable point to try again.
const backoff = new Map<string, number>();

/** When calls to this provider resume, or null if they are not paused. */
export function backoffUntil(providerId: string, now = Date.now()): number | null {
  const until = backoff.get(providerId);
  if (until === undefined || until <= now) return null;
  return until;
}

/** Test seam. */
export function resetBackoff(): void {
  backoff.clear();
}

/**
 * The hosts a request of this kind may go to. A self-hosted base URL replaces
 * both lists rather than extending them, so a typed address cannot widen where
 * a key travels.
 */
export function allowedHosts(provider: FetchTarget, ctx: Pick<ProviderContext, 'baseUrl'>, kind: HostKind): string[] {
  if (provider.allowsBaseUrl && ctx.baseUrl) {
    const base = parseHttps(ctx.baseUrl);
    return base ? [base.host] : [];
  }
  return kind === 'api' ? provider.apiHosts : provider.mediaHosts;
}

function parseHttps(raw: string): URL | null {
  try {
    const url = new URL(raw);
    // Plain http would put the key on the wire in clear text, and a page served
    // over https cannot fetch it anyway.
    return url.protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

/** Refuses before any request exists, so a refused URL costs nothing and leaks nothing. */
export function checkUrl(provider: FetchTarget, raw: string, ctx: Pick<ProviderContext, 'baseUrl'>, kind: HostKind): URL | null {
  const url = parseHttps(raw);
  if (!url) return null;
  return allowedHosts(provider, ctx, kind).includes(url.host) ? url : null;
}

/**
 * Link the caller's cancel with our own time limit. Written out rather than
 * `AbortSignal.any` so it works on the older phone browsers people keep for
 * the gym.
 */
function limitedSignal(outer: AbortSignal | undefined): { signal: AbortSignal; timedOut: () => boolean; done: () => void } {
  const controller = new AbortController();
  let expired = false;
  const timer = setTimeout(() => {
    expired = true;
    controller.abort();
  }, FETCH_TIMEOUT_MS);
  const onOuterAbort = () => controller.abort();
  if (outer?.aborted) controller.abort();
  else outer?.addEventListener('abort', onOuterAbort, { once: true });
  return {
    signal: controller.signal,
    timedOut: () => expired,
    done: () => {
      clearTimeout(timer);
      outer?.removeEventListener('abort', onOuterAbort);
    },
  };
}

/**
 * Fetch a provider URL. Never rejects: every failure comes back as a reason
 * the interface can put into words.
 */
export async function providerFetch(provider: FetchTarget, rawUrl: string, ctx: ProviderContext): Promise<FetchOutcome> {
  // API hosts only: this request may carry the key.
  const url = checkUrl(provider, rawUrl, ctx, 'api');
  if (!url) return { ok: false, reason: 'blocked', detail: 'host not allowed' };

  if (backoffUntil(provider.id) !== null) {
    return { ok: false, reason: 'quota', detail: 'paused after the provider said too many requests' };
  }

  const headers: Record<string, string> = { Accept: 'application/json' };
  if (provider.auth.kind === 'apiKey') {
    if (!ctx.apiKey) return { ok: false, reason: 'unauthorised', detail: 'no key' };
    Object.assign(headers, provider.auth.extraHeaders ?? {});
    headers[provider.auth.headerName] = ctx.apiKey;
  }

  const limit = limitedSignal(ctx.signal);
  try {
    const response = await fetch(url.toString(), {
      method: 'GET',
      headers,
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      mode: 'cors',
      cache: 'no-store',
      signal: limit.signal,
    });
    if (response.status === 429) {
      backoff.set(provider.id, Date.now() + BACKOFF_MS);
      return { ok: false, reason: 'quota', status: 429 };
    }
    if (response.status === 401 || response.status === 403) {
      return { ok: false, reason: 'unauthorised', status: response.status };
    }
    if (!response.ok) return { ok: false, reason: 'unexpected', status: response.status };
    return { ok: true, response };
  } catch (err) {
    // A browser reports a CORS refusal, a dropped connection and our own abort
    // all as a failed fetch. From where the user stands they are the same
    // thing: the service could not be reached.
    return { ok: false, reason: 'network', detail: limit.timedOut() ? 'timed out' : errorName(err) };
  } finally {
    limit.done();
  }
}

/**
 * Read a JSON body without letting a malformed one throw into an adapter.
 * Returns undefined when the body is not JSON.
 */
export async function readJson(response: Response): Promise<unknown> {
  try {
    return (await response.json()) as unknown;
  } catch {
    return undefined;
  }
}

/**
 * Fetch an image for saving on the device.
 *
 * Media hosts only, and never the key or any custom header, even when the
 * same host is also an API host: an <img> sends neither, so the saved copy is
 * exactly what the page would have shown. Some media hosts send no CORS
 * header; for those the only option is an opaque response, which can be
 * stored and displayed but never read by code.
 */
export async function providerFetchImage(provider: FetchTarget, rawUrl: string, ctx: Pick<ProviderContext, 'baseUrl' | 'signal'>): Promise<Response | null> {
  const url = checkUrl(provider, rawUrl, ctx, 'media');
  if (!url || backoffUntil(provider.id) !== null) return null;

  for (const mode of ['cors', 'no-cors'] as const) {
    const limit = limitedSignal(ctx.signal);
    try {
      const response = await fetch(url.toString(), {
        method: 'GET',
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        mode,
        signal: limit.signal,
      });
      if (response.type === 'opaque' || response.ok) return response;
      if (response.status === 429) backoff.set(provider.id, Date.now() + BACKOFF_MS);
      return null;
    } catch {
      if (limit.timedOut() || ctx.signal.aborted) return null;
      // Refused by CORS: try once more as an opaque request.
    } finally {
      limit.done();
    }
  }
  return null;
}

function errorName(err: unknown): string {
  return err instanceof Error ? err.name : 'unknown';
}
