// Pure helpers behind the Today screen: what the readiness number is called,
// the sentence under it, and the geometry of the fitness/fatigue curve.
// Kept out of the component so the thresholds and the chart maths can be
// tested with plain numbers.

import { MODEL, daysBetween, scores, type SessionLoad } from './calc';
import { C, onInk } from './tokens';
import type { Session } from './types';

const DAY_MS = 86_400_000;

export type ReadinessBand = 'primed' | 'steady' | 'buried';

/** Where each band starts. The scale under the numeral is drawn from these, so the two cannot disagree. */
export const READY_AT = { primed: 75, steady: 45 } as const;

export function readinessBand(readiness: number): ReadinessBand {
  if (readiness >= READY_AT.primed) return 'primed';
  if (readiness >= READY_AT.steady) return 'steady';
  return 'buried';
}

/**
 * The word beside the numeral. No arrow: the scale track under the number
 * already shows where it sits, and the word carries the band's colour.
 */
export const READY_LABEL: Record<ReadinessBand, string> = {
  primed: 'Primed',
  steady: 'Steady',
  buried: 'Buried',
};

/**
 * The three stretches of the 0–100 scale under the numeral, lowest first, each
 * sized by how much of the scale its band covers.
 */
export function readinessScale(): { band: ReadinessBand; share: number }[] {
  return [
    { band: 'buried', share: READY_AT.steady },
    { band: 'steady', share: READY_AT.primed - READY_AT.steady },
    { band: 'primed', share: 100 - READY_AT.primed },
  ];
}

/** Where the marker sits on the scale, as a percentage, clamped so it never leaves the track. */
export function readinessMarker(readiness: number): number {
  return Math.max(0, Math.min(100, readiness));
}

export type LoadWord = 'ok' | 'high' | 'too high';

/**
 * A word for this week's load against what you have a base for. Above the
 * danger line it is too high; above the top of the usual range, high. Below
 * the usual range still reads ok here: an easy week is not a warning on Today,
 * and the insight list says so when it lasts.
 */
export function loadWord(ratio: number | null): LoadWord | null {
  if (ratio === null) return null;
  if (ratio > MODEL.ACWR_DANGER) return 'too high';
  if (ratio > MODEL.ACWR_HIGH) return 'high';
  return 'ok';
}

/**
 * Whole days from today to the meet, or null with no meet set. A meet already
 * past reads as zero rather than a negative count.
 */
export function daysToMeet(todayKey: string, meetDate: string | undefined): number | null {
  if (!meetDate) return null;
  return Math.max(0, daysBetween(todayKey, meetDate));
}

/** The same in lower case, for the middle of the sentence a screen reader hears. */
export const READY_WORD: Record<ReadinessBand, string> = {
  primed: 'primed',
  steady: 'steady',
  buried: 'buried',
};

export function readySentence(readiness: number, fatigue: number): string {
  const band = readinessBand(readiness);
  if (band === 'primed') return 'Fitness is climbing faster than fatigue. Good day to push the top set.';
  if (band === 'steady') return 'Fitness and fatigue are roughly in step. Train as programmed.';
  if (fatigue >= 80) return 'Fatigue is well ahead of fitness. Back the volume off or take the day.';
  return 'You are carrying more fatigue than fitness right now. Keep it honest today.';
}

/**
 * How much history the readiness number stands on. A session logged earlier
 * today can count as less than a whole day, or even a negative one when it was
 * stamped at midday and it is still morning, so anything under one day is said
 * in words rather than as "0 days" or "-1 days".
 */
export function historyPhrase(days: number): string {
  if (days < 1) return 'under a day of history';
  if (days === 1) return '1 day of history';
  return `${days} days of history`;
}

/**
 * Readiness now against readiness just before the last finished session
 * began, or null when there is nothing honest to compare against.
 *
 * The reference is the session's `startedAt`, not the `at` on its load: loads
 * are stamped at the last set, so reading the model there would already count
 * part of the session's own fatigue. "Before you last trained" means before the
 * first set, and only the session row knows when that was. An open session is
 * not a last session yet, so only finished ones count.
 *
 * Loads are cut off strictly before that moment rather than left to the model's
 * own `at` filter, so a session whose load fell back to its start time can
 * never leak into the number it is being compared with.
 *
 * `readinessNow` is passed in rather than recomputed so the delta always agrees
 * with the numeral printed beside it.
 */
export function readinessTrend(
  loads: SessionLoad[],
  sessions: Pick<Session, 'startedAt' | 'finishedAt'>[],
  readinessNow: number,
): number | null {
  let reference: number | null = null;
  for (const session of sessions) {
    if (session.finishedAt === undefined) continue;
    if (reference === null || session.startedAt > reference) reference = session.startedAt;
  }
  if (reference === null) return null;

  const cutoff = reference;
  const before = loads.filter((l) => l.at < cutoff);
  // With nothing logged before it, the model reads a flat 50 out of thin air.
  // A delta against that would be a number about nothing, so say nothing.
  if (before.length === 0) return null;

  return readinessNow - scores(before, reference).readiness;
}

/** The trend line as shown, arrow and all. */
export function trendPhrase(delta: number): string {
  if (delta === 0) return 'level with last session';
  return `${delta > 0 ? '↑' : '↓'} ${Math.abs(delta)} since last session`;
}

/** The same as a sentence for a screen reader, because "down arrow 6" is not how anyone talks. */
export function trendWords(delta: number): string {
  if (delta === 0) return 'Level with last session.';
  return `${delta > 0 ? 'Up' : 'Down'} ${Math.abs(delta)} since last session.`;
}

/**
 * Fresher is good news, so it is green. Lower is plain white-ish body text,
 * never red: a dip after training is training working, and a red number the
 * morning after every session would teach people to fear the thing they came for.
 */
export function trendColour(delta: number): string {
  return delta > 0 ? C.greenLight : onInk.body;
}

export type CurvePoint = { at: number; fitness: number; fatigue: number };

export type CurveGeometry = {
  /** SVG polyline `points` for each line, in a `width` × `height` box. */
  fitness: string;
  fatigue: string;
  /** Where the predicted peak sits across the box, or null when there is no peak to show. */
  peakX: number | null;
};

/**
 * Lay the fitness and fatigue history out across a box, leaving room on the
 * right for the predicted peak when there is one.
 *
 * The peak is always in the future and the history always ends today, so a
 * peak line drawn inside a history-only chart would be a lie about its date.
 * Instead the time axis stretches forward to the peak and the two lines stop
 * at today: the gap between where they end and the amber line is the wait.
 */
export function curveGeometry(
  points: CurvePoint[],
  peakDaysAway: number | null,
  width: number,
  height: number,
): CurveGeometry {
  const first = points[0];
  const last = points[points.length - 1];
  if (points.length < 2 || !first || !last) return { fitness: '', fatigue: '', peakX: null };

  const start = first.at;
  const today = last.at;
  const peakAt = peakDaysAway === null ? null : today + Math.max(0, peakDaysAway) * DAY_MS;
  const end = Math.max(today, peakAt ?? today);
  const span = end - start;

  // The small inset keeps a line resting at zero from being clipped by the box edge.
  const inset = 2;
  const maxValue = Math.max(...points.map((p) => Math.max(p.fitness, p.fatigue)), 1);
  const x = (at: number) => round(((at - start) / span) * width);
  const y = (v: number) => round(height - inset - (v / maxValue) * (height - inset * 2));
  const line = (pick: (p: CurvePoint) => number) => points.map((p) => `${x(p.at)},${y(pick(p))}`).join(' ');

  return {
    fitness: line((p) => p.fitness),
    fatigue: line((p) => p.fatigue),
    peakX: peakAt === null ? null : x(peakAt),
  };
}

function round(n: number): number {
  return Math.round(n * 10) / 10;
}
