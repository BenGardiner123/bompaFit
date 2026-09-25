// The one-line read on a session that just finished.
//
// It says how the session sat against the effort it was programmed for, in the
// same terms the weekly review uses, so the two never disagree about what
// "ran hard" means. It never changes the plan: one session is noise, and only
// the weekly review acts. That is why the sentences say what *would* happen if
// the week carries on the same way, rather than what is happening now.
//
// Pure, like the rest of lib/: plain rows in, a sentence out.

import { ADAPT, liftCall, progressionBase, summariseWeek } from './adapt';
import { countsAsWork, isSet, scores, type SessionLoad } from './calc';
import type { LoggedSet } from './types';

export const VERDICT_EMPTY = "Nothing logged, and that's fine — it still counts as a session.";
export const VERDICT_ON_TARGET = 'On target across the board. Nothing to change.';
export const VERDICT_UNRATED = "Nothing was rated, so I can't tell how hard that was yet. Rate your sets and I'll read them.";

/**
 * One sentence on how a session went against its target RPE.
 *
 * - `sets`: everything logged in the session. Warm-ups are dropped here, because
 *   they run light on purpose and would drag every lift towards "easy".
 * - `targetRpe`: the programmed RPE per lift. A lift with no target — one added
 *   mid-session — has nothing to be measured against and is left out.
 * - `nameOf`: how to show a lift's name. Passed in so this stays free of the
 *   exercise library and works for movements the user made up.
 * - `untrained`: planned lifts with no work logged, in session order.
 *
 * A lift that ran hard or easy leads, because that is what the week will act
 * on. Past that, "on target" is only said of sets the lifter rated: an
 * unrated set carries the aim written in on their behalf, which sits on
 * target by construction and proves nothing. And a planned lift that was
 * never started is said out loud, not folded into "across the board".
 */
export function sessionVerdict(
  sets: LoggedSet[],
  targetRpe: Record<string, number>,
  nameOf: (exerciseId: string) => string,
  untrained: string[] = [],
): string {
  if (!sets.some((row) => countsAsWork(row.type))) return VERDICT_EMPTY;

  // The weekly review's own call, not a copy of its thresholds: the summary
  // may only promise what the review would actually do.
  const lifts = summariseWeek(sets, targetRpe);

  // Sorted hardest first, so the first hard one is the worst one.
  const hard = lifts.find((lift) => liftCall(lift) === 'hard');
  if (hard) {
    return `${nameOf(hard.exerciseId)} ran ${signed(hard.meanDeviation)} RPE over target. If the week stays like this, I'll trim its volume.`;
  }

  // And the easiest one is therefore the last.
  // Only one the review can actually add weight to: a bodyweight lift that ran
  // easy gets no step, so it gets no promise of one.
  const easy = [...lifts]
    .reverse()
    .find((lift) => liftCall(lift) === 'easy' && progressionBase(sets, lift.exerciseId) !== null);
  if (easy) {
    return `${nameOf(easy.exerciseId)} came in under target. Keep that up this week and I'll add weight.`;
  }

  // Over the line on average, but carried by a few sets rather than most of
  // them. Not enough for the review to act, and not "on target" either.
  const spiky = lifts.find((lift) => lift.workingSets >= ADAPT.MIN_SETS && lift.meanDeviation >= ADAPT.HARD_DEVIATION);
  if (spiky) {
    return `${nameOf(spiky.exerciseId)} had a few sets well over target, but not enough to change the plan.`;
  }

  // Sets, not pieces: a drop piece is estimated at failure by design and is
  // never asked about, so it says nothing about whether the set was rated.
  const work = sets.filter((row) => countsAsWork(row.type) && isSet(row));
  const rated = work.filter((row) => !row.rpeEstimated).length;
  const allRated = rated === work.length;

  if (untrained.length > 0) {
    const skipped = `You didn't get to ${listOr(untrained.map(nameOf))}`;
    if (rated === 0) return `${skipped}, and with nothing rated I can't judge the rest yet.`;
    if (allRated) return `${skipped}. The rest was on target, so I'll plan the week around what you did.`;
    return `${skipped}. What you rated was on target; rate the rest and I'll read those too.`;
  }
  if (rated === 0) return VERDICT_UNRATED;
  if (!allRated) return "What you rated was on target. Rate the rest and I'll read those too.";
  return VERDICT_ON_TARGET;
}

/** "A", "A or B", "A, B or C". */
function listOr(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}`;
}

/**
 * How much a session moved the fatigue score shown on Today.
 *
 * Measured just before the first set and again when the session finished, so
 * the answer is what this session added and nothing else. A session's load is
 * stamped at its last set, which puts it after `before` and at or before
 * `after` — the model already leaves it out of the first reading and counts it
 * in the second.
 */
export function fatigueDelta(loads: SessionLoad[], before: number, after: number): number {
  return scores(loads, after).fatigueScore - scores(loads, before).fatigueScore;
}

/** "+1.2", one decimal, with the sign a reader expects on a change. */
function signed(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return `${rounded > 0 ? '+' : ''}${rounded}`;
}
