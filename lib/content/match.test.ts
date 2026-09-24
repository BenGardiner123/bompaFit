import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContentLink } from '@/lib/types';
import { resetBackoff } from './fetcher';
import { MATCH_THRESHOLD, bestMatch, findMatches, isUsableLink, nameTokens, scoreMatch } from './match';
import type { ContentProvider, ExternalMatch } from './provider';

const m = (name: string, externalId = name.toLowerCase().replace(/\s+/g, '-'), equipment?: string): ExternalMatch => ({
  externalId,
  name,
  ...(equipment ? { equipment } : {}),
});

describe('names', () => {
  it('folds case, punctuation and the usual abbreviations', () => {
    expect(nameTokens('DB Row')).toEqual(nameTokens('Dumbbell row'));
    expect(nameTokens('BB Bench-Press')).toEqual(['barbell', 'bench', 'press']);
    expect(nameTokens('Squat with the Barbell')).toEqual(['squat', 'barbell']);
  });
});

describe('scoring a candidate', () => {
  it('matches "Barbell Back Squat" to "Barbell Squat"', () => {
    const best = bestMatch({ name: 'Barbell Back Squat', equipment: 'barbell' }, [m('Front Squat'), m('Barbell Squat'), m('Goblet Squat')]);
    expect(best?.match.name).toBe('Barbell Squat');
  });

  it('does not suggest "Romanian Deadlift" for "Deadlift"', () => {
    expect(scoreMatch({ name: 'Deadlift' }, m('Romanian Deadlift'))).toBeLessThan(MATCH_THRESHOLD);
    expect(bestMatch({ name: 'Deadlift' }, [m('Romanian Deadlift'), m('Sumo Deadlift')])).toBeNull();
    expect(bestMatch({ name: 'Deadlift' }, [m('Romanian Deadlift'), m('Deadlift')])?.match.name).toBe('Deadlift');
  });

  it('keeps a qualifier when both names carry it', () => {
    expect(bestMatch({ name: 'Incline Bench Press' }, [m('Bench Press'), m('Incline Bench Press')])?.match.name).toBe('Incline Bench Press');
  });

  it('prefers the entry whose equipment agrees', () => {
    const best = bestMatch({ name: 'Bent Over Row', equipment: 'barbell' }, [m('Bent Over Row', 'db', 'Dumbbell'), m('Bent Over Row', 'bb', 'Barbell')]);
    expect(best?.match.externalId).toBe('bb');
  });

  it('returns nothing for an unrelated list, or an empty one', () => {
    expect(bestMatch({ name: 'Barbell Back Squat' }, [m('Lat Pulldown'), m('Bicep Curl')])).toBeNull();
    expect(bestMatch({ name: 'Barbell Back Squat' }, [])).toBeNull();
  });
});

describe('which links supply content', () => {
  const base: ContentLink = { providerId: 'p', exerciseId: 'squat', externalId: 'x', status: 'suggested', method: 'auto', at: 0 };
  it('a suggestion does not; the same link once confirmed does', () => {
    expect(isUsableLink(base)).toBe(false);
    expect(isUsableLink({ ...base, status: 'confirmed' })).toBe(true);
    expect(isUsableLink({ ...base, status: 'none', externalId: null })).toBe(false);
    expect(isUsableLink(undefined)).toBe(false);
  });
});

describe('a matching run', () => {
  const catalogue: Record<string, ExternalMatch[]> = {
    'Barbell Back Squat': [m('Barbell Squat', 'sq')],
    Deadlift: [m('Romanian Deadlift', 'rdl')],
    'Bench Press': [m('Bench Press', 'bp')],
  };

  function fakeProvider(search = vi.fn(async (q: string) => catalogue[q] ?? [])): ContentProvider {
    return {
      id: 'p',
      name: 'P',
      auth: { kind: 'none' },
      capabilities: { search: true, steps: true, images: false, video: false },
      apiHosts: ['p.example.org'],
      mediaHosts: ['p.example.org'],
      cachePolicy: () => ({ textMaxAgeMs: null, imageMaxAgeMs: null, cacheVideo: false }),
      test: async () => ({ ok: true }),
      search,
      fetchHowTo: async () => null,
    };
  }

  const movements = [
    { id: 'barbell-back-squat', name: 'Barbell Back Squat' },
    { id: 'deadlift', name: 'Deadlift' },
    { id: 'bench-press', name: 'Bench Press' },
  ];
  const ctx = () => ({ signal: new AbortController().signal });

  beforeEach(() => resetBackoff());

  it('stores suggestions, never confirmations, and nothing for a poor match', async () => {
    const run = await findMatches({ provider: fakeProvider(), ctx, movements, existing: [], now: 5 });
    expect(run.searched).toBe(3);
    expect(run.suggestions.map((l) => [l.exerciseId, l.externalId, l.status])).toEqual([
      ['barbell-back-squat', 'sq', 'suggested'],
      ['bench-press', 'bp', 'suggested'],
    ]);
  });

  it('never asks again about a movement already suggested, confirmed or declined', async () => {
    const search = vi.fn(async (q: string) => catalogue[q] ?? []);
    const existing: ContentLink[] = [
      { providerId: 'p', exerciseId: 'barbell-back-squat', externalId: 'sq', status: 'confirmed', method: 'auto', at: 1 },
      { providerId: 'p', exerciseId: 'bench-press', externalId: null, status: 'none', method: 'manual', at: 1 },
    ];
    const run = await findMatches({ provider: fakeProvider(search), ctx, movements, existing, now: 5 });
    expect(search).toHaveBeenCalledTimes(1);
    expect(search).toHaveBeenCalledWith('Deadlift', expect.anything());
    expect(run.suggestions).toEqual([]);
  });

  it('searches one at a time and stops at the run limit', async () => {
    let inFlight = 0;
    let most = 0;
    const search = vi.fn(async () => {
      inFlight += 1;
      most = Math.max(most, inFlight);
      await Promise.resolve();
      inFlight -= 1;
      return [];
    });
    const many = Array.from({ length: 60 }, (_, i) => ({ id: `lift-${i}`, name: `Lift ${i}` }));
    const run = await findMatches({ provider: fakeProvider(search), ctx, movements: many, existing: [], now: 5 });
    expect(most).toBe(1);
    expect(run.searched).toBe(40);
    expect(search).toHaveBeenCalledTimes(40);
  });

  it('keeps what it found when an adapter breaks its promise not to throw', async () => {
    const search = vi.fn(async (q: string) => {
      if (q === 'Deadlift') throw new Error('bug');
      return catalogue[q] ?? [];
    });
    const run = await findMatches({ provider: fakeProvider(search), ctx, movements, existing: [], now: 5 });
    expect(run.stoppedBy).toBe('unexpected');
    expect(run.suggestions).toHaveLength(1);
  });
});
