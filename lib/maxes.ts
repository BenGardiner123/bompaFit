// Which lifts the Starting maxes list offers.
//
// Not the whole library: it holds hundreds of compound movements, and a list
// that long buries the few that matter. A starting max is only read by a
// routine written as a percentage of 1RM, so the lifts worth showing are the
// ones in the user's own workouts, plus the four most programmes are built on.

import type { Routine } from './types';

/** Squat, bench, deadlift, press: first in the list, whatever the workouts hold. */
export const BIG_FOUR = ['back-squat', 'barbell-bench-press', 'deadlift', 'overhead-press'] as const;

/**
 * Lift ids to offer, in order, without repeats: the big four, then every lift in
 * the given routines in the order they appear, then any lift that already has a
 * declared max, so a number someone typed never quietly disappears from view.
 *
 * Pass only the user's own routines. Templates are never trained until copied,
 * so their lifts are not the user's yet.
 */
export function startingMaxLifts(routines: Routine[], declared: Record<string, number>): string[] {
  const ids = [
    ...BIG_FOUR,
    ...routines.flatMap((routine) => routine.slots.map((slot) => slot.exerciseId)),
    ...Object.keys(declared).filter((id) => (declared[id] ?? 0) > 0),
  ];
  return [...new Set(ids)];
}
