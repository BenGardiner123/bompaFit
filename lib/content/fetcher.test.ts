import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BACKOFF_MS, FETCH_TIMEOUT_MS, backoffUntil, providerFetch, providerFetchImage, resetBackoff } from './fetcher';
import type { ContentProvider } from './provider';

type Target = Pick<ContentProvider, 'id' | 'apiHosts' | 'mediaHosts' | 'auth' | 'allowsBaseUrl'>;

const KEYED: Target = {
  id: 'keyed',
  apiHosts: ['api.example.com'],
  mediaHosts: ['media.example.com'],
  auth: { kind: 'apiKey', headerName: 'X-Api-Key', extraHeaders: { 'X-Api-Host': 'api.example.com' }, helpUrl: 'https://example.com/keys' },
};

const OPEN: Target = {
  id: 'open',
  apiHosts: ['open.example.org'],
  mediaHosts: ['open.example.org'],
  auth: { kind: 'none' },
  allowsBaseUrl: true,
};

const signal = () => new AbortController().signal;

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  resetBackoff();
  fetchMock = vi.fn(async () => new Response('{"ok":true}', { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function sentHeaders(call = 0): Record<string, string> {
  return (fetchMock.mock.calls[call]![1] as RequestInit).headers as Record<string, string>;
}

describe('where a request may go', () => {
  it('refuses a host the adapter did not declare, before any request exists', async () => {
    const result = await providerFetch(KEYED, 'https://evil.example.net/steal', { apiKey: 'secret', signal: signal() });
    expect(result).toMatchObject({ ok: false, reason: 'blocked' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses an API call to a host listed only for media, so the key never reaches it', async () => {
    const result = await providerFetch(KEYED, 'https://media.example.com/search?q=squat', { apiKey: 'secret', signal: signal() });
    expect(result).toMatchObject({ ok: false, reason: 'blocked' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses a look-alike host that merely ends with an allowed one', async () => {
    const result = await providerFetch(KEYED, 'https://notapi.example.com.evil.net/x', { apiKey: 'secret', signal: signal() });
    expect(result).toMatchObject({ ok: false, reason: 'blocked' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses plain http, which would put the key on the wire in clear', async () => {
    const result = await providerFetch(KEYED, 'http://api.example.com/x', { apiKey: 'secret', signal: signal() });
    expect(result).toMatchObject({ ok: false, reason: 'blocked' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('attaches the key and the fixed headers only on an allowed host', async () => {
    const result = await providerFetch(KEYED, 'https://api.example.com/search?q=squat', { apiKey: 'secret', signal: signal() });
    expect(result.ok).toBe(true);
    expect(sentHeaders()).toMatchObject({ 'X-Api-Key': 'secret', 'X-Api-Host': 'api.example.com' });
  });

  it('sends no cookies and no referrer', async () => {
    await providerFetch(KEYED, 'https://api.example.com/x', { apiKey: 'secret', signal: signal() });
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(init.credentials).toBe('omit');
    expect(init.referrerPolicy).toBe('no-referrer');
  });

  it('does not call a keyed provider without a key', async () => {
    const result = await providerFetch(KEYED, 'https://api.example.com/x', { signal: signal() });
    expect(result).toMatchObject({ ok: false, reason: 'unauthorised' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('a self-hosted address replaces the declared hosts rather than adding to them', async () => {
    const ctx = { baseUrl: 'https://wger.my-house.net', signal: signal() };
    expect((await providerFetch(OPEN, 'https://wger.my-house.net/api/x', ctx)).ok).toBe(true);
    expect(await providerFetch(OPEN, 'https://open.example.org/api/x', ctx)).toMatchObject({ reason: 'blocked' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('ignores a base address for an adapter that does not allow one', async () => {
    const result = await providerFetch(KEYED, 'https://elsewhere.net/x', { apiKey: 'secret', baseUrl: 'https://elsewhere.net', signal: signal() });
    expect(result).toMatchObject({ reason: 'blocked' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('failures come back as reasons, never as exceptions', () => {
  it.each([
    [401, 'unauthorised'],
    [403, 'unauthorised'],
    [429, 'quota'],
    [500, 'unexpected'],
    [404, 'unexpected'],
  ])('a %i becomes %s', async (status, reason) => {
    fetchMock.mockResolvedValueOnce(new Response('', { status }));
    await expect(providerFetch(OPEN, 'https://open.example.org/x', { signal: signal() })).resolves.toMatchObject({ ok: false, reason, status });
  });

  it('a network failure becomes network', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await expect(providerFetch(OPEN, 'https://open.example.org/x', { signal: signal() })).resolves.toMatchObject({ ok: false, reason: 'network' });
  });

  it('gives up after eight seconds', async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementationOnce(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
        }),
    );
    const pending = providerFetch(OPEN, 'https://open.example.org/slow', { signal: signal() });
    await vi.advanceTimersByTimeAsync(FETCH_TIMEOUT_MS - 1);
    let settled = false;
    void pending.then(() => (settled = true));
    await Promise.resolve();
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await expect(pending).resolves.toMatchObject({ ok: false, reason: 'network', detail: 'timed out' });
  });

  it("honours the caller's cancel", async () => {
    const controller = new AbortController();
    fetchMock.mockImplementationOnce(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
        }),
    );
    const pending = providerFetch(OPEN, 'https://open.example.org/x', { signal: controller.signal });
    controller.abort();
    await expect(pending).resolves.toMatchObject({ ok: false, reason: 'network' });
  });
});

describe('after a 429', () => {
  it('leaves that provider alone for fifteen minutes, then tries again', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.UTC(2026, 8, 24, 12));
    fetchMock.mockResolvedValueOnce(new Response('', { status: 429 }));
    await providerFetch(OPEN, 'https://open.example.org/x', { signal: signal() });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await expect(providerFetch(OPEN, 'https://open.example.org/y', { signal: signal() })).resolves.toMatchObject({ reason: 'quota' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(backoffUntil('open')).toBe(Date.now() + BACKOFF_MS);

    vi.setSystemTime(Date.now() + BACKOFF_MS - 1);
    await providerFetch(OPEN, 'https://open.example.org/y', { signal: signal() });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    vi.setSystemTime(Date.now() + 1);
    expect((await providerFetch(OPEN, 'https://open.example.org/y', { signal: signal() })).ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('pauses only the provider that said so', async () => {
    fetchMock.mockResolvedValueOnce(new Response('', { status: 429 }));
    await providerFetch(OPEN, 'https://open.example.org/x', { signal: signal() });
    expect((await providerFetch(KEYED, 'https://api.example.com/x', { apiKey: 'k', signal: signal() })).ok).toBe(true);
  });
});

describe('saving an image', () => {
  it('sends no key and no custom headers, and refuses other hosts', async () => {
    fetchMock.mockResolvedValue(new Response('png', { status: 200 }));
    const withKey = { apiKey: 'secret', signal: signal() };
    expect(await providerFetchImage(KEYED, 'https://media.example.com/a.png', withKey)).not.toBeNull();
    expect((fetchMock.mock.calls[0]![1] as RequestInit).headers).toBeUndefined();
    expect(await providerFetchImage(KEYED, 'https://cdn.elsewhere.net/a.png', { signal: signal() })).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('never sends the key to a media host, even one that is also an API host', async () => {
    const shared: Target = { ...KEYED, apiHosts: ['both.example.com'], mediaHosts: ['both.example.com'] };
    fetchMock.mockResolvedValue(new Response('png', { status: 200 }));
    // The context a caller holds may carry the key; the image request must not.
    const ctx = { apiKey: 'secret', signal: signal() };
    expect(await providerFetchImage(shared, 'https://both.example.com/a.png', ctx)).not.toBeNull();
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(init.headers).toBeUndefined();
    expect(JSON.stringify(init)).not.toContain('secret');
    expect(fetchMock.mock.calls[0]![0]).not.toContain('secret');
    expect(init.credentials).toBe('omit');
    expect(init.referrerPolicy).toBe('no-referrer');
  });

  it('refuses a picture from an API-only host', async () => {
    expect(await providerFetchImage(KEYED, 'https://api.example.com/a.png', { signal: signal() })).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses a picture from a host the adapter never listed', async () => {
    expect(await providerFetchImage(OPEN, 'https://tracker.example.net/pixel.png', { signal: signal() })).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('a self-hosted address is the only media host too', async () => {
    fetchMock.mockResolvedValue(new Response('png', { status: 200 }));
    const ctx = { baseUrl: 'https://wger.my-house.net', signal: signal() };
    expect(await providerFetchImage(OPEN, 'https://open.example.org/a.png', ctx)).toBeNull();
    expect(await providerFetchImage(OPEN, 'https://wger.my-house.net/media/a.png', ctx)).not.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('falls back to an opaque request when the media host sends no CORS header', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('CORS')).mockResolvedValueOnce(new Response('png', { status: 200 }));
    expect(await providerFetchImage(OPEN, 'https://open.example.org/a.png', { signal: signal() })).not.toBeNull();
    expect((fetchMock.mock.calls[1]![1] as RequestInit).mode).toBe('no-cors');
  });
});
