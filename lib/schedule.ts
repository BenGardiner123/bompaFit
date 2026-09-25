// Week-anchored scheduling: the v1→v2 transform, and the helpers that read a
// week's slots.
//
// Pure — imports only calc and types. That matters because this exact transform
// runs in two places: the Dexie `version(2).upgrade()` and the envelope importer.
// Two derivations would drift, and the drift would be silent.

import { MODEL, addDays, dateKey, startOfWeek } from './calc';
import type { PlannedSession, PlannedStatus } from './types';

/**
 * The week a planned session is filed under.
 *
 * Always Monday, deliberately independent of the user's `weekStart` display
 * setting. `weekStart` is a *storage key* on every row — if it followed a
 * setting, flipping Monday→Sunday would invalidate every key in the database and
 * demand a data migration on a settings toggle. Worse, until that migration ran,
 * every query built from the setting would miss every stored row, and the
 * rollover sweep would mark the entire current week as skipped.
 */
export function planWeekStart(key: string): string {
  return startOfWeek(key, MODEL.WEEK_ANCHOR);
}

/** The week containing a timestamp. */
export function planWeekOf(at: number): string {
  return planWeekStart(dateKey(at));
}

// ─────────────────────────────────────────────────────────────
// v1 → v2
// ─────────────────────────────────────────────────────────────

/** A row as it existed under `db.version(1)`, before weeks replaced weekdays. */
export type LegacyPlannedSession = {
  id?: number;
  planId: number;
  blockId: number;
  date?: string;
  routineId: string;
  status: string;
  sessionId?: number;
  adjustedByBompa?: boolean;
  volumeFactor: number;
  // Present when a row has already been migrated; makes this idempotent.
  weekStart?: string;
  slotIndex?: number;
};

export type MigrationResult = {
  /** Rows to write back, already in v2 shape. */
  keep: PlannedSession[];
  /** Ids of rows to delete — the weekday grid's rest-day filler. */
  drop: number[];
  /** For the import preview. Silence about a destructive step is not acceptable. */
  summary: { migrated: number; dropped: number; datesCleared: number };
};

/**
 * Old statuses fold into the narrowed union. Anything unrecognised becomes
 * `'plan'` rather than throwing — this also runs against `Adjustment.before`
 * blobs written before the migration, which can carry `'rest'` and `'adjusted'`
 * and would otherwise get written straight back into the database past the type
 * system.
 */
export function normalisePlannedStatus(raw: unknown): PlannedStatus {
  if (raw === 'done' || raw === 'skip') return raw;
  return 'plan';
}

/**
 * Map v1 rows onto the week model.
 *
 * Total by construction. A throw in here would abort the Dexie version
 * transaction, reject `db.open()`, and drop the user into in-memory mode — which
 * looks exactly like their entire training history has vanished, with a console
 * warning as the only clue. So a missing or unparseable date buckets to
 * `fallbackWeek` instead of failing.
 */
export function migratePlannedSessions(
  rows: LegacyPlannedSession[],
  fallbackWeek: string,
): MigrationResult {
  const drop: number[] = [];
  const survivors: LegacyPlannedSession[] = [];

  for (const row of rows) {
    // Rest days were filler emitted so the weekday grid had a cell to draw. They
    // are exactly the rows with no routine, and they have no meaning in a model
    // that only stores sessions you intend to do.
    if (!row.routineId) {
      if (row.id !== undefined) drop.push(row.id);
      continue;
    }
    survivors.push(row);
  }

  // Group by the week each row's old date fell in, so slot order follows the
  // order they were originally scheduled.
  const byWeek = new Map<string, LegacyPlannedSession[]>();
  for (const row of survivors) {
    const week = row.weekStart ?? safeWeek(row.date, fallbackWeek);
    const bucket = byWeek.get(week);
    if (bucket) bucket.push(row);
    else byWeek.set(week, [row]);
  }

  const keep: PlannedSession[] = [];
  let datesCleared = 0;

  for (const [weekStart, bucket] of byWeek) {
    bucket.sort((a, b) => {
      const byDate = (a.date ?? '').localeCompare(b.date ?? '');
      if (byDate !== 0) return byDate;
      return (a.id ?? 0) - (b.id ?? 0);
    });

    bucket.forEach((row, index) => {
      const status = normalisePlannedStatus(row.status);
      // A date now means "this was actually trained". Leaving the invented
      // scheduled date on a pending row would invite a `p.date === todayKey`
      // check that treats a plan as if it were trained.
      const keepDate = status === 'done' && row.date;
      if (!keepDate && row.date) datesCleared += 1;

      keep.push({
        id: row.id,
        planId: row.planId,
        blockId: row.blockId,
        weekStart,
        slotIndex: row.slotIndex ?? index,
        routineId: row.routineId,
        status,
        ...(keepDate ? { date: row.date } : {}),
        ...(row.sessionId !== undefined ? { sessionId: row.sessionId } : {}),
        adjustedByBompa: row.adjustedByBompa ?? false,
        volumeFactor: row.volumeFactor,
      });
    });
  }

  return { keep, drop, summary: { migrated: keep.length, dropped: drop.length, datesCleared } };
}

function safeWeek(date: string | undefined, fallbackWeek: string): string {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return fallbackWeek;
  const week = planWeekStart(date);
  // planWeekStart runs on UTC arithmetic and cannot really fail, but a garbage
  // date that passed the regex would surface here rather than downstream.
  return /^\d{4}-\d{2}-\d{2}$/.test(week) ? week : fallbackWeek;
}

// ─────────────────────────────────────────────────────────────
// Reading a week
// ─────────────────────────────────────────────────────────────

/** The slots of one week, in order. */
export function weekSlots(planned: PlannedSession[], weekStart: string): PlannedSession[] {
  return planned.filter((p) => p.weekStart === weekStart).sort((a, b) => a.slotIndex - b.slotIndex);
}

/**
 * Has the user rearranged this week by hand?
 *
 * A week is user-modified when any slot in it says so. There is no week row to
 * carry the flag, and deriving it from the adjustment log does not work — a
 * drop writes no adjustment at all, and `Adjustment.scope` names a slot rather
 * than the week it sat in.
 *
 * Distinct from `adjustedByBompa`, which marks what *Bompa* changed. A week can
 * be both, and conflating them would make the Plan screen unable to say which
 * of you moved something.
 */
export function weekIsUserModified(planned: PlannedSession[], weekStart: string): boolean {
  return weekSlots(planned, weekStart).some((p) => p.userModified === true);
}

/** The next slot still to be done in a week, or null when the week is complete. */
export function nextPendingSlot(planned: PlannedSession[], weekStart: string): PlannedSession | null {
  return weekSlots(planned, weekStart).find((p) => p.status === 'plan') ?? null;
}

/**
 * The pending slot a routine would fill, if any.
 *
 * Matching on the routine rather than "the next slot in order" is what makes
 * doing Wednesday's session on Monday count as *early* rather than *extra*.
 */
export function pendingSlotFor(
  planned: PlannedSession[],
  weekStart: string,
  routineId: string,
): PlannedSession | null {
  return weekSlots(planned, weekStart).find((p) => p.status === 'plan' && p.routineId === routineId) ?? null;
}

export type WeekProgress = { done: number; total: number; remaining: number };

export function weekProgress(planned: PlannedSession[], weekStart: string): WeekProgress {
  const slots = weekSlots(planned, weekStart);
  const done = slots.filter((p) => p.status === 'done').length;
  return { done, total: slots.length, remaining: slots.filter((p) => p.status === 'plan').length };
}

/**
 * Renumber a week's slots to a dense 0..n-1.
 *
 * Called after every reorder or drop. Gaps or repeats would make "the lowest
 * pending slotIndex" ambiguous, and nothing else enforces uniqueness.
 */
export function renumber(slots: PlannedSession[]): PlannedSession[] {
  return slots
    .slice()
    .sort((a, b) => a.slotIndex - b.slotIndex)
    .map((slot, index) => (slot.slotIndex === index ? slot : { ...slot, slotIndex: index }));
}

// ─────────────────────────────────────────────────────────────
// The week as a budget
// ─────────────────────────────────────────────────────────────

export type WeekBudget = {
  /** What the week was planned to cost — the summed prescribed load of its slots. */
  budget: number;
  /** What has actually been logged in it so far. */
  logged: number;
  /** Logged plus the prescribed load of the slots still standing. */
  projected: number;
  /** projected / budget − 1. Positive means over. */
  overshoot: number;
  /** Slots still to do, in order. What a trim would act on. */
  remaining: PlannedSession[];
  /**
   * True when a routine could not be priced, so the numbers are incomplete.
   *
   * Callers must not raise an over-budget claim on an unknown budget. Treating
   * an unresolvable routine as zero load makes the projection look over when it
   * is not, and the app then offers to trim work that was never over — a wrong
   * statement to the user, which is worse than saying nothing.
   */
  unknown: boolean;
};

/**
 * Price a week: what it was meant to cost, what it has cost, what it will cost.
 *
 * `slotLoad` returns null for a routine it cannot resolve. `loggedLoad` is the
 * real load of sessions already trained in this week, including any that
 * consumed no slot — those are the additional sessions that push a week over.
 */
export function weekBudget(args: {
  planned: PlannedSession[];
  weekStart: string;
  slotLoad: (p: PlannedSession) => number | null;
  loggedLoad: number;
}): WeekBudget {
  const { planned, weekStart, slotLoad, loggedLoad } = args;
  const slots = weekSlots(planned, weekStart);

  let budget = 0;
  let remainingLoad = 0;
  let unknown = false;
  const remaining: PlannedSession[] = [];

  for (const slot of slots) {
    const load = slotLoad(slot);
    if (load === null) {
      unknown = true;
      continue;
    }
    budget += load;
    if (slot.status === 'plan') {
      remaining.push(slot);
      remainingLoad += load;
    }
  }

  const projected = loggedLoad + remainingLoad;
  return {
    budget,
    logged: loggedLoad,
    projected,
    overshoot: budget > 0 ? projected / budget - 1 : 0,
    remaining,
    unknown,
  };
}

/** Whether the week's projection is far enough over to be worth saying. */
export function isOverBudget(week: WeekBudget, isDeload: boolean): boolean {
  // An unknown budget cannot support a claim about being over it.
  if (week.unknown || week.budget <= 0) return false;
  // A deload week's budget is already about a third of normal, so almost any
  // additional session trips the percentage anyway — but say so regardless,
  // because the point of a deload is fewer stressors, not lighter ones.
  if (isDeload) return week.projected > week.budget;
  return week.overshoot > MODEL.WEEK_OVER_BUDGET;
}

/**
 * The most a trim will take off a session. Below this the week stops being
 * training and starts being a gesture.
 */
export const MIN_TRIM_FACTOR = 0.5;

/**
 * Scale the remaining slots so the week lands back on budget.
 * Returns the slots with new volume factors, or an empty list when there is
 * nothing left to trim.
 */
export function trimToBudget(week: WeekBudget, slotLoad: (p: PlannedSession) => number | null): PlannedSession[] {
  if (week.remaining.length === 0) return [];
  const headroom = week.budget - week.logged;
  let remainingLoad = 0;
  for (const slot of week.remaining) remainingLoad += slotLoad(slot) ?? 0;
  if (remainingLoad <= 0) return [];

  // Floored, not zeroed. One big extra session should not delete the rest of
  // your week — past a point the honest answer is "I've cut this as far as it
  // sensibly goes", and the remaining overshoot is yours to own.
  const factor = Math.max(MIN_TRIM_FACTOR, Math.max(0, headroom) / remainingLoad);
  return week.remaining.map((slot) => ({
    ...slot,
    volumeFactor: Math.round(slot.volumeFactor * factor * 1000) / 1000,
    adjustedByBompa: true,
  }));
}

/**
 * Spread a week's slots across its seven days, for the forward projection.
 * Planned sessions have no dates, so the model needs somewhere to put them; even
 * spacing is the least wrong assumption available.
 */
export function spreadWeekDays(weekStart: string, count: number): string[] {
  if (count <= 0) return [];
  if (count >= 7) return Array.from({ length: count }, (_, i) => addDays(weekStart, Math.min(i, 6)));
  const step = 7 / count;
  return Array.from({ length: count }, (_, i) => addDays(weekStart, Math.min(6, Math.round(i * step))));
}

/**
 * The week with a dropped slot put back, for Undo.
 *
 * The slot returns with its own id, so anything that pointed at it still does,
 * and at the position it was dropped from. It is spliced into the week as it
 * stands now rather than the week as it stood then: something may have moved
 * or been added in the seconds since, and restoring an old snapshot wholesale
 * would throw that away.
 *
 * Dropping marks the whole week as rearranged by hand. Undoing gives a slot
 * back the flag it had before, but only a slot still exactly as the drop left
 * it: one changed since (swapped, moved) was changed by the lifter, and its
 * mark is theirs now, not the drop's. A slot added since keeps its own too, so
 * a drop and its undo leave no trace and take nothing else away.
 *
 * `before` is the week as it was just before the drop, dropped slot included,
 * and `after` the week as the drop left it. If the slot is somehow already
 * back, the week is returned as it is, so a second tap on Undo cannot put in a
 * duplicate.
 */
export function restoreDropped(
  week: PlannedSession[],
  dropped: PlannedSession,
  before: PlannedSession[],
  after: PlannedSession[],
): PlannedSession[] {
  if (week.some((p) => p.id === dropped.id)) return week;
  const flags = new Map(before.map((p) => [p.id, p.userModified]));
  const left = new Map(after.map((p) => [p.id, p]));
  const untouched = (slot: PlannedSession) => {
    const was = left.get(slot.id);
    return (
      was !== undefined &&
      was.slotIndex === slot.slotIndex &&
      was.routineId === slot.routineId &&
      was.status === slot.status &&
      was.userModified === slot.userModified
    );
  };
  const ordered = week.slice().sort((a, b) => a.slotIndex - b.slotIndex);
  const kept = new Set(ordered.filter(untouched).map((p) => p.id));
  ordered.splice(Math.min(dropped.slotIndex, ordered.length), 0, dropped);
  return ordered.map((slot, index) => {
    const next: PlannedSession = { ...slot, slotIndex: index };
    if (flags.has(slot.id) && kept.has(slot.id)) {
      const flag = flags.get(slot.id);
      if (flag === undefined) delete next.userModified;
      else next.userModified = flag;
    }
    return next;
  });
}
