import { describe, expect, it } from 'vitest';
import {
  WARMUP_OPACITY,
  bestSet,
  dailyTonnage,
  fmtShortDay,
  fmtVolume,
  liftSparkline,
  liftTrend,
  liftVolume,
  loggedLifts,
  monthTicks,
  percentChange,
  personalRecords,
  recentLiftDays,
  summariseSessions,
  volumeUnit,
  weekdayShort,
} from './history';
import { C } from './tokens';
import type { LoggedSet, Session } from './types';

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 7, 22, 10, 0, 0);

function session(over: Partial<Session> = {}): Session {
  return {
    id: over.id ?? 1,
    date: over.date ?? '2026-08-22',
    routineId: over.routineId ?? 'push',
    routineName: over.routineName ?? 'Push Day',
    exerciseIds: over.exerciseIds ?? ['barbell-bench-press', 'overhead-press'],
    startedAt: over.startedAt ?? NOW,
    lastSetAt: over.lastSetAt ?? NOW,
    elapsedMs: over.elapsedMs ?? 45 * 60_000,
    finishedAt: 'finishedAt' in over ? over.finishedAt : NOW + 45 * 60_000,
    plannedSessionId: over.plannedSessionId,
  };
}

function set(over: Partial<LoggedSet> = {}): LoggedSet {
  return {
    id: over.id,
    sessionId: over.sessionId ?? 1,
    exerciseId: over.exerciseId ?? 'barbell-bench-press',
    setNo: over.setNo ?? 1,
    type: over.type ?? 'working',
    weightKg: over.weightKg ?? 80,
    reps: over.reps ?? 5,
    rpe: over.rpe ?? 8,
    rpeEstimated: over.rpeEstimated ?? false,
    at: over.at ?? NOW,
  };
}

describe('summariseSessions', () => {
  it('groups a session by lift, in the order the session presented them', () => {
    const [summary] = summariseSessions(
      [session()],
      [
        set({ exerciseId: 'overhead-press', at: NOW + 2000 }),
        set({ exerciseId: 'barbell-bench-press', at: NOW + 1000 }),
      ],
    );
    // The snapshot says bench first, so bench is first — not whichever was
    // logged first.
    expect(summary!.lifts.map((l) => l.exerciseId)).toEqual(['barbell-bench-press', 'overhead-press']);
  });

  it('counts working and back-off toward sets and tonnage, warm-ups toward neither', () => {
    const [summary] = summariseSessions(
      [session()],
      [
        set({ type: 'warmup', weightKg: 40, reps: 8 }),
        set({ type: 'working', weightKg: 80, reps: 5 }),
        set({ type: 'backoff', weightKg: 60, reps: 8 }),
      ],
    );
    expect(summary!.workingSets).toBe(2);
    // 80*5 + 60*8 = 880. The 320kg of warm-up is not the work.
    expect(summary!.tonnageKg).toBe(880);
  });

  it('takes the top weight from working sets, not from a heavy warm-up single', () => {
    const [summary] = summariseSessions(
      [session()],
      [set({ type: 'warmup', weightKg: 200, reps: 1 }), set({ type: 'working', weightKg: 80, reps: 5 })],
    );
    expect(summary!.lifts[0]!.topWeightKg).toBe(80);
  });

  it('leaves an unfinished session out — the Train tab owns that one', () => {
    const summaries = summariseSessions([session({ finishedAt: undefined })], [set()]);
    expect(summaries).toHaveLength(0);
  });

  it('keeps a finished session that logged nothing', () => {
    // Starting one and giving up is a real thing that happened. Hiding it would
    // be the app deciding which of your days counted.
    const summaries = summariseSessions([session()], []);
    expect(summaries).toHaveLength(1);
    expect(summaries[0]!.lifts).toEqual([]);
    expect(summaries[0]!.tonnageKg).toBe(0);
  });

  it('shows a set logged against a lift the snapshot missed, rather than dropping it', () => {
    const [summary] = summariseSessions(
      [session({ exerciseIds: ['barbell-bench-press'] })],
      [set(), set({ exerciseId: 'cable-fly', weightKg: 20, reps: 12 })],
    );
    // A set that exists has to appear somewhere. Silently vanishing is the one
    // outcome that is never right.
    expect(summary!.lifts.map((l) => l.exerciseId)).toEqual(['barbell-bench-press', 'cable-fly']);
  });

  it('orders sessions newest first', () => {
    const summaries = summariseSessions(
      [
        session({ id: 1, finishedAt: NOW - 2 * DAY, date: '2026-08-20' }),
        session({ id: 2, finishedAt: NOW, date: '2026-08-22' }),
        session({ id: 3, finishedAt: NOW - DAY, date: '2026-08-21' }),
      ],
      [],
    );
    expect(summaries.map((s) => s.session.id)).toEqual([2, 3, 1]);
  });

  it('orders sets within a lift oldest first', () => {
    const [summary] = summariseSessions(
      [session()],
      [set({ setNo: 2, at: NOW + 2000 }), set({ setNo: 1, at: NOW + 1000 })],
    );
    expect(summary!.lifts[0]!.sets.map((s) => s.setNo)).toEqual([1, 2]);
  });

  it('reports time spent training, not time since it started', () => {
    // `elapsedMs` accrues only while the Train tab is open, so a session left
    // open while you cooked dinner does not claim four hours.
    const [summary] = summariseSessions([session({ elapsedMs: 30 * 60_000 })], [set()]);
    expect(summary!.durationMs).toBe(30 * 60_000);
  });
});

// The helpers below read dates in local time, as the screen does, so their
// fixtures are built from local times too. A UTC fixture would land on a
// different calendar day depending on where the tests run.
const TODAY = '2026-09-24';
const NOON = new Date(2026, 8, 24, 12).getTime();
const daysAgo = (n: number, hour = 12) => new Date(2026, 8, 24 - n, hour).getTime();

describe('dailyTonnage', () => {
  it('returns seven calendar days ending today, oldest first, rest days included at zero', () => {
    const days = dailyTonnage([set({ at: daysAgo(2), weightKg: 100, reps: 5 })], TODAY);
    expect(days.map((d) => d.key)).toEqual([
      '2026-09-18',
      '2026-09-19',
      '2026-09-20',
      '2026-09-21',
      '2026-09-22',
      '2026-09-23',
      '2026-09-24',
    ]);
    expect(days.map((d) => d.kg)).toEqual([0, 0, 0, 0, 500, 0, 0]);
  });

  it('counts working and back-off sets and leaves warm-ups out, like every other tonnage in the app', () => {
    const days = dailyTonnage(
      [
        set({ at: daysAgo(0), type: 'warmup', weightKg: 60, reps: 5 }),
        set({ at: daysAgo(0), type: 'working', weightKg: 100, reps: 5 }),
        set({ at: daysAgo(0), type: 'backoff', weightKg: 80, reps: 8 }),
      ],
      TODAY,
    );
    expect(days[6]!.kg).toBe(500 + 640);
  });

  it('ignores anything older than the window', () => {
    const days = dailyTonnage([set({ at: daysAgo(7), weightKg: 100, reps: 5 })], TODAY);
    expect(days.reduce((a, d) => a + d.kg, 0)).toBe(0);
  });

  it('files a late-evening set under the day it happened', () => {
    const days = dailyTonnage([set({ at: daysAgo(1, 23), weightKg: 100, reps: 1 })], TODAY);
    expect(days[5]).toEqual({ key: '2026-09-23', kg: 100 });
  });
});

describe('percentChange', () => {
  it('rounds to a whole percentage', () => {
    expect(percentChange(109, 100)).toBe(9);
    expect(percentChange(2, 3)).toBe(-33);
  });

  it('has no answer when last week was empty, rather than Infinity', () => {
    expect(percentChange(5000, 0)).toBeNull();
    expect(percentChange(0, 0)).toBeNull();
  });
});

describe('fmtShortDay', () => {
  it('reads the way people remember a session', () => {
    expect(fmtShortDay('2026-09-22', TODAY)).toBe('Tue 22 Sep');
  });

  it('adds the year only when it is not this one', () => {
    expect(fmtShortDay('2025-12-31', TODAY)).toBe('Wed 31 Dec 2025');
  });

  it('names the weekday for every day of a week', () => {
    expect(['2026-09-21', '2026-09-27'].map(weekdayShort)).toEqual(['Mon', 'Sun']);
  });
});

describe('fmtVolume', () => {
  it('shows tonnes in kilograms and thousands of pounds in pounds', () => {
    expect(fmtVolume(24_800, 'kg')).toBe('24.8');
    expect(volumeUnit('kg')).toBe('tonnes');
    // 10,000kg is 22,046lb.
    expect(fmtVolume(10_000, 'lb')).toBe('22.0');
    expect(volumeUnit('lb', true)).toBe('k lb');
  });
});

describe('loggedLifts', () => {
  it('lists lifts with working sets, most recently trained first', () => {
    const ids = loggedLifts([
      set({ exerciseId: 'back-squat', at: daysAgo(3) }),
      set({ exerciseId: 'barbell-bench-press', at: daysAgo(1) }),
      set({ exerciseId: 'back-squat', at: daysAgo(5) }),
    ]);
    expect(ids).toEqual(['barbell-bench-press', 'back-squat']);
  });

  it('leaves out a lift that has only ever been warmed up', () => {
    expect(loggedLifts([set({ exerciseId: 'deadlift', type: 'warmup' })])).toEqual([]);
  });
});

describe('liftSparkline', () => {
  it('keeps the best estimate per day and spaces points by time', () => {
    const { points, from } = liftSparkline(
      [
        set({ at: daysAgo(20), weightKg: 100, reps: 5 }),
        set({ at: daysAgo(20) + 1000, weightKg: 90, reps: 5 }),
        set({ at: daysAgo(5), weightKg: 105, reps: 5 }),
        set({ at: NOON, weightKg: 110, reps: 5 }),
      ],
      NOON,
    );
    expect(points).toHaveLength(3);
    // The line starts at the first session and ends today.
    expect(from).toBe(daysAgo(20));
    expect(points[0]).toBe('0.0,78.0');
    // Fifteen days into a twenty-day span is three quarters of the way across.
    expect(Number(points[1]!.split(',')[0])).toBeCloseTo(225, 0);
    expect(points[2]).toBe('300.0,6.0');
  });

  it('draws nothing from warm-ups or sets older than twelve weeks', () => {
    expect(liftSparkline([set({ type: 'warmup', at: NOON }), set({ at: daysAgo(90) })], NOON).points).toEqual([]);
  });
});

describe('monthTicks', () => {
  it('labels each month where it begins', () => {
    const ticks = monthTicks(daysAgo(84), NOON);
    expect(ticks.map((t) => t.label)).toEqual(['Jul', 'Aug', 'Sep']);
    expect(ticks[0]!.x).toBe(0);
    expect(ticks.every((t) => t.x >= 0 && t.x <= 1)).toBe(true);
  });

  it('drops the opening month when the next one starts right beside it', () => {
    // From 25 Aug, September begins a week in, and an "Aug" label at the edge
    // would collide with it.
    const ticks = monthTicks(new Date(2026, 7, 25, 12).getTime(), new Date(2026, 10, 17, 12).getTime());
    expect(ticks.map((t) => t.label)).toEqual(['Sep', 'Oct', 'Nov']);
  });

  it('crosses the year boundary', () => {
    const ticks = monthTicks(new Date(2026, 10, 28).getTime(), new Date(2027, 1, 20).getTime());
    expect(ticks.map((t) => t.label)).toEqual(['Dec', 'Jan', 'Feb']);
  });

  it('labels a short span with the one month it sits in', () => {
    expect(monthTicks(daysAgo(10), NOON).map((t) => t.label)).toEqual(['Sep']);
  });
});

describe('liftTrend', () => {
  it('is the best estimate in the window against the first one', () => {
    const trend = liftTrend([set({ at: daysAgo(60), weightKg: 90, reps: 3 }), set({ at: daysAgo(1), weightKg: 100, reps: 3 })], NOON);
    expect(trend).toBe(11);
  });

  it('is null with a single set, where any trend would be made up', () => {
    expect(liftTrend([set({ at: NOON })], NOON)).toBeNull();
  });
});

describe('bestSet', () => {
  it('breaks a tie in weight on reps, and never picks a warm-up', () => {
    const best = bestSet([
      set({ weightKg: 100, reps: 3 }),
      set({ weightKg: 100, reps: 5 }),
      set({ type: 'warmup', weightKg: 140, reps: 1 }),
    ]);
    expect(best).toMatchObject({ weightKg: 100, reps: 5 });
  });
});

describe('liftVolume', () => {
  it('sums working sets over the last 28 days', () => {
    expect(liftVolume([set({ at: daysAgo(3), weightKg: 100, reps: 5 }), set({ at: daysAgo(40) })], NOON)).toBe(500);
  });
});

describe('personalRecords', () => {
  it('leads with the estimate, counts a heavier set of more reps as a rep max, and ignores warm-ups', () => {
    const prs = personalRecords([
      set({ at: daysAgo(10), weightKg: 100, reps: 6 }),
      set({ at: daysAgo(2), weightKg: 120, reps: 1 }),
      set({ at: daysAgo(2), type: 'warmup', weightKg: 150, reps: 1 }),
    ]);
    expect(prs[0]).toMatchObject({ label: 'Est. 1RM', highlight: true });
    const byLabel = Object.fromEntries(prs.map((p) => [p.label, p.kg]));
    expect(byLabel['1 rep max']).toBe(120);
    // The set of six at 100kg is also a five and a three.
    expect(byLabel['5 rep max']).toBe(100);
    expect(byLabel['3 rep max']).toBe(100);
    expect(byLabel['8 rep max']).toBeUndefined();
    expect(prs.at(-1)).toMatchObject({ label: 'Best session volume', kind: 'volume', kg: 600 });
  });
});

describe('recentLiftDays', () => {
  it('groups working sets by day, newest first', () => {
    const days = recentLiftDays([
      set({ at: daysAgo(3), weightKg: 100, reps: 5 }),
      set({ at: daysAgo(1), weightKg: 100, reps: 5 }),
      set({ at: daysAgo(1), weightKg: 100, reps: 5 }),
      set({ at: daysAgo(1), type: 'warmup' }),
    ]);
    expect(days).toEqual([
      { key: '2026-09-23', sets: 2, tonnageKg: 1000 },
      { key: '2026-09-21', sets: 1, tonnageKg: 500 },
    ]);
  });
});

// WCAG relative luminance and contrast, the same nine lines the token tests
// use. Copied rather than shared so this file needs nothing from a test helper.
function luminance(hex: string): number {
  const value = hex.replace('#', '');
  const channels = [0, 2, 4].map((i) => parseInt(value.slice(i, i + 2), 16) / 255);
  const linear = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * linear[0]! + 0.7152 * linear[1]! + 0.0722 * linear[2]!;
}

function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light! + 0.05) / (dark! + 0.05);
}

/** The colour a translucent foreground actually paints over a background. */
function blend(fg: string, bg: string, alpha: number): string {
  const channel = (hex: string, i: number) => parseInt(hex.replace('#', '').slice(i, i + 2), 16);
  return `#${[0, 2, 4]
    .map((i) => Math.round(alpha * channel(fg, i) + (1 - alpha) * channel(bg, i)).toString(16).padStart(2, '0'))
    .join('')}`;
}

describe('warm-up lines in an expanded session', () => {
  it('stay readable when dimmed, because their text is ink rather than grey', () => {
    expect(contrast(blend(C.ink, C.screen, WARMUP_OPACITY), C.screen)).toBeGreaterThanOrEqual(4.5);
  });

  it('would fail if the grey labels were dimmed too, which is why they are not', () => {
    expect(contrast(blend(C.tertiary, C.screen, WARMUP_OPACITY), C.screen)).toBeLessThan(4.5);
  });
});

// ─────────────────────────────────────────────────────────────
// Training methods in history and records
// ─────────────────────────────────────────────────────────────

describe('training methods in history', () => {
  function row(over: Partial<LoggedSet>): LoggedSet {
    return { ...set(over), rpeEstimated: false, ...over };
  }

  it('a set of 21s does not claim an eight-rep record', () => {
    const records = personalRecords([row({ weightKg: 60, reps: 5 }), row({ weightKg: 30, reps: 21, repStyle: 'twenty-ones' })]);
    expect(records.find((r) => r.label === '8 rep max')).toBeUndefined();
    expect(records.find((r) => r.label === '5 rep max')?.kg).toBe(60);
  });

  it('a cluster single at 90% claims the one-rep record when it is the heaviest single', () => {
    const records = personalRecords([
      row({ weightKg: 150, reps: 3, setNo: 1 }),
      row({ weightKg: 160, reps: 1, setNo: 2 }),
      row({ weightKg: 160, reps: 1, setNo: 2, segment: 1, segmentStyle: 'cluster' }),
      row({ weightKg: 162.5, reps: 1, setNo: 2, segment: 2, segmentStyle: 'cluster' }),
    ]);
    expect(records.find((r) => r.label === '1 rep max')?.kg).toBe(162.5);
  });

  it('a lowering-only set at 130% of the max changes neither the estimate nor the rep records', () => {
    const honest = [row({ weightKg: 100, reps: 5 })];
    const withEccentric = [...honest, row({ weightKg: 150, reps: 3, repStyle: 'eccentric-only', at: NOW + 1 })];
    const labels = (rows: LoggedSet[]) =>
      personalRecords(rows)
        .filter((r) => r.kind === 'weight')
        .map((r) => [r.label, r.kg]);
    expect(labels(withEccentric)).toEqual(labels(honest));
    expect(bestSet(withEccentric)).toEqual(honest[0]);
  });

  it("the best session's volume counts every piece of a drop set", () => {
    const records = personalRecords([
      row({ weightKg: 100, reps: 8 }),
      row({ weightKg: 80, reps: 6, segment: 1, segmentStyle: 'drop' }),
    ]);
    expect(records.find((r) => r.label === 'Best session volume')?.kg).toBe(800 + 480);
  });

  it('a set with two drops is one set in the session summary, and its tonnage is every piece', () => {
    const rows = [
      row({ weightKg: 100, reps: 5, setNo: 1, at: NOW }),
      row({ weightKg: 80, reps: 6, setNo: 1, segment: 1, segmentStyle: 'drop', at: NOW + 1 }),
      row({ weightKg: 60, reps: 8, setNo: 1, segment: 2, segmentStyle: 'drop', at: NOW + 2 }),
      row({ weightKg: 100, reps: 5, setNo: 2, at: NOW + 3 }),
    ];
    const [summary] = summariseSessions([session()], rows);
    expect(summary!.workingSets).toBe(2);
    expect(summary!.lifts[0]!.workingSets).toBe(2);
    expect(summary!.tonnageKg).toBe(500 + 480 + 480 + 500);
    expect(recentLiftDays(rows)[0]).toMatchObject({ sets: 2, tonnageKg: 1960 });
  });

  it('rows with no method fields summarise exactly as before', () => {
    const rows = [row({ weightKg: 100, reps: 5 }), row({ weightKg: 90, reps: 5, setNo: 2, at: NOW + 1 })];
    const [summary] = summariseSessions([session()], rows);
    expect(summary!.workingSets).toBe(2);
    expect(summary!.tonnageKg).toBe(950);
    expect(liftVolume(rows, NOW + 2)).toBe(950);
  });

  it('the trend and the sparkline read full-range reps only', () => {
    const honest = [row({ weightKg: 100, reps: 5, at: NOW - 7 * DAY }), row({ weightKg: 100, reps: 5, at: NOW })];
    const withPartial = [...honest, row({ weightKg: 200, reps: 5, repStyle: 'partial', at: NOW })];
    expect(liftTrend(withPartial, NOW)).toBe(liftTrend(honest, NOW));
    expect(liftSparkline(withPartial, NOW)).toEqual(liftSparkline(honest, NOW));
  });
});
