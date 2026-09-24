// How a weight reads when the lifter's own body is the load.
//
// A stored weight of zero already means "bodyweight" everywhere the numbers
// are used; this is only about saying so, instead of printing "0 kg" for a
// set of pull-ups. Every figure here is in the display unit — converting is
// done before these are called, never inside them.

import { MODEL, type EffectiveWeight } from './calc';
import type { Exercise, Unit } from './types';

/** The equipment value the exercise library gives to lifts done with no load. */
const BODYWEIGHT_EQUIPMENT = 'Bodyweight';

/**
 * True for a lift the library knows is done with no load, e.g. a pull-up. The
 * lifter can mark others by hand; the app's own answer, which includes those,
 * comes from the state's `isBodyweightLift(exerciseId)`.
 */
export function isBodyweightLift(exercise: { equipment: string } | undefined): boolean {
  return exercise?.equipment === BODYWEIGHT_EQUIPMENT;
}

const UNIT_WORD: Record<Unit, string> = { kg: 'kilograms', lb: 'pounds' };

/**
 * A weight as the big figure on screen says it: "Bodyweight" at zero,
 * "BW + 10 kg" for added weight on a bodyweight lift, "80 kg" otherwise.
 *
 * `bodyweight` says the lift is done with the body as the base load — known
 * from the library, or picked by the lifter. Zero is bodyweight regardless.
 */
export function weightText(weight: number, unit: Unit, bodyweight = false): string {
  if (weight === 0) return 'Bodyweight';
  if (bodyweight) return `BW + ${weight} ${unit}`;
  return `${weight} ${unit}`;
}

/**
 * The same, for a crowded line such as a logged set or a summary: "BW",
 * "+10 kg", "80 kg". The plus sign is only trustworthy when the lift is known
 * to be a bodyweight one, which is why that is the caller's to say.
 */
export function weightShort(weight: number, unit: Unit, bodyweight = false): string {
  if (weight === 0) return 'BW';
  if (bodyweight) return `+${weight} ${unit}`;
  return `${weight} ${unit}`;
}

/** What a screen reader says: "Bodyweight plus 10 kilograms", never "0 kg". */
export function weightSpoken(weight: number, unit: Unit, bodyweight = false): string {
  if (weight === 0) return 'Bodyweight';
  if (bodyweight) return `Bodyweight plus ${weight} ${UNIT_WORD[unit]}`;
  return `${weight} ${UNIT_WORD[unit]}`;
}

// ─────────────────────────────────────────────────────────────
// Counting the body in the fatigue model
// ─────────────────────────────────────────────────────────────

/** Name first: the library files dips under elbow extension and some push-ups under general. */
const BY_NAME: [RegExp, number][] = [
  // Before the full-body rule, which would otherwise catch the word "dip".
  // The feet stay on the floor and carry part of the body, as in a push-up.
  [/\bbench dips?\b/, MODEL.BW_SHARE_PUSH_UP],
  [/\b(pull[- ]?ups?|chin[- ]?ups?|muscle[- ]?ups?|dips?|handstand)\b/, MODEL.BW_SHARE_FULL],
  [/\b(push[- ]?ups?|press[- ]?ups?)\b/, MODEL.BW_SHARE_PUSH_UP],
  [/\b(squats?|lunges?|step[- ]?ups?)\b/, MODEL.BW_SHARE_SQUAT],
  [/\b(hyperextensions?|back extensions?|glute[- ]ham)\b/, MODEL.BW_SHARE_HINGE],
];

/**
 * By pattern, when the name said nothing. Only a main pattern: the library
 * tags isolation work as accessory — glute bridges under squat, leg lifts too —
 * and those move a limb or the hips, not the body the pattern suggests.
 */
const BY_PATTERN: Record<string, number> = {
  'Vertical pull': MODEL.BW_SHARE_FULL,
  'Vertical push': MODEL.BW_SHARE_FULL,
  'Horizontal push': MODEL.BW_SHARE_PUSH_UP,
  Squat: MODEL.BW_SHARE_SQUAT,
  Hinge: MODEL.BW_SHARE_HINGE,
};

/**
 * The fraction of the lifter's bodyweight a movement moves, from its name and
 * pattern. Estimates — see the shares in MODEL. Anything unrecognised gets
 * the low default rather than a guess at the whole body.
 */
export function bodyweightShare(exercise: Pick<Exercise, 'name' | 'pattern'> | undefined): number {
  if (!exercise) return MODEL.BW_SHARE_OTHER;
  const name = exercise.name.toLowerCase();
  for (const [pattern, share] of BY_NAME) if (pattern.test(name)) return share;
  const [main = '', qualifier] = exercise.pattern.split(' · ');
  if (qualifier === undefined) return BY_PATTERN[main] ?? MODEL.BW_SHARE_OTHER;
  return MODEL.BW_SHARE_OTHER;
}

/**
 * How the fatigue model weighs each set, given the lifter's bodyweight: the
 * movement's share of it plus the weight logged, for a bodyweight lift.
 *
 * A lift counts as bodyweight when it is one — from the library or marked by
 * the lifter — or when it was logged at zero, which means bodyweight
 * everywhere in the app. Undefined with no bodyweight entered, and every
 * caller then counts sets exactly as logged, as it did before this existed.
 */
export function effectiveWeight(args: {
  bodyweightKg: number | null;
  isBodyweight: (exerciseId: string) => boolean;
  share: (exerciseId: string) => number;
}): EffectiveWeight | undefined {
  const { bodyweightKg, isBodyweight, share } = args;
  if (bodyweightKg === null || !(bodyweightKg > 0)) return undefined;
  // Only lifts known to be bodyweight — marked by the lifter, or listed as
  // bodyweight equipment — count the body. A 0 on a barbell lift is more likely
  // a slip than a bodyweight set, and silently pricing it at a share of the
  // lifter's weight would raise fatigue for a reason nobody could see.
  return (exerciseId, weightKg) => (isBodyweight(exerciseId) ? bodyweightKg * share(exerciseId) + weightKg : weightKg);
}

/** Heaviest bodyweight worth believing, in kilograms. Beyond it, a typing slip. */
export const BODYWEIGHT_MAX_KG = 400;

/** A stored bodyweight, or null for none. Anything unusable reads as not entered. */
export function readBodyweightKg(raw: unknown): number | null {
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0 || raw > BODYWEIGHT_MAX_KG) return null;
  return raw;
}

/** The stored list of lifts the lifter marked as bodyweight, with anything that is not an id dropped. */
export function readBodyweightLifts(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.filter((id): id is string => typeof id === 'string' && id.length > 0))];
}
