// @vitest-environment jsdom

// The How-to sheet inside the real provider, with an in-memory content service
// standing in for a real one. `fetch` is replaced with a spy that refuses
// everything, so any request the sheet makes on its own is caught, and nothing
// here can reach a real network.

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db';
import { PROVIDER_ENTRIES } from '@/lib/content/providers';
import type { ContentProvider } from '@/lib/content/provider';
import { resetProviderCache } from '@/lib/content/registry';
import { resetBackoff } from '@/lib/content/fetcher';
import type { ProviderHowTo } from '@/lib/types';
import { BompaProvider, useBompa } from '@/state/BompaContext';
import { HowToSheet } from './HowToSheet';

const BENCH = 'barbell-bench-press';
/** A movement whose cues live only in the ingested file, which these tests make unavailable. */
const PULLUPS = 'pullups';

const CREDIT = {
  line: 'Instructions from Fake',
  licence: 'CC-BY-SA 4',
  licenceUrl: 'https://creativecommons.org/licenses/by-sa/4.0/deed.en',
  author: 'deusinvictus',
  url: 'https://fake.example.org/exercise/bp-1',
};

function providerHowTo(overrides: Partial<ProviderHowTo> = {}): ProviderHowTo {
  return { externalId: 'bp-1', steps: ['Fake step one', 'Fake step two'], media: [], credit: CREDIT, ...overrides };
}

function Controls({ exerciseId }: { exerciseId: string }) {
  const b = useBompa();
  return (
    <>
      <span data-testid="hydrated">{String(b.s.hydrated)}</span>
      <button type="button" onClick={() => b.patch({ howToKey: exerciseId })}>
        Open
      </button>
      <button type="button" onClick={() => b.patch({ howToKey: null })}>
        Shut
      </button>
    </>
  );
}

async function openSheet(exerciseId: string) {
  const view = render(
    <BompaProvider>
      <Controls exerciseId={exerciseId} />
      <HowToSheet />
    </BompaProvider>,
  );
  await waitFor(() => expect(screen.getByTestId('hydrated').textContent).toBe('true'), { timeout: 4000 });
  fireEvent.click(screen.getByRole('button', { name: 'Open' }));
  return { view, sheet: await screen.findByRole('dialog', { name: /^How to perform / }) };
}

/** A connection, and a confirmed link from `exerciseId` to the fake service's entry. */
async function connectAndLink(exerciseId: string) {
  await db.providerConnections.put({ providerId: 'fake', connectedAt: 1, cachingAllowed: true, rank: 0 });
  await db.contentLinks.put({ providerId: 'fake', exerciseId, externalId: 'bp-1', externalName: 'Barbell Bench Press', status: 'confirmed', method: 'manual', at: 1 });
}

function goOffline() {
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
}

let provider: ContentProvider;
let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  await db.delete();
  await db.open();
  resetProviderCache();
  resetBackoff();
  provider = {
    id: 'fake',
    name: 'Fake',
    auth: { kind: 'none' },
    capabilities: { search: true, steps: true, images: true, video: false },
    apiHosts: ['fake.example.org'],
    mediaHosts: ['fake.example.org'],
    cachePolicy: () => ({ textMaxAgeMs: null, imageMaxAgeMs: null, cacheVideo: false }),
    test: vi.fn(async () => ({ ok: true as const })),
    search: vi.fn(async () => []),
    fetchHowTo: vi.fn(async () => providerHowTo()),
  };
  PROVIDER_ENTRIES.push({ id: 'fake', name: 'Fake', load: async () => provider });
  // Every request refused: the ingested cue file included, so an ingested
  // movement has no bundled cues to fall back on.
  fetchSpy = vi.fn(async () => new Response('', { status: 404 }));
  vi.stubGlobal('fetch', fetchSpy);
});

afterEach(async () => {
  cleanup();
  PROVIDER_ENTRIES.length = 0;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  await db.close();
});

describe('How-to sheet', () => {
  it('with nothing connected shows the bundled cues and credit and asks no one anything', async () => {
    const { sheet } = await openSheet(BENCH);
    expect(within(sheet).getByText('Execution')).toBeTruthy();
    // A starter movement: its cues were written for the app, not taken from a dataset.
    expect(within(sheet).getByText('Cues written for Bompa · CC0')).toBeTruthy();
    expect(within(sheet).queryByRole('link', { name: 'Free Exercise DB' })).toBeNull();
    expect(within(sheet).queryByText('Loading cues…')).toBeNull();
    expect(within(sheet).getByText('OFFLINE')).toBeTruthy();
    expect(within(sheet).queryByText('ONLINE ONLY')).toBeNull();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(provider.fetchHowTo).not.toHaveBeenCalled();
  });

  it('shows a saved copy of the service’s steps and its credit with the network off', async () => {
    await connectAndLink(BENCH);
    await db.contentCache.put({ providerId: 'fake', externalId: 'bp-1', howTo: providerHowTo(), fetchedAt: Date.now(), expiresAt: null });
    goOffline();

    const { sheet } = await openSheet(BENCH);
    expect(await within(sheet).findByText('Fake step one')).toBeTruthy();
    const credit = within(sheet).getByRole('link', { name: 'Instructions from Fake' });
    expect(credit.getAttribute('href')).toBe(CREDIT.url);
    expect(credit.getAttribute('target')).toBe('_blank');
    expect(credit.parentElement?.textContent).toBe('Instructions from Fake · CC-BY-SA 4 · deusinvictus');
    // The licence name links to its terms, which a saved copy keeps too.
    const licence = within(sheet).getByRole('link', { name: 'CC-BY-SA 4' });
    expect(licence.getAttribute('href')).toBe(CREDIT.licenceUrl);
    expect(licence.getAttribute('target')).toBe('_blank');
    expect(licence.getAttribute('rel')).toContain('noopener');
    // A saved copy is there in a basement, and the sheet says so.
    expect(within(sheet).getByText('OFFLINE')).toBeTruthy();
    // The dataset credit belongs to Bompa's own cues, which are no longer showing.
    expect(within(sheet).queryByRole('link', { name: 'Free Exercise DB' })).toBeNull();
    expect(provider.fetchHowTo).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('linked but never downloaded, offline: bundled cues, the sentence, no loading state', async () => {
    await connectAndLink(BENCH);
    goOffline();

    const { sheet } = await openSheet(BENCH);
    expect(within(sheet).getByText('Execution')).toBeTruthy();
    expect(within(sheet).queryByText('Loading cues…')).toBeNull();
    expect(await within(sheet).findByText(/Fake's instructions for this haven't been downloaded yet/)).toBeTruthy();
    expect(within(sheet).queryByText('Loading cues…')).toBeNull();
    expect(provider.fetchHowTo).not.toHaveBeenCalled();
  });

  it('online and linked: keeps the bundled cues up while it checks, then shows the service’s', async () => {
    await connectAndLink(BENCH);
    let answer: (value: ProviderHowTo) => void = () => {};
    provider.fetchHowTo = vi.fn(() => new Promise<ProviderHowTo>((resolve) => (answer = resolve)));

    const { sheet } = await openSheet(BENCH);
    expect(await within(sheet).findByText('Checking Fake…')).toBeTruthy();
    expect(within(sheet).getByText('Execution')).toBeTruthy();

    await act(async () => answer(providerHowTo()));
    expect(await within(sheet).findByText('Fake step one')).toBeTruthy();
    expect(within(sheet).queryByText('Checking Fake…')).toBeNull();
    await waitFor(async () => expect(await db.contentCache.count()).toBe(1));
  });

  it('says ONLINE ONLY, not OFFLINE, when the service’s terms forbid saving what it sent', async () => {
    provider.cachePolicy = () => ({ textMaxAgeMs: 0, imageMaxAgeMs: 0, cacheVideo: false });
    await connectAndLink(BENCH);

    const { sheet } = await openSheet(BENCH);
    // Not asserting the bundled cues' OFFLINE tag on the way: it shows only until
    // the fake service answers, which can be before the first check runs.
    expect(await within(sheet).findByText('Fake step one')).toBeTruthy();
    expect(within(sheet).getByText('ONLINE ONLY')).toBeTruthy();
    expect(within(sheet).queryByText('OFFLINE')).toBeNull();
    expect(await db.contentCache.count()).toBe(0);
  });

  it(
    'a service that never answers, for a movement with no cues of its own, ends in a sentence within eight seconds',
    async () => {
      await connectAndLink(PULLUPS);
      provider.fetchHowTo = vi.fn(() => new Promise<ProviderHowTo | null>(() => {}));

      const started = Date.now();
      const { sheet } = await openSheet(PULLUPS);
      expect(within(sheet).getByText('Loading cues…')).toBeTruthy();

      expect(await within(sheet).findByText(/Couldn't reach Fake, and Bompa has no cues of its own/, {}, { timeout: 9500 })).toBeTruthy();
      expect(Date.now() - started).toBeLessThan(9500);
      expect(within(sheet).queryByText('Loading cues…')).toBeNull();
    },
    15_000,
  );

  it('with nothing connected and no cues anywhere, says so instead of loading', async () => {
    const { sheet } = await openSheet(PULLUPS);
    expect(await within(sheet).findByText(/No instructions for this movement are available right now/)).toBeTruthy();
    expect(within(sheet).queryByText('Loading cues…')).toBeNull();
  });

  it('shows the service’s picture with alt text, and a sentence rather than a broken image when it fails', async () => {
    const image = 'https://fake.example.org/media/bench.png';
    await connectAndLink(BENCH);
    await db.contentCache.put({
      providerId: 'fake',
      externalId: 'bp-1',
      howTo: providerHowTo({ media: [{ kind: 'image', url: image }] }),
      fetchedAt: Date.now(),
      expiresAt: null,
      imageUrl: image,
      imageExpiresAt: null,
    });
    goOffline();

    const { sheet } = await openSheet(BENCH);
    const picture = await within(sheet).findByRole('img', { name: 'Demonstration of Bench Press from Fake' });
    expect(picture.getAttribute('src')).toBe(image);
    // One credit covers the steps and the picture, so it is said once.
    expect(within(sheet).getAllByRole('link', { name: /Fake$/ })).toHaveLength(1);

    fireEvent.error(picture);
    expect(within(sheet).queryByRole('img')).toBeNull();
    expect(within(sheet).getByText(/This picture isn't saved on this phone/)).toBeTruthy();
  });

  it('credits a picture separately when it carries its own licence', async () => {
    const image = 'https://fake.example.org/media/bench.png';
    await connectAndLink(BENCH);
    await db.contentCache.put({
      providerId: 'fake',
      externalId: 'bp-1',
      howTo: providerHowTo({ media: [{ kind: 'image', url: image, credit: { line: 'Photo', licence: 'CC-BY 4', author: 'someone else' } }] }),
      fetchedAt: Date.now(),
      expiresAt: null,
      imageUrl: image,
      imageExpiresAt: null,
    });
    goOffline();

    const { sheet } = await openSheet(BENCH);
    expect(await within(sheet).findByText('Image from Fake · CC-BY 4 · someone else')).toBeTruthy();
    // No link given for this licence, so its name is plain text rather than a dead link.
    expect(within(sheet).queryByRole('link', { name: 'CC-BY 4' })).toBeNull();
    expect(within(sheet).getByRole('link', { name: 'Instructions from Fake' })).toBeTruthy();
  });

  it('closing while the service is still being asked stops the request and updates nothing afterwards', async () => {
    await connectAndLink(BENCH);
    let signal: AbortSignal | undefined;
    let answer: (value: ProviderHowTo) => void = () => {};
    provider.fetchHowTo = vi.fn((_id, ctx) => {
      signal = ctx.signal;
      return new Promise<ProviderHowTo>((resolve) => (answer = resolve));
    });
    const errors = vi.spyOn(console, 'error');

    const { sheet } = await openSheet(BENCH);
    await within(sheet).findByText('Checking Fake…');
    fireEvent.click(screen.getByRole('button', { name: 'Shut' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(signal?.aborted).toBe(true);

    await act(async () => answer(providerHowTo()));
    expect(screen.queryByText('Fake step one')).toBeNull();
    expect(errors).not.toHaveBeenCalled();
  });
});
