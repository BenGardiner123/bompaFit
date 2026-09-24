import { afterEach, describe, expect, it, vi } from 'vitest';
import { MAX_STEPS, MAX_STEP_CHARS, clampHowTo, type ContentProvider } from './provider';
import { isKnownProvider, loadProvider, providerEntries, resetProviderCache } from './registry';
import { PROVIDER_ENTRIES } from './providers';

const credit = { line: 'Instructions from P' };

describe('holding a how-to to its limits', () => {
  it('flattens whitespace, drops empty steps and caps count and length', () => {
    const long = 'x'.repeat(MAX_STEP_CHARS + 50);
    const out = clampHowTo({
      externalId: 'e',
      steps: ['  Brace\n\n  hard ', '', long, ...Array.from({ length: 30 }, (_, i) => `Step ${i}`)],
      media: [],
      credit,
    });
    expect(out?.steps[0]).toBe('Brace hard');
    expect(out?.steps[1]).toHaveLength(MAX_STEP_CHARS);
    expect(out?.steps).toHaveLength(MAX_STEPS);
  });

  it('returns null when nothing usable is left', () => {
    expect(clampHowTo({ externalId: 'e', steps: ['  ', ''], media: [], credit })).toBeNull();
  });

  it('keeps only https media and links, so a provider cannot smuggle a script URL in', () => {
    const out = clampHowTo({
      externalId: 'e',
      steps: ['Go'],
      media: [
        { kind: 'image', url: 'javascript:alert(1)' },
        { kind: 'image', url: 'data:image/png;base64,AAAA' },
        { kind: 'image', url: 'https://media.example.org/a.png' },
      ],
      credit: { line: 'From P', url: 'javascript:alert(1)' },
    });
    expect(out?.media.map((item) => item.url)).toEqual(['https://media.example.org/a.png']);
    expect(out?.credit.url).toBeUndefined();
  });

  it('keeps a licence link only when it is https and names a licence', () => {
    const base = { externalId: 'e', steps: ['Go'], media: [] };
    const good = clampHowTo({ ...base, credit: { line: 'From P', licence: 'CC0', licenceUrl: 'https://creativecommons.org/publicdomain/zero/1.0/' } });
    expect(good?.credit.licenceUrl).toBe('https://creativecommons.org/publicdomain/zero/1.0/');
    const script = clampHowTo({ ...base, credit: { line: 'From P', licence: 'CC0', licenceUrl: 'javascript:alert(1)' } });
    expect(script?.credit.licenceUrl).toBeUndefined();
    const nameless = clampHowTo({ ...base, credit: { line: 'From P', licenceUrl: 'https://creativecommons.org/' } });
    expect(nameless?.credit.licenceUrl).toBeUndefined();
  });
});

describe('the registry', () => {
  afterEach(() => {
    PROVIDER_ENTRIES.length = 0;
    resetProviderCache();
  });

  it('knows exactly the services that are listed, each once', () => {
    const ids = providerEntries().map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(isKnownProvider(id)).toBe(true);
    expect(isKnownProvider('not-a-service')).toBe(false);
  });

  it('loads an adapter once, however many ask at the same time', async () => {
    const provider = { id: 'fake' } as ContentProvider;
    const load = vi.fn(async () => provider);
    PROVIDER_ENTRIES.push({ id: 'fake', name: 'Fake', load });
    const [a, b] = await Promise.all([loadProvider('fake'), loadProvider('fake')]);
    expect(a).toBe(provider);
    expect(b).toBe(provider);
    expect(load).toHaveBeenCalledTimes(1);
    expect(isKnownProvider('fake')).toBe(true);
  });

  it('refuses an adapter whose id disagrees with its entry, and forgets a failed load', async () => {
    PROVIDER_ENTRIES.push({ id: 'named', name: 'Named', load: async () => ({ id: 'other' }) as ContentProvider });
    expect(await loadProvider('named')).toBeNull();

    const load = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ id: 'flaky' });
    PROVIDER_ENTRIES.push({ id: 'flaky', name: 'Flaky', load });
    expect(await loadProvider('flaky')).toBeNull();
    expect(await loadProvider('flaky')).toMatchObject({ id: 'flaky' });
  });
});
