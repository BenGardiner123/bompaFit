import { describe, expect, it } from 'vitest';
import { moveLift, nextLift, planDone, roundSets, unratedSets, untrainedLifts, type LiftPlan } from './train';
import type { LoggedSet } from './types';

let clock = 1_000;

function set(over: Partial<LoggedSet> = {}): LoggedSet {
  clock += 1_000;
  return {
    id: over.id,
    sessionId: over.sessionId ?? 1,
    exerciseId: over.exerciseId ?? 'bench',
    setNo: over.setNo ?? 1,
    type: over.type ?? 'working',
    weightKg: over.weightKg ?? 80,
    reps: over.reps ?? 8,
    rpe: over.rpe ?? 7,
    rpeEstimated: over.rpeEstimated ?? true,
    at: over.at ?? clock,
    ...(over.segment !== undefined ? { segment: over.segment } : {}),
  };
}

const PLAN: LiftPlan[] = [
  { exerciseId: 'bench', planned: 2 },
  { exerciseId: 'ohp', planned: 1 },
];

describe('unrated sets', () => {
  it('are sets of work whose RPE was never given', () => {
    const rows = [
      set({ setNo: 1, rpeEstimated: true }),
      set({ setNo: 2, rpeEstimated: false }),
      set({ setNo: 3, type: 'warmup', rpeEstimated: true }),
      set({ setNo: 4, type: 'backoff', rpeEstimated: true }),
    ];
    expect(unratedSets(rows).map((row) => row.setNo)).toEqual([1, 4]);
  });

  it('count a set made of pieces once, by the set and not its pieces', () => {
    const rows = [set({ setNo: 1 }), set({ setNo: 1, segment: 1 }), set({ setNo: 1, segment: 2 })];
    expect(unratedSets(rows)).toHaveLength(1);
  });

  it('can be narrowed to one lift', () => {
    const rows = [set({ exerciseId: 'bench' }), set({ exerciseId: 'ohp' })];
    expect(unratedSets(rows, 'ohp').map((row) => row.exerciseId)).toEqual(['ohp']);
  });
});

describe('untrained lifts', () => {
  it('are planned lifts with no set of work logged, warm-ups not counting', () => {
    const rows = [set({ exerciseId: 'bench' }), set({ exerciseId: 'ohp', type: 'warmup' })];
    expect(untrainedLifts(PLAN, rows)).toEqual([{ exerciseId: 'ohp', planned: 1 }]);
  });

  it('are none once every lift has a set, however short of its plan', () => {
    const rows = [set({ exerciseId: 'bench' }), set({ exerciseId: 'ohp' })];
    expect(untrainedLifts(PLAN, rows)).toEqual([]);
  });

  it('never include a lift planned for no sets', () => {
    expect(untrainedLifts([{ exerciseId: 'bench', planned: 0 }], [])).toEqual([]);
  });
});

describe('the plan being done', () => {
  it('is every planned set of every lift logged', () => {
    const partial = [set({ exerciseId: 'bench' }), set({ exerciseId: 'ohp' })];
    expect(planDone(PLAN, partial)).toBe(false);
    expect(planDone(PLAN, [...partial, set({ exerciseId: 'bench', setNo: 2 })])).toBe(true);
  });

  it('is never true of an empty plan, which has nothing to finish', () => {
    expect(planDone([], [set()])).toBe(false);
  });
});

describe("a superset round's sets", () => {
  it("are each member's latest set of work", () => {
    const rows = [
      set({ exerciseId: 'fly', setNo: 1 }),
      set({ exerciseId: 'dip', setNo: 1 }),
      set({ exerciseId: 'fly', setNo: 2 }),
      set({ exerciseId: 'dip', setNo: 2 }),
      set({ exerciseId: 'dip', setNo: 2, segment: 1 }),
    ];
    expect(roundSets(['fly', 'dip'], rows).map((row) => `${row.exerciseId}${row.setNo}`)).toEqual(['fly2', 'dip2']);
  });

  it('leave out a member with nothing logged', () => {
    expect(roundSets(['fly', 'dip'], [set({ exerciseId: 'fly' })]).map((row) => row.exerciseId)).toEqual(['fly']);
  });
});

describe('the next lift after a rest', () => {
  it('is the same lift while it has planned sets left', () => {
    expect(nextLift(PLAN, [set({ exerciseId: 'bench' })], 'bench')).toBe('bench');
  });

  it('moves on in session order once the lift is done', () => {
    const rows = [set({ exerciseId: 'bench' }), set({ exerciseId: 'bench', setNo: 2 })];
    expect(nextLift(PLAN, rows, 'bench')).toBe('ohp');
  });

  it('wraps round to an earlier lift still owed sets', () => {
    expect(nextLift(PLAN, [set({ exerciseId: 'ohp' })], 'ohp')).toBe('bench');
  });

  it('is nothing once the whole plan is done', () => {
    const rows = [set({ exerciseId: 'bench' }), set({ exerciseId: 'bench', setNo: 2 }), set({ exerciseId: 'ohp' })];
    expect(nextLift(PLAN, rows, 'ohp')).toBeNull();
  });

  it('stays on a lift that is not in the plan at all', () => {
    expect(nextLift(PLAN, [], 'curl')).toBe('curl');
  });
});

describe('moving a lift within the session', () => {
  const none = () => null;

  it('swaps a lift with its neighbour', () => {
    expect(moveLift(['a', 'b', 'c'], 1, -1, none)).toEqual(['b', 'a', 'c']);
    expect(moveLift(['a', 'b', 'c'], 1, 1, none)).toEqual(['a', 'c', 'b']);
  });

  it('does nothing past either end', () => {
    expect(moveLift(['a', 'b'], 0, -1, none)).toEqual(['a', 'b']);
    expect(moveLift(['a', 'b'], 1, 1, none)).toEqual(['a', 'b']);
  });

  it('moves a superset as one block, and steps over a whole block', () => {
    const letter = (id: string) => (id === 'x' || id === 'y' ? 'A' : null);
    // Moving y (in group A) up takes x with it, past a.
    expect(moveLift(['a', 'x', 'y', 'b'], 2, -1, letter)).toEqual(['x', 'y', 'a', 'b']);
    // Moving b up steps over the whole group, not into the middle of it.
    expect(moveLift(['a', 'x', 'y', 'b'], 3, -1, letter)).toEqual(['a', 'b', 'x', 'y']);
  });
});
