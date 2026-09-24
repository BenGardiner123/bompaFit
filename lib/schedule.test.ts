import Dexie from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import { BompaDB } from './db';
import {
  isOverBudget,
  migratePlannedSessions,
  nextPendingSlot,
  normalisePlannedStatus,
  pendingSlotFor,
  planWeekStart,
  renumber,
  spreadWeekDays,
  trimToBudget,
  weekBudget,
  weekIsUserModified,
  weekProgress,
  weekSlots,
  type LegacyPlannedSession,
} from './schedule';
import type { PlannedSession } from './types';

const WEEK = '2026-08-17'; // a Monday
const FALLBACK = '2026-01-05';

function slot(over: Partial<PlannedSession> = {}): PlannedSession {
  return {
    id: over.id,
    planId: 1,
    blockId: 1,
    weekStart: over.weekStart ?? WEEK,
    slotIndex: over.slotIndex ?? 0,
    routineId: over.routineId ?? 'push',
    status: over.status ?? 'plan',
    date: over.date,
    adjustedByBompa: over.adjustedByBompa ?? false,
    volumeFactor: over.volumeFactor ?? 1,
    userModified: over.userModified,
  };
}

// ─────────────────────────────────────────────────────────────
// Week anchoring
// ─────────────────────────────────────────────────────────────

describe('planWeekStart', () => {
  it('always lands on the Monday, whatever the day', () => {
    expect(planWeekStart('2026-08-17')).toBe(WEEK); // Monday
    expect(planWeekStart('2026-08-19')).toBe(WEEK); // Wednesday
    expect(planWeekStart('2026-08-23')).toBe(WEEK); // Sunday
  });

  it('does not follow the display setting', () => {
    // The whole point: weekStart is a storage key. If it tracked a preference,
    // flipping Mon→Sun would invalidate every key already written.
    expect(planWeekStart('2026-08-23')).toBe(WEEK);
  });
});

// ─────────────────────────────────────────────────────────────
// v1 → v2
// ─────────────────────────────────────────────────────────────

describe('migratePlannedSessions', () => {
  it('maps each row to the week its old date fell in', () => {
    const rows: LegacyPlannedSession[] = [
      { planId: 1, blockId: 1, date: '2026-08-19', routineId: 'push', status: 'plan', volumeFactor: 1 },
      { planId: 1, blockId: 1, date: '2026-08-21', routineId: 'pull', status: 'plan', volumeFactor: 1 },
    ];
    const { keep } = migratePlannedSessions(rows, FALLBACK);
    expect(keep.every((r) => r.weekStart === WEEK)).toBe(true);
  });

  it('derives dense slot indices from the original day order', () => {
    const rows: LegacyPlannedSession[] = [
      { id: 3, planId: 1, blockId: 1, date: '2026-08-21', routineId: 'legs', status: 'plan', volumeFactor: 1 },
      { id: 1, planId: 1, blockId: 1, date: '2026-08-17', routineId: 'push', status: 'plan', volumeFactor: 1 },
      { id: 2, planId: 1, blockId: 1, date: '2026-08-19', routineId: 'pull', status: 'plan', volumeFactor: 1 },
    ];
    const { keep } = migratePlannedSessions(rows, FALLBACK);
    expect(keep.map((r) => [r.routineId, r.slotIndex])).toEqual([
      ['push', 0],
      ['pull', 1],
      ['legs', 2],
    ]);
  });

  it('deletes rest-day filler rather than converting it', () => {
    const rows: LegacyPlannedSession[] = [
      { id: 1, planId: 1, blockId: 1, date: '2026-08-17', routineId: 'push', status: 'plan', volumeFactor: 1 },
      { id: 2, planId: 1, blockId: 1, date: '2026-08-20', routineId: '', status: 'rest', volumeFactor: 0 },
    ];
    const { keep, drop, summary } = migratePlannedSessions(rows, FALLBACK);
    expect(drop).toEqual([2]);
    expect(keep).toHaveLength(1);
    expect(summary.dropped).toBe(1);
  });

  it('keeps a date only on sessions that were actually trained', () => {
    const rows: LegacyPlannedSession[] = [
      { id: 1, planId: 1, blockId: 1, date: '2026-08-17', routineId: 'push', status: 'done', volumeFactor: 1 },
      { id: 2, planId: 1, blockId: 1, date: '2026-08-19', routineId: 'pull', status: 'plan', volumeFactor: 1 },
    ];
    const { keep } = migratePlannedSessions(rows, FALLBACK);
    expect(keep.find((r) => r.id === 1)?.date).toBe('2026-08-17');
    // A pending slot carrying an invented date would invite a
    // `p.date === todayKey` check that treats a plan as if it were trained.
    expect(keep.find((r) => r.id === 2)?.date).toBeUndefined();
  });

  it('folds retired statuses into the narrowed union', () => {
    const rows: LegacyPlannedSession[] = [
      { id: 1, planId: 1, blockId: 1, date: '2026-08-17', routineId: 'push', status: 'adjusted', adjustedByBompa: true, volumeFactor: 1.2 },
    ];
    const { keep } = migratePlannedSessions(rows, FALLBACK);
    expect(keep[0]!.status).toBe('plan');
    // The flag that always carried this meaning survives untouched.
    expect(keep[0]!.adjustedByBompa).toBe(true);
  });

  it('never throws on a malformed row', () => {
    // A throw here aborts the version transaction, rejects db.open(), and the
    // user sees an empty app where their history used to be.
    const rows = [
      { planId: 1, blockId: 1, routineId: 'push', status: 'plan', volumeFactor: 1 },
      { planId: 1, blockId: 1, date: 'not-a-date', routineId: 'pull', status: 'plan', volumeFactor: 1 },
      { planId: 1, blockId: 1, date: '', routineId: 'legs', status: 'weird', volumeFactor: 1 },
    ] as LegacyPlannedSession[];
    const { keep } = migratePlannedSessions(rows, FALLBACK);
    expect(keep).toHaveLength(3);
    expect(keep.every((r) => r.weekStart === FALLBACK)).toBe(true);
    expect(keep.every((r) => r.status === 'plan')).toBe(true);
  });

  it('is idempotent — running it on v2 rows changes nothing', () => {
    const rows: LegacyPlannedSession[] = [
      { id: 1, planId: 1, blockId: 1, weekStart: WEEK, slotIndex: 2, routineId: 'push', status: 'plan', volumeFactor: 1 },
    ];
    const once = migratePlannedSessions(rows, FALLBACK).keep;
    const twice = migratePlannedSessions(once as LegacyPlannedSession[], FALLBACK).keep;
    expect(twice).toEqual(once);
    expect(twice[0]!.slotIndex).toBe(2);
  });
});

describe('normalisePlannedStatus', () => {
  it('passes the live union through', () => {
    expect(normalisePlannedStatus('done')).toBe('done');
    expect(normalisePlannedStatus('skip')).toBe('skip');
  });

  it('folds retired and unknown values to plan rather than throwing', () => {
    // Old Adjustment.before blobs carry these, and undo writes them straight
    // back into the database past the type system.
    expect(normalisePlannedStatus('rest')).toBe('plan');
    expect(normalisePlannedStatus('adjusted')).toBe('plan');
    expect(normalisePlannedStatus(undefined)).toBe('plan');
    expect(normalisePlannedStatus(42)).toBe('plan');
  });
});

// ─────────────────────────────────────────────────────────────
// The real Dexie upgrade
// ─────────────────────────────────────────────────────────────

describe('db.version(2)', () => {
  const NAME = 'bompa-migration-test';

  afterEach(async () => {
    await Dexie.delete(NAME);
  });

  it('upgrades a v1 database without losing anything', async () => {
    // A database as version(1) actually shaped it.
    const v1 = new Dexie(NAME);
    v1.version(1).stores({
      exercises: 'id, name, pattern',
      routines: 'id, source',
      plans: '++id, startDate',
      blocks: '++id, planId, startDate',
      plannedSessions: '++id, planId, date, blockId',
      sessions: '++id, date, startedAt',
      sets: '++id, sessionId, exerciseId, at',
      adjustments: '++id, at, planId',
      competitions: '++id, date',
      settings: 'key',
      syncQueue: '++id, at',
    });
    await v1.open();
    await v1.table('plans').put({ id: 1, name: 'Old plan', startDate: WEEK, createdAt: Date.now() });
    await v1.table('plannedSessions').bulkAdd([
      { planId: 1, blockId: 1, date: '2026-08-17', routineId: 'push', status: 'done', adjustedByBompa: false, volumeFactor: 1 },
      { planId: 1, blockId: 1, date: '2026-08-18', routineId: '', status: 'rest', adjustedByBompa: false, volumeFactor: 0 },
      { planId: 1, blockId: 1, date: '2026-08-19', routineId: 'pull', status: 'plan', adjustedByBompa: false, volumeFactor: 1 },
      { planId: 1, blockId: 1, date: '2026-08-21', routineId: 'legs', status: 'adjusted', adjustedByBompa: true, volumeFactor: 1.2 },
    ]);
    await v1.table('sets').add({ sessionId: 1, exerciseId: 'back-squat', setNo: 1, type: 'working', weightKg: 100, reps: 5, rpe: 8, rpeEstimated: false, at: Date.now() });
    v1.close();

    // Reopen through the real schema, which runs the upgrade. The literal is the
    // current schema version, not v2 — a new migration is meant to fail here and
    // make its author confirm this history still survives the whole chain.
    const v2 = new BompaDB(NAME);
    await v2.open();
    expect(v2.verno).toBe(4);

    const rows = await v2.plannedSessions.toArray();
    // The rest-day filler is gone; the three real sessions survive.
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.weekStart === WEEK)).toBe(true);
    expect(rows.map((r) => r.slotIndex).sort()).toEqual([0, 1, 2]);
    expect(rows.every((r) => r.status !== ('rest' as never) && r.status !== ('adjusted' as never))).toBe(true);

    const done = rows.find((r) => r.routineId === 'push');
    expect(done?.status).toBe('done');
    expect(done?.date).toBe('2026-08-17');
    expect(rows.find((r) => r.routineId === 'pull')?.date).toBeUndefined();
    // The adjusted row keeps its flag even though the status is gone.
    expect(rows.find((r) => r.routineId === 'legs')?.adjustedByBompa).toBe(true);

    // Everything else is carried forward untouched.
    expect(await v2.sets.count()).toBe(1);
    expect(await v2.plans.count()).toBe(1);
    v2.close();
  });

  it('opens a fresh database straight at the current version', async () => {
    const fresh = new BompaDB(NAME);
    await fresh.open();
    expect(fresh.verno).toBe(4);
    expect(await fresh.plannedSessions.count()).toBe(0);
    fresh.close();
  });
});

// ─────────────────────────────────────────────────────────────
// Reading a week
// ─────────────────────────────────────────────────────────────

describe('week helpers', () => {
  const week = [
    slot({ id: 1, slotIndex: 0, routineId: 'push', status: 'done' }),
    slot({ id: 2, slotIndex: 1, routineId: 'pull' }),
    slot({ id: 3, slotIndex: 2, routineId: 'legs' }),
    slot({ id: 4, slotIndex: 0, routineId: 'push', weekStart: '2026-08-24' }),
  ];

  it('returns only the asked-for week, in order', () => {
    expect(weekSlots(week, WEEK).map((p) => p.id)).toEqual([1, 2, 3]);
  });

  it('finds the next pending slot', () => {
    expect(nextPendingSlot(week, WEEK)?.id).toBe(2);
  });

  it('matches a pending slot by routine, not by position', () => {
    // Doing Wednesday's legs session on Monday fills the legs slot — early,
    // not extra.
    expect(pendingSlotFor(week, WEEK, 'legs')?.id).toBe(3);
  });

  it('returns nothing when the routine has no pending slot', () => {
    // push is already done, so a second push session is genuinely additional.
    expect(pendingSlotFor(week, WEEK, 'push')).toBeNull();
  });

  it('a week with no hand-made changes is not user-modified', () => {
    expect(weekIsUserModified(week, WEEK)).toBe(false);
  });

  it('one marked slot makes its whole week user-modified', () => {
    const touched = [...week.slice(0, 2), slot({ id: 3, slotIndex: 2, userModified: true })];
    expect(weekIsUserModified(touched, WEEK)).toBe(true);
  });

  it('the mark does not leak into a neighbouring week', () => {
    // id 4 lives in the following week. Marking it must not make this one read
    // as rearranged — weekStart is the boundary and it has to hold.
    const other = [...week.slice(0, 3), slot({ id: 4, slotIndex: 0, weekStart: '2026-08-24', userModified: true })];
    expect(weekIsUserModified(other, WEEK)).toBe(false);
    expect(weekIsUserModified(other, '2026-08-24')).toBe(true);
  });

  it('user-modified and adjustedByBompa are independent', () => {
    // A week Bompa trimmed is not a week you rearranged. Collapsing the two
    // would make the Plan screen unable to say which of you moved something.
    const bompaOnly = [slot({ id: 1, slotIndex: 0, adjustedByBompa: true })];
    expect(weekIsUserModified(bompaOnly, WEEK)).toBe(false);
  });

  it('counts progress', () => {
    expect(weekProgress(week, WEEK)).toEqual({ done: 1, total: 3, remaining: 2 });
  });

  it('renumbers to a dense range', () => {
    const gappy = [slot({ id: 1, slotIndex: 0 }), slot({ id: 2, slotIndex: 4 }), slot({ id: 3, slotIndex: 9 })];
    expect(renumber(gappy).map((p) => p.slotIndex)).toEqual([0, 1, 2]);
  });

  it('spreads a week evenly for the forward projection', () => {
    expect(spreadWeekDays(WEEK, 1)).toEqual(['2026-08-17']);
    const three = spreadWeekDays(WEEK, 3);
    expect(three).toHaveLength(3);
    expect(new Set(three).size).toBe(3);
    expect(spreadWeekDays(WEEK, 0)).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────
// The week as a budget
// ─────────────────────────────────────────────────────────────

describe('weekBudget', () => {
  const week = [
    slot({ id: 1, slotIndex: 0, status: 'done' }),
    slot({ id: 2, slotIndex: 1 }),
    slot({ id: 3, slotIndex: 2 }),
  ];
  const flat = () => 100;

  it('prices the whole week and what is left of it', () => {
    const budget = weekBudget({ planned: week, weekStart: WEEK, slotLoad: flat, loggedLoad: 100 });
    expect(budget.budget).toBe(300);
    expect(budget.projected).toBe(300); // 100 logged + 200 still to come
    expect(budget.overshoot).toBeCloseTo(0, 5);
    expect(budget.remaining).toHaveLength(2);
  });

  it('a session that fills a slot leaves the budget unchanged', () => {
    const before = weekBudget({ planned: week, weekStart: WEEK, slotLoad: flat, loggedLoad: 100 });
    const after = weekBudget({
      planned: week.map((p) => (p.id === 2 ? { ...p, status: 'done' as const } : p)),
      weekStart: WEEK,
      slotLoad: flat,
      loggedLoad: 200,
    });
    expect(after.budget).toBe(before.budget);
    expect(after.projected).toBe(before.projected);
  });

  it('an additional session pushes the projection over', () => {
    // One slot done (100) plus an extra unplanned session (50) = 150 logged,
    // with two slots still to come (200). Budget is 300.
    const budget = weekBudget({ planned: week, weekStart: WEEK, slotLoad: flat, loggedLoad: 150 });
    expect(budget.projected).toBe(350);
    expect(budget.overshoot).toBeCloseTo(1 / 6, 3);
    expect(isOverBudget(budget, false)).toBe(true);
  });

  it('stays quiet under the threshold', () => {
    const budget = weekBudget({ planned: week, weekStart: WEEK, slotLoad: flat, loggedLoad: 110 });
    expect(isOverBudget(budget, false)).toBe(false);
  });

  it('a deload week flags any extra at all', () => {
    const budget = weekBudget({ planned: week, weekStart: WEEK, slotLoad: flat, loggedLoad: 105 });
    expect(isOverBudget(budget, false)).toBe(false);
    expect(isOverBudget(budget, true)).toBe(true);
  });

  it('raises nothing when a routine cannot be priced', () => {
    // Unknown load is not zero load. Treating it as zero would make the
    // projection look over and offer to trim work that is not over — a wrong
    // claim to the user, which is worse than saying nothing.
    const budget = weekBudget({ planned: week, weekStart: WEEK, slotLoad: () => null, loggedLoad: 9999 });
    expect(budget.unknown).toBe(true);
    expect(isOverBudget(budget, false)).toBe(false);
    expect(isOverBudget(budget, true)).toBe(false);
  });

  it('trimming lands the week back on budget', () => {
    const budget = weekBudget({ planned: week, weekStart: WEEK, slotLoad: flat, loggedLoad: 200 });
    const trimmed = trimToBudget(budget, flat);
    expect(trimmed).toHaveLength(2);
    const after = trimmed.reduce((total, p) => total + 100 * p.volumeFactor, 0);
    expect(200 + after).toBeCloseTo(300, 0);
    expect(trimmed.every((p) => p.adjustedByBompa)).toBe(true);
  });

  it('flags an overshoot even with nothing left to trim', () => {
    const spent = week.map((p) => ({ ...p, status: 'done' as const }));
    const budget = weekBudget({ planned: spent, weekStart: WEEK, slotLoad: flat, loggedLoad: 500 });
    expect(isOverBudget(budget, false)).toBe(true);
    expect(trimToBudget(budget, flat)).toHaveLength(0);
  });

  it('never trims a session below zero', () => {
    const budget = weekBudget({ planned: week, weekStart: WEEK, slotLoad: flat, loggedLoad: 9999 });
    for (const p of trimToBudget(budget, flat)) expect(p.volumeFactor).toBeGreaterThanOrEqual(0);
  });
});
