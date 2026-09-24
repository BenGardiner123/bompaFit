// Plan generation: macrocycles, mesocycle shapes, competition tapers, and the
// forward projection that finds the peak window. Pure — no Dexie, no React.

import { DAY_MS, MODEL, addDays, dateKey, daysBetween, fitness, fatigue, fromDateKey, weekdayIndex } from './calc';
import { planWeekStart, spreadWeekDays, weekSlots } from './schedule';
import type { EffectiveWeight, SessionLoad } from './calc';
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

export type BlockSpec = {
  phase: Phase;
  weeks: number;
  deloadWeeks: number;
  /** The workouts this block cycles through, when it differs from the plan's. */
  rotation?: string[];
};

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

  if (sessionsPerWeek <= 0 || (rotation.length === 0 && !specs.some((spec) => spec.rotation?.length))) {
    // A plan with nothing to schedule is a valid state — it is what setup
    // produces if the user skips building a routine — but it has no sessions.
    return { plan, blocks, sessions };
  }

  let cursor = alignedStart;
  let blockId = 1;
  let rotationCursor = 0;

  for (const spec of specs) {
    // A block with its own workouts starts on the first one the lifter picked,
    // because they chose that order. The plan-wide cursor is left where it was
    // so a later block on the plan's list carries on as it always did.
    const own = spec.rotation && spec.rotation.length > 0 ? spec.rotation : null;
    let ownCursor = 0;
    const block: Block & { id: number } = {
      id: blockId,
      planId,
      phase: spec.phase,
      weeks: spec.weeks,
      deloadWeeks: spec.deloadWeeks,
      startDate: cursor,
      // Only written when the block has its own list: absent means "the plan's",
      // which is how every block stored before this field existed reads.
      ...(own ? { rotation: [...own] } : {}),
    };
    blocks.push(block);
    const totalWeeks = spec.weeks + spec.deloadWeeks;
    // Nothing to cycle through: the block still exists, it just has no slots.
    const fillable = own !== null || rotation.length > 0;

    for (let w = 0; w < (fillable ? totalWeeks : 0); w++) {
      const isDeload = w >= spec.weeks;
      const shape = weekShape(isDeload ? 'deload' : spec.phase, w, spec.weeks);
      const weekStart = addDays(cursor, w * 7);

      // A deload drops a session outright rather than only scaling the rest
      // down — the point is fewer stressors, not the same ones made lighter.
      const slots = isDeload ? Math.max(1, sessionsPerWeek - 1) : sessionsPerWeek;

      for (let slotIndex = 0; slotIndex < slots; slotIndex++) {
        // The rotation carries across week and block boundaries, so a 3-routine
        // split over a 4-session week doesn't restart on A every Monday.
        const routineId = own ? own[ownCursor++ % own.length]! : rotation[rotationCursor++ % rotation.length]!;
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

// ─────────────────────────────────────────────────────────────
// Adding a workout to the plan
// ─────────────────────────────────────────────────────────────

/** One calendar week of a block, with the volume the generator gives it. */
export type BlockWeek = { weekStart: string; isDeload: boolean; volumeFactor: number };

/** Every week a block covers, working weeks first and then its deloads. */
export function blockWeeks(block: Block): BlockWeek[] {
  const total = block.weeks + block.deloadWeeks;
  return Array.from({ length: total }, (_, w) => {
    const isDeload = w >= block.weeks;
    return {
      weekStart: addDays(block.startDate, w * 7),
      isDeload,
      volumeFactor: weekShape(isDeload ? 'deload' : block.phase, w, block.weeks).volume,
    };
  });
}

/**
 * The block a week falls inside, or null when the week is outside the plan.
 *
 * By date rather than by "the block of this week's first slot": a week the user
 * has emptied with drops has no slot to ask, and it still belongs to a block.
 */
export function blockContaining(blocks: Block[], weekStart: string): Block | null {
  for (const block of blocks) {
    if (block.id === undefined) continue;
    if (blockWeeks(block).some((w) => w.weekStart === weekStart)) return block;
  }
  return null;
}

/**
 * A new pending slot at the end of a week.
 *
 * One past the highest index rather than the slot count: on a dense week the
 * two agree, and if a week were ever left with a gap, the count would collide
 * with an existing slot while this cannot. No date — it has not been trained.
 *
 * Marked `userModified` because the user put it there. Only the new slot
 * carries the mark: a week reads as rearranged when any slot says so, and
 * leaving the others alone means a done slot is never rewritten by an add.
 */
function appendedSlot(args: {
  planned: PlannedSession[];
  planId: number;
  blockId: number;
  weekStart: string;
  routineId: string;
  volumeFactor: number;
}): PlannedSession {
  const slots = weekSlots(args.planned, args.weekStart);
  const slotIndex = slots.reduce((max, p) => Math.max(max, p.slotIndex), -1) + 1;
  return {
    planId: args.planId,
    blockId: args.blockId,
    weekStart: args.weekStart,
    slotIndex,
    routineId: args.routineId,
    status: 'plan',
    adjustedByBompa: false,
    userModified: true,
    volumeFactor: args.volumeFactor,
  };
}

/**
 * Add a workout to one week only — "just this week".
 *
 * Planned, not additional: the week's budget rises by what the workout costs,
 * so training it later fills this slot and the over-budget offer has nothing to
 * say about it. Sized to the week's own volume, like the sessions the generator
 * put there, so an added session in a ramp-up or deload week is not heavier
 * than everything around it.
 *
 * Null when there is no plan, or the week sits outside every block — there is
 * no block to file the slot under, and inventing one would put a row in the
 * plan that no block owns.
 */
export function addToWeek(args: {
  planned: PlannedSession[];
  planId: number | undefined;
  blocks: Block[];
  weekStart: string;
  routineId: string;
}): PlannedSession | null {
  const { planned, planId, blocks, weekStart, routineId } = args;
  if (planId === undefined || !routineId) return null;
  const block = blockContaining(blocks, weekStart);
  if (!block?.id) return null;
  // The week's own volume, as its generated sessions have: an added session in
  // a lighter ramp-up or deload week is sized like its neighbours, not heavier.
  const volumeFactor = blockWeeks(block).find((w) => w.weekStart === weekStart)?.volumeFactor ?? 1;
  return appendedSlot({ planned, planId, blockId: block.id, weekStart, routineId, volumeFactor });
}

/**
 * Add a workout to this week and every week left in its block — "every week
 * from now".
 *
 * Planned sessions are generated up front, one row per slot for the whole
 * block, so there is no rotation to change that would reach weeks already
 * written. The workout is appended to each remaining week instead, at the
 * volume the generator gives that week — which is what makes a deload week's
 * copy a deload-sized session rather than a full one.
 *
 * Weeks before `fromWeek` are left alone: a past week's slots are history, and
 * a new pending slot there would be skipped the moment it was written.
 */
export function addToEveryWeek(args: {
  planned: PlannedSession[];
  planId: number | undefined;
  blocks: Block[];
  fromWeek: string;
  routineId: string;
}): PlannedSession[] {
  const { planned, planId, blocks, fromWeek, routineId } = args;
  if (planId === undefined || !routineId) return [];
  const block = blockContaining(blocks, fromWeek);
  if (!block?.id) return [];
  return blockWeeks(block)
    .filter((w) => w.weekStart >= fromWeek)
    .map((w) =>
      appendedSlot({ planned, planId, blockId: block.id!, weekStart: w.weekStart, routineId, volumeFactor: w.volumeFactor }),
    );
}

// ─────────────────────────────────────────────────────────────
// A block's own workouts
// ─────────────────────────────────────────────────────────────

/** The workouts a block cycles through: its own list, or the plan's when it has none. */
export function blockRotation(block: Block, plan: Pick<Plan, 'rotation'> | null): string[] {
  return block.rotation ?? plan?.rotation ?? [];
}

/**
 * Point every pending slot in one block that uses `from` at `to` instead.
 *
 * Returns only the rows that changed. Done and skipped slots are left alone —
 * they are what was trained, or what the week closed on, and history must read
 * as it happened. Slots in other blocks are never touched: the point is that
 * this block trains differently and the rest of the plan does not.
 *
 * Marked `userModified`, as a single swap is: the lifter changed these weeks.
 * Positions are not touched, so every week stays dense.
 */
export function repointInBlock(args: { planned: PlannedSession[]; blockId: number; from: string; to: string }): PlannedSession[] {
  const { planned, blockId, from, to } = args;
  if (from === to) return [];
  return planned
    .filter((p) => p.blockId === blockId && p.status === 'plan' && p.routineId === from)
    .map((p) => ({ ...p, routineId: to, userModified: true }));
}

/**
 * The blocks that use a workout: in a slot still to do, a slot already
 * trained or skipped, or the list the block cycles through. Editing the
 * workout changes what every one of them shows, so this is who to warn.
 */
export function blocksUsing(
  routineId: string,
  blocks: Block[],
  planned: PlannedSession[],
  plan: Pick<Plan, 'rotation'> | null,
): Block[] {
  const inSlots = new Set(planned.filter((p) => p.routineId === routineId).map((p) => p.blockId));
  return blocks.filter((b) => inSlots.has(b.id!) || blockRotation(b, plan).includes(routineId));
}

/** This block's own copy of a workout, if one was made for it. */
export function blockVersion(routines: Routine[], routineId: string, blockId: number): Routine | undefined {
  return routines.find((r) => r.versionOf?.routineId === routineId && r.versionOf.blockId === blockId);
}

/** A rotation with one workout replaced by another, in the same position. */
export function replaceInRotation(rotation: string[], from: string, to: string): string[] {
  return rotation.map((id) => (id === from ? to : id));
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
 *
 * `effectiveKg` is the same weighting the logged sessions are counted with, so
 * a bodyweight slot is priced as the share of the lifter it moves. The week
 * budget compares this against what was logged, and pricing the two sides
 * differently would read a week of pull-ups done exactly as planned as over
 * budget. Absent, every slot is priced at its written weight.
 */
export function plannedSessionLoad(
  routine: Routine,
  volumeFactor: number,
  e1rmByExercise: Record<string, number>,
  effectiveKg: EffectiveWeight = (_exerciseId, weightKg) => weightKg,
): number {
  let total = 0;
  for (const slot of routine.slots) {
    const written = slotWeight(slot, e1rmByExercise);
    if (written === null) continue;
    const weight = effectiveKg(slot.exerciseId, written);
    if (weight <= 0) continue;
    total += slot.sets * slot.reps * weight * (slot.targetRpe / 10);
  }
  return total * volumeFactor;
}

/**
 * A slot's weight as written, or null when it is a percentage of a max nobody
 * has estimated yet. That is unknown rather than bodyweight, so it is never
 * handed on to be priced as a bodyweight lift.
 */
function slotWeight(slot: Routine['slots'][number], e1rmByExercise: Record<string, number>): number | null {
  if (typeof slot.targetWeightKg === 'number') return slot.targetWeightKg;
  const max = e1rmByExercise[slot.exerciseId] ?? 0;
  if (!slot.targetPct1RM || max <= 0) return null;
  return max * slot.targetPct1RM;
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
  effectiveKg?: EffectiveWeight,
) {
  return (p: PlannedSession): number | null => {
    const routine = lookup(p.routineId);
    if (!routine) return null;
    return plannedSessionLoad(routine, p.volumeFactor || 1, e1rmByExercise, effectiveKg);
  };
}
