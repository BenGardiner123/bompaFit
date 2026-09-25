// Supersets: exercises performed back to back with no rest between them, then a
// rest after the whole group.
//
// Pure — no React, no Dexie. The logger's behaviour hangs off these three
// questions: which lifts are in this group, how many rounds have been completed,
// and what comes next.

import { countsAsWork } from './calc';
import { METHOD_LIMITS, groupNoun, isSet, readGapSec, resolveSlotMethod } from './methods';
import type { LoggedSet, Routine, RoutineSlot } from './types';

/**
 * The longest gap allowed between the lifts of a superset.
 *
 * Past a couple of minutes it is not a superset any more, it is two exercises;
 * clamping here means a corrupt or hand-edited stored value cannot strand
 * someone on a twenty-minute timer with no way to tell where it came from.
 */
export const SUPERSET_REST_MAX_SEC = METHOD_LIMITS.GAP_MAX_SEC;

/** One superset, in the order its lifts are performed. */
export type SupersetGroup = {
  /** The shared letter, e.g. 'A'. */
  letter: string;
  slots: RoutineSlot[];
  /** Rounds the group is programmed for — one round is one set of each lift. */
  targetRounds: number;
  /**
   * Seconds between the lifts of this group. Zero — the usual case — means
   * straight into the next one.
   */
  restSec: number;
};

/**
 * Read a group's gap off a routine, surviving whatever is actually stored.
 *
 * The field is optional, so old routines have none; and because it is plain
 * stored JSON it can hold a negative, a NaN or something absurd. Resolving all
 * of that here means every caller downstream sees a plain number in range.
 */
function restSecFor(routine: Routine, letter: string): number {
  return readGapSec(routine.supersetRest?.[letter]) ?? 0;
}

/**
 * The groups in a routine, keyed by letter.
 *
 * Slots keep their routine order inside a group, because a superset is a
 * sequence: you do A1 then A2, not whichever you feel like.
 */
export function supersetGroups(routine: Routine | null | undefined): Map<string, SupersetGroup> {
  const out = new Map<string, SupersetGroup>();
  if (!routine) return out;

  for (const slot of [...routine.slots].sort((a, b) => a.order - b.order)) {
    if (!slot.supersetGroup) continue;
    const existing = out.get(slot.supersetGroup);
    if (existing) existing.slots.push(slot);
    else
      out.set(slot.supersetGroup, {
        letter: slot.supersetGroup,
        slots: [slot],
        targetRounds: 0,
        restSec: restSecFor(routine, slot.supersetGroup),
      });
  }

  for (const group of out.values()) {
    // Members should agree on set count, but a hand-built routine can disagree.
    // Take the largest so the group is not cut short by its shortest lift. A
    // member with a scheme prescribes as many sets as the scheme has.
    group.targetRounds = Math.max(...group.slots.map((slot) => resolveSlotMethod(slot).setCount));
  }
  return out;
}

/** The group an exercise belongs to, or null when it is trained on its own. */
export function groupFor(
  routine: Routine | null | undefined,
  exerciseId: string | null,
): SupersetGroup | null {
  if (!routine || !exerciseId) return null;
  const slot = routine.slots.find((s) => s.exerciseId === exerciseId);
  if (!slot?.supersetGroup) return null;
  return supersetGroups(routine).get(slot.supersetGroup) ?? null;
}

/**
 * Working sets logged for one exercise in this session. Warm-ups do not count,
 * and neither do the later pieces of a drop or cluster set: without that, the
 * first drop would complete the round and send the lifter to the next lift
 * halfway through their set.
 */
export function workingSetCount(sessionSets: LoggedSet[], exerciseId: string): number {
  return sessionSets.filter((row) => row.exerciseId === exerciseId && countsAsWork(row.type) && isSet(row)).length;
}

/**
 * Rounds completed: the number of times every lift in the group has been done.
 *
 * The minimum across members, not the maximum — you have not finished round two
 * until every lift in the group has had its second set.
 */
export function roundsCompleted(group: SupersetGroup, sessionSets: LoggedSet[]): number {
  if (group.slots.length === 0) return 0;
  return Math.min(...group.slots.map((slot) => workingSetCount(sessionSets, slot.exerciseId)));
}

/**
 * The lift to move to after logging inside a group.
 *
 * Returns null when the round is complete — that is the signal to rest, and the
 * only point in a superset where resting is correct.
 *
 * A member that has done all its planned sets sits the rest of the group's
 * planned rounds out: with bench for 4 and fly for 3, the fourth round is bench
 * alone, and handing on to fly would ask for a set nobody planned. `planned`
 * gives each lift's count as the session has it (adaptation can trim one);
 * without it, the slot's own count is used. Once every member is past its
 * plan, an extra round runs through the whole group again.
 */
export function nextInRound(
  group: SupersetGroup,
  sessionSets: LoggedSet[],
  currentExerciseId: string,
  planned?: Record<string, number>,
): RoutineSlot | null {
  const index = group.slots.findIndex((slot) => slot.exerciseId === currentExerciseId);
  if (index === -1) return null;

  const counts = group.slots.map((slot) => workingSetCount(sessionSets, slot.exerciseId));
  const plans = group.slots.map((slot) => planned?.[slot.exerciseId] ?? resolveSlotMethod(slot).setCount);
  // A member still owes the round in progress if it is behind the furthest-ahead
  // member. When every count is level the round is finished, and that — not a
  // set count — is what says it is time to rest.
  const ahead = Math.max(...counts);
  const plannedRound = ahead <= Math.max(...plans);
  const owes = (i: number) => (counts[i] ?? 0) < ahead && !(plannedRound && (counts[i] ?? 0) >= (plans[i] ?? 0));

  // Look forward from the current lift first: a superset runs in order.
  for (let i = index + 1; i < group.slots.length; i++) {
    if (owes(i)) return group.slots[i] ?? null;
  }
  // Then wrap, in case the user jumped into the middle of the group.
  for (let i = 0; i < index; i++) {
    if (owes(i)) return group.slots[i] ?? null;
  }
  return null;
}

/**
 * What rest follows a set: how long, and which kind.
 *
 * `full` is the ordinary rest between working sets. `transition` is the short
 * deliberate gap some programmes prescribe between the lifts of a superset —
 * zero by default, in which case the kind is `none` and no timer starts at all.
 * `intra` is the pause between the pieces of one cluster or rest-pause set: a
 * few seconds at the bar, shown on the entry card, never the full screen.
 *
 * One function rather than a "should I rest" and a separate "for how long":
 * they would answer the same question and could disagree.
 */
export type RestKind = 'none' | 'transition' | 'intra' | 'full';

export type RestPlan = {
  /** Seconds to run the timer for. Zero means go straight to the next set. */
  sec: number;
  kind: RestKind;
};

export function restAfterSet(args: {
  group: SupersetGroup | null;
  sessionSetsAfterLogging: LoggedSet[];
  exerciseId: string;
  /**
   * The full rest after this set, already resolved — the scheme entry's, the
   * slot's or the lifter's preset (see `fullRestSec` in lib/methods.ts). This
   * module has no other way to know the preset.
   */
  fullRestSec: number;
  /**
   * Set when the row just logged is a piece of a set that carries on — a
   * cluster single with more to come. The pause is all that belongs here; the
   * round and the full rest wait until the set is over.
   */
  midSet?: { intraRestSec: number } | null;
  /** Each lift's planned sets as the session has them. See `nextInRound`. */
  planned?: Record<string, number>;
}): RestPlan {
  const { group, sessionSetsAfterLogging, exerciseId, fullRestSec, midSet, planned } = args;
  if (midSet) {
    const sec = Math.max(0, Math.round(midSet.intraRestSec));
    return sec > 0 ? { sec, kind: 'intra' } : { sec: 0, kind: 'none' };
  }

  const full: RestPlan = { sec: fullRestSec, kind: 'full' };
  if (!group) return full;

  // Still lifts owing the round: the rest that belongs here is the gap after
  // this member — its own if it has one, the group's otherwise — not the full
  // one. The full rest waits for the end of the round.
  if (nextInRound(group, sessionSetsAfterLogging, exerciseId, planned) === null) return full;
  const member = group.slots.find((slot) => slot.exerciseId === exerciseId);
  const gap = (member ? resolveSlotMethod(member).gapAfterSec : null) ?? group.restSec;
  return gap > 0 ? { sec: gap, kind: 'transition' } : { sec: 0, kind: 'none' };
}

/**
 * "Superset A · round 2 of 3" — what the logger puts above the entry card. Three
 * lifts read "Triset", four or more "Giant set": the label is how the lifter
 * knows the shape of what they are doing.
 */
export function groupLabel(group: SupersetGroup, sessionSets: LoggedSet[]): string {
  const round = Math.min(group.targetRounds, roundsCompleted(group, sessionSets) + 1);
  return `${groupNoun(group.slots.length)} ${group.letter} · round ${round} of ${group.targetRounds}`;
}

/**
 * Lay a routine's lifts out for the chip row: singles on their own, superset
 * members kept adjacent and tagged with their letter.
 */
export type ChipEntry = {
  exerciseId: string;
  /** null for a lift trained on its own. */
  letter: string | null;
  /** True for the first member of a group, so the row can draw the bracket. */
  startsGroup: boolean;
  endsGroup: boolean;
};

/**
 * Reorder a routine's slots so superset members sit next to each other.
 *
 * A superset is a sequence performed back to back. If the user tags lifts 1 and
 * 3 with the same letter and leaves lift 2 between them, the group is a fiction —
 * the chip row would draw two separate one-member groups and the logger would
 * bounce past an unrelated lift mid-round. Each group is pulled together at the
 * position of its first member, and everything else keeps its relative order.
 */
export function normaliseSlotOrder(slots: RoutineSlot[]): RoutineSlot[] {
  const ordered = [...slots].sort((a, b) => a.order - b.order);
  const out: RoutineSlot[] = [];
  const placed = new Set<string>();

  for (const slot of ordered) {
    if (placed.has(slot.exerciseId)) continue;
    if (!slot.supersetGroup) {
      out.push(slot);
      placed.add(slot.exerciseId);
      continue;
    }
    // First member of this group: bring the rest of it along now.
    for (const member of ordered) {
      if (member.supersetGroup === slot.supersetGroup && !placed.has(member.exerciseId)) {
        out.push(member);
        placed.add(member.exerciseId);
      }
    }
  }

  return out.map((slot, index) => (slot.order === index ? slot : { ...slot, order: index }));
}

/**
 * Tidy a whole routine: contiguous group members, and no rest values left over
 * for letters nothing uses any more.
 *
 * The pruning is the part that is not obvious. Ungroup the last lift tagged B
 * and `supersetRest.B` would sit there unreferenced; tag a different pair B a
 * month later and they would silently inherit a gap nobody set for them. Values
 * are also clamped on the way through, so what is stored is what will be read.
 */
export function normaliseRoutine(routine: Routine): Routine {
  const slots = normaliseSlotOrder(routine.slots);
  const live = new Set(slots.map((slot) => slot.supersetGroup).filter((letter): letter is string => letter !== null));

  const rest: Record<string, number> = {};
  for (const letter of live) {
    const sec = restSecFor(routine, letter);
    if (sec > 0) rest[letter] = sec;
  }

  return { ...routine, slots, supersetRest: rest };
}

export function chipLayout(exerciseIds: string[], routine: Routine | null | undefined): ChipEntry[] {
  const letterOf = new Map<string, string | null>();
  for (const slot of routine?.slots ?? []) letterOf.set(slot.exerciseId, slot.supersetGroup);

  return exerciseIds.map((exerciseId, i) => {
    const letter = letterOf.get(exerciseId) ?? null;
    const prev = i > 0 ? (letterOf.get(exerciseIds[i - 1]!) ?? null) : null;
    const next = i < exerciseIds.length - 1 ? (letterOf.get(exerciseIds[i + 1]!) ?? null) : null;
    return {
      exerciseId,
      letter,
      startsGroup: letter !== null && letter !== prev,
      endsGroup: letter !== null && letter !== next,
    };
  });
}
