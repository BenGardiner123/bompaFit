// The on-demand cue loader. The interesting cases are the ones that happen in a
// basement: the fetch fails, and the sheet has to degrade rather than throw.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadHowTo, resetHowToCache, HOWTOS_URL } from './howtos';

const FIXTURE = {
  'barbell-squat': { muscles: 'Primary: Quads · Secondary: Glutes', steps: ['Unrack it.', 'Sit down.', 'Stand up.'] },
};

function mockFetch(impl: () => Promise<Response>) {
  const spy = vi.fn(impl);
  vi.stubGlobal('fetch', spy);
  return spy;
}

const ok = () => Promise.resolve(new Response(JSON.stringify(FIXTURE), { status: 200 }));

beforeEach(() => resetHowToCache());

afterEach(() => {
  vi.unstubAllGlobals();
  resetHowToCache();
});

describe('loadHowTo', () => {
  it('resolves a seeded movement without touching the network', async () => {
    const fetchSpy = mockFetch(ok);

    const howTo = await loadHowTo('barbell-bench-press');

    expect(howTo?.fault).toBeTruthy();
    expect(howTo?.steps.length).toBeGreaterThan(0);
    // The seeded 14 are in the bundle. Fetching for them would put a network
    // round trip in front of the movements most likely to be opened.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('fetches the ingested cues and shapes them like a seeded entry', async () => {
    mockFetch(ok);

    const howTo = await loadHowTo('barbell-squat');

    expect(howTo?.exerciseId).toBe('barbell-squat');
    expect(howTo?.steps).toHaveLength(3);
    expect(howTo?.muscles).toContain('Quads');
    expect(howTo?.mediaNote).toBeTruthy();
    // No invented fault. The dataset does not carry one.
    expect(howTo?.fault).toBeUndefined();
  });

  it('fetches once however many movements are opened', async () => {
    const fetchSpy = mockFetch(ok);

    await Promise.all([loadHowTo('barbell-squat'), loadHowTo('barbell-squat'), loadHowTo('nothing-here')]);
    await loadHowTo('barbell-squat');

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledWith(HOWTOS_URL);
  });

  it('returns null rather than throwing when the fetch fails', async () => {
    mockFetch(() => Promise.reject(new Error('offline')));

    // The app has to work offline. A missing cue file is a sheet that says it
    // has no cues, never an unhandled rejection during a workout.
    await expect(loadHowTo('barbell-squat')).resolves.toBeNull();
  });

  it('returns null on a non-ok response', async () => {
    mockFetch(() => Promise.resolve(new Response('nope', { status: 404 })));

    await expect(loadHowTo('barbell-squat')).resolves.toBeNull();
  });

  it('retries after a failure instead of caching it', async () => {
    let attempt = 0;
    const fetchSpy = mockFetch(() => {
      attempt += 1;
      return attempt === 1 ? Promise.reject(new Error('offline')) : ok();
    });

    // Failing once must not poison the session. Someone who opens a sheet while
    // the precache is still in flight should get cues on the second try.
    expect(await loadHowTo('barbell-squat')).toBeNull();
    expect((await loadHowTo('barbell-squat'))?.steps).toHaveLength(3);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('returns null for a movement with no cues bundled', async () => {
    mockFetch(ok);

    await expect(loadHowTo('some-movement-with-no-instructions')).resolves.toBeNull();
  });
});
