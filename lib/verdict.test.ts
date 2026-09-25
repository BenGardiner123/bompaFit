import { describe, expect, it } from 'vitest';
import { DAY_MS, type SessionLoad } from './calc';
import { VERDICT_EMPTY, VERDICT_ON_TARGET, VERDICT_UNRATED, fatigueDelta, sessionVerdict } from './verdict';
import type { LoggedSet } from './types';

// Hand-worked fixtures. Every expected sentence below was worked out on paper
// from the thresholds the weekly review uses: a lift "runs hard" at a mean of
// 1.5 RPE or more over target with at least 60% of its sets that far over,
// "runs easy" at 1.0 or more under, and is not judged at all on fewer than
// three working sets.

const NOW = Date.UTC(2026, 8, 24, 10, 0, 0);

const NAMES: Record<string, string> = {
  bench: 'Bench Press',
  ohp: 'Overhead Press',
  fly: 'Cable Fly',
};
const nameOf = (id: string) => NAMES[id] ?? id;

function set(exerciseId: string, rpe: number, over: Partial<LoggedSet> = {}): LoggedSet {
  return {
    sessionId: 1,
    exerciseId,
    setNo: 1,
    type: 'working',
    weightKg: 80,
    reps: 8,
    rpe,
    rpeEstimated: false,
    at: NOW,
    ...over,
  };
}

describe('sessionVerdict', () => {
  it('names a lift that ran hard, with its mean overshoot', () => {
    // Target 7. Deviations +2, +1.5, +1.5 → mean 5 / 3 = 1.67, shown as +1.7.
    const sets = [set('bench', 9), set('bench', 8.5), set('bench', 8.5)];
    expect(sessionVerdict(sets, { bench: 7 }, nameOf)).toBe(
      "Bench Press ran +1.7 RPE over target. If the week stays like this, I'll trim its volume.",
    );
  });

  it('names the worst lift when more than one ran hard', () => {
    // Bench: +1.67 as above. Press: 9, 9, 9 against 7 → +2.0. Press is worse.
    const sets = [
      set('bench', 9),
      set('bench', 8.5),
      set('bench', 8.5),
      set('ohp', 9),
      set('ohp', 9),
      set('ohp', 9),
    ];
    expect(sessionVerdict(sets, { bench: 7, ohp: 7 }, nameOf)).toBe(
      "Overhead Press ran +2 RPE over target. If the week stays like this, I'll trim its volume.",
    );
  });

  it('counts exactly 1.5 over as hard, the same edge the weekly review uses', () => {
    // Target 7. 8.5 three times → +1.5 exactly.
    const sets = [set('bench', 8.5), set('bench', 8.5), set('bench', 8.5)];
    expect(sessionVerdict(sets, { bench: 7 }, nameOf)).toMatch(/^Bench Press ran \+1.5 RPE over target\./);
  });

  it('does not promise a volume cut the weekly review would not make', () => {
    // Target 6. Two sets at 10 (+4 each) and three at 6.5 (+0.5 each): mean
    // 9.5 / 5 = +1.9, over the line — but only 2 of 5 sets (40%) ran hard, under
    // the 60% the review needs before it trims. So no trim, and no promise of one.
    // It isn't "on target" either, so it says what did happen.
    const sets = [set('bench', 10), set('bench', 10), set('bench', 6.5), set('bench', 6.5), set('bench', 6.5)];
    expect(sessionVerdict(sets, { bench: 6 }, nameOf)).toBe(
      'Bench Press had a few sets well over target, but not enough to change the plan.',
    );
  });

  it('does not promise weight on a bodyweight lift', () => {
    // Pull-ups at 0kg, 6, 6, 6 against 8: easy, but the review adds no plate.
    const sets = [set('bench', 6, { weightKg: 0 }), set('bench', 6, { weightKg: 0 }), set('bench', 6, { weightKg: 0 })];
    expect(sessionVerdict(sets, { bench: 8 }, nameOf)).toBe(VERDICT_ON_TARGET);
  });

  it('a hard lift outranks an easy one', () => {
    // Bench +1.67 (hard) and Press 6, 6, 6 against 8 → −2 (easy). Hard wins,
    // because a lift beating you up matters more than one that is too light.
    const sets = [
      set('bench', 9),
      set('bench', 8.5),
      set('bench', 8.5),
      set('ohp', 6),
      set('ohp', 6),
      set('ohp', 6),
    ];
    expect(sessionVerdict(sets, { bench: 7, ohp: 8 }, nameOf)).toMatch(/^Bench Press ran/);
  });

  it('names a lift that came in under target', () => {
    // Target 8. 7, 7, 7 → −1.0 exactly, which is the easy threshold.
    const sets = [set('bench', 7), set('bench', 7), set('bench', 7)];
    expect(sessionVerdict(sets, { bench: 8 }, nameOf)).toBe(
      "Bench Press came in under target. Keep that up this week and I'll add weight.",
    );
  });

  it('names the easiest lift when more than one came in under', () => {
    // Bench −1.0, Press 6, 6, 6 against 8 → −2.0. Press is further under.
    const sets = [
      set('bench', 7),
      set('bench', 7),
      set('bench', 7),
      set('ohp', 6),
      set('ohp', 6),
      set('ohp', 6),
    ];
    expect(sessionVerdict(sets, { bench: 8, ohp: 8 }, nameOf)).toMatch(/^Overhead Press came in under target\./);
  });

  it('says so when everything landed on target', () => {
    // Target 7. 7, 7.5, 7 → +0.17. Neither hard nor easy.
    const sets = [set('bench', 7), set('bench', 7.5), set('bench', 7)];
    expect(sessionVerdict(sets, { bench: 7 }, nameOf)).toBe(VERDICT_ON_TARGET);
  });

  it('leaves warm-ups out of the average', () => {
    // Three working sets on target, plus three warm-ups at 5. Counted together
    // that is (0 × 3 + −2 × 3) / 6 = −1.0, which would wrongly read as easy.
    const warm = { type: 'warmup' as const };
    const sets = [
      set('bench', 5, warm),
      set('bench', 5, warm),
      set('bench', 5, warm),
      set('bench', 7),
      set('bench', 7),
      set('bench', 7),
    ];
    expect(sessionVerdict(sets, { bench: 7 }, nameOf)).toBe(VERDICT_ON_TARGET);
  });

  it('counts back-off sets as work', () => {
    // Two working sets and one back-off, all at 9 against 7 → three sets, +2.
    const sets = [set('bench', 9), set('bench', 9), set('bench', 9, { type: 'backoff' })];
    expect(sessionVerdict(sets, { bench: 7 }, nameOf)).toMatch(/^Bench Press ran \+2 RPE/);
  });

  it('does not judge a lift on fewer than three working sets', () => {
    // Two sets at 10 against 7 is +3, far over — but two sets is not a pattern.
    const sets = [set('bench', 10), set('bench', 10)];
    expect(sessionVerdict(sets, { bench: 7 }, nameOf)).toBe(VERDICT_ON_TARGET);
  });

  it('warm-ups do not count towards the three-set minimum', () => {
    // Two working sets at 10 plus a warm-up. Still only two sets of work.
    const sets = [set('bench', 10), set('bench', 10), set('bench', 10, { type: 'warmup' })];
    expect(sessionVerdict(sets, { bench: 7 }, nameOf)).toBe(VERDICT_ON_TARGET);
  });

  it('ignores a lift with no programmed target', () => {
    // An added lift has nothing to be measured against, however hard it was.
    const sets = [set('fly', 10), set('fly', 10), set('fly', 10)];
    expect(sessionVerdict(sets, { bench: 7 }, nameOf)).toBe(VERDICT_ON_TARGET);
  });

  it('has its own sentence for a session with nothing logged', () => {
    expect(sessionVerdict([], { bench: 7 }, nameOf)).toBe(VERDICT_EMPTY);
  });

  it('treats a session of warm-ups only as nothing logged', () => {
    const sets = [set('bench', 6, { type: 'warmup' }), set('bench', 6, { type: 'warmup' })];
    expect(sessionVerdict(sets, { bench: 7 }, nameOf)).toBe(VERDICT_EMPTY);
  });
});

describe('sessionVerdict, when the evidence is thin', () => {
  const unrated = (exerciseId: string, rpe = 7) => set(exerciseId, rpe, { rpeEstimated: true });

  it('does not call sets on target when none of them were rated', () => {
    // Estimated sets are the aim written in on the lifter's behalf, so they
    // sit on target by construction. That is not evidence of anything.
    const sets = [unrated('bench'), unrated('bench'), unrated('bench')];
    expect(sessionVerdict(sets, { bench: 7 }, nameOf)).toBe(VERDICT_UNRATED);
  });

  it('with some sets rated, speaks only for those', () => {
    const sets = [set('bench', 7), unrated('bench'), unrated('bench')];
    expect(sessionVerdict(sets, { bench: 7 }, nameOf)).toBe(
      "What you rated was on target. Rate the rest and I'll read those too.",
    );
  });

  it('ignores the pieces of a drop, which are estimated at failure by design', () => {
    const sets = [set('bench', 7), set('bench', 10, { segment: 1, segmentStyle: 'drop', rpeEstimated: true })];
    expect(sessionVerdict(sets, { bench: 7 }, nameOf)).toBe(VERDICT_ON_TARGET);
  });

  it('says which planned lifts were not trained, and that nothing was rated', () => {
    // The case that used to read "On target across the board": two unrated
    // bench sets, press and fly never started.
    const sets = [unrated('bench'), unrated('bench')];
    expect(sessionVerdict(sets, { bench: 7, ohp: 7, fly: 8 }, nameOf, ['ohp', 'fly'])).toBe(
      "You didn't get to Overhead Press or Cable Fly, and with nothing rated I can't judge the rest yet.",
    );
  });

  it('with a lift untrained and the rest rated on target, says both', () => {
    const sets = [set('bench', 7), set('bench', 7)];
    expect(sessionVerdict(sets, { bench: 7, ohp: 7 }, nameOf, ['ohp'])).toBe(
      "You didn't get to Overhead Press. The rest was on target, so I'll plan the week around what you did.",
    );
  });

  it('with a lift untrained and only some sets rated, says both', () => {
    const sets = [set('bench', 7), unrated('bench')];
    expect(sessionVerdict(sets, { bench: 7, ohp: 7 }, nameOf, ['ohp'])).toBe(
      "You didn't get to Overhead Press. What you rated was on target; rate the rest and I'll read those too.",
    );
  });

  it('lists three untrained lifts the way a person would', () => {
    const sets = [set('bench', 7)];
    expect(sessionVerdict(sets, { bench: 7 }, nameOf, ['ohp', 'fly', 'curl'])).toMatch(
      /^You didn't get to Overhead Press, Cable Fly or curl\./,
    );
  });

  it('a lift that ran hard still leads, since that is what the week will act on', () => {
    const sets = [set('bench', 9), set('bench', 9), set('bench', 9)];
    expect(sessionVerdict(sets, { bench: 7, ohp: 7 }, nameOf, ['ohp'])).toMatch(/^Bench Press ran \+2 RPE over target/);
  });
});

describe('fatigueDelta', () => {
  const load = (at: number, value: number): SessionLoad => ({ at, dateKey: '2026-09-24', load: value });

  it('a first session takes fatigue from nothing to the top of the scale', () => {
    // Before the first set there is no load at all, so the score is 0. After,
    // this session is the only load in the window, so it is its own maximum: 100.
    const loads = [load(NOW, 2000)];
    expect(fatigueDelta(loads, NOW - 60 * 60_000, NOW)).toBe(100);
  });

  it('leaves the session itself out of the reading before it', () => {
    // The session's load is stamped at its last set. Measured a millisecond
    // earlier, the model must not see it yet — or the delta would read zero.
    const loads = [load(NOW, 2000)];
    expect(fatigueDelta(loads, NOW - 1, NOW)).toBeGreaterThan(0);
  });

  it('never goes up when nothing was logged between the two readings', () => {
    // A heavy session a week ago and nothing today. Across an empty session
    // fatigue can only decay, so the change is zero or a fall, never a rise.
    const loads = [load(NOW - 7 * DAY_MS, 4000)];
    expect(fatigueDelta(loads, NOW - 60 * 60_000, NOW)).toBeLessThanOrEqual(0);
  });
});
