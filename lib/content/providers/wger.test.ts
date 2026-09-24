import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetBackoff } from '../fetcher';
import { MAX_STEPS, MAX_STEP_CHARS, type ProviderContext } from '../provider';
import { loadProvider, resetProviderCache } from '../registry';
import { descriptionToSteps, wger } from './wger';

// Every fixture is a real wger response, recorded from https://wger.de/api/v2/.
function fixture(name: string): unknown {
  return JSON.parse(readFileSync(join(__dirname, 'fixtures', 'wger', `${name}.json`), 'utf8')) as unknown;
}

const BENCH_UUID = '3717d144-7815-4a97-9a56-956fb889c996';
const PLACEHOLDER_UUID = '42e40343-955c-43a2-902e-e70bd603a713';
const BEAR_WALK_UUID = 'b7267f90-8706-442b-b918-507e16092b8e';
const UNKNOWN_UUID = '00000000-0000-4000-8000-000000000000';

const ctx = (extra: Partial<ProviderContext> = {}): ProviderContext => ({ signal: new AbortController().signal, ...extra });

let fetchMock: ReturnType<typeof vi.fn>;

/** Answer each request with the fixture its URL asks for, the way wger would. */
function serveFixtures(url: string): Response {
  const u = new URL(url);
  const uuid = u.searchParams.get('uuid');
  const search = u.searchParams.get('name__search');
  let body: unknown = fixture('search-empty');
  if (uuid === BENCH_UUID) body = fixture('exerciseinfo-bench-press');
  else if (uuid === PLACEHOLDER_UUID) body = fixture('exerciseinfo-placeholder');
  else if (uuid === BEAR_WALK_UUID) body = fixture('exerciseinfo-bear-walk');
  else if (uuid) body = fixture('exerciseinfo-unknown');
  else if (search === 'squat') body = fixture('search-squat');
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

function requestedUrl(call = 0): URL {
  return new URL(String(fetchMock.mock.calls[call]![0]));
}

/** A how-to built from a hand-made exercise, for markup no real entry happens to contain. */
async function howToFromDescription(description: string) {
  const exercise = structuredClone((fixture('exerciseinfo-bench-press') as { results: Record<string, unknown>[] }).results[0]!);
  const translations = exercise.translations as { language: number; description: string }[];
  translations.find((t) => t.language === 2)!.description = description;
  fetchMock.mockImplementation(async () => new Response(JSON.stringify({ count: 1, results: [exercise] }), { status: 200 }));
  return wger.fetchHowTo(BENCH_UUID, ctx());
}

beforeEach(() => {
  resetBackoff();
  fetchMock = vi.fn(async (url: string) => serveFixtures(url));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('registration', () => {
  it('is listed and loads on demand under its own id', async () => {
    resetProviderCache();
    const loaded = await loadProvider('wger');
    expect(loaded).toBe(wger);
  });

  it('needs no key and keeps Creative Commons content without a time limit, but never video', () => {
    expect(wger.auth).toEqual({ kind: 'none' });
    expect(wger.cachePolicy({ providerId: 'wger', connectedAt: 0, cachingAllowed: false, rank: 0 })).toEqual({
      textMaxAgeMs: null,
      imageMaxAgeMs: null,
      cacheVideo: false,
    });
  });
});

describe('search', () => {
  it('maps a recorded search to English names, equipment, muscle and a thumbnail', async () => {
    const matches = await wger.search('squat', ctx());
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0]).toEqual({
      externalId: 'a2f5b6ef-b780-49c0-8d96-fdaff23e27ce',
      name: 'Squats',
      equipment: 'Barbell',
      muscle: expect.any(String),
    });
    // Box squat has a picture; its small thumbnail is what a results list needs.
    expect(matches[2]!.thumbUrl).toMatch(/^https:\/\/wger\.de\/media\/exercise-images\/977\/.+\.png\.200x200_q85\.png$/);
    for (const match of matches) {
      expect(match.name).not.toMatch(/[<>]/);
      if (match.thumbUrl) expect(new URL(match.thumbUrl).host).toBe('wger.de');
    }
  });

  it('asks for one small page, by name, of the exercise endpoint', async () => {
    await wger.search('  back   squat ', ctx());
    const url = requestedUrl();
    expect(url.origin).toBe('https://wger.de');
    expect(url.pathname).toBe('/api/v2/exerciseinfo/');
    expect(url.searchParams.get('name__search')).toBe('back squat');
    expect(url.searchParams.get('limit')).toBe('10');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('returns an empty list, without throwing, when nothing matches', async () => {
    await expect(wger.search('zzqxnotanexercise', ctx())).resolves.toEqual([]);
  });

  it('does not call the service for an empty search', async () => {
    await expect(wger.search('   ', ctx())).resolves.toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('skips entries that have no English name', async () => {
    const recorded = fixture('search-squat') as { results: { translations: { language: number }[] }[] };
    recorded.results[0]!.translations = recorded.results[0]!.translations.filter((t) => t.language !== 2);
    fetchMock.mockImplementation(async () => new Response(JSON.stringify(recorded), { status: 200 }));
    const matches = await wger.search('squat', ctx());
    expect(matches.map((m) => m.name)).not.toContain('Squats');
    expect(matches.length).toBe(recorded.results.length - 1);
  });

  it('returns an empty list for a network failure, a server error or a body that is not JSON', async () => {
    fetchMock.mockImplementationOnce(async () => {
      throw new TypeError('Failed to fetch');
    });
    await expect(wger.search('squat', ctx())).resolves.toEqual([]);
    fetchMock.mockImplementationOnce(async () => new Response('oops', { status: 500 }));
    await expect(wger.search('squat', ctx())).resolves.toEqual([]);
    fetchMock.mockImplementationOnce(async () => new Response('<html>maintenance</html>', { status: 200 }));
    await expect(wger.search('squat', ctx())).resolves.toEqual([]);
  });
});

describe('instructions for one entry', () => {
  it('turns a recorded entry into plain steps, muscles, the main image and a credit', async () => {
    const howTo = await wger.fetchHowTo(BENCH_UUID, ctx());
    expect(howTo).not.toBeNull();
    expect(howTo!.externalId).toBe(BENCH_UUID);
    expect(howTo!.steps).toEqual([
      'Lay down on a bench, the bar should be directly above your eyes, the knees are somewhat angled and the feet are firmly on the floor. Concentrate, breath deeply and grab the bar more than shoulder wide. Bring it slowly down till it briefly touches your chest at the height of your nipples. Push the bar up.',
      "If you train with a high weight it is advisable to have a spotter that can help you up if you can't lift the weight on your own.",
      'With the width of the grip you can also control which part of the chest is trained more: wide grip: outer chest muscles; narrow grip: inner chest muscles and triceps.',
    ]);
    for (const step of howTo!.steps) {
      expect(step).not.toMatch(/<|>|&[a-z#0-9]+;/i);
    }
    expect(howTo!.muscles).toBe('Chest; also Shoulders, Triceps');
    const image = howTo!.media.find((m) => m.kind === 'image');
    expect(image?.url).toBe('https://wger.de/media/exercise-images/192/Bench-press-1.png');
    expect(image?.credit).toMatchObject({ licence: 'CC-BY-SA 3', licenceUrl: 'https://creativecommons.org/licenses/by-sa/3.0/deed.en', author: 'Everkinetic' });
  });

  it('credits the English text: title, author, source, licence, and that it was adapted', async () => {
    const howTo = await wger.fetchHowTo(BENCH_UUID, ctx());
    expect(howTo!.credit).toEqual({
      line: 'Adapted from "Bench Press" on wger',
      licence: 'CC-BY-SA 3',
      licenceUrl: 'https://creativecommons.org/licenses/by-sa/3.0/deed.en',
      author: 'sistab2',
      url: 'https://wger.de/exercise/73/',
    });
  });

  it.each([
    [1, 'CC-BY-SA 3', 'https://creativecommons.org/licenses/by-sa/3.0/deed.en'],
    [2, 'CC-BY-SA 4', 'https://creativecommons.org/licenses/by-sa/4.0/deed.en'],
    [3, 'CC0', 'https://creativecommons.org/publicdomain/zero/1.0/deed.en'],
  ])('links licence %i, %s, to its terms', async (id, name, url) => {
    const exercise = structuredClone((fixture('exerciseinfo-bench-press') as { results: Record<string, unknown>[] }).results[0]!);
    for (const t of exercise.translations as Record<string, unknown>[]) t.license = id;
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ results: [exercise] }), { status: 200 }));
    const howTo = await wger.fetchHowTo(BENCH_UUID, ctx());
    expect(howTo!.credit).toMatchObject({ licence: name, licenceUrl: url });
  });

  it('falls back to the licence link wger gives with the exercise, for an id it has no row for', async () => {
    const exercise = structuredClone((fixture('exerciseinfo-bench-press') as { results: Record<string, unknown>[] }).results[0]!);
    exercise.license = { id: 9, short_name: 'CC-BY 5', url: 'https://creativecommons.org/licenses/by/5.0/' };
    for (const t of exercise.translations as Record<string, unknown>[]) t.license = 9;
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ results: [exercise] }), { status: 200 }));
    const howTo = await wger.fetchHowTo(BENCH_UUID, ctx());
    expect(howTo!.credit).toMatchObject({ licence: 'CC-BY 5', licenceUrl: 'https://creativecommons.org/licenses/by/5.0/' });
  });

  it('offers the main video to stream, credited separately', async () => {
    const howTo = await wger.fetchHowTo(BENCH_UUID, ctx());
    const video = howTo!.media.find((m) => m.kind === 'video');
    expect(video?.url).toMatch(/^https:\/\/wger\.de\/media\/exercise-video\//);
    expect(video?.credit?.line).toBe('Video of "Bench Press" from wger');
  });

  it('asks by the stable uuid rather than wger’s numeric id', async () => {
    await wger.fetchHowTo(BENCH_UUID, ctx());
    const url = requestedUrl();
    expect(url.pathname).toBe('/api/v2/exerciseinfo/');
    expect(url.searchParams.get('uuid')).toBe(BENCH_UUID);
  });

  it('drops hand-typed bullets and decodes entities from a recorded entry', async () => {
    const howTo = await wger.fetchHowTo(BEAR_WALK_UUID, ctx());
    expect(howTo!.steps[0]).toBe('Rest your weight on your palms and the balls of your feet, not dissimilar to normal pushup position');
    expect(howTo!.steps[1]).toBe('Move by stepping with your R palm and L foot, then your L palm and R foot. Basically, walk like a lumbering bear.');
    expect(howTo!.credit.author).toBe('nate303303');
    expect(howTo!.credit.licence).toBe('CC-BY-SA 4');
  });

  it('returns null, without throwing, for an unknown uuid', async () => {
    await expect(wger.fetchHowTo(UNKNOWN_UUID, ctx())).resolves.toBeNull();
  });

  it('returns null without a request for something that is not a uuid', async () => {
    await expect(wger.fetchHowTo('../../admin', ctx())).resolves.toBeNull();
    await expect(wger.fetchHowTo('73', ctx())).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns null for a network failure, a server error and a malformed body', async () => {
    fetchMock.mockImplementationOnce(async () => {
      throw new TypeError('Failed to fetch');
    });
    await expect(wger.fetchHowTo(BENCH_UUID, ctx())).resolves.toBeNull();
    fetchMock.mockImplementationOnce(async () => new Response('', { status: 502 }));
    await expect(wger.fetchHowTo(BENCH_UUID, ctx())).resolves.toBeNull();
    fetchMock.mockImplementationOnce(async () => new Response('{"results":"nope"}', { status: 200 }));
    await expect(wger.fetchHowTo(BENCH_UUID, ctx())).resolves.toBeNull();
  });

  it('ignores a row for a different entry, in case the filter is ever ignored by the server', async () => {
    const other = fixture('exerciseinfo-bear-walk');
    fetchMock.mockImplementation(async () => new Response(JSON.stringify(other), { status: 200 }));
    await expect(wger.fetchHowTo(BENCH_UUID, ctx())).resolves.toBeNull();
  });

  it('falls back to "wger.de contributors" when an entry names no author', async () => {
    const exercise = structuredClone((fixture('exerciseinfo-bench-press') as { results: Record<string, unknown>[] }).results[0]!);
    const english = (exercise.translations as Record<string, unknown>[]).find((t) => t.language === 2)!;
    english.license_author = '';
    english.author_history = [];
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ results: [exercise] }), { status: 200 }));
    const howTo = await wger.fetchHowTo(BENCH_UUID, ctx());
    expect(howTo!.credit.author).toBe('wger.de contributors');
  });

  it('lists everyone in the author history once, the licensed author first', async () => {
    const exercise = structuredClone((fixture('exerciseinfo-bench-press') as { results: Record<string, unknown>[] }).results[0]!);
    const english = (exercise.translations as Record<string, unknown>[]).find((t) => t.language === 2)!;
    english.author_history = ['editor-two', 'sistab2', 'editor-two'];
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ results: [exercise] }), { status: 200 }));
    const howTo = await wger.fetchHowTo(BENCH_UUID, ctx());
    expect(howTo!.credit.author).toBe('sistab2, editor-two');
  });
});

describe('entries that say nothing', () => {
  it('rejects the recorded importer placeholder', async () => {
    await expect(wger.fetchHowTo(PLACEHOLDER_UUID, ctx())).resolves.toBeNull();
  });

  it('rejects an empty or one-line description', async () => {
    await expect(howToFromDescription('')).resolves.toBeNull();
    await expect(howToFromDescription('<p>Very common shoulder exercise.</p>')).resolves.toBeNull();
    await expect(howToFromDescription('<p>&nbsp;</p>\n<p></p>')).resolves.toBeNull();
  });
});

describe('markup never survives', () => {
  it('drops script and style bodies and every attribute-borne handler', async () => {
    const howTo = await howToFromDescription(
      '<p>Brace your core and keep the bar over the middle of your foot.</p>' +
        '<script>alert("x")</script><style>p{color:red}</style>' +
        '<p><img src=x onerror="alert(1)">Drive through the whole foot <a href="javascript:alert(1)">to stand</a>.</p>',
    );
    const text = howTo!.steps.join(' ');
    expect(text).not.toMatch(/alert|onerror|javascript|color:red|[<>]/);
    expect(howTo!.steps).toEqual([
      'Brace your core and keep the bar over the middle of your foot.',
      'Drive through the whole foot to stand.',
    ]);
  });

  it('does not let encoded markup come back to life after decoding', async () => {
    const howTo = await howToFromDescription(
      '<p>Keep your elbows tucked &lt;img src=x onerror=alert(1)&gt; and lower under control.</p>',
    );
    expect(howTo!.steps.join(' ')).not.toMatch(/[<>]|onerror/);
  });

  it('removes a tag left unterminated and an unfinished comment', async () => {
    const howTo = await howToFromDescription('<p>Keep your chest up and sit between your heels.</p><p>Then stand <img src=x onerror=alert(1)');
    expect(howTo!.steps.join(' ')).not.toMatch(/[<>]|onerror/);
    const commented = await howToFromDescription('<p>Keep your chest up and sit between your heels.</p><!-- <script>alert(1)</script>');
    expect(commented!.steps).toEqual(['Keep your chest up and sit between your heels.']);
  });

  it('decodes numeric and named entities and drops ones it cannot name', () => {
    expect(descriptionToSteps('<p>Hold for 30&nbsp;seconds at 90&deg; &#8212; don&#x27;t let the hips sag &bogus;at all.</p>')).toEqual([
      "Hold for 30 seconds at 90° — don't let the hips sag at all.",
    ]);
  });

  it('drops code points that are not characters rather than throwing', () => {
    expect(() => descriptionToSteps('<p>Stand tall with the bar racked on your upper back &#0; &#xD800; &#99999999; now.</p>')).not.toThrow();
  });
});

describe('splitting into steps', () => {
  it('splits one long paragraph into a step per sentence, keeping abbreviations whole', () => {
    const steps = descriptionToSteps(
      '<p>Stand with your feet shoulder width apart and the bar on your upper back. Measure the distance, i.e. 40 yards, before you start. ' +
        'Sit down between your heels until your thighs are parallel to the floor. Drive back up through the whole foot and lock out at the top.</p>',
    );
    expect(steps).toEqual([
      'Stand with your feet shoulder width apart and the bar on your upper back.',
      'Measure the distance, i.e. 40 yards, before you start.',
      'Sit down between your heels until your thighs are parallel to the floor.',
      'Drive back up through the whole foot and lock out at the top.',
    ]);
  });

  it('keeps a numbered list as its own steps, without the numbers', () => {
    expect(descriptionToSteps('<ol><li>1. Grip the bar just outside your knees.</li><li>2. Pull the slack out of the bar before it leaves the floor.</li></ol>')).toEqual([
      'Grip the bar just outside your knees.',
      'Pull the slack out of the bar before it leaves the floor.',
    ]);
  });

  it('accepts a description written as plain text with line breaks', () => {
    expect(descriptionToSteps('Hinge at the hips with a flat back.\n\nRow the handle to your lower ribs.')).toEqual([
      'Hinge at the hips with a flat back.',
      'Row the handle to your lower ribs.',
    ]);
  });

  it('holds to the step count and length every adapter promises', async () => {
    const long = 'Keep the movement slow and controlled throughout the whole range '.repeat(10);
    const many = Array.from({ length: 30 }, (_, i) => `<li>Step number ${i + 1} of a very long list of cues for this lift.</li>`).join('');
    const howTo = await howToFromDescription(`<p>${long}</p><ul>${many}</ul>`);
    expect(howTo!.steps.length).toBe(MAX_STEPS);
    for (const step of howTo!.steps) expect(step.length).toBeLessThanOrEqual(MAX_STEP_CHARS);
  });
});

describe('where it may send requests', () => {
  it('declares wger.de as its only host, for the API and for pictures', () => {
    expect(wger.apiHosts).toEqual(['wger.de']);
    expect(wger.mediaHosts).toEqual(['wger.de']);
  });

  it('never keeps media from a host it may not contact', async () => {
    const exercise = structuredClone((fixture('exerciseinfo-bench-press') as { results: Record<string, unknown>[] }).results[0]!);
    const images = exercise.images as Record<string, unknown>[];
    images.forEach((image) => {
      image.image = 'https://tracker.example.net/pixel.png';
    });
    const videos = exercise.videos as Record<string, unknown>[];
    videos.forEach((video) => {
      video.video = 'javascript:alert(1)';
    });
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ results: [exercise] }), { status: 200 }));
    const howTo = await wger.fetchHowTo(BENCH_UUID, ctx());
    expect(howTo!.media).toEqual([]);
  });

  it('uses a self-hosted instance instead of wger.de when one is set', async () => {
    await wger.search('squat', ctx({ baseUrl: 'https://wger.example.org/' }));
    expect(requestedUrl().origin).toBe('https://wger.example.org');
  });

  it('refuses a plain-http self-hosted address without sending anything', async () => {
    await expect(wger.search('squat', ctx({ baseUrl: 'http://wger.example.org' }))).resolves.toEqual([]);
    await expect(wger.fetchHowTo(BENCH_UUID, ctx({ baseUrl: 'http://wger.example.org' }))).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('being polite after too many requests', () => {
  it('stops calling wger after a 429 and answers from nothing rather than retrying', async () => {
    fetchMock.mockImplementationOnce(async () => new Response('', { status: 429 }));
    await expect(wger.search('squat', ctx())).resolves.toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await expect(wger.search('squat', ctx())).resolves.toEqual([]);
    await expect(wger.fetchHowTo(BENCH_UUID, ctx())).resolves.toBeNull();
    await expect(wger.test(ctx())).resolves.toMatchObject({ ok: false, reason: 'quota' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('testing the connection', () => {
  it('passes on a real one-row answer, spending a single request', async () => {
    fetchMock.mockImplementation(async () => new Response(JSON.stringify(fixture('search-squat')), { status: 200 }));
    await expect(wger.test(ctx())).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(requestedUrl().searchParams.get('limit')).toBe('1');
  });

  it('reports a network failure and a non-wger answer in words the screen can use', async () => {
    fetchMock.mockImplementationOnce(async () => {
      throw new TypeError('Failed to fetch');
    });
    await expect(wger.test(ctx())).resolves.toMatchObject({ ok: false, reason: 'network' });
    fetchMock.mockImplementationOnce(async () => new Response('<html></html>', { status: 200 }));
    await expect(wger.test(ctx())).resolves.toMatchObject({ ok: false, reason: 'unexpected' });
  });
});
