import { describe, expect, it } from 'vitest';
import {
  METHOD_LIMITS,
  cloneSlot,
  countsForDrift,
  countsForProgression,
  countsForRecords,
  describeTempo,
  formatTempo,
  fullRestSec,
  groupNoun,
  isMethodGuideKey,
  isSet,
  nextSegment,
  normaliseScheme,
  normaliseSlot,
  parseTempo,
  readSegments,
  readTempo,
  repEquivalent,
  resolveSlotMethod,
  roundToStep,
  segmentWeight,
  setTargetAt,
  unplannedSegment,
} from './methods';
import type { LoggedSet, RoutineSlot, SegmentPlan, SetPrescription } from './types';

function slot(over: Partial<RoutineSlot> = {}): RoutineSlot {
  return {
    exerciseId: 'back-squat',
    order: 0,
    sets: 3,
    reps: 5,
    targetWeightKg: 100,
    targetPct1RM: null,
    targetRpe: 8,
    supersetGroup: null,
    ...over,
  };
}

function row(over: Partial<LoggedSet> = {}): LoggedSet {
  return {
    sessionId: 1,
    exerciseId: 'back-squat',
    setNo: 1,
    type: 'working',
    weightKg: 100,
    reps: 5,
    rpe: 8,
    rpeEstimated: false,
    at: 0,
    ...over,
  };
}

/** Anything at all, to stand in for hand-edited or imported JSON. */
function junk<T>(value: unknown): T {
  return value as T;
}

const WAVE: SetPrescription[] = [
  { reps: 7, load: { kind: 'rel', x: 0.85 } },
  { reps: 5, load: { kind: 'rel', x: 0.9 } },
  { reps: 3, load: { kind: 'rel', x: 0.95 } },
  { reps: 7, load: { kind: 'rel', x: 0.875 } },
  { reps: 5, load: { kind: 'rel', x: 0.925 } },
  { reps: 3, load: { kind: 'rel', x: 1 } },
];

// ─────────────────────────────────────────────────────────────

describe('tempo', () => {
  it('reads the ways people write it into lowering, pause, lifting, pause', () => {
    expect(parseTempo('4010')).toEqual([4, 0, 1, 0]);
    expect(parseTempo('30X')).toEqual([3, 0, 'X', 0]);
    expect(parseTempo('211')).toEqual([2, 1, 1, 0]);
    expect(parseTempo('2-1-1-0')).toEqual([2, 1, 1, 0]);
    expect(parseTempo('10/0/10')).toEqual([10, 0, 10, 0]);
    expect(parseTempo(' 3 1 1 0 ')).toEqual([3, 1, 1, 0]);
    expect(parseTempo('30x0')).toEqual([3, 0, 'X', 0]);
  });

  it('reads anything else as no tempo rather than a wrong one', () => {
    for (const text of ['', '4', '40', '40100', 'abcd', '4-0', '40/1/0/0/0', '3.5-1-1-0', '31/0/1/0', '4 0 1 a']) {
      expect(parseTempo(text)).toBeNull();
    }
  });

  it('writes the compact form when every phase is one figure, the slashed form otherwise', () => {
    expect(formatTempo([3, 1, 1, 0])).toBe('3110');
    expect(formatTempo([3, 0, 'X', 0])).toBe('30X0');
    expect(formatTempo([10, 0, 10, 0])).toBe('10/0/10/0');
    expect(formatTempo([3, 1, 1, 0], { spaced: true })).toBe('3 1 1 0');
  });

  it('spells a tempo out in plain words', () => {
    expect(describeTempo([3, 1, 1, 0])).toBe('lower for 3 seconds, pause 1, lift in 1, no pause at the top');
    expect(describeTempo([2, 1, 1, 0])).toBe('lower for 2 seconds, pause 1, lift in 1, no pause at the top');
    expect(describeTempo([1, 0, 'X', 2])).toBe(
      'lower for 1 second, no pause at the bottom, lift as fast as you can, pause 2 at the top',
    );
  });

  it('clamps a stored tempo, and drops one it cannot read', () => {
    expect(readTempo([-4, 0, 1, 0])).toEqual([0, 0, 1, 0]);
    expect(readTempo([400, 0, 1, 0])).toEqual([30, 0, 1, 0]);
    expect(readTempo([2.4, 0, 'x', 0])).toEqual([2, 0, 'X', 0]);
    expect(readTempo([3, 1, 1])).toEqual([3, 1, 1, 0]);
    expect(readTempo(['3', 1, 1, 0])).toBeNull();
    expect(readTempo([Number.NaN, 1, 1, 0])).toBeNull();
    expect(readTempo('3110')).toBeNull();
    expect(readTempo([1, 1])).toBeNull();
  });
});

describe('reading a slot', () => {
  it('a slot with no method fields reads as plain straight sets', () => {
    const method = resolveSlotMethod(slot());
    expect(method).toEqual({
      tempo: null,
      repStyle: 'full',
      holdSec: null,
      repsMax: null,
      scheme: null,
      segments: null,
      restSec: null,
      gapAfterSec: null,
      note: null,
      setCount: 3,
    });
  });

  it('turns absurd stored values into safe ones before anything else sees them', () => {
    const method = resolveSlotMethod(
      slot({
        tempo: junk([-1, 99, 'X', 0]),
        repStyle: junk('sideways'),
        restSec: -30,
        gapAfterSec: 9000,
        repsMax: junk('lots'),
        note: `  ${'x'.repeat(500)}  `,
        scheme: junk([{ reps: -3, load: { kind: 'rel', x: Number.NaN }, restSec: 1e9, type: 'warmup' }, 'nonsense']),
        segments: junk({ style: 'drop', segmentReps: [0, null, 'x'], intraRestSec: -5, dropFraction: 7 }),
      }),
    );
    expect(method.tempo).toEqual([0, 30, 'X', 0]);
    expect(method.repStyle).toBe('full');
    expect(method.restSec).toBe(0);
    expect(method.gapAfterSec).toBe(METHOD_LIMITS.GAP_MAX_SEC);
    expect(method.repsMax).toBeNull();
    expect(method.note).toHaveLength(METHOD_LIMITS.NOTE_MAX);
    expect(method.scheme).toEqual([
      { reps: 1, load: { kind: 'rel', x: 1 }, restSec: METHOD_LIMITS.REST_MAX_SEC },
      { reps: 1, load: { kind: 'rel', x: 1 } },
    ]);
    expect(method.setCount).toBe(2);
    expect(method.segments).toEqual({ style: 'drop', segmentReps: [1, null, null], intraRestSec: 0, dropFraction: 0.5 });
  });

  it('keeps a hold length only for holds', () => {
    expect(resolveSlotMethod(slot({ repStyle: 'isometric', holdSec: 10 })).holdSec).toBe(10);
    expect(resolveSlotMethod(slot({ repStyle: 'isometric', holdSec: -2 })).holdSec).toBe(1);
    expect(resolveSlotMethod(slot({ repStyle: 'partial', holdSec: 10 })).holdSec).toBeNull();
  });

  it('keeps a rep ceiling only when it is above the floor', () => {
    expect(resolveSlotMethod(slot({ reps: 6, repsMax: 8 })).repsMax).toBe(8);
    expect(resolveSlotMethod(slot({ reps: 6, repsMax: 6 })).repsMax).toBeNull();
  });

  it('reads a segment plan with an unknown style, or nothing to do, as none', () => {
    expect(readSegments({ style: 'giant', segmentReps: [5] })).toBeNull();
    expect(readSegments({ style: 'drop', segmentReps: [] })).toBeNull();
    expect(readSegments({ style: 'rest-pause', segmentReps: [], totalReps: 50, intraRestSec: 15 })).toEqual({
      style: 'rest-pause',
      segmentReps: [],
      intraRestSec: 15,
      dropFraction: 0,
      totalReps: 50,
    });
    // A mechanical drop changes the movement, never the weight.
    expect(readSegments({ style: 'mechanical-drop', segmentReps: [null], dropFraction: 0.3 })?.dropFraction).toBe(0);
  });
});

describe('schemes', () => {
  it('a scheme saved with a heaviest relative load other than 1 is normalised, and its weights are unchanged', () => {
    const stored = slot({
      targetWeightKg: 100,
      scheme: [
        { reps: 5, load: { kind: 'rel', x: 0.8 } },
        { reps: 3, load: { kind: 'rel', x: 0.9 } },
        { reps: 8, load: { kind: 'kg', x: 60 } },
      ],
    });
    const before = [0, 1, 2].map((i) => setTargetAt(stored, i, stored.targetWeightKg!, 0).weightKg);

    const saved = normaliseSlot(stored);
    const rels = saved.scheme!.map((entry) => (entry.load?.kind === 'rel' ? entry.load.x : 0));
    expect(Math.max(...rels)).toBe(1);
    expect(saved.targetWeightKg).toBe(90);
    const after = [0, 1, 2].map((i) => setTargetAt(saved, i, saved.targetWeightKg!, 0).weightKg);
    expect(after).toEqual(before);
  });

  it('scales a percentage-priced slot the same way', () => {
    const saved = normaliseSlot(
      slot({ targetWeightKg: null, targetPct1RM: 0.8, scheme: [{ reps: 5, load: { kind: 'rel', x: 0.5 } }] }),
    );
    expect(saved.targetPct1RM).toBe(0.4);
    expect(saved.scheme![0]!.load).toEqual({ kind: 'rel', x: 1 });
  });

  it('pulls a relative load above 1 back to 1 without changing the weights', () => {
    const { scheme, scale } = normaliseScheme([
      { reps: 5, load: { kind: 'rel', x: 1.2 } },
      { reps: 5, load: { kind: 'rel', x: 0.6 } },
    ]);
    expect(scale).toBe(1.2);
    expect(scheme.map((e) => e.load)).toEqual([
      { kind: 'rel', x: 1 },
      { kind: 'rel', x: 0.5 },
    ]);
  });

  it('leaves a scheme with no relative loads alone', () => {
    expect(normaliseScheme([{ reps: 5, load: { kind: 'pct', x: 0.85 } }]).scale).toBe(1);
  });

  it('saving keeps the set count equal to the scheme length', () => {
    expect(normaliseSlot(slot({ sets: 3, scheme: WAVE })).sets).toBe(6);
  });

  it('saving a slot with no method fields changes nothing about its shape', () => {
    const plain = slot();
    expect(normaliseSlot(plain)).toEqual(plain);
    expect(Object.keys(normaliseSlot(plain)).sort()).toEqual(Object.keys(plain).sort());
  });

  it('saving drops what cannot be read and keeps what can', () => {
    const saved = normaliseSlot(slot({ tempo: junk('fast'), repStyle: 'full', restSec: 90, note: '  ' }));
    expect(saved).not.toHaveProperty('tempo');
    expect(saved).not.toHaveProperty('repStyle');
    expect(saved).not.toHaveProperty('note');
    expect(saved.restSec).toBe(90);
  });

  it('each set of a wave hangs off the working weight', () => {
    const wave = slot({ scheme: WAVE });
    const weights = WAVE.map((_, i) => setTargetAt(wave, i, 100, 0).weightKg);
    expect(weights).toEqual([85, 90, 95, 87.5, 92.5, 100]);
    expect(WAVE.map((_, i) => setTargetAt(wave, i, 100, 0).reps)).toEqual([7, 5, 3, 7, 5, 3]);
    expect(setTargetAt(wave, 0, 100, 0).setCount).toBe(6);
  });

  it('a percentage hangs off the estimated max, and a fixed weight off nothing', () => {
    const mixed = slot({
      scheme: [
        { reps: 5, load: { kind: 'pct', x: 0.75 }, amrap: true },
        { reps: 10, load: { kind: 'kg', x: 60 }, type: 'backoff', restSec: 45 },
      ],
    });
    expect(setTargetAt(mixed, 0, 100, 160)).toMatchObject({ weightKg: 120, amrap: true, type: 'working' });
    expect(setTargetAt(mixed, 1, 100, 160)).toMatchObject({ weightKg: 60, type: 'backoff', restSec: 45 });
    // No estimate yet: prescribe off the working weight rather than zero.
    expect(setTargetAt(mixed, 0, 100, 0).weightKg).toBe(75);
  });

  it('a set past the end of a scheme repeats its last entry', () => {
    expect(setTargetAt(slot({ scheme: WAVE }), 9, 100, 0)).toMatchObject({ setIndex: 9, reps: 3, weightKg: 100 });
  });

  it('straight sets are the slot as it has always been', () => {
    expect(setTargetAt(slot({ reps: 8 }), 2, 80, 0)).toEqual({
      setIndex: 2,
      setCount: 3,
      reps: 8,
      repsMax: null,
      amrap: false,
      weightKg: 80,
      type: 'working',
      restSec: null,
    });
  });
});

describe('rest', () => {
  it('a full rest is the scheme entry, then the slot, then the preset', () => {
    const descending = slot({
      restSec: 120,
      scheme: [
        { reps: 5, restSec: 90 },
        { reps: 5, restSec: 60 },
        { reps: 5, restSec: 45 },
        { reps: 5, restSec: 30 },
        { reps: 5 },
      ],
    });
    expect([0, 1, 2, 3, 4].map((i) => fullRestSec(descending, i, 150))).toEqual([90, 60, 45, 30, 120]);
    expect(fullRestSec(slot({ restSec: 200 }), 0, 150)).toBe(200);
    expect(fullRestSec(slot(), 0, 150)).toBe(150);
    expect(fullRestSec(null, 0, 150)).toBe(150);
  });
});

describe('pieces of a set', () => {
  const doubleDrop: SegmentPlan = { style: 'drop', segmentReps: [null, null], intraRestSec: 0, dropFraction: 0.2 };

  it('walks the planned pieces and then stops', () => {
    expect(nextSegment(doubleDrop, [{ reps: 8 }])).toEqual({ index: 1, reps: null, label: null });
    expect(nextSegment(doubleDrop, [{ reps: 8 }, { reps: 6 }])).toEqual({ index: 2, reps: null, label: null });
    expect(nextSegment(doubleDrop, [{ reps: 8 }, { reps: 6 }, { reps: 5 }])).toBeNull();
  });

  it('carries on until a total-reps target is reached, trimming the last piece to it', () => {
    const fifty: SegmentPlan = { style: 'rest-pause', segmentReps: [], intraRestSec: 15, dropFraction: 0, totalReps: 50 };
    expect(nextSegment(fifty, [{ reps: 20 }])).toEqual({ index: 1, reps: null, label: null });
    expect(nextSegment(fifty, [{ reps: 20 }, { reps: 15 }, { reps: 10 }])).toMatchObject({ index: 3 });
    expect(nextSegment(fifty, [{ reps: 20 }, { reps: 15 }, { reps: 10 }, { reps: 5 }])).toBeNull();
    const planned: SegmentPlan = { ...fifty, segmentReps: [10, 10, 10] };
    expect(nextSegment(planned, [{ reps: 20 }, { reps: 10 }, { reps: 10 }])?.reps).toBe(10);
    expect(nextSegment(planned, [{ reps: 25 }, { reps: 10 }, { reps: 10 }])?.reps).toBe(5);
  });

  it('names the next piece of a mechanical drop', () => {
    const mech: SegmentPlan = { style: 'mechanical-drop', segmentReps: [null], intraRestSec: 0, dropFraction: 0, labels: ['incline', 'flat'] };
    expect(nextSegment(mech, [{ reps: 8 }])?.label).toBe('flat');
  });

  it('works out a drop in display units, on the plate step, never rounding up to the same weight', () => {
    expect(segmentWeight(100, doubleDrop, 2.5)).toBe(80);
    expect(segmentWeight(225, doubleDrop, 5)).toBe(180);
    expect(segmentWeight(82.5, doubleDrop, 2.5)).toBe(65);
    // 3% off 20 is 19.4, which a 2.5 step would round straight back to 20.
    expect(segmentWeight(20, { ...doubleDrop, dropFraction: 0.03 }, 2.5)).toBe(17.5);
    // A cluster keeps the weight.
    expect(segmentWeight(140, { ...doubleDrop, style: 'cluster', dropFraction: 0 }, 2.5)).toBe(140);
  });

  it('an unplanned drop is one more piece, 20% lighter, straight away', () => {
    expect(unplannedSegment()).toEqual({ style: 'drop', segmentReps: [null], intraRestSec: 0, dropFraction: 0.2 });
    // Continuing a set that already has a piece plans one past it.
    expect(nextSegment(unplannedSegment('drop', 1), [{ reps: 8 }, { reps: 6 }])).toMatchObject({ index: 2 });
    expect(unplannedSegment('cluster').intraRestSec).toBeGreaterThan(0);
  });
});

describe('what a row counts toward', () => {
  it('a row written before any of this counts exactly as it always did', () => {
    const old = row();
    expect(isSet(old)).toBe(true);
    expect(countsForRecords(old)).toBe(true);
    expect(countsForDrift(old)).toBe(true);
    expect(countsForProgression(old)).toBe(true);
    expect(repEquivalent(old)).toBe(1);
  });

  it('a piece is work but not a set', () => {
    const piece = row({ segment: 1, segmentStyle: 'drop' });
    expect(isSet(piece)).toBe(false);
    expect(countsForRecords(piece)).toBe(true);
    expect(countsForDrift(piece)).toBe(false);
    expect(countsForProgression(piece)).toBe(false);
  });

  it('reads a nonsense segment number as a set', () => {
    expect(isSet(row({ segment: junk('two') }))).toBe(true);
    expect(isSet(row({ segment: -1 }))).toBe(true);
    expect(isSet(row({ segment: 0 }))).toBe(true);
  });

  it('an AMRAP set stays out of the drift and counts for everything else', () => {
    const amrap = row({ amrap: true });
    expect(countsForDrift(amrap)).toBe(false);
    expect(countsForRecords(amrap)).toBe(true);
    expect(countsForProgression(amrap)).toBe(true);
  });

  it('only full-range reps count for records; lowering-only and holds cannot be a progression base', () => {
    for (const repStyle of ['one-and-half', 'twenty-ones', 'partial', 'eccentric-only', 'isometric'] as const) {
      expect(countsForRecords(row({ repStyle }))).toBe(false);
    }
    expect(countsForProgression(row({ repStyle: 'one-and-half' }))).toBe(true);
    expect(countsForProgression(row({ repStyle: 'twenty-ones' }))).toBe(true);
    expect(countsForProgression(row({ repStyle: 'partial' }))).toBe(true);
    expect(countsForProgression(row({ repStyle: 'eccentric-only' }))).toBe(false);
    expect(countsForProgression(row({ repStyle: 'isometric' }))).toBe(false);
    expect(countsForProgression(row({ type: 'backoff' }))).toBe(false);
  });

  it('a warm-up counts for none of it, whatever it carries', () => {
    const warm = row({ type: 'warmup' });
    expect(countsForRecords(warm)).toBe(false);
    expect(countsForDrift(warm)).toBe(false);
    expect(countsForProgression(warm)).toBe(false);
  });

  it('rep equivalents follow the stated stand-ins', () => {
    expect(repEquivalent(row({ repStyle: 'one-and-half' }))).toBe(1.5);
    expect(repEquivalent(row({ repStyle: 'twenty-ones' }))).toBeCloseTo(2 / 3, 10);
    expect(repEquivalent(row({ repStyle: 'partial' }))).toBe(0.5);
    expect(repEquivalent(row({ repStyle: 'eccentric-only' }))).toBe(0.6);
    expect(repEquivalent(row({ repStyle: 'isometric', holdSec: 12 }))).toBe(4);
    // A hold with no length is one rep's worth, not a guess.
    expect(repEquivalent(row({ repStyle: 'isometric' }))).toBe(1);
    expect(repEquivalent(row({ repStyle: junk('bogus') }))).toBe(1);
  });
});

describe('words and small helpers', () => {
  it('names a group by its size', () => {
    expect(groupNoun(2)).toBe('Superset');
    expect(groupNoun(3)).toBe('Triset');
    expect(groupNoun(4)).toBe('Giant set');
    expect(groupNoun(6)).toBe('Giant set');
  });

  it('knows its explainer keys', () => {
    expect(isMethodGuideKey('tempo')).toBe(true);
    expect(isMethodGuideKey('groups')).toBe(true);
    expect(isMethodGuideKey('juggling')).toBe(false);
  });

  it('rounds to the plate step', () => {
    expect(roundToStep(76.31, 2.5)).toBe(77.5);
    expect(roundToStep(168.7, 5)).toBe(170);
    expect(roundToStep(76.314, 0)).toBe(76.31);
  });

  it('a copied slot shares nothing with the original', () => {
    const original = slot({
      tempo: [3, 1, 1, 0],
      scheme: [{ reps: 5, load: { kind: 'rel', x: 1 } }],
      segments: { style: 'drop', segmentReps: [null], intraRestSec: 0, dropFraction: 0.2, labels: ['a'] },
    });
    const copy = cloneSlot(original);
    expect(copy).toEqual(original);
    copy.tempo![0] = 9;
    copy.scheme![0]!.reps = 9;
    (copy.scheme![0]!.load as { x: number }).x = 0.5;
    copy.segments!.segmentReps.push(4);
    copy.segments!.labels!.push('b');
    expect(original.tempo![0]).toBe(3);
    expect(original.scheme![0]).toEqual({ reps: 5, load: { kind: 'rel', x: 1 } });
    expect(original.segments!.segmentReps).toEqual([null]);
    expect(original.segments!.labels).toEqual(['a']);
    expect(Object.keys(cloneSlot(slot())).sort()).toEqual(Object.keys(slot()).sort());
  });
});
