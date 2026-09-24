// Which adapters exist, and loading one on demand.
//
// The list itself lives in ./providers/index.ts so that adding an adapter is a
// one-line change there and nothing here moves.

import type { ContentProvider, ProviderEntry } from './provider';
import { PROVIDER_ENTRIES } from './providers';

export function providerEntries(): readonly ProviderEntry[] {
  return PROVIDER_ENTRIES;
}

export function providerEntry(id: string): ProviderEntry | undefined {
  return PROVIDER_ENTRIES.find((entry) => entry.id === id);
}

/** Import validation leans on this: a link to a service Bompa has no adapter for is dropped. */
export function isKnownProvider(id: unknown): id is string {
  return typeof id === 'string' && PROVIDER_ENTRIES.some((entry) => entry.id === id);
}

// One import per adapter per session, shared by everyone who asks at once.
const loaded = new Map<string, Promise<ContentProvider | null>>();

/**
 * The adapter for an id, or null if there is none or it fails to load — a
 * chunk that will not download offline must degrade to "not available", not
 * to an error on the How-to sheet.
 */
export function loadProvider(id: string): Promise<ContentProvider | null> {
  const existing = loaded.get(id);
  if (existing) return existing;
  const entry = providerEntry(id);
  if (!entry) return Promise.resolve(null);
  const pending = entry
    .load()
    // An adapter whose id disagrees with its entry would store rows under a
    // name nothing looks up. Refuse it rather than write orphans.
    .then((provider) => (provider.id === id ? provider : null))
    .catch(() => {
      // Forget the failure so the next attempt, once back online, can succeed.
      loaded.delete(id);
      return null;
    });
  loaded.set(id, pending);
  return pending;
}

/** Test seam. */
export function resetProviderCache(): void {
  loaded.clear();
}
