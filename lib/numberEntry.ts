// Turning what someone typed into a number the app can store.
//
// Kept apart from the component so the rules — which inputs count, where they
// are clamped, how they are rounded — can be tested without a browser.

import type { Unit } from './types';

/** Where a typed value is allowed to land, and how finely. */
export type EntryRules = {
  min: number;
  max: number;
  /** Rounded to a multiple of this. Omit to keep what was typed. */
  precision?: number;
};

// Digits with at most one decimal point, which may lead or trail: "82.5",
// ".5" and "82." are all things a thumb produces. A minus sign never matches,
// because nothing typed here can sensibly be negative.
const DECIMAL = /^(\d+\.?\d*|\.\d+)$/;

/**
 * The number in `text`, rounded and clamped to `rules`, or null when there
 * isn't one. Null means "leave the value alone": an empty box or a stray letter
 * must never be written as zero or NaN.
 *
 * A comma is read as a decimal point, because a European keypad offers only
 * that, and spaces are dropped wherever they are.
 */
export function parseEntry(text: string, rules: EntryRules): number | null {
  const cleaned = text.replace(/\s+/g, '').replace(',', '.');
  if (!DECIMAL.test(cleaned)) return null;
  const value = Number(cleaned);
  if (!Number.isFinite(value)) return null;

  const { min, max, precision } = rules;
  // Rounded before clamping, so a bound that is itself off the grid (a 2.5
  // minimum with whole-number rounding, say) is still honoured exactly.
  const rounded = precision ? roundTo(value, precision) : value;
  return Math.min(max, Math.max(min, rounded));
}

/**
 * Nearest multiple of `step`, tidied so 0.1 + 0.2 style float noise never
 * reaches the screen as 82.50000000001.
 */
export function roundTo(value: number, step: number): number {
  return Math.round(Math.round(value / step) * step * 1000) / 1000;
}

/**
 * How finely a typed weight is kept. A quarter kilo is the smallest plate most
 * gyms own; half a pound is where the stored kilograms already round to on the
 * way back to the screen, so a finer pound figure would not survive a reload.
 */
export function weightPrecision(unit: Unit): number {
  return unit === 'kg' ? 0.25 : 0.5;
}

/**
 * The heaviest weight a box will accept, in the display unit. Well past any
 * lift a person has made; it exists so a slipped extra digit can't write a
 * ten-tonne set into the history that every average is taken from.
 */
export function weightMax(unit: Unit): number {
  return unit === 'kg' ? 1000 : 2200;
}

/** More reps than this in one set is a typo, not a set. */
export const REPS_MAX = 100;

/** More sets than this for one lift in one workout is a typo, not a plan. */
export const SETS_MAX = 20;
