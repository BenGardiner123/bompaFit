import { describe, expect, it } from 'vitest';
import { BIG_FOUR, startingMaxLifts } from './maxes';
import type { Routine, RoutineSlot } from './types';

function slot(exerciseId: string, order: number): RoutineSlot {
  return { exerciseId, order, sets: 3, reps: 5, targetWeightKg: null, targetPct1RM: 0.8, targetRpe: 8, supersetGroup: null };
}

function routine(id: string, lifts: string[]): Routine {
  return { id, name: id, source: 'user', phase: 'strength', estMinutes: 60, slots: lifts.map((lift, i) => slot(lift, i)) };
}

describe('startingMaxLifts', () => {
  it('offers just the big four to someone with no workouts yet', () => {
    expect(startingMaxLifts([], {})).toEqual([...BIG_FOUR]);
  });

  it('adds the lifts from their workouts after the big four, in workout order', () => {
    const push = routine('push', ['barbell-bench-press', 'incline-dumbbell-press', 'cable-fly']);
    expect(startingMaxLifts([push], {})).toEqual([...BIG_FOUR, 'incline-dumbbell-press', 'cable-fly']);
  });

  it('lists a lift once however many workouts share it', () => {
    const a = routine('a', ['front-squat', 'barbell-row']);
    const b = routine('b', ['barbell-row', 'front-squat']);
    expect(startingMaxLifts([a, b], {})).toEqual([...BIG_FOUR, 'front-squat', 'barbell-row']);
  });

  it('keeps a lift that already has a max, even once no workout uses it', () => {
    expect(startingMaxLifts([], { 'front-squat': 100 })).toEqual([...BIG_FOUR, 'front-squat']);
  });

  it('does not keep a lift whose max was cleared back to zero', () => {
    expect(startingMaxLifts([], { 'front-squat': 0 })).toEqual([...BIG_FOUR]);
  });
});
