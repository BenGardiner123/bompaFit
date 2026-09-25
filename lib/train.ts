// How far through its plan a session is, and which of its sets still need an
// RPE. Pure: session rows and a plan in, answers out.
//
// The plan arrives as a list of lifts with the sets each is programmed for,
// already resolved by the caller (adaptation can trim a set count, and that
// lives in lib/adapt.ts). Keeping the resolution out of here is what lets these
// rules be tested with plain rows.

import { countsAsWork, isSet } from './calc';
import { workingSetCount } from './supersets';
import type { LoggedSet } from './types';

/** One lift of the session's plan, in session order. */
export type LiftPlan = { exerciseId: string; planned: number };

/**
 * Sets of work whose RPE the lifter never gave, so the target was logged as a
 * stand-in. Warm-ups are left out: their effort is inferred from the weight
 * and nothing reads an RPE on one. A set made of pieces is counted once, by
 * its first row: it is rated as one set.
 */
export function unratedSets(sessionSets: LoggedSet[], exerciseId?: string): LoggedSet[] {
  return sessionSets.filter(
    (row) =>
      countsAsWork(row.type) &&
      isSet(row) &&
      row.rpeEstimated &&
      (exerciseId === undefined || row.exerciseId === exerciseId),
  );
}

/** Planned lifts without a single set of work yet: what "Finish" would leave behind. */
export function untrainedLifts(plan: LiftPlan[], sessionSets: LoggedSet[]): LiftPlan[] {
  return plan.filter((lift) => lift.planned > 0 && workingSetCount(sessionSets, lift.exerciseId) === 0);
}

/**
 * Every planned set of every lift is logged. An empty plan is never done: a
 * session with nothing planned has no point at which the plan ran out.
 */
export function planDone(plan: LiftPlan[], sessionSets: LoggedSet[]): boolean {
  const owed = plan.filter((lift) => lift.planned > 0);
  return owed.length > 0 && owed.every((lift) => workingSetCount(sessionSets, lift.exerciseId) >= lift.planned);
}

/**
 * The sets of the round a superset just finished: each member's latest set of
 * work. A member with nothing logged is left out rather than guessed at.
 */
export function roundSets(memberIds: string[], sessionSets: LoggedSet[]): LoggedSet[] {
  return memberIds.flatMap((exerciseId) => {
    const latest = sessionSets
      .filter((row) => row.exerciseId === exerciseId && countsAsWork(row.type) && isSet(row))
      .reduce<LoggedSet | null>((last, row) => (last === null || row.at > last.at ? row : last), null);
    return latest ? [latest] : [];
  });
}

/**
 * The lift the rest screen names as next: this one while it has planned sets
 * left, otherwise the next lift in session order still owed some, wrapping
 * round. Null once the plan is done. A lift outside the plan has no count to
 * run out of, so it stays itself.
 */
export function nextLift(plan: LiftPlan[], sessionSets: LoggedSet[], currentId: string): string | null {
  const owes = (lift: LiftPlan) => workingSetCount(sessionSets, lift.exerciseId) < lift.planned;
  const at = plan.findIndex((lift) => lift.exerciseId === currentId);
  if (at === -1) return currentId;
  for (let step = 0; step < plan.length; step++) {
    const lift = plan[(at + step) % plan.length]!;
    if (owes(lift)) return lift.exerciseId;
  }
  return null;
}

/**
 * Move the lift at `index` one place up (-1) or down (+1) in the session.
 *
 * A superset moves as one block and a lift steps over a whole block, never
 * into the middle of one: a group split by another lift would have the logger
 * bounce past it mid-round. `letterOf` gives a lift's superset letter, or null
 * for a lift trained on its own. Past either end nothing moves.
 */
export function moveLift(
  ids: string[],
  index: number,
  dir: -1 | 1,
  letterOf: (exerciseId: string) => string | null,
): string[] {
  // Runs of consecutive ids that move together.
  const blocks: string[][] = [];
  for (const id of ids) {
    const last = blocks[blocks.length - 1];
    const letter = letterOf(id);
    if (last && letter !== null && letterOf(last[0]!) === letter) last.push(id);
    else blocks.push([id]);
  }
  const from = blocks.findIndex((block) => block.includes(ids[index]!));
  const to = from + dir;
  if (from === -1 || to < 0 || to >= blocks.length) return ids;
  [blocks[from], blocks[to]] = [blocks[to]!, blocks[from]!];
  return blocks.flat();
}
