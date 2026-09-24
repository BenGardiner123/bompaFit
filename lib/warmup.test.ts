import { describe, expect, it } from 'vitest';
import {
  WARMUP_LIMITS,
  readWarmupItems,
  readWarmupTicks,
  resolveWarmup,
  toggleTick,
} from './warmup';
import { moveKey, moveWarmupItem, newWarmupItem, warmupProgress } from './warmupList';
import { WARMUP_MOVES } from './warmupMoves';
import type { WarmupItem } from './types';

const OWN: WarmupItem[] = [
  { id: 'cat-cow', name: 'Cat-cow', dose: '8 slow' },
  { id: 'band-marches', name: 'Band marches', dose: '10 each side' },
];
const DEFAULTS: WarmupItem[] = [{ id: 'hip-aeroplanes', name: 'Hip aeroplanes', dose: '5 each side' }];

describe('resolveWarmup', () => {
  it("shows the workout's own list by default", () => {
    expect(resolveWarmup({ warmup: OWN }, DEFAULTS)).toEqual(OWN);
  });

  it('shows the default list when the workout says to use it, whatever its own list holds', () => {
    expect(resolveWarmup({ warmup: OWN, warmupUsesDefault: true }, DEFAULTS)).toEqual(DEFAULTS);
  });

  it('is empty with no routine, no list, or a default that was never set', () => {
    expect(resolveWarmup(null, DEFAULTS)).toEqual([]);
    expect(resolveWarmup({}, DEFAULTS)).toEqual([]);
    expect(resolveWarmup({ warmupUsesDefault: true }, undefined)).toEqual([]);
  });
});

describe('readWarmupItems', () => {
  it('drops anything that is not an item with a name', () => {
    expect(readWarmupItems('nope')).toEqual([]);
    expect(readWarmupItems([null, 3, { name: '   ' }, { dose: '5' }, { name: 'Dead bugs' }])).toEqual([
      { id: 'dead-bugs', name: 'Dead bugs' },
    ]);
  });

  it('trims and cuts names and doses to length', () => {
    const [item] = readWarmupItems([{ id: 'x', name: `  ${'a'.repeat(80)}  `, dose: `${'5'.repeat(40)}` }]);
    expect(item!.name).toHaveLength(WARMUP_LIMITS.NAME);
    expect(item!.dose).toHaveLength(WARMUP_LIMITS.DOSE);
  });

  it('leaves out an empty dose rather than storing a blank one', () => {
    expect(readWarmupItems([{ id: 'a', name: 'Leg swings', dose: '  ' }])).toEqual([{ id: 'a', name: 'Leg swings' }]);
  });

  it('keeps at most twenty items', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ id: `m${i}`, name: `Move ${i}` }));
    expect(readWarmupItems(many)).toHaveLength(WARMUP_LIMITS.ITEMS);
  });

  it('gives a duplicate or missing id a fresh one, so one tick never ticks two items', () => {
    const items = readWarmupItems([
      { id: 'same', name: 'Bird dogs' },
      { id: 'same', name: 'Bird dogs' },
      { name: 'Bird dogs' },
    ]);
    expect(new Set(items.map((item) => item.id)).size).toBe(3);
  });
});

describe('newWarmupItem', () => {
  it('mints an id the list does not already use', () => {
    const item = newWarmupItem(' Cat-cow ', ' 10 ', [{ id: 'w3', name: 'A' }, { id: 'w2', name: 'B' }]);
    expect(item).toEqual({ id: 'w4', name: 'Cat-cow', dose: '10' });
  });

  it('leaves the dose off when none is given', () => {
    expect(newWarmupItem('Leg swings', ' ', [])).toEqual({ id: 'w1', name: 'Leg swings' });
  });

  it('refuses an empty name or a full list', () => {
    expect(newWarmupItem('  ', '5', OWN)).toBeNull();
    const full = Array.from({ length: WARMUP_LIMITS.ITEMS }, (_, i) => ({ id: `m${i}`, name: `Move ${i}` }));
    expect(newWarmupItem('One more', '', full)).toBeNull();
  });
});

describe('moveWarmupItem', () => {
  const list = ['a', 'b', 'c'];

  it('moves an item up or down one place', () => {
    expect(moveWarmupItem(list, 1, -1)).toEqual(['b', 'a', 'c']);
    expect(moveWarmupItem(list, 1, 1)).toEqual(['a', 'c', 'b']);
  });

  it('does nothing past either end rather than wrapping', () => {
    expect(moveWarmupItem(list, 0, -1)).toEqual(list);
    expect(moveWarmupItem(list, 2, 1)).toEqual(list);
  });
});

describe('warmupProgress', () => {
  it('counts the ticked items out of the whole list', () => {
    expect(warmupProgress(OWN, ['cat-cow'])).toEqual({ done: 1, total: 2 });
  });

  it('ignores ticks for items no longer on the list', () => {
    expect(warmupProgress(OWN, ['cat-cow', 'gone'])).toEqual({ done: 1, total: 2 });
  });
});

describe('ticks', () => {
  it('belong to one session and read as nothing for any other', () => {
    const stored = { sessionKey: 100, done: ['cat-cow'] };
    expect(readWarmupTicks(stored, 100)).toEqual(['cat-cow']);
    expect(readWarmupTicks(stored, 200)).toEqual([]);
    expect(readWarmupTicks(stored, null)).toEqual([]);
    expect(readWarmupTicks('junk', 100)).toEqual([]);
  });

  it('toggle on and off', () => {
    expect(toggleTick([], 'a')).toEqual(['a']);
    expect(toggleTick(['a', 'b'], 'a')).toEqual(['b']);
  });
});

describe('moveKey', () => {
  it('matches a typed name to a common move regardless of case and spacing', () => {
    expect(moveKey('  Cat-Cow ')).toBe(moveKey('cat-cow'));
    expect(moveKey('Band   marches')).toBe('band marches');
  });
});

describe('common moves', () => {
  it('fit the limits a stored item is clamped to, so picking one never gets cut short', () => {
    for (const move of WARMUP_MOVES) {
      expect(move.name.length).toBeLessThanOrEqual(WARMUP_LIMITS.NAME);
      expect(move.dose.length).toBeLessThanOrEqual(WARMUP_LIMITS.DOSE);
      expect(move.cue.length).toBeGreaterThan(0);
    }
  });

  it('have distinct names, since a name is how a ticked item finds its cue', () => {
    const keys = WARMUP_MOVES.map((move) => moveKey(move.name));
    expect(new Set(keys).size).toBe(keys.length);
  });
});
