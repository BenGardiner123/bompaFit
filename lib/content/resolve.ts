// Deciding what a How-to sheet shows, and downloading content for offline.
//
// Text comes from exactly one place, in this order:
//   1. cues the user wrote for the movement — synchronous, and when they exist
//      nothing else is consulted for text, not even a cache read;
//   2. a connected provider, through a confirmed link, from the device if a
//      fresh copy is saved or from the network if not;
//   3. Bompa's bundled cues.
// Media is decided separately, because the user's own cues have no pictures.
//
// The sheet never waits on the network while it has something to show. The
// first answer is synchronous; better answers arrive through `onUpdate`; and
// the whole thing is over within eight seconds, ending in a sentence rather
// than a spinner.

import type { ContentLink, HowTo, ProviderConnection, ProviderCredit, ProviderMedia } from '@/lib/types';
import { FETCH_TIMEOUT_MS, backoffUntil, providerFetchImage } from './fetcher';
import { isUsableLink } from './match';
import { clampHowTo, type ContentProvider, type FailureReason, type ProviderContext, type TestResult } from './provider';
import { cacheRowFor, expiryFor, readCache, recordImage, saveImage, writeCache, type CacheRead } from './store';

export type ResolvedText = { steps: string[]; fault?: string; muscles?: string };

export type TextSource = 'user' | 'provider' | 'bundled' | 'none';

/** What the sheet should say under the credit area, if anything. */
export type ContentStatus =
  | { kind: 'ok' }
  | { kind: 'checking'; providerName: string }
  | { kind: 'unreachable'; providerName: string }
  | { kind: 'not-downloaded'; providerName: string }
  | { kind: 'expired'; providerName: string }
  | { kind: 'no-storage'; providerName: string }
  | { kind: 'not-linked'; providerId: string; providerName: string }
  /** Nothing to show at all. With a provider name, that provider was tried and could not be reached. */
  | { kind: 'unavailable'; providerName?: string };

export type ResolvedHowTo = {
  exerciseId: string;
  text: ResolvedText | null;
  textSource: TextSource;
  /** Present only when a provider supplied the text. */
  textCredit?: ProviderCredit;
  /**
   * True when the text showing came straight from a provider whose terms, on
   * this connection, let the device keep none of it — so it will not be there
   * offline, and the sheet must not promise that it will.
   */
  onlineOnly?: boolean;
  /** Offline, only images saved on the device; video only ever online. */
  media: ProviderMedia[];
  /** Present only when a provider supplied media. */
  mediaCredit?: ProviderCredit;
  /** The provider behind whatever it supplied, if anything. */
  providerId?: string;
  status: ContentStatus;
  /** True only while there is nothing at all to show. Never longer than the deadline. */
  loading: boolean;
};

/** One connected provider, and this movement's link to it if there is one. */
export type ResolveCandidate = { connection: ProviderConnection; name: string; link?: ContentLink };

export type ResolveInput = {
  exerciseId: string;
  userCues: ResolvedText | null;
  /** Cues bundled in the app itself, available without waiting. */
  seeded: HowTo | null;
  /** The larger bundled set, read from the app's own files. */
  loadBundled: () => Promise<HowTo | null>;
  /** Connected providers in the user's order. */
  candidates: ResolveCandidate[];
  loadProvider: (id: string) => Promise<ContentProvider | null>;
  online: () => boolean;
  now: () => number;
  deadlineMs?: number;
};

export type Resolution = {
  first: ResolvedHowTo;
  done: Promise<ResolvedHowTo>;
  cancel: () => void;
};

function fromBundled(howTo: HowTo | null): ResolvedText | null {
  if (!howTo || howTo.steps.length === 0) return null;
  return { steps: howTo.steps, ...(howTo.fault ? { fault: howTo.fault } : {}), muscles: howTo.muscles };
}

export function contextFor(connection: Pick<ProviderConnection, 'apiKey' | 'baseUrl'>, signal: AbortSignal): ProviderContext {
  return {
    ...(connection.apiKey ? { apiKey: connection.apiKey } : {}),
    ...(connection.baseUrl ? { baseUrl: connection.baseUrl } : {}),
    signal,
  };
}

/** Media a device can actually show right now. */
function showableMedia(media: ProviderMedia[], online: boolean, savedImage: string | undefined): ProviderMedia[] {
  if (online) return media;
  return media.filter((item) => item.kind === 'image' && item.url === savedImage);
}

async function safeRead(providerId: string, externalId: string, now: number): Promise<CacheRead> {
  try {
    return await readCache(providerId, externalId, now);
  } catch {
    // A local read that fails is a miss, not an error on screen.
    return { kind: 'missing' };
  }
}

/**
 * Resolve one movement's How-to. Returns a synchronous first answer, and
 * reports each better answer through `onUpdate` until `done` settles.
 */
export function resolveHowTo(input: ResolveInput, onUpdate?: (next: ResolvedHowTo) => void): Resolution {
  const { exerciseId, userCues, candidates } = input;
  const linked = candidates.find((c) => isUsableLink(c.link));
  const firstUnlinked = candidates[0] && !linked ? candidates[0] : undefined;

  const initialText = userCues ?? fromBundled(input.seeded);
  const first: ResolvedHowTo = {
    exerciseId,
    text: initialText,
    textSource: userCues ? 'user' : initialText ? 'bundled' : 'none',
    media: [],
    status: firstUnlinked
      ? { kind: 'not-linked', providerId: firstUnlinked.connection.providerId, providerName: firstUnlinked.name }
      : { kind: 'ok' },
    loading: initialText === null,
  };

  // User cues and nothing linked: the answer is complete and nothing is read.
  // Seeded cues with nothing linked: likewise — the seeded map is the bundle.
  if ((userCues || first.text) && !linked) {
    return { first, done: Promise.resolve(first), cancel: () => {} };
  }

  const controller = new AbortController();
  let current = first;
  let settled = false;
  let settle: (value: ResolvedHowTo) => void = () => {};
  const done = new Promise<ResolvedHowTo>((resolve) => {
    settle = resolve;
  });

  const emit = (next: ResolvedHowTo) => {
    if (settled) return;
    current = next;
    onUpdate?.(next);
  };
  const finish = (next: ResolvedHowTo) => {
    if (settled) return;
    emit(next);
    settled = true;
    clearTimeout(deadline);
    settle(next);
  };

  // The backstop. Whatever is still outstanding, the sheet stops waiting here.
  const deadline = setTimeout(() => {
    controller.abort();
    const tried = current.status.kind === 'checking' ? current.status.providerName : undefined;
    const status: ContentStatus =
      current.text === null
        ? { kind: 'unavailable', ...(tried ? { providerName: tried } : {}) }
        : tried
          ? { kind: 'unreachable', providerName: tried }
          : current.status;
    finish({ ...current, status, loading: false });
  }, input.deadlineMs ?? FETCH_TIMEOUT_MS);

  void (async () => {
    // Linked, or nothing to show yet (bundled cues for an ingested movement).
    const provider = linked ? await input.loadProvider(linked.connection.providerId) : null;
    const externalId = linked?.link?.externalId ?? null;

    const [cache, bundled] = await Promise.all([
      provider && externalId ? safeRead(provider.id, externalId, input.now()) : Promise.resolve<CacheRead>({ kind: 'missing' }),
      userCues || input.seeded ? Promise.resolve(input.seeded) : input.loadBundled().catch(() => null),
    ]);
    if (settled) return;

    const baseText = userCues ?? fromBundled(bundled);
    const base: ResolvedHowTo = {
      ...first,
      text: baseText,
      textSource: userCues ? 'user' : baseText ? 'bundled' : 'none',
      loading: baseText === null,
    };

    if (!provider || !linked || !externalId) {
      finish({ ...base, loading: false, status: base.text ? first.status : { kind: 'unavailable' } });
      return;
    }

    const online = input.online();
    if (cache.kind === 'fresh') {
      const howTo = clampHowTo(cache.row.howTo);
      if (howTo) {
        const media = showableMedia(howTo.media, online, cache.row.imageUrl);
        finish({
          ...base,
          ...(userCues ? {} : { text: pick(howTo), textSource: 'provider' as const, textCredit: howTo.credit }),
          media,
          ...(media.length ? { mediaCredit: media[0]?.credit ?? howTo.credit } : {}),
          providerId: provider.id,
          status: { kind: 'ok' },
          loading: false,
        });
        return;
      }
    }

    // The user's own words need nothing from the network; only a saved
    // picture could have added to them, and there is none.
    if (userCues) {
      finish({ ...base, loading: false, status: { kind: 'ok' } });
      return;
    }

    const policy = provider.cachePolicy(linked.connection);
    const offlineStatus: ContentStatus =
      policy.textMaxAgeMs === 0
        ? { kind: 'no-storage', providerName: linked.name }
        : cache.kind === 'expired'
          ? { kind: 'expired', providerName: linked.name }
          : { kind: 'not-downloaded', providerName: linked.name };

    if (!online || backoffUntil(provider.id) !== null) {
      finish({ ...base, loading: false, status: offlineStatus });
      return;
    }

    emit({ ...base, status: { kind: 'checking', providerName: linked.name } });

    let fetched = null;
    try {
      fetched = await provider.fetchHowTo(externalId, contextFor(linked.connection, controller.signal));
    } catch {
      fetched = null;
    }
    if (settled) return;
    const howTo = fetched ? clampHowTo(fetched) : null;
    if (!howTo) {
      finish({
        ...base,
        loading: false,
        status: base.text ? { kind: 'unreachable', providerName: linked.name } : { kind: 'unavailable', providerName: linked.name },
      });
      return;
    }

    const row = cacheRowFor(provider.id, howTo, policy, input.now());
    if (row) void writeCache(row).catch(() => {});
    finish({
      ...base,
      text: pick(howTo),
      textSource: 'provider',
      textCredit: howTo.credit,
      ...(row ? {} : { onlineOnly: true }),
      media: howTo.media,
      ...(howTo.media.length ? { mediaCredit: howTo.media[0]?.credit ?? howTo.credit } : {}),
      providerId: provider.id,
      status: { kind: 'ok' },
      loading: false,
    });
  })().catch(() => {
    // Unreachable in practice — every step above catches its own failures —
    // but a sheet must never be left loading because of a bug here.
    finish({ ...current, loading: false, status: current.text ? current.status : { kind: 'unavailable' } });
  });

  return {
    first,
    done,
    cancel: () => {
      controller.abort();
      settled = true;
      clearTimeout(deadline);
      settle(current);
    },
  };
}

function pick(howTo: { steps: string[]; fault?: string; muscles?: string }): ResolvedText {
  return {
    steps: howTo.steps,
    ...(howTo.fault ? { fault: howTo.fault } : {}),
    ...(howTo.muscles ? { muscles: howTo.muscles } : {}),
  };
}

/**
 * The sentence for a status, shared so the sheet and anything else that
 * reports content say the same thing. Null when there is nothing to say.
 */
export function statusSentence(status: ContentStatus): string | null {
  switch (status.kind) {
    case 'checking':
      return `Checking ${status.providerName}…`;
    case 'unreachable':
      return `Couldn't reach ${status.providerName} — showing Bompa's cues.`;
    case 'not-downloaded':
      return `${status.providerName}'s instructions for this haven't been downloaded yet. Tools → Exercise content → Download for offline.`;
    case 'expired':
      return `Your saved copy from ${status.providerName} expired. It will refresh next time you're online.`;
    case 'no-storage':
      return `Your ${status.providerName} plan doesn't allow saving instructions on the device.`;
    case 'unavailable':
      return status.providerName
        ? `Couldn't reach ${status.providerName}, and Bompa has no cues of its own for this movement.`
        : 'No instructions for this movement are available right now. They need a connection the first time.';
    case 'ok':
    case 'not-linked':
      return null;
  }
}

// ─────────────────────────────────────────────────────────────
// Testing a connection
// ─────────────────────────────────────────────────────────────

/** Run an adapter's test without letting a bug in it reach the screen as an exception. */
export async function testConnection(provider: ContentProvider, connection: Pick<ProviderConnection, 'apiKey' | 'baseUrl'>): Promise<TestResult> {
  const controller = new AbortController();
  try {
    return await provider.test(contextFor(connection, controller.signal));
  } catch {
    return { ok: false, reason: 'unexpected' };
  }
}

// ─────────────────────────────────────────────────────────────
// Download for offline
// ─────────────────────────────────────────────────────────────

export const MAX_DOWNLOADS_PER_RUN = 40;

export type DownloadRun = {
  /** How-tos now saved, including those that already were. */
  done: number;
  total: number;
  images: number;
  /** Why it ended early. 'not-allowed' means the plan forbids keeping anything. */
  stoppedBy?: FailureReason | 'not-allowed' | 'cancelled' | 'in-session';
};

/**
 * Save the how-to, and one image where the terms allow, for each confirmed
 * link given. One request at a time, stopping at the first sign of a spent
 * quota, at most forty per run.
 */
export async function downloadContent(args: {
  provider: ContentProvider;
  connection: ProviderConnection;
  links: ContentLink[];
  now: () => number;
  signal: AbortSignal;
  onProgress?: (done: number, total: number) => void;
  limit?: number;
}): Promise<DownloadRun> {
  const { provider, connection, signal } = args;
  const policy = provider.cachePolicy(connection);
  const seen = new Set<string>();
  const targets = args.links
    .filter(isUsableLink)
    .filter((link) => link.providerId === provider.id)
    .filter((link) => (seen.has(link.externalId) ? false : (seen.add(link.externalId), true)))
    .slice(0, args.limit ?? MAX_DOWNLOADS_PER_RUN);
  const total = targets.length;
  if (policy.textMaxAgeMs === 0) return { done: 0, total, images: 0, stoppedBy: 'not-allowed' };

  const wantImages = provider.capabilities.images && policy.imageMaxAgeMs !== 0;
  let done = 0;
  let images = 0;
  args.onProgress?.(done, total);

  for (const link of targets) {
    if (signal.aborted) return { done, total, images, stoppedBy: 'cancelled' };
    const ctx = contextFor(connection, signal);

    const cached = await safeRead(provider.id, link.externalId, args.now());
    let row = cached.kind === 'fresh' ? cached.row : null;
    if (!row) {
      let fetched = null;
      try {
        fetched = await provider.fetchHowTo(link.externalId, ctx);
      } catch {
        fetched = null;
      }
      if (backoffUntil(provider.id) !== null) return { done, total, images, stoppedBy: 'quota' };
      const howTo = fetched ? clampHowTo(fetched) : null;
      if (!howTo) continue;
      row = cacheRowFor(provider.id, howTo, policy, args.now());
      if (!row) continue;
      await writeCache(row);
    }
    done += 1;

    if (wantImages && !row.imageUrl) {
      const image = row.howTo.media.find((item) => item.kind === 'image');
      const response = image ? await providerFetchImage(provider, image.url, ctx) : null;
      if (image && response && (await saveImage(image.url, response))) {
        await recordImage(provider.id, row.externalId, image.url, expiryFor(policy.imageMaxAgeMs, policy, row.fetchedAt));
        images += 1;
      }
    } else if (row.imageUrl) {
      images += 1;
    }
    args.onProgress?.(done, total);
  }
  return { done, total, images };
}
