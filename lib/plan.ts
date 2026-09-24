// Plan generation: macrocycles, mesocycle shapes, competition tapers, and the
// forward projection that finds the peak window. Pure — no Dexie, no React.

import { DAY_MS, MODEL, addDays, dateKey, daysBetween, fitness, fatigue, fromDateKey, weekdayIndex } from './calc';
import { planWeekStart, spreadWeekDays } from './schedule';
import type { SessionLoad } from './calc';
import type { Block, Phase, Plan, PlannedSession, Routine } from './types';

/** A deload week runs at roughly half the volume of a working week. */
export const DELOAD_VOLUME_FACTOR = 0.38;
const DELOAD_INTENSITY_FACTOR = 0.55;

/**
 * How volume and intensity move across the working weeks of a block.
 * `t` runs 0 → 1 across the block. Accumulation blocks ramp volume up; a peak
 * block does the opposite — volume falls away while intensity climbs, which is
 * what lets fatigue drain while fitness holds.
 */
export function weekShape(phase: Phase, weekIndex: number, totalWeeks: number): { volume: number; intensity: number } {
  if (phase === 'deload') return { volume: DELOAD_VOLUME_FACTOR, intensity: DELOAD_INTENSITY_FACTOR };
  const t = totalWeeks <= 1 ? 1 : weekIndex / (totalWeeks - 1);
  if (phase === 'peak') return { volume: 1 - t * 0.55, intensity: 0.7 + t * 0.3 };
  return { volume: 0.62 + t * 0.38, intensity: 0.68 + t * 0.28 };
}

/** One bar in the mesocycle builder's chart, including the trailing deload. */
export type CurveWeek = { label: string; volume: number; intensity: number; isDeload: boolean };

export function mesocycleCurve(phase: Phase, weeks: number): CurveWeek[] {
  const out: CurveWeek[] = [];
  for (let i = 0; i < weeks; i++) {
    const s = weekShape(phase, i, weeks);
    out.push({ label: `W${i + 1}`, volume: s.volume, intensity: s.intensity, isDeload: false });
  }
  out.push({ label: 'DL', volume: DELOAD_VOLUME_FACTOR, intensity: DELOAD_INTENSITY_FACTOR, isDeload: true });
  return out;
}

// ─────────────────────────────────────────────────────────────
// Building a plan
// ─────────────────────────────────────────────────────────────

export type BlockSpec = { phase: Phase; weeks: number; deloadWeeks: number };

/** The 16-week default a fresh install starts on. */
export const DEFAULT_BLOCKS: BlockSpec[] = [
  { phase: 'hypertrophy', weeks: 5, deloadWeeks: 1 },
  { phase: 'strength', weeks: 5, deloadWeeks: 1 },
  { phase: 'peak', weeks: 4, deloadWeeks: 0 },
];

export type GeneratedPlan = {
  plan: Plan;
  blocks: (Block & { id: number })[];
  sessions: PlannedSession[];
};

/**
 * Turn a list of block specs into a real calendar: one PlannedSession per day,
 * including rest days, so the week view has something to render and adaptation
 * has something to move.
 */
export function generatePlan(args: {
  name: string;
  startDate: string;
  /** The routines to cycle through, in order. A 4-session week over [A, B, C] is A B C A. */
  rotation: string[];
  sessionsPerWeek: number;
  specs?: BlockSpec[];
  planId?: number;
  createdAt?: number;
}): GeneratedPlan {
  const {
    name,
    startDate,
    rotation,
    sessionsPerWeek,
    specs = DEFAULT_BLOCKS,
    planId = 1,
    createdAt = fromDateKey(startDate),
  } = args;

  // The plan records the aligned Monday, not the day the user happened to press
  // the button — otherwise the plan claims one start date and its sessions use
  // another. `createdAt` keeps the real moment.
  const alignedStart = startWeekOn(startDate);
  const plan: Plan = {
    id: planId,
    name,
    startDate: alignedStart,
    createdAt,
    rotation,
    sessionsPerWeek,
  };
  const blocks: (Block & { id: number })[] = [];
  const sessions: PlannedSession[] = [];

  if (rotation.length === 0 || sessionsPerWeek <= 0) {
    // A plan with nothing to schedule is a valid state — it is what setup
    // produces if the user skips building a routine — but it has no sessions.
    return { plan, blocks, sessions };
  }

  let cursor = alignedStart;
  let blockId = 1;
  let rotationCursor = 0;

  for (const spec of specs) {
    const block: Block & { id: number } = {
      id: blockId,
      planId,
      phase: spec.phase,
      weeks: spec.weeks,
      deloadWeeks: spec.deloadWeeks,
      startDate: cursor,
    };
    blocks.push(block);

    const totalWeeks = spec.weeks + spec.deloadWeeks;
    for (let w = 0; w < totalWeeks; w++) {
      const isDeload = w >= spec.weeks;
      const shape = weekShape(isDeload ? 'deload' : spec.phase, w, spec.weeks);
      const weekStart = addDays(cursor, w * 7);

      // A deload drops a session outright rather than only scaling the rest
      // down — the point is fewer stressors, not the same ones made lighter.
      const slots = isDeload ? Math.max(1, sessionsPerWeek - 1) : sessionsPerWeek;

      for (let slotIndex = 0; slotIndex < slots; slotIndex++) {
        // The rotation carries across week and block boundaries, so a 3-routine
        // split over a 4-session week doesn't restart on A every Monday.
        const routineId = rotation[rotationCursor % rotation.length]!;
        rotationCursor += 1;
        sessions.push({
          planId,
          blockId,
          weekStart,
          slotIndex,
          routineId,
          status: 'plan',
          adjustedByBompa: false,
          volumeFactor: shape.volume,
        });
      }
    }

    cursor = addDays(cursor, totalWeeks * 7);
    blockId += 1;
  }

  return { plan, blocks, sessions };
}

/** Plans start on a Monday so week boundaries line up with the adaptation pass. */
export function startWeekOn(date: string): string {
  return addDays(date, -weekdayIndex(date, 'Mon'));
}

/** Total calendar weeks a set of blocks occupies. */
export function planWeeks(specs: BlockSpec[]): number {
  return specs.reduce((a, b) => a + b.weeks + b.deloadWeeks, 0);
}

// ─────────────────────────────────────────────────────────────
// Competition mode
// ─────────────────────────────────────────────────────────────

export type TaperPhase = {
  phase: Phase;
  name: string;
  weeks: number;
  detail: string;
  startDate: string;
  endDate: string;
};

export type TaperPlan = {
  phases: TaperPhase[];
  /** Set when the available runway was too short for a full build. */
  warning: string | null;
};

/**
 * Work backwards from meet day: peak week, then a volume taper, then strength,
 * then whatever runway is left goes to hypertrophy.
 */
export function reverseTaper(today: string, meetDate: string): TaperPlan {
  const totalDays = daysBetween(today, meetDate);
  const totalWeeks = Math.floor(totalDays / 7);

  if (totalWeeks < 1) {
    return { phases: [], warning: 'Meet day is inside a week — there is no runway left to plan against.' };
  }

  // Ideal shape, longest-lead first.
  let peak = 1;
  let taper = 2;
  let strength = 4;
  let warning: string | null = null;

  let remaining = totalWeeks - peak - taper - strength;
  if (remaining < 0) {
    // Not enough room. Give up the blocks furthest from meet day first — the
    // taper and peak week are the parts you cannot compress without cost.
    strength = Math.max(0, strength + remaining);
    remaining = totalWeeks - peak - taper - strength;
    if (remaining < 0) {
      taper = Math.max(1, taper + remaining);
      remaining = totalWeeks - peak - taper - strength;
    }
    if (remaining < 0) {
      peak = Math.max(1, totalWeeks);
      taper = Math.max(0, totalWeeks - peak);
      strength = 0;
      remaining = 0;
    }
    warning = `Only ${totalWeeks} weeks to meet day — this is a compressed build, not a full peak.`;
  }
  const hypertrophy = Math.max(0, remaining);

  const specs: { phase: Phase; name: string; weeks: number; detail: string }[] = [];
  if (hypertrophy > 0) {
    specs.push({ phase: 'hypertrophy', name: 'Hypertrophy', weeks: hypertrophy, detail: `${hypertrophy} wks · volume climbs to 118%` });
  }
  if (strength > 0) {
    specs.push({ phase: 'strength', name: 'Strength', weeks: strength, detail: `${strength} wks · intensity 82% → 91%` });
  }
  if (taper > 0) {
    specs.push({ phase: 'deload', name: 'Volume taper', weeks: taper, detail: `${taper} wks · volume −45%, load held` });
  }
  specs.push({ phase: 'peak', name: 'Peak week', weeks: peak, detail: 'Openers early, full rest before meet day' });

  // Lay them out so the last one ends on meet day.
  const phases: TaperPhase[] = [];
  let cursor = addDays(meetDate, -(specs.reduce((a, s) => a + s.weeks, 0) * 7) + 1);
  for (const s of specs) {
    const endDate = addDays(cursor, s.weeks * 7 - 1);
    phases.push({ phase: s.phase, name: s.name, weeks: s.weeks, detail: s.detail, startDate: cursor, endDate });
    cursor = addDays(endDate, 1);
  }

  return { phases, warning };
}

// ─────────────────────────────────────────────────────────────
// Supercompensation prediction
// ─────────────────────────────────────────────────────────────

export type PeakWindow = { startDate: string; endDate: string; daysAway: number } | null;

/**
 * Estimate what a planned session will cost, from its prescription rather than
 * from anything logged. Slots priced off a percentage of 1RM need an estimate
 * for that lift; without one they contribute nothing, which understates the
 * projection rather than inventing load.
 */
export function plannedSessionLoad(
  routine: Routine,
  volumeFactor: number,
  e1rmByExercise: Record<string, number>,
): number {
  let total = 0;
  for (const slot of routine.slots) {
    const weight = slot.targetWeightKg ?? (slot.targetPct1RM ? (e1rmByExercise[slot.exerciseId] ?? 0) * slot.targetPct1RM : 0);
    if (weight <= 0) continue;
    total += slot.sets * slot.reps * weight * (slot.targetRpe / 10);
  }
  return total * volumeFactor;
}

/**
 * Project fitness and fatigue forward over the planned calendar and find where
 * form is highest. Needs real history behind it — below MIN_PREDICT_DAYS we hide
 * the answer rather than guess.
 */
export function predictPeak(
  loads: SessionLoad[],
  planned: PlannedSession[],
  routineLoad: (p: PlannedSession) => number | null,
  now: number,
  horizonDays = 120,
): PeakWindow {
  const first = loads[0];
  if (!first) return null;
  if ((now - first.at) / DAY_MS < MODEL.MIN_PREDICT_DAYS) return null;

  const thisWeek = planWeekStart(dateKey(now));
  const projected: SessionLoad[] = [...loads];

  // Planned sessions have no dates, so the projection has to put them
  // somewhere. Spread each future week's pending slots evenly across its seven
  // days — the least wrong assumption available, and it keeps the shape of the
  // load rather than dumping a week onto one point.
  const byWeek = new Map<string, PlannedSession[]>();
  for (const p of planned) {
    if (p.status !== 'plan' || !p.routineId) continue;
    if (p.weekStart < thisWeek) continue; // a past week's pending slots are gone, not future load
    const bucket = byWeek.get(p.weekStart);
    if (bucket) bucket.push(p);
    else byWeek.set(p.weekStart, [p]);
  }

  for (const [weekStart, bucket] of byWeek) {
    bucket.sort((a, b) => a.slotIndex - b.slotIndex);
    const days = spreadWeekDays(weekStart, bucket.length);
    bucket.forEach((p, index) => {
      const load = routineLoad(p);
      // null means the routine could not be resolved. Unknown load is not zero
      // load; skipping is the honest choice, and it under-projects rather than
      // asserting something false.
      if (load === null || load <= 0) return;
      const day = days[index] ?? weekStart;
      // Midday, so a session never lands on a day boundary and flickers.
      const at = fromDateKey(day) + 12 * 3600_000;
      if (at <= now) return;
      projected.push({ at, dateKey: day, load });
    });
  }
  projected.sort((a, b) => a.at - b.at);

  let bestForm = -Infinity;
  let bestDay = 0;
  const daily: number[] = [];
  for (let i = 0; i <= horizonDays; i++) {
    const at = now + i * DAY_MS;
    const f = MODEL.K_FITNESS * fitness(projected, at) - MODEL.K_FATIGUE * fatigue(projected, at);
    daily.push(f);
    if (f > bestForm) {
      bestForm = f;
      bestDay = i;
    }
  }

  // Widen to the plateau around the maximum — a peak is a window, not a day.
  const threshold = bestForm - Math.abs(bestForm) * 0.02;
  let lo = bestDay;
  let hi = bestDay;
  while (lo > 0 && (daily[lo - 1] ?? -Infinity) >= threshold) lo--;
  while (hi < horizonDays && (daily[hi + 1] ?? -Infinity) >= threshold) hi++;

  return {
    startDate: dateKey(now + lo * DAY_MS),
    endDate: dateKey(now + hi * DAY_MS),
    daysAway: lo,
  };
}

/**
 * Price a planned session against a routine lookup.
 *
 * Returns `null` — not `0` — when the routine cannot be resolved, because the
 * two mean opposite things. A deleted routine is *unknown* load; treating it as
 * zero makes the week's projection look under budget and the peak land early,
 * and worse, makes the budget check offer to trim work that is not over. Every
 * caller has to decide what unknown means for it.
 */
export function routineLoader(
  lookup: (id: string) => Routine | undefined,
  e1rmByExercise: Record<string, number>,
) {
  return (p: PlannedSession): number | null => {
    const routine = lookup(p.routineId);
    if (!routine) return null;
    return plannedSessionLoad(routine, p.volumeFactor || 1, e1rmByExercise);
  };
}
