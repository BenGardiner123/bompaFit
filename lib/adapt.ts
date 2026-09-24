// The adaptation engine. This is the part that makes Bompa a coach rather than
// a ledger: it reads the week that just happened and changes the week ahead.
//
// Adaptation evaluates at week boundaries, never per set. One
// hard set is noise; a week of hard sets is signal. The per-set toast in the
// logger is commentary and changes nothing.

import { EXERCISE_BY_ID } from './data';
import { countsForDrift, countsForProgression, resolveSlotMethod } from './methods';
import type { Adjustment, LoggedSet, PlannedSession, Routine, RoutineSlot } from './types';

/** Trigger thresholds, kept together so they are tunable in one place. */
export const ADAPT = {
  /** Mean RPE overshoot that counts as "this is beating me up". */
  HARD_DEVIATION: 1.5,
  /** Fraction of a lift's working sets that must overshoot before we act. */
  HARD_SET_FRACTION: 0.6,
  /** Mean RPE undershoot that counts as "this is too easy". */
  EASY_DEVIATION: -1.0,
  /** How much volume comes off a lift that is beating you up. */
  VOLUME_CUT: 0.1,
  /** Ceiling on how much a session can absorb from a missed one. */
  REDISTRIBUTE_CAP: 0.25,
  /** Weight bumps, in kilograms, when a lift is running easy. */
  STEP_COMPOUND: 2.5,
  STEP_ACCESSORY: 1.25,
  /** Don't judge a lift on one or two sets. */
  MIN_SETS: 3,
} as const;

/** Per-lift current prescription. Lives in the settings table under one key. */
export type Prescription = {
  /** Overrides the routine's programmed weight once adaptation has moved it. */
  weightKg: number | null;
  /** Multiplies the routine's set count. 1 = as programmed. */
  volumeFactor: number;
};

export type Prescriptions = Record<string, Prescription>;

export const PRESCRIPTIONS_KEY = 'prescriptions';

export function emptyPrescription(): Prescription {
  return { weightKg: null, volumeFactor: 1 };
}

/** What the logger should actually show for a slot, after adaptation. */
export function resolveTarget(
  slot: RoutineSlot,
  prescriptions: Prescriptions,
  e1rm: number,
): { sets: number; reps: number; weightKg: number; rpe: number } {
  const p = prescriptions[slot.exerciseId];
  const base = slot.targetWeightKg ?? (slot.targetPct1RM ? e1rm * slot.targetPct1RM : 0);
  const weightKg = p?.weightKg ?? base;
  const factor = p?.volumeFactor ?? 1;
  return {
    // Never round a prescription down to zero sets — an adapted lift is still
    // a lift you're doing. A scheme's length is its set count.
    sets: Math.max(1, Math.round(resolveSlotMethod(slot).setCount * factor)),
    reps: slot.reps,
    weightKg: Math.round(weightKg * 100) / 100,
    rpe: slot.targetRpe,
  };
}

// ─────────────────────────────────────────────────────────────
// Weekly review
// ─────────────────────────────────────────────────────────────

export type LiftWeek = {
  exerciseId: string;
  workingSets: number;
  meanDeviation: number;
  hardFraction: number;
};

/**
 * Summarise how each lift went against its programmed RPE. Warm-ups are excluded
 * — they run light by definition and would drag every mean downwards. So are the
 * later pieces of a drop or cluster set and AMRAP sets, whose effort is "all of
 * it" by design: counting them against the target would cut the volume of every
 * lift that uses them. `workingSets` therefore counts the same sets `liftCall`'s
 * minimum is about, and a lift trained only with AMRAP sets gets no call at all,
 * which is right — there is no evidence either way.
 */
export function summariseWeek(sets: LoggedSet[], targetRpe: Record<string, number>): LiftWeek[] {
  const byLift = new Map<string, number[]>();
  for (const s of sets) {
    if (!countsForDrift(s)) continue;
    const target = targetRpe[s.exerciseId];
    if (target === undefined) continue;
    const arr = byLift.get(s.exerciseId);
    if (arr) arr.push(s.rpe - target);
    else byLift.set(s.exerciseId, [s.rpe - target]);
  }

  const out: LiftWeek[] = [];
  for (const [exerciseId, deviations] of byLift) {
    const total = deviations.reduce((a, b) => a + b, 0);
    const hard = deviations.filter((d) => d >= ADAPT.HARD_DEVIATION).length;
    out.push({
      exerciseId,
      workingSets: deviations.length,
      meanDeviation: total / deviations.length,
      hardFraction: hard / deviations.length,
    });
  }
  return out.sort((a, b) => b.meanDeviation - a.meanDeviation);
}

/**
 * Whether a lift's week reads as too hard, too easy, or fine.
 *
 * The one place this call is made. The weekly review acts on it and the
 * finish summary only talks about it, and the summary must never promise a
 * change the review would not make — so both ask this, rather than each
 * keeping its own copy of the thresholds. A high average alone is not "hard":
 * one brutal set among easy ones should not cost the lift its volume.
 */
export function liftCall(lift: LiftWeek): 'hard' | 'easy' | null {
  if (lift.workingSets < ADAPT.MIN_SETS) return null;
  if (lift.meanDeviation >= ADAPT.HARD_DEVIATION && lift.hardFraction >= ADAPT.HARD_SET_FRACTION) return 'hard';
  if (lift.meanDeviation <= ADAPT.EASY_DEVIATION) return 'easy';
  return null;
}

/**
 * The weight an easy week's step is added to, or null when there is nothing
 * to progress.
 *
 * It is what they actually lifted, not what was suggested: changing the weight
 * mid-workout is how the lifter overrides Bompa, so the heaviest working set is
 * the truth. Back-offs are left out, being lighter on purpose, and so are the
 * pieces of a drop set, lowering-only sets and holds — see `countsForProgression`.
 * For a scheme the heaviest working set is its top set, the one at the working
 * weight, so a step moves the whole wave or pyramid together. The stored
 * prescription is not used — it starts empty, so a step added to it would never
 * happen. Zero means a bodyweight lift, and a step there would strap on a plate
 * nobody chose.
 */
export function progressionBase(sets: LoggedSet[], exerciseId: string): number | null {
  const heaviest = Math.max(
    0,
    ...sets.filter((row) => row.exerciseId === exerciseId && countsForProgression(row)).map((row) => row.weightKg),
  );
  return heaviest > 0 ? heaviest : null;
}

export type ReviewResult = {
  adjustments: Adjustment[];
  prescriptions: Prescriptions;
};

/**
 * Decide what changes for next week. Returns new prescriptions plus an audit
 * record for every change — nothing moves without a record, because a coach that
 * can't tell you why it did something is just a random number generator.
 */
export function reviewWeek(args: {
  sets: LoggedSet[];
  targetRpe: Record<string, number>;
  prescriptions: Prescriptions;
  planId: number;
  now: number;
}): ReviewResult {
  const { sets, targetRpe, planId, now } = args;
  const prescriptions: Prescriptions = { ...args.prescriptions };
  const adjustments: Adjustment[] = [];

  for (const lift of summariseWeek(sets, targetRpe)) {
    const call = liftCall(lift);
    if (call === null) continue;

    const exercise = EXERCISE_BY_ID.get(lift.exerciseId);
    const name = exercise?.name ?? lift.exerciseId;
    const before = prescriptions[lift.exerciseId] ?? emptyPrescription();

    if (call === 'hard') {
      const after: Prescription = {
        ...before,
        volumeFactor: Math.round(before.volumeFactor * (1 - ADAPT.VOLUME_CUT) * 1000) / 1000,
      };
      prescriptions[lift.exerciseId] = after;
      adjustments.push({
        at: now,
        planId,
        scope: { kind: 'lift', exerciseId: lift.exerciseId },
        rule: 'rpe-drift-high',
        before,
        after,
        narrative: `${name} ran ${fmtDeviation(lift.meanDeviation)} over target all week. I've taken 10% off next week's volume.`,
      });
      continue;
    }

    if (call === 'easy') {
      const step = exercise?.kind === 'accessory' ? ADAPT.STEP_ACCESSORY : ADAPT.STEP_COMPOUND;
      const currentWeight = progressionBase(sets, lift.exerciseId);
      if (currentWeight === null) continue;
      const after: Prescription = { ...before, weightKg: Math.round((currentWeight + step) * 100) / 100 };
      prescriptions[lift.exerciseId] = after;
      adjustments.push({
        at: now,
        planId,
        scope: { kind: 'lift', exerciseId: lift.exerciseId },
        rule: 'rpe-drift-low',
        before,
        after,
        narrative: `${name} keeps landing under target. Adding ${step} kg from next session.`,
      });
    }
  }

  return { adjustments, prescriptions };
}

function fmtDeviation(d: number): string {
  const rounded = Math.round(d * 10) / 10;
  return `${rounded > 0 ? '+' : ''}${rounded} RPE`;
}

// ─────────────────────────────────────────────────────────────
// Missed sessions
// ─────────────────────────────────────────────────────────────

export type RedistributeResult = {
  adjustments: Adjustment[];
  sessions: PlannedSession[];
};

/**
 * Spread a slot's volume across the rest of its week, capped at +25% per
 * session. Anything over the cap is written off rather than carried forward —
 * pushing this week's shortfall into next week just moves the problem.
 *
 * The rule is unchanged from the weekday model; only its trigger moved. It used
 * to fire because a specific weekday had passed. Now it fires while a week is
 * still live and running behind — there is no weekday left to miss.
 */
export function redistributeWithinWeek(args: {
  /** The slot whose volume is being spread. Not "missed" — it may be a drop. */
  source: PlannedSession;
  week: PlannedSession[];
  planId: number;
  now: number;
  /** Why, in the user's language. The caller knows whether this was a shortfall or a drop. */
  narrative: string;
}): RedistributeResult {
  const { source, week, planId, now, narrative } = args;

  // Slots later in the week absorb the work. Earlier ones may already have been
  // trained, and back-dating volume onto something done is meaningless.
  const receivers = week.filter(
    (p) => p.id !== source.id && p.status === 'plan' && p.routineId !== '' && p.slotIndex > source.slotIndex,
  );
  if (receivers.length === 0 || source.volumeFactor <= 0) {
    return { adjustments: [], sessions: [] };
  }

  const share = source.volumeFactor / receivers.length;
  const sessions: PlannedSession[] = [];
  let absorbed = 0;

  for (const r of receivers) {
    const headroom = r.volumeFactor * ADAPT.REDISTRIBUTE_CAP;
    const added = Math.min(share, headroom);
    absorbed += added;
    sessions.push({
      ...r,
      volumeFactor: Math.round((r.volumeFactor + added) * 1000) / 1000,
      adjustedByBompa: true,
    });
  }

  const dropped = source.volumeFactor - absorbed;
  const droppedNote = dropped > 0.01 ? ' The rest is written off — carrying it into next week just moves the problem.' : '';

  const adjustments: Adjustment[] = [
    {
      at: now,
      planId,
      scope: { kind: 'session', plannedSessionId: source.id ?? 0 },
      rule: 'missed-session-redistribute',
      before: {
        sessions: receivers.map((r) => ({
          id: r.id,
          volumeFactor: r.volumeFactor,
          status: r.status,
          adjustedByBompa: r.adjustedByBompa,
        })),
      },
      after: {
        sessions: sessions.map((r) => ({
          id: r.id,
          volumeFactor: r.volumeFactor,
          status: r.status,
          adjustedByBompa: r.adjustedByBompa,
        })),
      },
      narrative: `${narrative}${droppedNote}`,
    },
  ];

  return { adjustments, sessions };
}

// ─────────────────────────────────────────────────────────────
// Undo
// ─────────────────────────────────────────────────────────────

/** Restore the prescription an adjustment changed. Adjustments are reversible
 *  so the user can always take back a change they disagree with, which is why
 *  `before` is stored in full. */
export function revertPrescription(adjustment: Adjustment, prescriptions: Prescriptions): Prescriptions {
  if (adjustment.scope.kind !== 'lift') return prescriptions;
  const before = adjustment.before as Prescription | undefined;
  if (!before) return prescriptions;
  return { ...prescriptions, [adjustment.scope.exerciseId]: before };
}

/** Target RPE per exercise for one routine, used as the yardstick for deviation. */
export function targetRpeFor(routine: Routine | undefined): Record<string, number> {
  if (!routine) return {};
  const out: Record<string, number> = {};
  for (const slot of routine.slots) out[slot.exerciseId] = slot.targetRpe;
  return out;
}

/**
 * Target RPE across every routine the user actually has — a week's logging may
 * span more than one.
 *
 * Takes the routines rather than reading a module-level map, because once
 * routines are user-created there is no module-level map to read. An empty
 * result here is not harmless: `summariseWeek` skips any lift with no target,
 * so an empty map silently stops the adaptation engine producing anything.
 * Callers must treat "empty targets but sets exist" as a fault, not a quiet no-op.
 */
export function allTargetRpe(routines: Routine[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const routine of routines) {
    for (const slot of routine.slots) {
      // Where two routines disagree, the heavier target wins: it is the one that
      // would flag a genuine overshoot rather than a programming difference.
      out[slot.exerciseId] = Math.max(out[slot.exerciseId] ?? 0, slot.targetRpe);
    }
  }
  return out;
}
