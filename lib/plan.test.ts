import { describe, expect, it } from 'vitest';
import { DAY_MS, addDays as addDaysAcross, buildLoads, dateKey, daysBetween } from './calc';
import { TEMPLATE_BY_ID } from './data';
import {
  DEFAULT_BLOCKS,
  generatePlan,
  mesocycleCurve,
  plannedSessionLoad,
  predictPeak,
  reverseTaper,
  startWeekOn,
  weekShape,
} from './plan';
import type { LoggedSet, PlannedSession, Session } from './types';

const NOW = new Date(2026, 7, 19, 18, 0, 0).getTime(); // Wed 19 Aug 2026
const TODAY = dateKey(NOW);

// ─────────────────────────────────────────────────────────────
// Mesocycle shape
// ─────────────────────────────────────────────────────────────

describe('weekShape', () => {
  it('ramps volume up across an accumulation block', () => {
    const first = weekShape('strength', 0, 4);
    const last = weekShape('strength', 3, 4);
    expect(last.volume).toBeGreaterThan(first.volume);
    expect(last.intensity).toBeGreaterThan(first.intensity);
  });

  it('sheds volume while intensity climbs through a peak block', () => {
    const first = weekShape('peak', 0, 4);
    const last = weekShape('peak', 3, 4);
    expect(last.volume).toBeLessThan(first.volume);
    expect(last.intensity).toBeGreaterThan(first.intensity);
  });

  it('drops a deload well below any working week', () => {
    expect(weekShape('deload', 0, 1).volume).toBeLessThan(weekShape('strength', 0, 4).volume);
  });
});

describe('mesocycleCurve', () => {
  it('appends a deload after the working weeks', () => {
    const curve = mesocycleCurve('hypertrophy', 4);
    expect(curve).toHaveLength(5);
    expect(curve[4]?.isDeload).toBe(true);
    expect(curve[4]?.label).toBe('DL');
  });

  it('handles a single-week block without dividing by zero', () => {
    const curve = mesocycleCurve('strength', 1);
    expect(Number.isFinite(curve[0]!.volume)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────
// Plan generation
// ─────────────────────────────────────────────────────────────

describe('generatePlan', () => {
  const ROTATION = ['push', 'pull', 'legs'];
  const PER_WEEK = 4;
  const { plan, blocks, sessions } = generatePlan({
    name: 'Autumn build',
    startDate: TODAY,
    rotation: ROTATION,
    sessionsPerWeek: PER_WEEK,
  });

  it('starts on a Monday so week boundaries line up with the review pass', () => {
    expect(plan.startDate).toBe(startWeekOn(TODAY));
    expect(startWeekOn('2026-08-19')).toBe('2026-08-17'); // the Monday of that week
    expect(startWeekOn('2026-08-17')).toBe('2026-08-17'); // already a Monday
    expect(startWeekOn('2026-08-23')).toBe('2026-08-17'); // Sunday belongs to the week before
  });

  it('survives a daylight-saving boundary without shifting a day', () => {
    // A southern-hemisphere DST start falls on 4 Oct 2026. Millisecond
    // arithmetic on local midnights would slide the whole plan by a day
    // across this boundary.
    expect(daysBetween('2026-09-30', '2026-10-10')).toBe(10);
    expect(addDaysAcross('2026-09-30', 10)).toBe('2026-10-10');
    expect(addDaysAcross('2026-12-09', -111)).toBe('2026-08-20');
  });

  it('schedules sessions per week, not one row per calendar day', () => {
    // 12 working weeks at 4, 2 deload weeks at 3.
    const working = DEFAULT_BLOCKS.reduce((a, b) => a + b.weeks, 0);
    const deload = DEFAULT_BLOCKS.reduce((a, b) => a + b.deloadWeeks, 0);
    expect(sessions).toHaveLength(working * PER_WEEK + deload * (PER_WEEK - 1));
  });

  it('gives every slot a week and a dense position within it', () => {
    const byWeek = new Map<string, number[]>();
    for (const s of sessions) {
      expect(s.weekStart).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      const bucket = byWeek.get(s.weekStart) ?? [];
      bucket.push(s.slotIndex);
      byWeek.set(s.weekStart, bucket);
    }
    for (const [, indices] of byWeek) {
      // Dense 0..n-1, no gaps and no repeats — otherwise "the lowest pending
      // slot" is ambiguous and nothing else enforces uniqueness.
      expect([...indices].sort((a, b) => a - b)).toEqual(indices.map((_, i) => i));
    }
  });

  it('never stamps a date on a slot that has not been trained', () => {
    // date present ⟺ done. This is the invariant that stops anyone writing
    // `p.date === todayKey` again.
    for (const s of sessions) expect(s.date).toBeUndefined();
  });

  it('cycles the rotation across weeks rather than restarting each Monday', () => {
    const first = sessions.slice(0, 5).map((s) => s.routineId);
    expect(first).toEqual(['push', 'pull', 'legs', 'push', 'pull']);
  });

  it('records the rotation and cadence on the plan', () => {
    expect(plan.rotation).toEqual(ROTATION);
    expect(plan.sessionsPerWeek).toBe(PER_WEEK);
  });

  it('creates a block per spec', () => {
    expect(blocks).toHaveLength(DEFAULT_BLOCKS.length);
    expect(blocks.map((b) => b.phase)).toEqual(['hypertrophy', 'strength', 'peak']);
  });

  it('lays blocks end to end with no gaps', () => {
    for (let i = 1; i < blocks.length; i++) {
      const prev = blocks[i - 1]!;
      const gap = daysBetween(prev.startDate, blocks[i]!.startDate);
      expect(gap).toBe((prev.weeks + prev.deloadWeeks) * 7);
    }
  });

  it('drops a whole session from the deload week rather than only scaling it', () => {
    const strength = blocks.find((b) => b.phase === 'strength')!;
    const deloadWeekStart = addDaysAcross(strength.startDate, strength.weeks * 7);
    const deloadWeek = sessions.filter((s) => s.weekStart === deloadWeekStart);
    const firstWeek = sessions.filter((s) => s.weekStart === strength.startDate);
    expect(deloadWeek.length).toBeLessThan(firstWeek.length);
    // And what remains runs lighter too.
    expect(deloadWeek[0]!.volumeFactor).toBeLessThan(firstWeek[0]!.volumeFactor);
  });

  it('runs every session at a fraction of full volume, never above it', () => {
    for (const s of sessions) {
      expect(s.volumeFactor).toBeLessThanOrEqual(1.0001);
    }
  });

  it('produces a plan with no sessions when there is nothing to schedule', () => {
    // What setup writes if the user skips building a workout.
    const empty = generatePlan({ name: 'Empty', startDate: TODAY, rotation: [], sessionsPerWeek: 4 });
    expect(empty.sessions).toHaveLength(0);
    expect(empty.plan.startDate).toBe(startWeekOn(TODAY));
  });
});

// ─────────────────────────────────────────────────────────────
// Competition taper
// ─────────────────────────────────────────────────────────────

describe('reverseTaper', () => {
  it('16 weeks out produces phases that sum to 16 and end on meet day', () => {
    const meet = dateKey(NOW + 16 * 7 * DAY_MS);
    const { phases, warning } = reverseTaper(TODAY, meet);
    expect(warning).toBeNull();
    expect(phases.reduce((a, p) => a + p.weeks, 0)).toBe(16);
    expect(phases[phases.length - 1]?.endDate).toBe(meet);
    expect(phases.map((p) => p.phase)).toEqual(['hypertrophy', 'strength', 'deload', 'peak']);
  });

  it('too little runway compresses the plan and warns rather than failing', () => {
    const meet = dateKey(NOW + 3 * 7 * DAY_MS);
    const { phases, warning } = reverseTaper(TODAY, meet);
    expect(warning).not.toBeNull();
    expect(phases.length).toBeGreaterThan(0);
    expect(phases.reduce((a, p) => a + p.weeks, 0)).toBeLessThanOrEqual(3);
  });

  it('protects the peak week first when runway is short', () => {
    const meet = dateKey(NOW + 2 * 7 * DAY_MS);
    const { phases } = reverseTaper(TODAY, meet);
    expect(phases.some((p) => p.phase === 'peak')).toBe(true);
  });

  it('refuses to plan when meet day is inside the week', () => {
    const meet = dateKey(NOW + 3 * DAY_MS);
    const { phases, warning } = reverseTaper(TODAY, meet);
    expect(phases).toHaveLength(0);
    expect(warning).not.toBeNull();
  });

  it('every phase runs end to end with no overlap', () => {
    const meet = dateKey(NOW + 16 * 7 * DAY_MS);
    const { phases } = reverseTaper(TODAY, meet);
    for (let i = 1; i < phases.length; i++) {
      expect(daysBetween(phases[i - 1]!.endDate, phases[i]!.startDate)).toBe(1);
    }
  });
});

// ─────────────────────────────────────────────────────────────
// Supercompensation
// ─────────────────────────────────────────────────────────────

describe('predictPeak', () => {
  function historyOf(days: number[]) {
    const sessions: Session[] = [];
    const sets: LoggedSet[] = [];
    days.forEach((d, i) => {
      const at = NOW - d * DAY_MS;
      sessions.push({
        id: i + 1,
        date: dateKey(at),
        routineId: 'push',
        routineName: 'Push Day',
        exerciseIds: ['barbell-bench-press'],
        startedAt: at,
        lastSetAt: at,
        elapsedMs: 0,
        finishedAt: at,
      });
      sets.push({
        sessionId: i + 1,
        exerciseId: 'barbell-bench-press',
        setNo: 1,
        type: 'working',
        weightKg: 100,
        reps: 10,
        rpe: 8,
        rpeEstimated: false,
        at,
      });
    });
    return buildLoads(sessions, sets);
  }

  const pricer = (p: PlannedSession) => {
    const routine = TEMPLATE_BY_ID.get(p.routineId);
    return routine ? plannedSessionLoad(routine, p.volumeFactor, {}) : null;
  };

  it('hides the prediction below 28 days of history', () => {
    const thin = historyOf([10, 8, 6, 4, 2]);
    expect(predictPeak(thin, [], pricer, NOW)).toBeNull();
  });

  it('returns nothing at all with no history', () => {
    expect(predictPeak([], [], pricer, NOW)).toBeNull();
  });

  it('finds a window once there is enough history', () => {
    const long = historyOf(Array.from({ length: 30 }, (_, i) => 60 - i * 2));
    const window = predictPeak(long, [], pricer, NOW);
    expect(window).not.toBeNull();
    expect(window!.daysAway).toBeGreaterThanOrEqual(0);
    expect(daysBetween(window!.startDate, window!.endDate)).toBeGreaterThanOrEqual(0);
  });

  it('adding planned load pushes the peak later', () => {
    const long = historyOf(Array.from({ length: 30 }, (_, i) => 60 - i * 2));
    const bare = predictPeak(long, [], pricer, NOW)!;

    // Three sessions a week for the next four weeks. No dates — the projection
    // spreads each week's slots across its own seven days.
    const upcoming: PlannedSession[] = Array.from({ length: 12 }, (_, i) => ({
      id: i + 1,
      planId: 1,
      blockId: 1,
      weekStart: addDaysAcross(startWeekOn(TODAY), (Math.floor(i / 3) + 1) * 7),
      slotIndex: i % 3,
      routineId: 'legs',
      status: 'plan' as const,
      adjustedByBompa: false,
      volumeFactor: 1,
    }));
    const loaded = predictPeak(long, upcoming, pricer, NOW)!;

    expect(loaded.daysAway).toBeGreaterThan(bare.daysAway);
  });

  it('ignores pending slots from weeks that have already gone', () => {
    const long = historyOf(Array.from({ length: 30 }, (_, i) => 60 - i * 2));
    const bare = predictPeak(long, [], pricer, NOW)!;
    const stale: PlannedSession[] = [
      {
        id: 1,
        planId: 1,
        blockId: 1,
        weekStart: addDaysAcross(startWeekOn(TODAY), -14),
        slotIndex: 0,
        routineId: 'legs',
        status: 'plan',
        adjustedByBompa: false,
        volumeFactor: 1,
      },
    ];
    // A slot you never got to is not future load.
    expect(predictPeak(long, stale, pricer, NOW)!.daysAway).toBe(bare.daysAway);
  });

  it('treats an unresolvable routine as unknown, not as zero', () => {
    const long = historyOf(Array.from({ length: 30 }, (_, i) => 60 - i * 2));
    const nullPricer = () => null;
    const upcoming: PlannedSession[] = [
      {
        id: 1,
        planId: 1,
        blockId: 1,
        weekStart: addDaysAcross(startWeekOn(TODAY), 7),
        slotIndex: 0,
        routineId: 'deleted-routine',
        status: 'plan',
        adjustedByBompa: false,
        volumeFactor: 1,
      },
    ];
    // Skipped rather than counted as nothing — it under-projects instead of
    // asserting a load it cannot know.
    const bare = predictPeak(long, [], pricer, NOW)!;
    expect(predictPeak(long, upcoming, nullPricer, NOW)!.daysAway).toBe(bare.daysAway);
  });
});

// ─────────────────────────────────────────────────────────────
// Pricing a planned session
// ─────────────────────────────────────────────────────────────

describe('plannedSessionLoad', () => {
  it('scales with the session volume factor', () => {
    const routine = TEMPLATE_BY_ID.get('push')!;
    const full = plannedSessionLoad(routine, 1, {});
    const half = plannedSessionLoad(routine, 0.5, {});
    expect(half).toBeCloseTo(full / 2, 5);
  });

  it('skips percentage-based slots when the lift has no estimated max yet', () => {
    const routine = TEMPLATE_BY_ID.get('meet-openers')!; // every slot is %1RM
    expect(plannedSessionLoad(routine, 1, {})).toBe(0);
  });

  it('prices percentage-based slots once a max is known', () => {
    const routine = TEMPLATE_BY_ID.get('meet-openers')!;
    const load = plannedSessionLoad(routine, 1, { 'back-squat': 200, 'barbell-bench-press': 120, deadlift: 240 });
    expect(load).toBeGreaterThan(0);
  });
});
