// Pure maths. No React, no Dexie, no DOM — that is what makes the fatigue model
// testable with plain fixtures and no mocks. Nothing in here reads the clock;
// callers pass `now` in, so tests are deterministic.

import type { LoggedSet, RepStyle, Session, SetType, Unit } from './types';

// ─────────────────────────────────────────────────────────────
// Model configuration
// ─────────────────────────────────────────────────────────────

/**
 * Every constant in the impulse-response model lives here rather than scattered
 * as literals. Changing one of these should break fixtures — that
 * is the point of the fixtures.
 */
export const MODEL = {
  /** Days. Fitness decays slowly. */
  TAU_FITNESS: 42,
  /** Days. Fatigue decays roughly six times faster — that asymmetry is the whole
   *  mechanism behind supercompensation and tapering. */
  TAU_FATIGUE: 7,
  K_FITNESS: 1.0,
  K_FATIGUE: 2.0,
  /**
   * false = the chronic window excludes the acute week (days 8–28).
   * The coupled form measures a spike against a baseline the spike itself
   * raised, which damps the signal. Flip to compare.
   */
  ACWR_COUPLED: false,
  /** Days of history below which both scores are marked low-confidence. */
  MIN_CONFIDENT_DAYS: 14,
  /** Days of history the supercompensation prediction needs before it will run. */
  MIN_PREDICT_DAYS: 28,
  /** Window the 0–100 scores are normalised against. */
  NORMALISE_DAYS: 90,
  /**
   * The day every plan week is anchored to. Deliberately not the user's
   * `weekStart` display setting — see `planWeekStart` in lib/schedule.ts for why
   * a storage key must not follow a preference.
   */
  WEEK_ANCHOR: 'Mon' as 'Mon' | 'Sun',
  /** Week projection over its planned budget that raises the extra-load flag. */
  WEEK_OVER_BUDGET: 0.15,
  /** How close a trim has to land to the budget to count as on target. */
  WEEK_TRIM_TOLERANCE: 0.05,
  /** ACWR above this is the injury-risk zone and must raise an insight. */
  ACWR_DANGER: 1.5,
  ACWR_LOW: 0.8,
  ACWR_HIGH: 1.3,
  /**
   * How a warm-up's implied effort scales with how close it got to the day's
   * working weight. 2 means a warm-up at 80% of the working weight reads as
   * roughly 64% of the effort, and one at 50% reads as 25%.
   *
   * A warm-up is normally 8–15 reps from failure, which is entirely off the
   * bottom of the 6–10 RPE scale the logger offers (6 already means "four or
   * more left"), so its effort cannot be recorded and has to be inferred.
   * Proximity is the only signal available without asking for one.
   */
  WARMUP_CURVE: 2,
  /**
   * How much of a warm-up's computed cost counts toward session load.
   *
   * This is a stand-in for something the model cannot currently say. A warm-up
   * costs a little and builds nothing, but `sessionLoad` is a single number
   * feeding both fitness and fatigue, so there is no way to express cost
   * without stimulus. Until those separate, this discount stands in for it.
   *
   * At 0.3 a typical three-set ramp lands near 10% of a session — enough that
   * a heavy peaking ramp is no longer invisible, small enough that it cannot
   * dominate. Chosen, not derived.
   */
  WARMUP_SHARE: 0.3,
  /**
   * How many normal reps one rep of each style is worth to session load.
   *
   * Stand-ins, like WARMUP_SHARE: chosen to be roughly right, not measured.
   * Session load is tonnage × effort, and a set of 21s logged as 21 reps did not
   * move 21 full reps' worth of work, so its reps are scaled before they count.
   *
   * 1½ reps: a full rep plus half of another.
   */
  REP_EQUIV_ONE_AND_HALF: 1.5,
  /** 21s: 7 full + 14 half-range = 14 full-rep equivalents out of 21 logged. */
  REP_EQUIV_TWENTY_ONES: 2 / 3,
  /** A partial covers about half the range. */
  REP_EQUIV_PARTIAL: 0.5,
  /**
   * Lowering only is half the movement, but lowering a load heavier than you
   * can lift costs more recovery than its share of the work suggests.
   */
  REP_EQUIV_ECCENTRIC: 0.6,
  /**
   * An isometric hold is worth its length divided by this, per hold: one rep
   * takes about three seconds under load. A stand-in until there is a better
   * model of what a hold costs.
   */
  HOLD_SEC_PER_REP: 3,
  /**
   * How much of the lifter's bodyweight a bodyweight lift moves, by movement.
   * A set of pull-ups is stored as zero kilograms, or as the plate hung from
   * the belt, and without these it would cost the model nothing, or only the
   * plate.
   *
   * Stand-ins, like WARMUP_SHARE: rounded estimates of the share of body mass
   * each kind of movement lifts, not measurements. They only apply once the
   * lifter has entered a bodyweight; with none, every set counts as logged.
   *
   * Pull-ups, chin-ups, dips, muscle-ups and handstand push-ups hang or press
   * the whole body.
   */
  BW_SHARE_FULL: 1.0,
  /** Push-ups: the feet carry the rest. Roughly two thirds reaches the hands. */
  BW_SHARE_PUSH_UP: 0.65,
  /** Squats, lunges, step-ups: the body less the lower legs, which barely travel. */
  BW_SHARE_SQUAT: 0.7,
  /** Back extensions, hyperextensions, glute-ham raises: trunk, head and arms hinging over a pad. */
  BW_SHARE_HINGE: 0.5,
  /**
   * Everything else: crunches, leg raises, planks, and any movement the name
   * and pattern don't identify. Core work moves a segment — the legs, or the
   * upper trunk — each around a third of the body, not the whole of it.
   *
   * Low on purpose. This also catches lifts nobody recognised, and counting an
   * unknown lift too heavily raises fatigue for a reason the lifter cannot
   * see, while counting it too lightly leaves them where they were before
   * bodyweight counted at all.
   */
  BW_SHARE_OTHER: 0.3,
} as const;

export const DAY_MS = 86_400_000;
const LB_PER_KG = 2.20462;

// ─────────────────────────────────────────────────────────────
// Units
// ─────────────────────────────────────────────────────────────

/** Kilograms to the display unit, rounded to the nearest 0.5 lb. */
export function toDisplay(kg: number, unit: Unit): number {
  if (unit === 'kg') return round(kg, 2);
  return Math.round(kg * LB_PER_KG * 2) / 2;
}

/** Display unit to kilograms, rounded to 0.01kg — 10 grams, finer than any plate. */
export function toKg(value: number, unit: Unit): number {
  if (unit === 'kg') return round(value, 2);
  return round(value / LB_PER_KG, 2);
}

/**
 * Stepper increments are unit-specific, so a lifter working in pounds gets
 * pound-shaped jumps rather than the 5.5lb that converting 2.5kg would produce.
 */
export function increments(unit: Unit): number[] {
  return unit === 'kg' ? [1.25, 2.5, 5] : [2.5, 5, 10];
}

export function defaultIncrement(unit: Unit): number {
  return unit === 'kg' ? 2.5 : 5;
}

function round(n: number, dp: number): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

// ─────────────────────────────────────────────────────────────
// One-rep max
// ─────────────────────────────────────────────────────────────

/** Epley. The canonical estimator everywhere in the app, so no two screens
 *  disagree about the same lifter's max. */
export function epley(weight: number, reps: number): number {
  return weight * (1 + reps / 30);
}

/**
 * Brzycki. Shown in the calculator as a second opinion and feeds nothing —
 * it diverges toward its asymptote as reps approach 37, which is why the
 * calculator clamps reps at 12.
 */
export function brzycki(weight: number, reps: number): number {
  return weight * (36 / (37 - reps));
}

/**
 * Estimated 1RM for a lift: the best Epley estimate from working sets in the
 * trailing 90 days. Warm-ups can be heavy singles and would poison this, and so
 * would anything that was not a full-range rep — see `countsForRecords`.
 *
 * Built on the weight logged, never the effective weight the fatigue model
 * uses. On a bodyweight lift that makes it a record of the added load, which
 * is the number the lifter chooses and progresses; folding in an estimated
 * share of their bodyweight would move every max when the setting changed.
 */
export function e1RM(sets: LoggedSet[], now: number, windowDays = MODEL.NORMALISE_DAYS): number {
  const cutoff = now - windowDays * DAY_MS;
  let best = 0;
  for (const s of sets) {
    if (s.at < cutoff) continue;
    if (!countsForRecords(s)) continue;
    if (s.reps > 12 || s.reps < 1) continue;
    const est = epley(s.weightKg, s.reps);
    if (est > best) best = est;
  }
  return round(best, 1);
}

// ─────────────────────────────────────────────────────────────
// Session load
// ─────────────────────────────────────────────────────────────

/** Warm-ups are not work. `sessionLoad` below still counts them, at a discount. */
export function countsAsWork(type: SetType): boolean {
  return type === 'working' || type === 'backoff';
}

// ─────────────────────────────────────────────────────────────
// What a logged row counts toward
//
// Drops, clusters, rest-pause, rep styles and AMRAP sets all change what counts
// as a set, and every number in the app is built on that definition. These
// questions are answered once, here, so the chip count, the weekly review, the
// progression step, the records and the session load cannot disagree. They
// live beside the model rather than in lib/methods.ts because this file imports
// nothing; lib/methods.ts re-exports them for everything else.
//
// Every stored field is read defensively. A row can be hand-edited or imported,
// and an absent field has to mean what it meant before the field existed.
// ─────────────────────────────────────────────────────────────

const REP_STYLES: readonly RepStyle[] = ['full', 'one-and-half', 'twenty-ones', 'partial', 'eccentric-only', 'isometric'];

/** Shortest and longest hold worth believing, in seconds. */
export const HOLD_SEC_MIN = 1;
export const HOLD_SEC_MAX = 120;

/** The piece number of a row: 0 for a set, 1..n for a later piece of one. */
export function segmentOf(row: Pick<LoggedSet, 'segment'>): number {
  const raw = row.segment;
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 1) return 0;
  return Math.floor(raw);
}

/** A rep style read from storage, with anything unrecognised read as a normal full rep. */
export function readRepStyle(raw: unknown): RepStyle {
  return typeof raw === 'string' && (REP_STYLES as readonly string[]).includes(raw) ? (raw as RepStyle) : 'full';
}

/** A row's rep style. Absent — every row written before rep styles existed — is full. */
export function repStyleOf(row: Pick<LoggedSet, 'repStyle'>): RepStyle {
  return readRepStyle(row.repStyle);
}

/** A stored hold length, clamped; null when none is stored or it is not a number. */
export function readHoldSec(raw: unknown): number | null {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return null;
  return Math.min(HOLD_SEC_MAX, Math.max(HOLD_SEC_MIN, Math.round(raw)));
}

/**
 * The row is a set, not a later piece of one. Three drops off one set are still
 * one set of the four prescribed — and without this, a drop would advance a
 * superset round and send the lifter to the next lift halfway through their set.
 */
export function isSet(row: Pick<LoggedSet, 'segment'>): boolean {
  return segmentOf(row) === 0;
}

/**
 * Can this row stand as evidence of what the lifter can lift? Work, and only
 * full-range reps. A set of 21s is logged as 21 reps but only seven of them were
 * full range, and a lowering-only set at 130% of the max would produce an
 * estimate far above anything ever lifted. Tempo and paused reps are full reps
 * and count; AMRAP sets count; each piece of a drop or cluster is judged on its
 * own weight and reps, and pieces are never added together.
 */
export function countsForRecords(row: Pick<LoggedSet, 'type' | 'repStyle'>): boolean {
  return countsAsWork(row.type) && repStyleOf(row) === 'full';
}

/**
 * Does this row's RPE say anything about whether the prescription was right?
 * A piece is taken to failure by design, and an AMRAP set is "all of it" by
 * definition; counting either against the target would read every drop set as
 * too hard and cut the lift's volume for doing the method as written. The first
 * piece of a drop set is a set, and is rated like any other.
 */
export function countsForDrift(row: Pick<LoggedSet, 'type' | 'segment' | 'amrap'>): boolean {
  return countsAsWork(row.type) && isSet(row) && row.amrap !== true;
}

/**
 * Can this row's weight be the base a progression step is added to? Working
 * sets only (back-offs are lighter on purpose), never a piece, never a
 * lowering-only set — progressing from 130% of the max would be dangerous — and
 * never a hold, whose weight is not comparable with a moving rep. 1½ reps, 21s
 * and partials are kept: that weight is still the one the lifter chose, and a
 * lift trained only that way must still be able to progress.
 */
export function countsForProgression(row: Pick<LoggedSet, 'type' | 'segment' | 'repStyle'>): boolean {
  if (row.type !== 'working' || !isSet(row)) return false;
  const style = repStyleOf(row);
  return style !== 'eccentric-only' && style !== 'isometric';
}

/**
 * How many normal reps one logged rep of this row is worth, for tonnage and
 * session load. 1 for anything without a rep style, which is every row written
 * before rep styles existed.
 */
export function repEquivalent(row: Pick<LoggedSet, 'repStyle' | 'holdSec'>): number {
  switch (repStyleOf(row)) {
    case 'one-and-half':
      return MODEL.REP_EQUIV_ONE_AND_HALF;
    case 'twenty-ones':
      return MODEL.REP_EQUIV_TWENTY_ONES;
    case 'partial':
      return MODEL.REP_EQUIV_PARTIAL;
    case 'eccentric-only':
      return MODEL.REP_EQUIV_ECCENTRIC;
    case 'isometric':
      // A hold with no stored length is read as one rep's worth rather than
      // guessed at.
      return (readHoldSec(row.holdSec) ?? MODEL.HOLD_SEC_PER_REP) / MODEL.HOLD_SEC_PER_REP;
    default:
      return 1;
  }
}

/**
 * Kilograms moved by one row, with its reps scaled to normal-rep equivalents.
 *
 * The weight on the bar, or the plate on the belt: what the lifter loaded.
 * Every tonnage the app shows is built on this, so a set of pull-ups shows no
 * volume, which is true of the plates. The fatigue model counts the body as
 * well — see `EffectiveWeight` — and the two are kept apart on purpose: a
 * displayed volume that quietly included an estimate of the lifter's weight
 * could not be checked against the plates, and would jump every time the
 * bodyweight setting changed.
 */
export function rowTonnage(row: Pick<LoggedSet, 'weightKg' | 'reps' | 'repStyle' | 'holdSec'>): number {
  return loadTonnage(row, row.weightKg);
}

/** The same tonnage at a weight the caller chose, multiplied in the same order. */
function loadTonnage(row: Pick<LoggedSet, 'reps' | 'repStyle' | 'holdSec'>, weightKg: number): number {
  return weightKg * row.reps * repEquivalent(row);
}

/**
 * The weight a row counts at in the fatigue model, in kilograms.
 *
 * For a loaded lift, the weight logged. For a bodyweight lift, the share of
 * the lifter's own weight the movement moves plus whatever was added, so ten
 * pull-ups cost something. Built from settings this file cannot read, and
 * passed in. Absent means every row counts exactly as logged.
 */
export type EffectiveWeight = (exerciseId: string, weightKg: number) => number;

const AS_LOGGED: EffectiveWeight = (_exerciseId, weightKg) => weightKg;

export type SessionLoad = {
  /** Epoch ms of the session, used for decay. */
  at: number;
  /** YYYY-MM-DD, used for rest-day detection. */
  dateKey: string;
  load: number;
};

/**
 * RPE weighting is what separates 5×5 at RPE 6 from 5×5 at RPE 9.5 — identical
 * tonnage, very different cost.
 *
 * **Warm-ups count, at a discount.** They used to contribute exactly zero, on
 * the grounds that counting them at full value would inflate tonnage and
 * deflate effort. Both are true, and neither is an argument for zero — a 60kg
 * triple before a 75kg working set is not nothing, and calling it nothing is
 * its own kind of wrong. Foster's session-RPE, which this formula is modelled
 * on, rates the whole session including its warm-ups.
 *
 * A warm-up's effort is inferred from how close it got to the day's heaviest
 * working set of the same lift, because that is the only signal available: the
 * logger's RPE scale starts at 6, which already means four or more reps in
 * reserve, and a warm-up is further from failure than that. Where the lifter
 * did record an RPE by hand, that is used instead — real data beats a proxy.
 *
 * Comparing against the session's own working weight rather than an estimated
 * 1RM is deliberate. It answers "how close was this to what you actually did
 * today", which is the question, and it self-corrects on a light day.
 */
export function sessionLoad(sets: LoggedSet[], effectiveKg: EffectiveWeight = AS_LOGGED): number {
  const weightOf = (s: LoggedSet) => effectiveKg(s.exerciseId, s.weightKg);

  // The heaviest working set per lift is the reference each warm-up is measured
  // against. Built once rather than per warm-up. Effective weights on both
  // sides, so bodyweight pull-ups before a weighted set are measured body and
  // all, not as nothing against a plate.
  const topWorking = new Map<string, number>();
  for (const s of sets) {
    if (!countsAsWork(s.type)) continue;
    const best = topWorking.get(s.exerciseId) ?? 0;
    const weight = weightOf(s);
    if (weight > best) topWorking.set(s.exerciseId, weight);
  }

  // Every piece of a drop or cluster set is its own row at its own weight, reps
  // and RPE, so a drop set adds more load than a straight set at the same top
  // weight — which is true.
  let total = 0;
  for (const s of sets) {
    const weight = weightOf(s);
    if (countsAsWork(s.type)) {
      total += loadTonnage(s, weight) * (s.rpe / 10);
      continue;
    }

    // A warm-up with nothing to have been warming up for. No reference means no
    // honest claim about how hard it was, so it contributes nothing rather than
    // a guess.
    const reference = topWorking.get(s.exerciseId) ?? 0;
    if (reference <= 0) continue;

    // An RPE the lifter actually chose beats one inferred from the weight.
    // `rpeEstimated` is true when the programmed target was recorded on their
    // behalf, which for a warm-up is the working target and far too high.
    const effort = s.rpeEstimated
      ? Math.min(1, weight / reference) ** MODEL.WARMUP_CURVE
      : s.rpe / 10;

    total += loadTonnage(s, weight) * effort * MODEL.WARMUP_SHARE;
  }
  return total;
}

/** Group logged sets into per-session loads, oldest first. */
export function buildLoads(sessions: Session[], sets: LoggedSet[], effectiveKg?: EffectiveWeight): SessionLoad[] {
  const bySession = new Map<number, LoggedSet[]>();
  for (const s of sets) {
    const arr = bySession.get(s.sessionId);
    if (arr) arr.push(s);
    else bySession.set(s.sessionId, [s]);
  }

  const out: SessionLoad[] = [];
  for (const session of sessions) {
    if (session.id === undefined) continue;
    const owned = bySession.get(session.id);
    if (!owned || owned.length === 0) continue;
    const load = sessionLoad(owned, effectiveKg);
    if (load <= 0) continue;
    // The session's own timestamp is when it started; decay should measure from
    // when the work actually happened, which is the last set.
    out.push({ at: session.lastSetAt || session.startedAt, dateKey: session.date, load });
  }
  return out.sort((a, b) => a.at - b.at);
}

// ─────────────────────────────────────────────────────────────
// Impulse-response model
// ─────────────────────────────────────────────────────────────

/** Exponentially-weighted sum of past load, evaluated at `at`. */
function decayedSum(loads: SessionLoad[], at: number, tauDays: number): number {
  let total = 0;
  for (const l of loads) {
    if (l.at > at) continue;
    const days = (at - l.at) / DAY_MS;
    total += l.load * Math.exp(-days / tauDays);
  }
  return total;
}

export function fitness(loads: SessionLoad[], at: number): number {
  return decayedSum(loads, at, MODEL.TAU_FITNESS);
}

export function fatigue(loads: SessionLoad[], at: number): number {
  return decayedSum(loads, at, MODEL.TAU_FATIGUE);
}

/** What you can express today: fitness minus a doubly-weighted fatigue. */
export function form(loads: SessionLoad[], at: number): number {
  return MODEL.K_FITNESS * fitness(loads, at) - MODEL.K_FATIGUE * fatigue(loads, at);
}

/** Fitness, fatigue and form sampled daily over a window — drives the Plan curve. */
export function series(
  loads: SessionLoad[],
  now: number,
  days: number,
): { at: number; fitness: number; fatigue: number; form: number }[] {
  const out: { at: number; fitness: number; fatigue: number; form: number }[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const at = now - i * DAY_MS;
    const fit = fitness(loads, at);
    const fat = fatigue(loads, at);
    out.push({ at, fitness: fit, fatigue: fat, form: MODEL.K_FITNESS * fit - MODEL.K_FATIGUE * fat });
  }
  return out;
}

// ─────────────────────────────────────────────────────────────
// The two scores
// ─────────────────────────────────────────────────────────────

export type Scores = {
  /** 0–100, higher means more fatigued. */
  fatigueScore: number;
  /** 0–100, higher means fresher. */
  readiness: number;
  /** Raw model values, exposed for charts and tests. */
  fitness: number;
  fatigue: number;
  form: number;
  /** Days of logged history. Zero both with nothing logged and with a first session today. */
  historyDays: number;
  /** How many sessions the scores were built from. Zero means nothing is logged yet. */
  sessions: number;
  /** True when there is too little history to state a number with a straight face. */
  lowConfidence: boolean;
};

export function scores(loads: SessionLoad[], now: number): Scores {
  const first = loads[0];
  // Floored at zero: a session is stamped at its last set, which can be later
  // than the moment the scores are read for, and history cannot be negative.
  const historyDays = first ? Math.max(0, Math.floor((now - first.at) / DAY_MS)) : 0;
  const fit = fitness(loads, now);
  const fat = fatigue(loads, now);
  const frm = MODEL.K_FITNESS * fit - MODEL.K_FATIGUE * fat;

  // Both scores are relative to what this lifter has actually done, not to any
  // absolute scale — a 0–100 that means the same thing for a novice and a
  // national-level lifter doesn't exist.
  let fatMax = 0;
  let formMin = Infinity;
  let formMax = -Infinity;
  for (let i = 0; i < MODEL.NORMALISE_DAYS; i++) {
    const at = now - i * DAY_MS;
    const f = fatigue(loads, at);
    if (f > fatMax) fatMax = f;
    const fo = MODEL.K_FITNESS * fitness(loads, at) - MODEL.K_FATIGUE * f;
    if (fo < formMin) formMin = fo;
    if (fo > formMax) formMax = fo;
  }

  const fatigueScore = fatMax > 0 ? clamp01to100(Math.round((fat / fatMax) * 100)) : 0;

  let readiness = 50;
  if (formMax > formMin) {
    readiness = clamp01to100(Math.round(((frm - formMin) / (formMax - formMin)) * 100));
  }

  return {
    fatigueScore,
    readiness,
    fitness: fit,
    fatigue: fat,
    form: frm,
    historyDays,
    sessions: loads.length,
    lowConfidence: historyDays < MODEL.MIN_CONFIDENT_DAYS,
  };
}

function clamp01to100(n: number): number {
  return Math.max(0, Math.min(100, n));
}

// ─────────────────────────────────────────────────────────────
// Acute:chronic workload ratio
// ─────────────────────────────────────────────────────────────

export type Acwr = { acute: number; chronic: number; ratio: number | null };

export function acwr(loads: SessionLoad[], now: number): Acwr {
  const acute = sumBetween(loads, now - 7 * DAY_MS, now);

  const chronic = MODEL.ACWR_COUPLED
    ? sumBetween(loads, now - 28 * DAY_MS, now) / 4
    : sumBetween(loads, now - 28 * DAY_MS, now - 7 * DAY_MS) / 3;

  // No baseline means no ratio. Rendering Infinity at someone mid-set is worse
  // than rendering nothing.
  return { acute, chronic, ratio: chronic > 0 ? acute / chronic : null };
}

function sumBetween(loads: SessionLoad[], from: number, to: number): number {
  let total = 0;
  for (const l of loads) if (l.at > from && l.at <= to) total += l.load;
  return total;
}

// ─────────────────────────────────────────────────────────────
// Displayed metrics
// ─────────────────────────────────────────────────────────────

/**
 * Tonnage over the trailing 7 days, in kilograms. Working sets only, with reps
 * scaled to normal-rep equivalents so a set of 21s is not read as 21 full reps.
 * What was loaded, not the body under it — see `rowTonnage`.
 */
export function volumeLoad(sets: LoggedSet[], now: number, days = 7): number {
  const cutoff = now - days * DAY_MS;
  let total = 0;
  for (const s of sets) {
    if (s.at < cutoff) continue;
    if (!countsAsWork(s.type)) continue;
    total += rowTonnage(s);
  }
  return total;
}

/**
 * Mean working weight as a fraction of estimated 1RM, over the trailing window.
 * Returns null when there is no e1RM to measure against.
 *
 * Measured over full-range reps only, the same rows the estimate itself comes
 * from, so a lowering-only set above the max cannot push the average past 100%.
 */
export function intensityAvg(sets: LoggedSet[], now: number, days = 7): number | null {
  const cutoff = now - days * DAY_MS;
  const recent = sets.filter((s) => s.at >= cutoff && countsForRecords(s));
  if (recent.length === 0) return null;

  const max = e1RM(sets, now);
  if (max <= 0) return null;

  let tonnage = 0;
  let reps = 0;
  for (const s of recent) {
    tonnage += s.weightKg * s.reps;
    reps += s.reps;
  }
  if (reps === 0) return null;
  return tonnage / reps / max;
}

/**
 * Days since the last calendar day with no working set. Display only — the
 * exponential decay already accounts for rest, and feeding this back into the
 * model would count it twice.
 */
export function daysSinceRest(loads: SessionLoad[], now: number, lookback = 30): number {
  const trained = new Set(loads.map((l) => l.dateKey));
  for (let i = 1; i <= lookback; i++) {
    const key = dateKey(now - i * DAY_MS);
    if (!trained.has(key)) return i - 1;
  }
  return lookback;
}

// ─────────────────────────────────────────────────────────────
// Dates
// ─────────────────────────────────────────────────────────────

/** YYYY-MM-DD in local time. Local, not UTC — a session at 11pm belongs to that day. */
export function dateKey(epochMs: number): string {
  const d = new Date(epochMs);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

/** Local midnight for a date key. Use when you need a real point in time. */
export function fromDateKey(key: string): number {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1).getTime();
}

/**
 * Calendar arithmetic runs on UTC midnights, never on local ones.
 *
 * Adding 86,400,000ms to a local midnight is wrong twice a year: across a
 * daylight-saving boundary the clock shifts an hour, and going backwards from
 * midnight lands at 23:00 the day before. A 16-week plan generated in December
 * would have started a day early. UTC has no DST, so this arithmetic is exact.
 */
function utcFromKey(key: string): number {
  const [y, m, d] = key.split('-').map(Number);
  return Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1);
}

function keyFromUtc(ms: number): string {
  const d = new Date(ms);
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${d.getUTCFullYear()}-${m}-${day}`;
}

export function addDays(key: string, days: number): string {
  return keyFromUtc(utcFromKey(key) + days * DAY_MS);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((utcFromKey(to) - utcFromKey(from)) / DAY_MS);
}

/** Monday-first index: Mon = 0 ... Sun = 6. */
export function weekdayIndex(key: string, weekStart: 'Mon' | 'Sun'): number {
  const jsDay = new Date(utcFromKey(key)).getUTCDay(); // Sun = 0
  return weekStart === 'Mon' ? (jsDay + 6) % 7 : jsDay;
}

export function startOfWeek(key: string, weekStart: 'Mon' | 'Sun'): string {
  return addDays(key, -weekdayIndex(key, weekStart));
}

// ─────────────────────────────────────────────────────────────
// Formatting
// ─────────────────────────────────────────────────────────────

/** m:ss. Used for both clocks. */
export function fmtClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(Math.abs(totalSeconds)));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

/** Tonnage in tonnes to one decimal, e.g. "24.8". */
export function fmtTonnes(kg: number): string {
  return (kg / 1000).toFixed(1);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "12 Aug 2026". */
export function fmtDate(key: string): string {
  const d = new Date(fromDateKey(key));
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

/** "Oct 12". */
export function fmtDayMonth(key: string): string {
  const d = new Date(fromDateKey(key));
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

export const DOW = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
