// How a weight reads when the lifter's own body is the load.
//
// A stored weight of zero already means "bodyweight" everywhere the numbers
// are used; this is only about saying so, instead of printing "0 kg" for a
// set of pull-ups. Every figure here is in the display unit — converting is
// done before these are called, never inside them.

import type { Unit } from './types';

/** The equipment value the exercise library gives to lifts done with no load. */
const BODYWEIGHT_EQUIPMENT = 'Bodyweight';

/** True for a lift whose natural load is the lifter, e.g. a pull-up or a dip. */
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
