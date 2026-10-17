import { describe, expect, it } from 'vitest';
import {
  emptyPrescription,
  allTargetRpe,
  liftCall,
  plannedWeights,
  progressionBase,
  readPrescriptions,
  redistributeWithinWeek,
  resolveTarget,
  revertPrescription,
  reviewWeek,
  summariseWeek,
  type Prescriptions,
} from './adapt';
import { setTargetAt } from './methods';
import type { LoggedSet, PlannedSession, Routine, RoutineSlot, SetPrescription, SetType } from './types';

const NOW = new Date(2026, 7, 19, 18, 0, 0).getTime();
const BENCH = 'barbell-bench-press';
const FLY = 'cable-fly';

const TARGETS = { [BENCH]: 7, [FLY]: 8 };
/** What the plan asks for next week, before anything the review has earned. */
const PLAN = { [BENCH]: 80, [FLY]: 20 };

function set(rpe: number, over: Partial<LoggedSet> = {}): LoggedSet {
  return {
    sessionId: 1,
    exerciseId: over.exerciseId ?? BENCH,
    setNo: over.setNo ?? 1,
    type: over.type ?? 'working',
    weightKg: over.weightKg ?? 80,
    reps: over.reps ?? 8,
    rpe,
    rpeEstimated: false,
    at: over.at ?? NOW,
  };
}

function slot(over: Partial<RoutineSlot> = {}): RoutineSlot {
  return {
    exerciseId: over.exerciseId ?? BENCH,
    order: 0,
    sets: over.sets ?? 4,
    reps: over.reps ?? 8,
    // `??` would swallow an explicit null, which is exactly the case these
    // tests need to exercise — a slot priced off a percentage, not a weight.
    targetWeightKg: over.targetWeightKg === undefined ? 80 : over.targetWeightKg,
    targetPct1RM: over.targetPct1RM === undefined ? null : over.targetPct1RM,
    targetRpe: over.targetRpe ?? 7,
    supersetGroup: null,
  };
}

function planned(over: Partial<PlannedSession> = {}): PlannedSession {
  return {
    id: over.id ?? 1,
    planId: 1,
    blockId: 1,
    weekStart: over.weekStart ?? '2026-08-17',
    slotIndex: over.slotIndex ?? 0,
    routineId: over.routineId ?? 'push',
    status: over.status ?? 'plan',
    adjustedByBompa: over.adjustedByBompa ?? false,
    volumeFactor: over.volumeFactor ?? 1,
  };
}

// ─────────────────────────────────────────────────────────────
// Week summary
// ─────────────────────────────────────────────────────────────

describe('summariseWeek', () => {
  it('excludes warm-ups from the deviation', () => {
    const sets: LoggedSet[] = [
      set(4, { type: 'warmup' as SetType }),
      set(4, { type: 'warmup' as SetType }),
      set(9),
      set(9),
    ];
    const [lift] = summariseWeek(sets, TARGETS);
    expect(lift?.workingSets).toBe(2);
    expect(lift?.meanDeviation).toBe(2);
  });

  it('measures each lift against its own target', () => {
    const sets = [set(9, { exerciseId: BENCH }), set(9, { exerciseId: FLY })];
    const summary = summariseWeek(sets, TARGETS);
    const bench = summary.find((l) => l.exerciseId === BENCH);
    const fly = summary.find((l) => l.exerciseId === FLY);
    expect(bench?.meanDeviation).toBe(2); // 9 against a target of 7
    expect(fly?.meanDeviation).toBe(1); // 9 against a target of 8
  });
});

// ─────────────────────────────────────────────────────────────
// Weekly adaptation
// ─────────────────────────────────────────────────────────────

describe('liftCall', () => {
  // Pinned numbers rather than ADAPT reads, for the same reason as below.
  const week = (workingSets: number, meanDeviation: number, hardFraction: number) => ({
    exerciseId: BENCH,
    workingSets,
    meanDeviation,
    hardFraction,
  });

  it('calls a week hard only when the average and most of the sets agree', () => {
    expect(liftCall(week(4, 1.5, 0.6))).toBe('hard');
    // Over on average, but carried by two sets in five.
    expect(liftCall(week(5, 1.9, 0.4))).toBeNull();
  });

  it('calls a week easy at a full point under', () => {
    expect(liftCall(week(3, -1.0, 0))).toBe('easy');
    expect(liftCall(week(3, -0.9, 0))).toBeNull();
  });

  it('makes no call on fewer than three working sets', () => {
    expect(liftCall(week(2, 3, 1))).toBeNull();
    expect(liftCall(week(2, -3, 0))).toBeNull();
  });
});

describe('reviewWeek', () => {
  const base: Prescriptions = { [BENCH]: { extraKg: 0, volumeFactor: 1 } };

  it('one hard set in an on-target week changes nothing', () => {
    const sets = [set(7), set(7), set(7), set(9)];
    const result = reviewWeek({ sets, targetRpe: TARGETS, prescriptions: base, planId: 1, now: NOW, plannedNextKg: PLAN });
    expect(result.adjustments).toHaveLength(0);
    expect(result.prescriptions[BENCH]?.volumeFactor).toBe(1);
  });

  it('a week averaging +2.0 takes 10% off next week', () => {
    const sets = [set(9), set(9), set(9), set(9)];
    const result = reviewWeek({ sets, targetRpe: TARGETS, prescriptions: base, planId: 1, now: NOW, plannedNextKg: PLAN });
    expect(result.adjustments).toHaveLength(1);
    expect(result.prescriptions[BENCH]?.volumeFactor).toBeCloseTo(0.9, 3);
  });

  it('every adjustment records what it changed and why', () => {
    const sets = [set(9), set(9), set(9), set(9)];
    const [adj] = reviewWeek({ sets, targetRpe: TARGETS, prescriptions: base, planId: 1, now: NOW, plannedNextKg: PLAN }).adjustments;
    expect(adj?.rule).toBe('rpe-drift-high');
    expect(adj?.scope).toEqual({ kind: 'lift', exerciseId: BENCH });
    expect(adj?.before).toEqual({ extraKg: 0, volumeFactor: 1 });
    expect(adj?.after).toEqual({ extraKg: 0, volumeFactor: 0.9 });
    expect(adj?.narrative.length).toBeGreaterThan(0);
  });

  it('an adjustment can be undone exactly', () => {
    const sets = [set(9), set(9), set(9), set(9)];
    const result = reviewWeek({ sets, targetRpe: TARGETS, prescriptions: base, planId: 1, now: NOW, plannedNextKg: PLAN });
    const adj = result.adjustments[0]!;
    const restored = revertPrescription(adj, result.prescriptions);
    expect(restored[BENCH]).toEqual(base[BENCH]);
  });

  it('adds weight when the week runs consistently easy', () => {
    const sets = [set(6), set(6), set(6), set(6)];
    const result = reviewWeek({ sets, targetRpe: TARGETS, prescriptions: base, planId: 1, now: NOW, plannedNextKg: PLAN });
    expect(result.adjustments[0]?.rule).toBe('rpe-drift-low');
    // A literal, not read back from ADAPT — a threshold a test cannot notice
    // changing is a threshold nobody is checking. The plan asks 80; lifted 80
    // and easy means 82.5, kept as the 2.5 above the plan.
    expect(result.prescriptions[BENCH]?.extraKg).toBe(2.5);
    expect(result.adjustments[0]?.narrative).toContain('Next week: 82.5 kg');
  });

  it('uses the smaller step for accessories', () => {
    const prescriptions: Prescriptions = { [FLY]: { extraKg: 0, volumeFactor: 1 } };
    const fly = { exerciseId: FLY, weightKg: 20 };
    const sets = [set(7, fly), set(7, fly), set(7, fly)];
    const result = reviewWeek({ sets, targetRpe: TARGETS, prescriptions, planId: 1, now: NOW, plannedNextKg: PLAN });
    expect(result.prescriptions[FLY]?.extraKg).toBe(1.25);
  });

  // The weight a step is added to is the weight actually lifted, not the one
  // suggested, because changing the weight mid-workout is how the lifter
  // overrides Bompa. But next week is never below what the plan already asks:
  // lifting light once must not drag the plan down.

  it('progresses a lift that has never been adjusted', () => {
    // The state every lift starts in: no prescription at all.
    const sets = [set(6), set(6), set(6), set(6)];
    const result = reviewWeek({ sets, targetRpe: TARGETS, prescriptions: {}, planId: 1, now: NOW, plannedNextKg: PLAN });
    expect(result.adjustments[0]?.rule).toBe('rpe-drift-low');
    expect(result.prescriptions[BENCH]?.extraKg).toBe(2.5);
  });

  it('raises a lift done lighter than the plan back to the plan, not to the lighter weight plus a step', () => {
    // The plan asks 80; they did 75 and it was easy. Next week is 80, not 77.5.
    const sets = [set(6, { weightKg: 75 }), set(6, { weightKg: 75 }), set(6, { weightKg: 75 })];
    const result = reviewWeek({ sets, targetRpe: TARGETS, prescriptions: base, planId: 1, now: NOW, plannedNextKg: PLAN });
    expect(result.prescriptions[BENCH]?.extraKg).toBe(0);
    expect(result.adjustments[0]?.narrative).toContain('Next week: 80 kg');
  });

  it('keeps the surplus when the lifter is ahead of the plan', () => {
    // The plan asks 80; they did 90 and it was easy. Next week is 92.5, 12.5 above the plan.
    const sets = [set(6, { weightKg: 90 }), set(6, { weightKg: 90 }), set(6, { weightKg: 90 })];
    const result = reviewWeek({ sets, targetRpe: TARGETS, prescriptions: base, planId: 1, now: NOW, plannedNextKg: PLAN });
    expect(result.prescriptions[BENCH]?.extraKg).toBe(12.5);
  });

  it('builds on the heaviest working set, not a lighter back-off', () => {
    const sets = [
      set(6, { weightKg: 100 }),
      set(6, { weightKg: 100 }),
      set(6, { weightKg: 85, type: 'backoff' }),
      set(6, { weightKg: 85, type: 'backoff' }),
    ];
    const result = reviewWeek({ sets, targetRpe: TARGETS, prescriptions: {}, planId: 1, now: NOW, plannedNextKg: PLAN });
    // 102.5 next week, which is 22.5 above the plan's 80.
    expect(result.prescriptions[BENCH]?.extraKg).toBe(22.5);
  });

  it('adds a plain step when the plan has no weight for the lift', () => {
    // A lift trained outside any workout: nothing to raise it to, so the old rule holds.
    const sets = [set(6), set(6), set(6), set(6)];
    const result = reviewWeek({ sets, targetRpe: TARGETS, prescriptions: {}, planId: 1, now: NOW, plannedNextKg: {} });
    expect(result.prescriptions[BENCH]?.extraKg).toBe(2.5);
    expect(result.adjustments[0]?.narrative).toContain('Adding 2.5 kg');
  });

  it('never adds a plate to a bodyweight lift', () => {
    // 0kg is a pull-up with no belt. A step would mean a weight they never chose.
    const sets = [set(6, { weightKg: 0 }), set(6, { weightKg: 0 }), set(6, { weightKg: 0 })];
    const result = reviewWeek({ sets, targetRpe: TARGETS, prescriptions: {}, planId: 1, now: NOW, plannedNextKg: PLAN });
    expect(result.adjustments).toHaveLength(0);
  });

  it('ignores a lift with too few sets to judge', () => {
    const sets = [set(10), set(10)];
    const result = reviewWeek({ sets, targetRpe: TARGETS, prescriptions: base, planId: 1, now: NOW, plannedNextKg: PLAN });
    expect(result.adjustments).toHaveLength(0);
  });

  it('needs most sets to be hard, not just a high average', () => {
    // Mean is +1.5, but only two of four sets actually overshot.
    const sets = [set(7), set(7), set(10), set(10)];
    const result = reviewWeek({ sets, targetRpe: TARGETS, prescriptions: base, planId: 1, now: NOW, plannedNextKg: PLAN });
    expect(result.adjustments).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────
// Missed sessions
// ─────────────────────────────────────────────────────────────

describe('redistributeWithinWeek', () => {
  const reason = 'Behind schedule this week.';

  it('raises the rest of the week by no more than 25% each', () => {
    const source = planned({ id: 1, slotIndex: 0, status: 'skip' });
    const week = [
      source,
      planned({ id: 2, slotIndex: 1 }),
      planned({ id: 3, slotIndex: 2 }),
      planned({ id: 4, slotIndex: 3 }),
    ];
    const { sessions, adjustments } = redistributeWithinWeek({ source, week, planId: 1, now: NOW, narrative: reason });

    expect(sessions).toHaveLength(3);
    for (const s of sessions) {
      expect(s.volumeFactor).toBeLessThanOrEqual(1.25 + 1e-9);
      expect(s.adjustedByBompa).toBe(true);
      // 'adjusted' is no longer a status — the flag that always meant it carries it.
      expect(s.status).toBe('plan');
    }
    expect(adjustments).toHaveLength(1);
    expect(adjustments[0]?.rule).toBe('missed-session-redistribute');
  });

  it('drops the excess rather than carrying it into next week', () => {
    const source = planned({ id: 1, slotIndex: 0, status: 'skip' });
    const week = [source, planned({ id: 2, slotIndex: 1 })];
    const { sessions } = redistributeWithinWeek({ source, week, planId: 1, now: NOW, narrative: reason });
    expect(sessions[0]?.volumeFactor).toBe(1.25);
  });

  it('says so in the narrative when volume is written off', () => {
    const source = planned({ id: 1, slotIndex: 0, status: 'skip' });
    const week = [source, planned({ id: 2, slotIndex: 1 })];
    const { adjustments } = redistributeWithinWeek({ source, week, planId: 1, now: NOW, narrative: reason });
    expect(adjustments[0]?.narrative).toContain('written off');
  });

  it('does nothing when the rest of the week is already gone', () => {
    const source = planned({ id: 1, slotIndex: 3, status: 'skip' });
    const week = [planned({ id: 2, slotIndex: 0, status: 'done' }), source];
    const { sessions, adjustments } = redistributeWithinWeek({ source, week, planId: 1, now: NOW, narrative: reason });
    expect(sessions).toHaveLength(0);
    expect(adjustments).toHaveLength(0);
  });

  it('never moves volume backwards onto slots earlier in the week', () => {
    const source = planned({ id: 3, slotIndex: 2, status: 'skip' });
    const week = [planned({ id: 1, slotIndex: 0 }), planned({ id: 2, slotIndex: 1 }), source];
    const { sessions } = redistributeWithinWeek({ source, week, planId: 1, now: NOW, narrative: reason });
    expect(sessions).toHaveLength(0);
  });

  it('carries the caller-supplied reason into the record', () => {
    const source = planned({ id: 1, slotIndex: 0, status: 'skip' });
    const week = [source, planned({ id: 2, slotIndex: 1 }), planned({ id: 3, slotIndex: 2 })];
    const { adjustments } = redistributeWithinWeek({ source, week, planId: 1, now: NOW, narrative: reason });
    expect(adjustments[0]?.narrative).toContain(reason);
  });
});

// ─────────────────────────────────────────────────────────────
// Resolving what the logger shows
// ─────────────────────────────────────────────────────────────

describe('resolveTarget', () => {
  it('applies an adapted volume factor to the set count', () => {
    const prescriptions: Prescriptions = { [BENCH]: { extraKg: 0, volumeFactor: 0.75 } };
    expect(resolveTarget(slot({ sets: 4 }), prescriptions, 0).sets).toBe(3);
  });

  it('never drops a lift to zero sets', () => {
    const prescriptions: Prescriptions = { [BENCH]: { extraKg: 0, volumeFactor: 0.1 } };
    expect(resolveTarget(slot({ sets: 3 }), prescriptions, 0).sets).toBe(1);
  });

  it('prices a percentage-based slot off the estimated max', () => {
    const target = resolveTarget(slot({ targetWeightKg: null, targetPct1RM: 0.8 }), {}, 150);
    expect(target.weightKg).toBe(120);
  });

  it('adds what the review has earned to the written weight', () => {
    const prescriptions: Prescriptions = { [BENCH]: { extraKg: 5, volumeFactor: 1 } };
    expect(resolveTarget(slot({ targetWeightKg: 80 }), prescriptions, 0).weightKg).toBe(85);
  });

  it('falls back cleanly when nothing has been adapted yet', () => {
    expect(resolveTarget(slot(), { [BENCH]: emptyPrescription() }, 0).weightKg).toBe(80);
  });

  // The week shapes the session: its volume scales the sets, its intensity
  // scales a written weight, and the result is rounded to the plate step.

  it("scales the sets and the written weight by the week's figures, to the plate step", () => {
    const week = { volume: 0.62, intensity: 0.85 };
    const target = resolveTarget(slot({ sets: 4, targetWeightKg: 80 }), {}, 0, week, 2.5);
    expect(target.sets).toBe(2);
    // 80 × 0.85 is 68, which is not a weight anyone can load; 67.5 is.
    expect(target.weightKg).toBe(67.5);
  });

  it('shows the written weight and every set in the last working week', () => {
    const target = resolveTarget(slot({ sets: 4, targetWeightKg: 80 }), {}, 0, { volume: 1, intensity: 1 }, 2.5);
    expect(target).toMatchObject({ sets: 4, weightKg: 80 });
  });

  it("leaves a percentage-of-max slot at its own percentage whatever the week", () => {
    const week = { volume: 1, intensity: 0.85 };
    expect(resolveTarget(slot({ targetWeightKg: null, targetPct1RM: 0.8 }), {}, 150, week).weightKg).toBe(120);
  });

  it("carries the review's surplus on top of the week's ramp", () => {
    const prescriptions: Prescriptions = { [BENCH]: { extraKg: 5, volumeFactor: 1 } };
    const target = resolveTarget(slot({ targetWeightKg: 80 }), prescriptions, 0, { volume: 1, intensity: 0.85 }, 2.5);
    // 68 + 5 = 73, rounded to the step.
    expect(target.weightKg).toBe(72.5);
  });

  it("leaves a scheme's set count alone whatever the week, and scales its weight", () => {
    const scheme: SetPrescription[] = [{ reps: 5 }, { reps: 5 }, { reps: 5, amrap: true }];
    const waveSlot: RoutineSlot = { ...slot({ sets: 3, targetWeightKg: 100 }), scheme };
    const target = resolveTarget(waveSlot, {}, 0, { volume: 0.62, intensity: 0.85 }, 2.5);
    expect(target.sets).toBe(3);
    expect(target.weightKg).toBe(85);
  });

  it('keeps at least one set in a deload week', () => {
    expect(resolveTarget(slot({ sets: 2 }), {}, 0, { volume: 0.38, intensity: 0.7 }).sets).toBe(1);
  });
});

describe('plannedWeights', () => {
  const routine = (over: Partial<Routine>): Routine => ({
    id: 'r',
    name: 'R',
    source: 'user',
    phase: 'strength',
    estMinutes: 30,
    slots: [slot({ targetWeightKg: 80 })],
    ...over,
  });

  it("scales a written weight by the week's intensity, and leaves a percentage to the max", () => {
    const pct = routine({ id: 'p', slots: [slot({ exerciseId: FLY, targetWeightKg: null, targetPct1RM: 0.5 })] });
    expect(plannedWeights([routine({}), pct], { [FLY]: 40 }, 0.9)).toEqual({ [BENCH]: 72, [FLY]: 20 });
  });

  it('ignores the templates, which nobody trains', () => {
    const template = routine({ id: 't', source: 'template', slots: [slot({ targetWeightKg: 200 })] });
    expect(plannedWeights([routine({}), template], {}, 1)).toEqual({ [BENCH]: 80 });
    expect(plannedWeights([template], {}, 1)).toEqual({});
  });

  it('takes the heavier where two workouts disagree, and leaves out a lift with no weight', () => {
    const heavier = routine({ id: 'h', slots: [slot({ targetWeightKg: 90 }), slot({ exerciseId: FLY, targetWeightKg: 0 })] });
    expect(plannedWeights([routine({}), heavier], {}, 1)).toEqual({ [BENCH]: 90 });
  });
});

describe('allTargetRpe', () => {
  it('takes the heavier target where two of your workouts disagree, and ignores the templates', () => {
    const mine = (id: string, targetRpe: number, source: Routine['source'] = 'user'): Routine => ({
      id,
      name: id,
      source,
      phase: 'strength',
      estMinutes: 30,
      slots: [slot({ targetRpe })],
    });
    expect(allTargetRpe([mine('a', 7), mine('b', 7.5)])).toEqual({ [BENCH]: 7.5 });
    expect(allTargetRpe([mine('a', 7.5), mine('t', 8, 'template')])).toEqual({ [BENCH]: 7.5 });
    expect(allTargetRpe([mine('t', 8, 'template')])).toEqual({});
  });
});

describe('readPrescriptions', () => {
  it('drops the absolute weight an older build stored, keeping the volume cut', () => {
    const stored = { [BENCH]: { weightKg: 32.5, volumeFactor: 0.9 }, [FLY]: { weightKg: null, volumeFactor: 1 } };
    expect(readPrescriptions(stored)).toEqual({
      [BENCH]: { extraKg: 0, volumeFactor: 0.9 },
      [FLY]: { extraKg: 0, volumeFactor: 1 },
    });
  });

  it("keeps today's shape as it is, and refuses nonsense", () => {
    expect(readPrescriptions({ [BENCH]: { extraKg: 2.5, volumeFactor: 1 } })).toEqual({ [BENCH]: { extraKg: 2.5, volumeFactor: 1 } });
    expect(readPrescriptions({ [BENCH]: { extraKg: -4, volumeFactor: 0 } })).toEqual({ [BENCH]: { extraKg: 0, volumeFactor: 1 } });
    expect(readPrescriptions('garbage')).toEqual({});
    expect(readPrescriptions(undefined)).toEqual({});
  });

  it('restores an adjustment written by an older build into the current shape', () => {
    const old = {
      at: NOW,
      planId: 1,
      scope: { kind: 'lift' as const, exerciseId: BENCH },
      rule: 'rpe-drift-low',
      before: { weightKg: null, volumeFactor: 1 },
      after: { weightKg: 82.5, volumeFactor: 1 },
      narrative: '',
    };
    expect(revertPrescription(old, { [BENCH]: { extraKg: 9, volumeFactor: 1 } })[BENCH]).toEqual({ extraKg: 0, volumeFactor: 1 });
  });
});

// ─────────────────────────────────────────────────────────────
// Training methods in the weekly review
// ─────────────────────────────────────────────────────────────

describe('training methods in the weekly review', () => {
  function row(rpe: number, over: Partial<LoggedSet> = {}): LoggedSet {
    return { ...set(rpe, over), ...over };
  }

  it('a drop piece at RPE 10 against a target of 8 does not move the drift; the set it belongs to does', () => {
    const targets = { [BENCH]: 8 };
    const sets = [1, 2, 3].map((n) => row(8, { setNo: n }));
    const withDrop = [...sets, row(10, { setNo: 3, segment: 1, segmentStyle: 'drop', weightKg: 64 })];
    expect(summariseWeek(withDrop, targets)).toEqual(summariseWeek(sets, targets));

    const hardSet = [...sets.slice(0, 2), row(10, { setNo: 3 })];
    expect(summariseWeek(hardSet, targets)[0]!.meanDeviation).toBeCloseTo(2 / 3, 10);
  });

  it('pieces do not count toward the minimum sets a call needs', () => {
    const sets = [row(10, { setNo: 1 }), row(10, { setNo: 1, segment: 1 }), row(10, { setNo: 1, segment: 2 })];
    const [lift] = summariseWeek(sets, { [BENCH]: 7 });
    expect(lift!.workingSets).toBe(1);
    expect(liftCall(lift!)).toBeNull();
  });

  it('an AMRAP set is left out of the drift, and a lift trained only that way gets no call', () => {
    const targets = { [BENCH]: 7 };
    const plain = [1, 2, 3].map((n) => row(7, { setNo: n }));
    expect(summariseWeek([...plain, row(10, { setNo: 4, amrap: true })], targets)).toEqual(summariseWeek(plain, targets));
    expect(summariseWeek([1, 2, 3, 4].map((n) => row(10, { setNo: n, amrap: true })), targets)).toEqual([]);
  });

  it('the progression base leaves out pieces, lowering-only sets and holds', () => {
    const sets = [
      row(8, { weightKg: 100 }),
      row(10, { weightKg: 130, repStyle: 'eccentric-only' }),
      row(8, { weightKg: 120, repStyle: 'isometric', holdSec: 10 }),
      row(10, { weightKg: 110, segment: 1, segmentStyle: 'cluster' }),
    ];
    expect(progressionBase(sets, BENCH)).toBe(100);
  });

  it('the progression base keeps 1½ reps, 21s and partials', () => {
    for (const repStyle of ['one-and-half', 'twenty-ones', 'partial'] as const) {
      expect(progressionBase([row(8, { weightKg: 40, repStyle })], BENCH)).toBe(40);
    }
  });

  it('a progression step on a 7/5/3 wave moves every set by the same proportion', () => {
    const wave: SetPrescription[] = [
      { reps: 7, load: { kind: 'rel', x: 0.85 } },
      { reps: 5, load: { kind: 'rel', x: 0.9 } },
      { reps: 3, load: { kind: 'rel', x: 0.95 } },
      { reps: 7, load: { kind: 'rel', x: 0.875 } },
      { reps: 5, load: { kind: 'rel', x: 0.925 } },
      { reps: 3, load: { kind: 'rel', x: 1 } },
    ];
    const waveSlot: RoutineSlot = { ...slot({ targetWeightKg: 100, sets: 6 }), scheme: wave };
    const before = resolveTarget(waveSlot, {}, 0);
    const weightsBefore = wave.map((_, i) => setTargetAt(waveSlot, i, before.weightKg, 0).weightKg);

    // An easy week, logged exactly as the wave prescribed.
    const week = weightsBefore.map((weightKg, i) => row(5, { setNo: i + 1, weightKg, reps: wave[i]!.reps }));
    const { prescriptions } = reviewWeek({ sets: week, targetRpe: { [BENCH]: 8 }, prescriptions: {}, planId: 1, now: NOW, plannedNextKg: { [BENCH]: 100 } });
    const after = resolveTarget(waveSlot, prescriptions, 0);
    expect(after.weightKg).toBe(102.5);

    const weightsAfter = wave.map((_, i) => setTargetAt(waveSlot, i, after.weightKg, 0).weightKg);
    const ratios = weightsAfter.map((w, i) => w / weightsBefore[i]!);
    for (const ratio of ratios) expect(ratio).toBeCloseTo(1.025, 3);
  });

  it("a scheme's length is the set count adaptation works from", () => {
    const scheme: SetPrescription[] = [{ reps: 5 }, { reps: 5 }, { reps: 5 }, { reps: 5 }, { reps: 5 }, { reps: 5 }];
    const waveSlot: RoutineSlot = { ...slot({ sets: 3 }), scheme };
    expect(resolveTarget(waveSlot, {}, 0).sets).toBe(6);
    expect(resolveTarget(waveSlot, { [BENCH]: { extraKg: 0, volumeFactor: 0.5 } }, 0).sets).toBe(3);
  });
});
