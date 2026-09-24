// On-demand loader for the ingested movement cues.
//
// The library splits by read pattern. The list — name, muscle,
// pattern, equipment — is read constantly and ships in the bundle. The cues are
// read only when someone opens the How-to sheet for one movement, and at 587KB
// raw they have no business in the startup path. Loading an encyclopedia to
// display one page is the wrong shape whatever it weighs.
//
// It is a plain file in public/ rather than a dynamic import so the URL is a
// constant the service worker can precache by name. That matters more than it
// looks: sw.js caches assets stale-while-revalidate, which only caches a file
// *after* it has been fetched once. Left to that, the cues for any movement you
// had not already looked at online would be missing in a basement gym — which
// is precisely the situation the app exists for. Precaching at install
// is what makes the sheet work offline for all 736.

import { HOWTO_BY_ID } from './data';
import type { HowTo } from './types';

/** Shape of one entry in public/howtos.json, written by scripts/ingest-exercises.mjs. */
type IngestedHowTo = { muscles: string; steps: string[] };

export const HOWTOS_URL = '/howtos.json';

/** Matches the seeded entries, so an ingested sheet doesn't read differently. */
const MEDIA_NOTE = 'Cues bundled offline · no demo clip yet';

// Parsed once and kept for the session. `inflight` is separate so that opening
// five sheets in a row shares one request instead of starting five.
let cache: Record<string, IngestedHowTo> | null = null;
let inflight: Promise<Record<string, IngestedHowTo> | null> | null = null;

async function loadAll(): Promise<Record<string, IngestedHowTo> | null> {
  if (cache) return cache;
  if (inflight) return inflight;

  inflight = fetch(HOWTOS_URL)
    .then((response) => (response.ok ? (response.json() as Promise<Record<string, IngestedHowTo>>) : null))
    .then((parsed) => {
      cache = parsed;
      return parsed;
    })
    .catch(() => null)
    .finally(() => {
      // Cleared either way. A failed fetch — offline before the precache
      // finished — must be retryable next time the sheet opens, not sticky.
      inflight = null;
    });

  return inflight;
}

/**
 * Cues for one movement, or null if none are bundled for it.
 *
 * The seeded 14 resolve synchronously from the bundle and never touch the
 * network; only an ingested movement waits. Returning null is a normal outcome,
 * not an error — the sheet has always had a "no cues bundled" state.
 */
export async function loadHowTo(exerciseId: string): Promise<HowTo | null> {
  const seeded = HOWTO_BY_ID.get(exerciseId);
  if (seeded) return seeded;

  const all = await loadAll();
  const entry = all?.[exerciseId];
  if (!entry) return null;

  return { exerciseId, muscles: entry.muscles, mediaNote: MEDIA_NOTE, steps: entry.steps };
}

/** Test seam. Nothing in the app clears the cache — it is correct for a session. */
export function resetHowToCache(): void {
  cache = null;
  inflight = null;
}
