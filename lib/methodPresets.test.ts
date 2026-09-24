import { describe, expect, it } from 'vitest';
import { METHOD_LIMITS, isMethodGuideKey, normaliseSlot, resolveSlotMethod } from './methods';
import { METHOD_PRESETS, PRESET_GROUPS, clearMethod, describeMethod, formatRest, presetById } from './methodPresets';
import type { RoutineSlot } from './types';

function slot(over: Partial<RoutineSlot> = {}): RoutineSlot {
  return {
    exerciseId: 'back-squat',
    order: 0,
    sets: 3,
    reps: 5,
    targetWeightKg: 100,
    targetPct1RM: null,
    targetRpe: 8,
    supersetGroup: 'A',
    ...over,
  };
}

// Starting points a preset has to cope with: a plain slot, one already carrying
// a wave, and one carrying every other method field.
const BASES: [string, RoutineSlot][] = [
  ['a plain slot', slot()],
  ['a slot on a percentage', slot({ targetWeightKg: null, targetPct1RM: 0.75 })],
  ['a slot with a scheme', presetById('wave-753')!.apply(slot())],
  [
    'a slot with other methods',
    slot({ tempo: [3, 1, 1, 0], repStyle: 'partial', restSec: 90, gapAfterSec: 10, note: 'wide grip' }),
  ],
];

describe('method presets', () => {
  it('have unique ids and a group the sheet shows', () => {
    const ids = METHOD_PRESETS.map((preset) => preset.id);
    expect(new Set(ids).size).toBe(ids.length);
    const groups = new Set(PRESET_GROUPS.map((group) => group.key));
    for (const preset of METHOD_PRESETS) expect(groups.has(preset.group)).toBe(true);
    for (const group of PRESET_GROUPS) expect(METHOD_PRESETS.some((preset) => preset.group === group.key)).toBe(true);
  });

  it('each open an explainer that exists and describe themselves in one short line', () => {
    for (const preset of METHOD_PRESETS) {
      expect(isMethodGuideKey(preset.guide)).toBe(true);
      expect(preset.label.length).toBeGreaterThan(0);
      expect(preset.description.length).toBeLessThanOrEqual(90);
      expect(preset.description).not.toContain('\n');
    }
  });

  describe.each(BASES)('applied to %s', (_, base) => {
    it.each(METHOD_PRESETS.map((preset) => [preset.id, preset] as const))('%s stores what it shows and keeps the scheme whole', (_id, preset) => {
      const before = JSON.stringify(base);
      const applied = preset.apply(base);

      // Saving tidies a slot; a preset that saving would change would show one
      // thing in the builder and store another.
      expect(normaliseSlot(applied)).toEqual(applied);

      if (applied.scheme) {
        expect(applied.sets).toBe(applied.scheme.length);
        expect(applied.scheme.length).toBeLessThanOrEqual(METHOD_LIMITS.SCHEME_MAX_SETS);
        const rels = applied.scheme.flatMap((entry) => (entry.load?.kind === 'rel' ? [entry.load.x] : []));
        if (rels.length > 0) expect(Math.max(...rels)).toBe(1);
      }
      expect(resolveSlotMethod(applied).setCount).toBe(applied.sets);

      // The builder's draft is shared with the original until saved.
      expect(JSON.stringify(base)).toBe(before);
    });
  });

  it('Wave 7/5/3 fills a six-set scheme', () => {
    const wave = presetById('wave-753')!.apply(slot());
    expect(wave.sets).toBe(6);
    expect(wave.scheme?.map((entry) => entry.reps)).toEqual([7, 5, 3, 7, 5, 3]);
    expect(wave.restSec).toBe(150);
  });

  it('10-to-1 counts down from ten to one and ends on the working weight', () => {
    const scheme = presetById('ten-to-one')!.apply(slot()).scheme!;
    expect(scheme.map((entry) => entry.reps)).toEqual([10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
    expect(scheme[0]!.load).toEqual({ kind: 'rel', x: 0.7 });
    expect(scheme[9]!.load).toEqual({ kind: 'rel', x: 1 });
  });

  it('percentage weeks work off a training max and leave the last set open-ended', () => {
    const scheme = presetById('pct-week-1')!.apply(slot()).scheme!;
    expect(scheme.map((entry) => entry.load)).toEqual([
      { kind: 'pct', x: 0.585 },
      { kind: 'pct', x: 0.675 },
      { kind: 'pct', x: 0.765 },
    ]);
    expect(scheme.map((entry) => entry.amrap === true)).toEqual([false, false, true]);
  });

  it('marks the lighter tail of 4×4 + 1×10 + 1×20 as back-off sets', () => {
    const scheme = presetById('four-by-four-plus')!.apply(slot()).scheme!;
    expect(scheme.map((entry) => entry.type ?? 'working')).toEqual(['working', 'working', 'working', 'working', 'backoff', 'backoff']);
  });

  it('descending rest puts a shorter rest after each set', () => {
    const scheme = presetById('descending-rest')!.apply(slot()).scheme!;
    expect(scheme.map((entry) => entry.restSec)).toEqual([90, 60, 45, 30, undefined]);
  });

  it('a back-off set is added after the sets already there', () => {
    const applied = presetById('backoff-heavy')!.apply(slot({ sets: 4, reps: 6 }));
    expect(applied.scheme?.map((entry) => [entry.reps, entry.type ?? 'working'])).toEqual([
      [6, 'working'],
      [6, 'working'],
      [6, 'working'],
      [6, 'working'],
      [15, 'backoff'],
    ]);
  });

  it('a cluster replaces any scheme, since its reps are the singles', () => {
    const applied = presetById('cluster-5x1')!.apply(presetById('wave-753')!.apply(slot()));
    expect(applied.scheme).toBeUndefined();
    expect(applied.sets).toBe(6);
    expect(applied.reps).toBe(1);
    expect(applied.targetPct1RM).toBe(0.9);
    expect(applied.targetWeightKg).toBeNull();
    expect(applied.segments).toEqual({ style: 'cluster', segmentReps: [1, 1, 1, 1], intraRestSec: 15, dropFraction: 0 });
  });

  it('a drop set keeps a scheme, dropping off each of its sets', () => {
    const applied = presetById('drop-double')!.apply(presetById('wave-753')!.apply(slot()));
    expect(applied.scheme).toHaveLength(6);
    expect(applied.segments?.style).toBe('drop');
  });

  it('tempo presets store the four phases', () => {
    expect(presetById('tempo-controlled')!.apply(slot()).tempo).toEqual([2, 1, 1, 0]);
    expect(presetById('tempo-explosive')!.apply(slot()).tempo).toEqual([3, 0, 'X', 0]);
  });

  it('a hold carries its length and other rep styles do not', () => {
    const hold = presetById('isometric')!.apply(slot());
    expect(hold.holdSec).toBe(10);
    expect(presetById('partial')!.apply(hold).holdSec).toBeUndefined();
  });
});

describe('clearing a method', () => {
  it('removes every method field and keeps the set count a scheme had', () => {
    const busy = presetById('drop-double')!.apply(
      presetById('wave-753')!.apply(slot({ tempo: [2, 1, 1, 0], note: 'x', gapAfterSec: 10, repStyle: 'partial' })),
    );
    const cleared = clearMethod(busy);
    expect(cleared).toEqual({ ...slot(), sets: 6 });
  });

  it('leaves a slot with no method as it was', () => {
    expect(clearMethod(slot())).toEqual(slot());
  });
});

describe('the method summary', () => {
  it('reads Straight sets when there is nothing extra', () => {
    expect(describeMethod(slot())).toBe('Straight sets');
  });

  it('names a preset scheme and the tempo', () => {
    const wave = presetById('wave-753')!.apply(slot({ tempo: [3, 1, 1, 0] }));
    expect(describeMethod(wave)).toBe('Wave 7/5/3 ×2 · tempo 3110 · rest 2:30');
  });

  it('spells out a scheme that matches no preset', () => {
    const wave = presetById('wave-753')!.apply(slot());
    wave.scheme![0] = { ...wave.scheme![0]!, reps: 8 };
    expect(describeMethod(wave)).toMatch(/^Sets 8\/5\/3\/7\/5\/3/);
  });

  it('describes drops, clusters, totals and holds', () => {
    expect(describeMethod(presetById('drop-double')!.apply(slot()))).toBe('Drop ×2 · 20%');
    expect(describeMethod(presetById('cluster-heavy')!.apply(slot()))).toBe('Cluster +4 · 10 s · rest 4:00');
    expect(describeMethod(presetById('total-50')!.apply(slot()))).toBe('Rest-pause · 50 total · rest 3:00');
    expect(describeMethod(presetById('isometric')!.apply(slot()))).toBe('Hold 10 s');
  });

  it('leaves the rest out when the scheme sets its own rests', () => {
    expect(describeMethod(presetById('descending-rest')!.apply(slot()))).toBe('Descending rest');
  });

  it('formats rests in seconds and minutes', () => {
    expect(formatRest(45)).toBe('45 s');
    expect(formatRest(150)).toBe('2:30');
    expect(formatRest(180)).toBe('3:00');
  });
});
