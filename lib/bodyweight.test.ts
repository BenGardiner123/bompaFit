import { describe, expect, it } from 'vitest';
import {
  bodyweightShare,
  effectiveWeight,
  isBodyweightLift,
  readBodyweightKg,
  readBodyweightLifts,
  weightShort,
  weightSpoken,
  weightText,
} from './bodyweight';
import { MODEL } from './calc';
import { EXERCISE_BY_ID } from './data';

describe('isBodyweightLift', () => {
  it('knows a lift from the library done with no load', () => {
    expect(isBodyweightLift({ equipment: 'Bodyweight' })).toBe(true);
    expect(isBodyweightLift({ equipment: 'Barbell' })).toBe(false);
    expect(isBodyweightLift(undefined)).toBe(false);
  });
});

describe('weightText', () => {
  it('says Bodyweight at zero, whatever the lift', () => {
    expect(weightText(0, 'kg')).toBe('Bodyweight');
    expect(weightText(0, 'lb', true)).toBe('Bodyweight');
  });

  it('puts added weight on top of bodyweight', () => {
    expect(weightText(10, 'kg', true)).toBe('BW + 10 kg');
    expect(weightText(2.5, 'lb', true)).toBe('BW + 2.5 lb');
  });

  it('is a plain weight on a loaded lift', () => {
    expect(weightText(80, 'kg')).toBe('80 kg');
  });
});

describe('weightShort', () => {
  it('fits a crowded line', () => {
    expect(weightShort(0, 'kg')).toBe('BW');
    expect(weightShort(10, 'kg', true)).toBe('+10 kg');
    expect(weightShort(80, 'lb')).toBe('80 lb');
  });
});

describe('weightSpoken', () => {
  it('never reads zero as a weight', () => {
    expect(weightSpoken(0, 'kg')).toBe('Bodyweight');
  });

  it('spells out the unit', () => {
    expect(weightSpoken(10, 'kg', true)).toBe('Bodyweight plus 10 kilograms');
    expect(weightSpoken(135, 'lb')).toBe('135 pounds');
  });
});

describe('bodyweightShare', () => {
  const share = (id: string) => bodyweightShare(EXERCISE_BY_ID.get(id));

  it('hangs or presses the whole body on pull-ups, chin-ups, dips and handstand push-ups', () => {
    expect(share('pullups')).toBe(MODEL.BW_SHARE_FULL);
    expect(share('chin-up')).toBe(MODEL.BW_SHARE_FULL);
    expect(share('weighted-pull-ups')).toBe(MODEL.BW_SHARE_FULL);
    // The library files dips under elbow extension; the name is what says it.
    expect(share('dips-triceps-version')).toBe(MODEL.BW_SHARE_FULL);
    expect(share('handstand-push-ups')).toBe(MODEL.BW_SHARE_FULL);
  });

  it('puts about two thirds on the hands in a push-up, and in a bench dip with the feet down', () => {
    expect(share('pushups')).toBe(MODEL.BW_SHARE_PUSH_UP);
    // Filed under "General", so only the name knows it is a push-up.
    expect(share('push-up-wide')).toBe(MODEL.BW_SHARE_PUSH_UP);
    expect(share('bench-dips')).toBe(MODEL.BW_SHARE_PUSH_UP);
  });

  it('counts squats and lunges as most of the body, and back extensions as half', () => {
    expect(share('bodyweight-squat')).toBe(MODEL.BW_SHARE_SQUAT);
    expect(bodyweightShare({ name: 'Walking Lunge', pattern: 'General' })).toBe(MODEL.BW_SHARE_SQUAT);
    expect(share('hyperextensions-back-extensions')).toBe(MODEL.BW_SHARE_HINGE);
  });

  it('gives core work, accessory patterns and anything unrecognised the low default', () => {
    expect(share('crunches')).toBe(MODEL.BW_SHARE_OTHER);
    expect(share('plank')).toBe(MODEL.BW_SHARE_OTHER);
    // "Chin" here is a crunch, not a chin-up.
    expect(share('gorilla-chin-crunch')).toBe(MODEL.BW_SHARE_OTHER);
    // A glute bridge is filed as a squat accessory and moves the hips, not the body.
    expect(share('butt-lift-bridge')).toBe(MODEL.BW_SHARE_OTHER);
    expect(bodyweightShare(undefined)).toBe(MODEL.BW_SHARE_OTHER);
  });

  it('falls back to the pattern when the name says nothing', () => {
    expect(bodyweightShare({ name: 'Rope Climb', pattern: 'Vertical pull' })).toBe(MODEL.BW_SHARE_FULL);
    expect(bodyweightShare({ name: 'Nordic Curl', pattern: 'Hinge' })).toBe(MODEL.BW_SHARE_HINGE);
  });
});

describe('effectiveWeight', () => {
  const bodyweightLifts = new Set(['pullups', 'hyperextensions-back-extensions']);
  const make = (bodyweightKg: number | null) =>
    effectiveWeight({
      bodyweightKg,
      isBodyweight: (id) => bodyweightLifts.has(id),
      share: (id) => bodyweightShare(EXERCISE_BY_ID.get(id)),
    });

  it('is absent with no bodyweight entered, so every set counts as logged', () => {
    expect(make(null)).toBeUndefined();
    expect(make(0)).toBeUndefined();
  });

  it('adds the share of an 80 kg lifter to a bodyweight lift', () => {
    const weigh = make(80)!;
    expect(weigh('pullups', 0)).toBe(80);
    // 80 × 0.5 = 40, plus the 10 kg plate.
    expect(weigh('hyperextensions-back-extensions', 10)).toBe(50);
  });

  it('counts a zero on any lift as bodyweight, and leaves loaded lifts alone', () => {
    const weigh = make(80)!;
    expect(weigh('bodyweight-squat', 0)).toBeCloseTo(56, 9); // 80 × 0.7
    expect(weigh('barbell-bench-press', 100)).toBe(100);
  });
});

describe('reading the stored settings', () => {
  it('reads a bodyweight, and anything unusable as not entered', () => {
    expect(readBodyweightKg(80)).toBe(80);
    expect(readBodyweightKg(undefined)).toBeNull();
    expect(readBodyweightKg(null)).toBeNull();
    expect(readBodyweightKg(0)).toBeNull();
    expect(readBodyweightKg('80')).toBeNull();
    expect(readBodyweightKg(Number.NaN)).toBeNull();
    expect(readBodyweightKg(4000)).toBeNull();
  });

  it('reads the marked lifts as distinct ids', () => {
    expect(readBodyweightLifts(['a', 'b', 'a', 3, ''])).toEqual(['a', 'b']);
    expect(readBodyweightLifts('a')).toEqual([]);
    expect(readBodyweightLifts(undefined)).toEqual([]);
  });
});
