'use client';

import { useEffect } from 'react';

type Sentinel = { released: boolean; release: () => Promise<void> };
type WakeLockApi = { request: (type: 'screen') => Promise<Sentinel> };

function wakeLockApi(): WakeLockApi | null {
  if (typeof navigator === 'undefined') return null;
  return (navigator as Navigator & { wakeLock?: WakeLockApi }).wakeLock ?? null;
}

/**
 * Keep the screen on while `enabled`.
 *
 * The browser drops the lock by itself whenever the page is hidden — switch
 * apps, lock the phone — and never gives it back, so it is asked for again
 * every time the page comes back into view. Released for good when `enabled`
 * goes false, which is how finishing a session lets the phone sleep again.
 */
export function useWakeLock(enabled: boolean): void {
  useEffect(() => {
    const api = wakeLockApi();
    if (!enabled || !api) return;
    let sentinel: Sentinel | null = null;
    let done = false;

    const acquire = async () => {
      if (document.visibilityState !== 'visible') return;
      if (sentinel && !sentinel.released) return;
      try {
        const next = await api.request('screen');
        // Finished while the request was in flight: hand it straight back.
        if (done) void next.release().catch(() => undefined);
        else sentinel = next;
      } catch {
        // Battery saver, or a browser that says no. The screen just sleeps.
      }
    };

    const onVisibility = () => void acquire();
    void acquire();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      done = true;
      document.removeEventListener('visibilitychange', onVisibility);
      if (sentinel && !sentinel.released) void sentinel.release().catch(() => undefined);
      sentinel = null;
    };
  }, [enabled]);
}
