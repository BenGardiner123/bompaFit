// Describing a finished session.
//
// History has always sliced by lift, which answers "how is my squat going" and
// cannot answer "what did I actually do on Tuesday" — that session's squats sit
// under Back Squat and its presses under Overhead Press, and the session itself
// appears nowhere. This is the other axis.
//
// Pure, like the rest of lib/: takes plain rows, returns plain numbers.

import { DAY_MS, addDays, countsAsWork, dateKey, epley, toDisplay, weekdayIndex } from './calc';
import { countsForRecords, isSet, rowTonnage } from './methods';
import type { LoggedSet, Session, Unit } from './types';

export type SessionLift = {
  exerciseId: string;
  /** Every set for this lift in this session, oldest first. */
  sets: LoggedSet[];
  /** Working and back-off only — a heavy warm-up single is not the top set. */
  topWeightKg: number;
  /** Sets, not pieces: a drop set with two drops is one set. */
  workingSets: number;
};

export type SessionSummary = {
  session: Session;
  /** Ordered by the session's own `exerciseIds` snapshot. */
  lifts: SessionLift[];
  /** Working and back-off sets. Warm-ups are not the work, and a drop is not an extra set. */
  workingSets: number;
  /** Kilograms, working and back-off only, every piece included, reps scaled to normal-rep equivalents. */
  tonnageKg: number;
  /** How long it took, from the session's own clock. */
  durationMs: number;
};

/**
 * Finished sessions, newest first, each with its sets grouped by lift.
 *
 * A finished session with no sets is kept rather than hidden. Starting one and
 * logging nothing is a real thing that happened, and quietly dropping it from
 * history would be the app deciding which of your days counted.
 */
export function summariseSessions(sessions: Session[], sets: LoggedSet[]): SessionSummary[] {
  const bySession = new Map<number, LoggedSet[]>();
  for (const row of sets) {
    const arr = bySession.get(row.sessionId);
    if (arr) arr.push(row);
    else bySession.set(row.sessionId, [row]);
  }

  const out: SessionSummary[] = [];
  for (const session of sessions) {
    if (session.id === undefined) continue;
    // Still running. The Train tab owns that one.
    if (session.finishedAt === undefined) continue;

    const owned = (bySession.get(session.id) ?? []).slice().sort((a, b) => a.at - b.at);

    // The snapshot drives the order, so history reads the way the session was
    // actually presented. Anything logged against a lift the snapshot somehow
    // missed is appended rather than dropped — a set that exists must appear.
    const order = [...session.exerciseIds];
    for (const row of owned) if (!order.includes(row.exerciseId)) order.push(row.exerciseId);

    const lifts: SessionLift[] = [];
    for (const exerciseId of order) {
      const mine = owned.filter((row) => row.exerciseId === exerciseId);
      if (mine.length === 0) continue;
      const work = mine.filter((row) => countsAsWork(row.type));
      lifts.push({
        exerciseId,
        sets: mine,
        topWeightKg: work.reduce((best, row) => (row.weightKg > best ? row.weightKg : best), 0),
        workingSets: work.filter(isSet).length,
      });
    }

    const work = owned.filter((row) => countsAsWork(row.type));
    out.push({
      session,
      lifts,
      workingSets: work.filter(isSet).length,
      tonnageKg: work.reduce((total, row) => total + rowTonnage(row), 0),
      // `elapsedMs` only accrues while the Train tab is open, so it is the
      // honest figure for time spent training rather than time elapsed since
      // you started and wandered off.
      durationMs: session.elapsedMs,
    });
  }

  return out.sort((a, b) => (b.session.finishedAt ?? 0) - (a.session.finishedAt ?? 0));
}

// ─────────────────────────────────────────────────────────────
// By session: the last seven days
// ─────────────────────────────────────────────────────────────

/**
 * How strongly a warm-up line is drawn in an expanded session. Dimmed rather
 * than hidden, because the warm-ups happened and they cost something. Kept
 * here so the contrast test and the screen read the same number.
 */
export const WARMUP_OPACITY = 0.6;

export type DayTonnage = {
  /** YYYY-MM-DD, local. */
  key: string;
  /** Kilograms, working and back-off sets only. */
  kg: number;
};

/**
 * Working tonnage for each calendar day in the `days` days ending on
 * `todayKey`, oldest first. Days with nothing logged are present with zero,
 * so a chart of them shows the rest days rather than skipping over them.
 *
 * Calendar days rather than a rolling 168 hours, so the bars and the total
 * above them always add up to the same number.
 */
export function dailyTonnage(sets: LoggedSet[], todayKey: string, days = 7): DayTonnage[] {
  const out: DayTonnage[] = [];
  const index = new Map<string, DayTonnage>();
  for (let i = days - 1; i >= 0; i--) {
    const day = { key: addDays(todayKey, -i), kg: 0 };
    out.push(day);
    index.set(day.key, day);
  }
  for (const row of sets) {
    if (!countsAsWork(row.type)) continue;
    const day = index.get(dateKey(row.at));
    if (day) day.kg += rowTonnage(row);
  }
  return out;
}

/**
 * Whole-number percentage change, or null when there is nothing to compare
 * against. Growth from zero is not a percentage: "Infinity%" and a made-up
 * "100%" would both be wrong.
 */
export function percentChange(current: number, previous: number): number | null {
  if (previous <= 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Tue", for a date key. The weekday is a fact about the date, not a setting. */
export function weekdayShort(key: string): string {
  return WEEKDAYS[weekdayIndex(key, 'Mon')] ?? '';
}

/**
 * "Tue 22 Sep", with the year added only when it isn't this year. The weekday
 * is what people actually remember a session by.
 */
export function fmtShortDay(key: string, todayKey: string): string {
  const [year, month, day] = key.split('-').map(Number);
  const base = `${weekdayShort(key)} ${day ?? ''} ${MONTHS[(month ?? 1) - 1] ?? ''}`;
  return key.slice(0, 4) === todayKey.slice(0, 4) ? base : `${base} ${year ?? ''}`;
}

/**
 * Tonnage as a short figure in the user's unit: tonnes to one decimal in
 * kilograms, thousands of pounds to one decimal in pounds. A five-digit pound
 * count does not fit beside a hero numeral, and nobody reads it anyway.
 */
export function fmtVolume(kg: number, unit: Unit): string {
  return (toDisplay(kg, unit) / 1000).toFixed(1);
}

/** The word that goes after `fmtVolume`, long ("tonnes") or short ("t"). */
export function volumeUnit(unit: Unit, short = false): string {
  if (unit === 'kg') return short ? 't' : 'tonnes';
  return short ? 'k lb' : 'thousand lb';
}

// ─────────────────────────────────────────────────────────────
// By lift
// ─────────────────────────────────────────────────────────────

/** The window the sparkline and its trend cover: twelve weeks. */
export const TREND_DAYS = 84;

/**
 * Every lift with at least one working set, most recently trained first. This
 * is the chip row: the catalogue holds hundreds of movements, and a chip for
 * a lift you have never done leads only to an empty page.
 */
export function loggedLifts(sets: LoggedSet[]): string[] {
  const latest = new Map<string, number>();
  for (const row of sets) {
    if (!countsAsWork(row.type)) continue;
    if (row.at > (latest.get(row.exerciseId) ?? -Infinity)) latest.set(row.exerciseId, row.at);
  }
  return [...latest.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
}

/**
 * The best Epley estimate per day across the last twelve weeks, as SVG points
 * in a 300×82 box. X is time, not position in the list, so two sessions a
 * week apart sit a week apart and the month labels underneath line up.
 * Sets over 12 reps are left out, where Epley stops being believable.
 *
 * The line starts at the first session in the window rather than twelve weeks
 * back, so someone two weeks in sees a curve across the width instead of a
 * spike squeezed against the right edge. `from` is that starting moment, for
 * placing the month labels on the same scale.
 */
export function liftSparkline(sets: LoggedSet[], now: number): { points: string[]; from: number } {
  const windowStart = now - TREND_DAYS * DAY_MS;
  const byDay = new Map<string, { at: number; value: number }>();
  for (const row of sets) {
    if (!countsForRecords(row) || row.at < windowStart || row.at > now || row.reps > 12) continue;
    const key = dateKey(row.at);
    const value = epley(row.weightKg, row.reps);
    const best = byDay.get(key);
    if (!best || value > best.value) byDay.set(key, { at: row.at, value });
  }
  const points = [...byDay.values()].sort((a, b) => a.at - b.at);
  const from = points.length > 1 ? points[0]!.at : windowStart;
  if (points.length === 0) return { points: [], from };

  const values = points.map((p) => p.value);
  const min = Math.min(...values);
  // A flat line still needs a span to divide by; 1 draws it level along the bottom.
  const span = Math.max(...values) - min || 1;
  return {
    from,
    points: points.map((p) => {
      const x = ((p.at - from) / (now - from || 1)) * 300;
      const y = 78 - ((p.value - min) / span) * 72;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }),
  };
}

export type MonthTick = {
  label: string;
  /** 0 at the left edge of the sparkline, 1 at the right. */
  x: number;
};

/**
 * Month labels for a sparkline running from `from` to `to`, each placed where
 * that month begins. The month the line opens in also gets a label at the
 * left edge, unless the next month starts so close by that the two would
 * overlap.
 */
export function monthTicks(from: number, to: number): MonthTick[] {
  const start = from;
  const span = to - from || 1;
  const opening = new Date(start);
  const ticks: MonthTick[] = [];
  // The Date constructor rolls month 12 over into January of the next year.
  for (let offset = 1; ; offset++) {
    const at = new Date(opening.getFullYear(), opening.getMonth() + offset, 1);
    if (at.getTime() > to) break;
    ticks.push({ label: MONTHS[at.getMonth()] ?? '', x: (at.getTime() - start) / span });
  }
  if (ticks.length === 0 || ticks[0]!.x > 0.15) ticks.unshift({ label: MONTHS[opening.getMonth()] ?? '', x: 0 });
  return ticks;
}

/**
 * Kilograms gained on the estimated max over the last twelve weeks: the best
 * estimate in the window against the first one in it. Null with fewer than
 * two sets to compare, where any trend would be made up.
 */
export function liftTrend(sets: LoggedSet[], now: number): number | null {
  const start = now - TREND_DAYS * DAY_MS;
  const recent = sets
    .filter((row) => countsForRecords(row) && row.at >= start && row.reps <= 12)
    .sort((a, b) => a.at - b.at);
  if (recent.length < 2) return null;
  const first = epley(recent[0]!.weightKg, recent[0]!.reps);
  const best = Math.max(...recent.map((row) => epley(row.weightKg, row.reps)));
  return Math.round((best - first) * 10) / 10;
}

/**
 * The heaviest working set, and on a tie in weight the one with more reps.
 * Full-range reps only: a lowering-only set above the max is not a best set.
 */
export function bestSet(sets: LoggedSet[]): LoggedSet | null {
  let best: LoggedSet | null = null;
  for (const row of sets) {
    if (!countsForRecords(row)) continue;
    if (!best || row.weightKg > best.weightKg || (row.weightKg === best.weightKg && row.reps > best.reps)) best = row;
  }
  return best;
}

/** Working tonnage for one lift over the trailing `days`, in kilograms. */
export function liftVolume(sets: LoggedSet[], now: number, days = 28): number {
  const start = now - days * DAY_MS;
  let total = 0;
  for (const row of sets) if (countsAsWork(row.type) && row.at > start) total += rowTonnage(row);
  return total;
}

export type PersonalRecord = {
  label: string;
  /** Kilograms: a weight for the rep maxes and the estimate, a tonnage for the best session. */
  kg: number;
  kind: 'weight' | 'volume';
  /** The date key it was set on. */
  key: string;
  /** The estimated max, which leads the list and is drawn in amber. */
  highlight: boolean;
};

/**
 * Records for one lift, from working sets only. A heavy warm-up single is not
 * a one-rep max, and counting it would put a number on the board that was
 * never tested.
 *
 * The estimate and the rep maxes come from full-range reps only, each row
 * judged on its own weight and reps: a cluster single at 90% is a real single,
 * a set of 21s is not an eight-rep record. The best session's volume counts all
 * the work, every piece of a drop set included.
 */
export function personalRecords(sets: LoggedSet[]): PersonalRecord[] {
  const work = sets.filter((row) => countsAsWork(row.type));
  const full = work.filter(countsForRecords);
  const out: PersonalRecord[] = [];

  let estimate: LoggedSet | null = null;
  for (const row of full) {
    if (row.reps > 12) continue;
    if (!estimate || epley(row.weightKg, row.reps) > epley(estimate.weightKg, estimate.reps)) estimate = row;
  }
  if (estimate) {
    out.push({
      label: 'Est. 1RM',
      kg: Math.round(epley(estimate.weightKg, estimate.reps) * 10) / 10,
      kind: 'weight',
      key: dateKey(estimate.at),
      highlight: true,
    });
  }

  // The "5 rep max" is the heaviest weight moved for five or more: a set of
  // six at 100kg is also a five at 100kg.
  for (const reps of [1, 3, 5, 8]) {
    let best: LoggedSet | null = null;
    for (const row of full) if (row.reps >= reps && (!best || row.weightKg > best.weightKg)) best = row;
    if (best) out.push({ label: `${reps} rep max`, kg: best.weightKg, kind: 'weight', key: dateKey(best.at), highlight: false });
  }

  const byDay = new Map<string, number>();
  for (const row of work) {
    const key = dateKey(row.at);
    byDay.set(key, (byDay.get(key) ?? 0) + rowTonnage(row));
  }
  const bestDay = [...byDay.entries()].sort((a, b) => b[1] - a[1])[0];
  if (bestDay) out.push({ label: 'Best session volume', kg: bestDay[1], kind: 'volume', key: bestDay[0], highlight: false });

  return out;
}

export type LiftDay = { key: string; sets: number; tonnageKg: number };

/** The most recent days this lift was trained, newest first, working sets only. Pieces add tonnage, not sets. */
export function recentLiftDays(sets: LoggedSet[], limit = 6): LiftDay[] {
  const byDay = new Map<string, LiftDay>();
  for (const row of sets) {
    if (!countsAsWork(row.type)) continue;
    const key = dateKey(row.at);
    const day = byDay.get(key) ?? { key, sets: 0, tonnageKg: 0 };
    if (isSet(row)) day.sets += 1;
    day.tonnageKg += rowTonnage(row);
    byDay.set(key, day);
  }
  return [...byDay.values()].sort((a, b) => (a.key < b.key ? 1 : -1)).slice(0, limit);
}
