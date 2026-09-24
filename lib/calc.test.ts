import { describe, expect, it } from 'vitest';
import {
  DAY_MS,
  acwr,
  brzycki,
  buildLoads,
  daysSinceRest,
  dateKey,
  e1RM,
  epley,
  fatigue,
  fmtClock,
  increments,
  intensityAvg,
  scores,
  sessionLoad,
  toDisplay,
  toKg,
  volumeLoad,
} from './calc';
import type { LoggedSet, Session, SetType } from './types';

// ─────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────

const NOW = new Date(2026, 7, 19, 18, 0, 0).getTime(); // 19 Aug 2026, 18:00 local

function set(over: Partial<LoggedSet> = {}): LoggedSet {
  return {
    id: over.id,
    sessionId: over.sessionId ?? 1,
    exerciseId: over.exerciseId ?? 'barbell-bench-press',
    setNo: over.setNo ?? 1,
    type: over.type ?? 'working',
    weightKg: over.weightKg ?? 100,
    reps: over.reps ?? 10,
    rpe: over.rpe ?? 8,
    rpeEstimated: over.rpeEstimated ?? false,
    at: over.at ?? NOW,
  };
}

function session(id: number, at: number): Session {
  return {
    id,
    date: dateKey(at),
    routineId: 'push',
    routineName: 'Push Day',
    exerciseIds: ['barbell-bench-press'],
    startedAt: at,
    lastSetAt: at,
    elapsedMs: 0,
    finishedAt: at,
  };
}

/** Sessions on the given day-offsets back from NOW, each one identical set. */
function history(daysAgo: number[], type: SetType = 'working') {
  const sessions: Session[] = [];
  const sets: LoggedSet[] = [];
  daysAgo.forEach((d, i) => {
    const at = NOW - d * DAY_MS;
    sessions.push(session(i + 1, at));
    sets.push(set({ sessionId: i + 1, at, type }));
  });
  return { sessions, sets, loads: buildLoads(sessions, sets) };
}

// ─────────────────────────────────────────────────────────────
// Units
// ─────────────────────────────────────────────────────────────

describe('units', () => {
  it('176 lb on screen stores as 79.83 kg', () => {
    expect(toKg(176, 'lb')).toBe(79.83);
  });

  it('round-trips a stored kilogram value back to the same pound display', () => {
    expect(toDisplay(toKg(176, 'lb'), 'lb')).toBe(176);
  });

  it('leaves kilograms alone', () => {
    expect(toKg(82.5, 'kg')).toBe(82.5);
    expect(toDisplay(82.5, 'kg')).toBe(82.5);
  });

  it('offers unit-shaped increments rather than converted ones', () => {
    expect(increments('kg')).toEqual([1.25, 2.5, 5]);
    expect(increments('lb')).toEqual([2.5, 5, 10]);
  });
});

// ─────────────────────────────────────────────────────────────
// One-rep max
// ─────────────────────────────────────────────────────────────

describe('one-rep max', () => {
  it('100 kg x 5 gives Epley 116.7 and Brzycki 112.5', () => {
    expect(epley(100, 5).toFixed(1)).toBe('116.7');
    expect(brzycki(100, 5).toFixed(1)).toBe('112.5');
  });

  it('takes the best working set for e1RM', () => {
    const sets = [
      set({ weightKg: 80, reps: 8 }), // 101.3
      set({ weightKg: 92.5, reps: 5 }), // 107.9
    ];
    expect(e1RM(sets, NOW)).toBeCloseTo(107.9, 1);
  });

  it('ignores warm-ups when estimating a max', () => {
    const sets = [
      set({ weightKg: 80, reps: 8, type: 'working' }),
      set({ weightKg: 200, reps: 1, type: 'warmup' }), // absurd, but a warm-up
    ];
    expect(e1RM(sets, NOW)).toBeCloseTo(101.3, 1);
  });
});

// ─────────────────────────────────────────────────────────────
// Session load
// ─────────────────────────────────────────────────────────────

describe('session load', () => {
  it('the same tonnage at RPE 9 costs more than at RPE 6', () => {
    const hard = sessionLoad([set({ rpe: 9 })]);
    const easy = sessionLoad([set({ rpe: 6 })]);
    expect(hard).toBeGreaterThan(easy);
  });

  it('a warm-up counts, discounted by how close it got to the working weight', () => {
    // Working: 100 x 5 @ RPE 8      = 100 * 5 * 0.8            = 400
    // Warm-up:  50 x 5, effort inferred from 50/100 = 0.5
    //                                 0.5^2 = 0.25
    //                               = 50 * 5 * 0.25 * 0.3      =  18.75
    const sets = [
      set({ setNo: 1, type: 'warmup', weightKg: 50, reps: 5, rpeEstimated: true }),
      set({ setNo: 2, weightKg: 100, reps: 5, rpe: 8 }),
    ];
    expect(sessionLoad(sets)).toBeCloseTo(418.75, 6);
  });

  it('a warm-up nearer the working weight costs more than a lighter one', () => {
    const near = sessionLoad([
      set({ setNo: 1, type: 'warmup', weightKg: 80, reps: 5, rpeEstimated: true }),
      set({ setNo: 2, weightKg: 100, reps: 5, rpe: 8 }),
    ]);
    const far = sessionLoad([
      set({ setNo: 1, type: 'warmup', weightKg: 50, reps: 5, rpeEstimated: true }),
      set({ setNo: 2, weightKg: 100, reps: 5, rpe: 8 }),
    ]);
    // 80 * 5 * 0.64 * 0.3 = 76.8 against 18.75.
    expect(near - far).toBeCloseTo(76.8 - 18.75, 6);
  });

  it('a warm-up still costs far less than the same set logged as working', () => {
    const asWarmup = sessionLoad([
      set({ setNo: 1, type: 'warmup', weightKg: 80, reps: 5, rpeEstimated: true }),
      set({ setNo: 2, weightKg: 100, reps: 5, rpe: 8 }),
    ]);
    const asWorking = sessionLoad([
      set({ setNo: 1, weightKg: 80, reps: 5, rpe: 8 }),
      set({ setNo: 2, weightKg: 100, reps: 5, rpe: 8 }),
    ]);
    // The whole point of the discount: counting them is not the same as
    // treating them as work.
    expect(asWarmup).toBeLessThan(asWorking);
    expect(asWarmup - 400).toBeLessThan((asWorking - 400) * 0.3);
  });

  it('warm-ups with no working set of that lift contribute nothing', () => {
    // Nothing to have been warming up *for*, so there is no honest claim to
    // make about how hard they were.
    const sets = [
      set({ setNo: 1, type: 'warmup', weightKg: 40, reps: 8, rpeEstimated: true }),
      set({ setNo: 2, type: 'warmup', weightKg: 60, reps: 5, rpeEstimated: true }),
    ];
    expect(sessionLoad(sets)).toBe(0);
  });

  it('an RPE the lifter actually chose beats the inferred one', () => {
    // 50 * 5 * 0.6 * 0.3 = 45, against 18.75 from the 50/100 proxy.
    const recorded = sessionLoad([
      set({ setNo: 1, type: 'warmup', weightKg: 50, reps: 5, rpe: 6, rpeEstimated: false }),
      set({ setNo: 2, weightKg: 100, reps: 5, rpe: 8 }),
    ]);
    expect(recorded).toBeCloseTo(445, 6);
  });

  it('a warm-up heavier than anything worked clamps rather than exploding', () => {
    // 120 * 3 * 1 * 0.3 = 108. Odd data, but no stored value should be able to
    // outweigh the session it sits in.
    const sets = [
      set({ setNo: 1, type: 'warmup', weightKg: 120, reps: 3, rpeEstimated: true }),
      set({ setNo: 2, weightKg: 100, reps: 5, rpe: 8 }),
    ];
    expect(sessionLoad(sets)).toBeCloseTo(508, 6);
  });

  it('the reference is the same lift, not the heaviest thing in the session', () => {
    // A bench warm-up must not be measured against a squat working set.
    const sets = [
      set({ setNo: 1, exerciseId: 'barbell-bench-press', type: 'warmup', weightKg: 50, reps: 5, rpeEstimated: true }),
      set({ setNo: 2, exerciseId: 'barbell-bench-press', weightKg: 100, reps: 5, rpe: 8 }),
      set({ setNo: 1, exerciseId: 'back-squat', weightKg: 200, reps: 5, rpe: 8 }),
    ];
    // Bench warm-up stays at 18.75; against the squat it would have been far less.
    expect(sessionLoad(sets)).toBeCloseTo(418.75 + 800, 6);
  });

  it('counts back-off sets as real work', () => {
    expect(sessionLoad([set({ type: 'backoff' })])).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────
// The impulse-response model
// ─────────────────────────────────────────────────────────────

describe('fatigue and readiness', () => {
  // Trained daily from 27 days ago to 7 days ago, then rested a full week.
  // Fatigue decays on a 7-day constant, so at NOW it should sit at e^-1 of its
  // value on the last training day. Both figures are geometric series:
  //   peak  = sum(j=0..20) e^(-j/7)          = 7.13787 L
  //   today = e^-1 * peak                    = 2.62581 L
  //   score = round(100 * today / peak)      = 37
  const layoff = history([27, 26, 25, 24, 23, 22, 21, 20, 19, 18, 17, 16, 15, 14, 13, 12, 11, 10, 9, 8, 7]);

  it('matches the hand-computed value within 1 point', () => {
    const s = scores(layoff.loads, NOW);
    expect(Math.abs(s.fatigueScore - 37)).toBeLessThanOrEqual(1);
  });

  it('a 7-day layoff sheds at least half the fatigue', () => {
    const lastTrainingDay = NOW - 7 * DAY_MS;
    const before = fatigue(layoff.loads, lastTrainingDay);
    const after = fatigue(layoff.loads, NOW);
    expect(after).toBeLessThanOrEqual(before * 0.5);
  });

  it('flags low confidence below 14 days of history', () => {
    const thin = history([3, 2, 1]);
    expect(scores(thin.loads, NOW).lowConfidence).toBe(true);

    const thick = history([20, 15, 10, 5, 1]);
    expect(scores(thick.loads, NOW).lowConfidence).toBe(false);
  });

  it('keeps both scores inside 0–100', () => {
    const s = scores(layoff.loads, NOW);
    expect(s.fatigueScore).toBeGreaterThanOrEqual(0);
    expect(s.fatigueScore).toBeLessThanOrEqual(100);
    expect(s.readiness).toBeGreaterThanOrEqual(0);
    expect(s.readiness).toBeLessThanOrEqual(100);
  });

  it('reads fresher after a rest week than in the middle of a hard block', () => {
    const grinding = history([6, 5, 4, 3, 2, 1, 0]);
    expect(scores(layoff.loads, NOW).readiness).toBeGreaterThan(scores(grinding.loads, NOW).readiness);
  });

  it('returns zeroes rather than NaN with no history at all', () => {
    const s = scores([], NOW);
    expect(s.fatigueScore).toBe(0);
    expect(s.historyDays).toBe(0);
    expect(Number.isNaN(s.readiness)).toBe(false);
  });

  it('never reports negative history for a session stamped later than the reading', () => {
    // A session is stamped at its last set; reading the scores for an earlier
    // moment the same day once gave -1 days of history.
    const later = [{ at: NOW + 2 * 60 * 60 * 1000, dateKey: '2026-08-19', load: 500 }];
    expect(scores(later, NOW).historyDays).toBe(0);
    // Zero days, but not nothing: the screens and insights key "nothing logged"
    // off the session count, so a first session today still reads.
    expect(scores(later, NOW).sessions).toBe(1);
    expect(scores([], NOW).sessions).toBe(0);
  });

  it('two years of history recomputes in under 200ms', () => {
    const days = Array.from({ length: 730 }, (_, i) => 730 - i).filter((d) => d % 2 === 0);
    const big = history(days);
    const started = performance.now();
    scores(big.loads, NOW);
    expect(performance.now() - started).toBeLessThan(200);
  });
});

// ─────────────────────────────────────────────────────────────
// Acute:chronic
// ─────────────────────────────────────────────────────────────

describe('acute:chronic workload ratio', () => {
  it('reports null rather than Infinity when there is no baseline', () => {
    const onlyThisWeek = history([3, 2, 1]);
    expect(acwr(onlyThisWeek.loads, NOW).ratio).toBeNull();
  });

  it('sits near 1 when this week matches the weeks before it', () => {
    const steady = history(Array.from({ length: 28 }, (_, i) => i));
    const ratio = acwr(steady.loads, NOW).ratio;
    expect(ratio).not.toBeNull();
    expect(ratio!).toBeGreaterThan(0.8);
    expect(ratio!).toBeLessThan(1.3);
  });

  it('spikes above the danger line when this week doubles the baseline', () => {
    // One session per week for three weeks, then seven in the last week.
    const days = [27, 20, 13, 6, 5, 4, 3, 2, 1, 0];
    const spike = history(days);
    const ratio = acwr(spike.loads, NOW).ratio;
    expect(ratio).not.toBeNull();
    expect(ratio!).toBeGreaterThan(1.5);
  });

  it('excludes the acute week from the chronic baseline', () => {
    // Uncoupled: the trailing 7 days must not appear in the denominator.
    const loads = history([10, 9, 8, 3, 2, 1]).loads;
    const { acute, chronic } = acwr(loads, NOW);
    // Three sessions in each window, so the two sums match despite the labels.
    expect(acute).toBeGreaterThan(0);
    expect(chronic).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────
// Displayed metrics
// ─────────────────────────────────────────────────────────────

describe('displayed metrics', () => {
  it('counts only working tonnage in the 7-day volume', () => {
    const sets = [set({ type: 'working' }), set({ type: 'warmup' })];
    expect(volumeLoad(sets, NOW)).toBe(1000);
  });

  it('drops sets older than the window', () => {
    const sets = [set({ at: NOW - 2 * DAY_MS }), set({ at: NOW - 20 * DAY_MS })];
    expect(volumeLoad(sets, NOW)).toBe(1000);
  });

  it('expresses intensity as a fraction of the estimated max', () => {
    const sets = [set({ weightKg: 100, reps: 5, rpe: 8 })];
    const pct = intensityAvg(sets, NOW);
    expect(pct).not.toBeNull();
    // e1RM for 100x5 is 116.7, so 100kg is roughly 86% of it.
    expect(pct!).toBeCloseTo(100 / epley(100, 5), 3);
  });

  it('returns null for intensity when there is nothing to measure against', () => {
    expect(intensityAvg([], NOW)).toBeNull();
  });

  it('counts consecutive training days since the last rest day', () => {
    const loads = history([2, 1, 0]).loads;
    expect(daysSinceRest(loads, NOW)).toBe(2);
  });

  it('reports zero when yesterday was a rest day', () => {
    const loads = history([5, 4, 3]).loads;
    expect(daysSinceRest(loads, NOW)).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────
// Formatting
// ─────────────────────────────────────────────────────────────

describe('formatting', () => {
  it('pads clock seconds', () => {
    expect(fmtClock(150)).toBe('2:30');
    expect(fmtClock(65)).toBe('1:05');
    expect(fmtClock(0)).toBe('0:00');
  });

  it('never shows a negative clock', () => {
    expect(fmtClock(-30)).toBe('0:30');
  });
});

// ─────────────────────────────────────────────────────────────
// Training methods: pieces, rep styles and AMRAP sets in the model
// ─────────────────────────────────────────────────────────────

describe('training methods in the model', () => {
  /** A row with whatever method fields the case needs. */
  function row(over: Partial<LoggedSet>): LoggedSet {
    return { ...set(), ...over };
  }

  it('rows with no method fields score exactly as before', () => {
    const rows = [row({ weightKg: 100, reps: 5, rpe: 8 }), row({ weightKg: 90, reps: 8, rpe: 7, type: 'backoff' })];
    // 100*5*0.8 + 90*8*0.7
    expect(sessionLoad(rows)).toBeCloseTo(400 + 504, 10);
    expect(volumeLoad(rows, NOW)).toBe(500 + 720);
  });

  it('session load for each rep style matches the hand-worked figures', () => {
    // Every row 60 kg x 12 reps at RPE 10, so tonnage x effort is 720 before the style.
    const base = { weightKg: 60, reps: 12, rpe: 10 };
    expect(sessionLoad([row({ ...base, repStyle: 'one-and-half' })])).toBeCloseTo(1080, 10);
    expect(sessionLoad([row({ ...base, repStyle: 'twenty-ones' })])).toBeCloseTo(480, 10);
    expect(sessionLoad([row({ ...base, repStyle: 'partial' })])).toBeCloseTo(360, 10);
    expect(sessionLoad([row({ ...base, repStyle: 'eccentric-only' })])).toBeCloseTo(432, 10);
    // Twelve 9-second holds: each worth 9/3 = 3 reps, so 36 rep-equivalents.
    expect(sessionLoad([row({ ...base, repStyle: 'isometric', holdSec: 9 })])).toBeCloseTo(60 * 36, 10);
  });

  it("a drop set's load is the sum of its pieces", () => {
    const top = row({ weightKg: 100, reps: 8, rpe: 8 });
    const drop1 = row({ weightKg: 80, reps: 6, rpe: 10, segment: 1, segmentStyle: 'drop' });
    const drop2 = row({ weightKg: 60, reps: 8, rpe: 10, segment: 2, segmentStyle: 'drop' });
    expect(sessionLoad([top, drop1, drop2])).toBeCloseTo(sessionLoad([top]) + 480 + 480, 10);
  });

  it('a lowering-only set at 130% of the max leaves the estimated max alone', () => {
    const honest = row({ weightKg: 100, reps: 5 });
    const before = e1RM([honest], NOW);
    expect(e1RM([honest, row({ weightKg: 150, reps: 3, repStyle: 'eccentric-only' })], NOW)).toBe(before);
  });

  it('the estimate counts AMRAP sets and each piece on its own weight and reps', () => {
    expect(e1RM([row({ weightKg: 100, reps: 9, amrap: true })], NOW)).toBe(130);
    // A cluster single at 140 is a real single at 140; pieces are never added together.
    const single = row({ weightKg: 140, reps: 1 });
    const pieces = [1, 2, 3, 4].map((n) => row({ weightKg: 140, reps: 1, segment: n, segmentStyle: 'cluster' }));
    expect(e1RM([single, ...pieces], NOW)).toBe(e1RM([single], NOW));
  });

  it('intensity is measured over full-range reps only, so a supramaximal eccentric cannot push it past 100%', () => {
    const honest = row({ weightKg: 100, reps: 5 });
    const eccentric = row({ weightKg: 150, reps: 3, repStyle: 'eccentric-only' });
    expect(intensityAvg([honest, eccentric], NOW)).toBeCloseTo(intensityAvg([honest], NOW)!, 10);
  });

  it('weekly tonnage counts reps at their equivalents', () => {
    expect(volumeLoad([row({ weightKg: 30, reps: 21, repStyle: 'twenty-ones' })], NOW)).toBeCloseTo(30 * 14, 10);
  });
});
