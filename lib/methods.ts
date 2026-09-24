// Training methods: tempo, rep styles, per-set schemes, and sets made of
// several pieces (drops, clusters, rest-pause).
//
// The one module that reads the method fields a routine slot stores. That is
// plain JSON which can be hand-edited or arrive by import, so everything here
// turns whatever is stored into a known-good value before anything else sees
// it — a negative rest, a NaN load or a tempo of "banana" must never reach the
// logger. Nothing else in the app reads the raw fields.
//
// Pure: no React, no Dexie.

import { readHoldSec, readRepStyle } from './calc';
import type {
  RepStyle,
  RoutineSlot,
  SegmentPlan,
  SegmentStyle,
  SetLoad,
  SetPrescription,
  Tempo,
  TempoPhase,
} from './types';

// The row-level judgements live beside the model maths, which imports nothing.
// Re-exported so there is one place to import "does this row count" from.
export {
  countsForDrift,
  countsForProgression,
  countsForRecords,
  HOLD_SEC_MAX,
  HOLD_SEC_MIN,
  isSet,
  repEquivalent,
  repStyleOf,
  rowTonnage,
  segmentOf,
} from './calc';

// ─────────────────────────────────────────────────────────────
// Limits
// ─────────────────────────────────────────────────────────────

/**
 * Every bound a stored method value is clamped to. Each is wide enough for any
 * real programme and narrow enough that a corrupt value cannot strand someone
 * on a twenty-minute timer or a hundred-set scheme.
 */
export const METHOD_LIMITS = {
  /** Seconds in one tempo phase. A ten-second lowering is real; thirty is plenty. */
  TEMPO_PHASE_MAX: 30,
  /** A full rest after a set. Ten minutes covers the heaviest singles. */
  REST_MAX_SEC: 600,
  /**
   * The gap after one member of a group. Past a couple of minutes it is not a
   * group any more, it is separate exercises.
   */
  GAP_MAX_SEC: 120,
  /** The pause between the pieces of one set. Longer than this and it is two sets. */
  INTRA_REST_MAX_SEC: 120,
  /** How much of the load one drop can take off. */
  DROP_FRACTION_MAX: 0.5,
  /** Pieces after the first in one set. */
  SEGMENTS_MAX: 10,
  /** Sets in a scheme. 10-to-1 is the longest preset. */
  SCHEME_MAX_SETS: 20,
  /** Reps in one set or piece. */
  REPS_MAX: 100,
  /** A rest-pause total-reps target. */
  TOTAL_REPS_MAX: 200,
  /** Lightest relative or percentage load worth prescribing. */
  LOAD_MIN: 0.05,
  /** A percentage of the max can exceed 1 — lowering-only work sits above it. */
  PCT_MAX: 1.5,
  /** A fixed weight, in kilograms. */
  KG_MAX: 1000,
  /** Characters in a slot note. */
  NOTE_MAX: 140,
  /** Characters in a mechanical-drop label. */
  LABEL_MAX: 24,
} as const;

/** The pieces a set can carry on with, in the order the builder offers them. */
export const SEGMENT_STYLES: readonly SegmentStyle[] = ['drop', 'mechanical-drop', 'cluster', 'rest-pause'];

/** The rep styles, in the order the builder offers them. */
export const REP_STYLES: readonly RepStyle[] = [
  'full',
  'one-and-half',
  'twenty-ones',
  'partial',
  'eccentric-only',
  'isometric',
];

/** The drop an unplanned "+ Drop" takes off: 20%, the classic drop-set step. */
export const UNPLANNED_DROP_FRACTION = 0.2;

// ─────────────────────────────────────────────────────────────
// Small clamps
// ─────────────────────────────────────────────────────────────

function finite(raw: unknown): number | null {
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
}

function clampInt(raw: unknown, min: number, max: number): number | null {
  const n = finite(raw);
  if (n === null) return null;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function clampNum(raw: unknown, min: number, max: number): number | null {
  const n = finite(raw);
  if (n === null) return null;
  return Math.min(max, Math.max(min, n));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** A full rest in seconds, or null when nothing usable is stored. */
export function readRestSec(raw: unknown): number | null {
  return clampInt(raw, 0, METHOD_LIMITS.REST_MAX_SEC);
}

/** A group gap in seconds, or null when nothing usable is stored. */
export function readGapSec(raw: unknown): number | null {
  return clampInt(raw, 0, METHOD_LIMITS.GAP_MAX_SEC);
}

export { readHoldSec, readRepStyle };

// ─────────────────────────────────────────────────────────────
// Tempo
// ─────────────────────────────────────────────────────────────

function readPhase(raw: unknown): TempoPhase | null {
  if (raw === 'X' || raw === 'x') return 'X';
  return clampInt(raw, 0, METHOD_LIMITS.TEMPO_PHASE_MAX);
}

/**
 * A stored tempo, clamped. Anything that is not three or four readable phases
 * is no tempo at all rather than a guess: a wrong tempo on the target line is
 * worse than none. Three phases get a zero top pause, as the written form does.
 */
export function readTempo(raw: unknown): Tempo | null {
  if (!Array.isArray(raw) || (raw.length !== 3 && raw.length !== 4)) return null;
  const phases = raw.map(readPhase);
  if (phases.some((p) => p === null)) return null;
  const [a, b, c, d] = phases as TempoPhase[];
  return [a!, b!, c!, d ?? 0];
}

/**
 * Read a tempo the way people write it: `4010`, `30X`, `211`, `3-1-1-0`,
 * `10/0/10`, `3 1 1 0`. The first figure is always the lowering. Returns null
 * for anything else, so a typo is "no tempo" rather than a wrong one.
 *
 * The compact form is one character per phase, so it can only say 0–9; any
 * longer phase has to be written with separators, which is why they exist.
 */
export function parseTempo(text: string): Tempo | null {
  const trimmed = text.trim().toUpperCase();
  if (trimmed === '') return null;

  let parts: string[];
  if (/^[0-9X]{3,4}$/.test(trimmed)) parts = trimmed.split('');
  else if (/^[0-9X]+([\s\-/]+[0-9X]+){2,3}$/.test(trimmed)) parts = trimmed.split(/[\s\-/]+/);
  else return null;

  const phases: TempoPhase[] = [];
  for (const part of parts) {
    if (part === 'X') {
      phases.push('X');
      continue;
    }
    if (!/^[0-9]+$/.test(part)) return null;
    const n = Number(part);
    if (n > METHOD_LIMITS.TEMPO_PHASE_MAX) return null;
    phases.push(n);
  }
  return readTempo(phases);
}

/**
 * Write a tempo back out: the compact `3110` when every phase is a single
 * figure, `10/0/10/0` otherwise, or `3 1 1 0` when `spaced` — the target line
 * spaces the phases so each is readable at arm's length.
 */
export function formatTempo(tempo: Tempo, opts: { spaced?: boolean } = {}): string {
  const parts = tempo.map(String);
  if (opts.spaced) return parts.join(' ');
  const compact = tempo.every((p) => p === 'X' || p < 10);
  return compact ? parts.join('') : parts.join('/');
}

function seconds(n: number): string {
  return `${n} ${n === 1 ? 'second' : 'seconds'}`;
}

/**
 * A tempo in plain words: `3110` is "lower for 3 seconds, pause 1, lift in 1,
 * no pause at the top".
 */
export function describeTempo(tempo: Tempo): string {
  const [down, bottom, up, top] = tempo;
  const lower = down === 'X' ? 'lower as fast as you can' : down === 0 ? 'lower without a set speed' : `lower for ${seconds(down)}`;
  const pause = bottom === 'X' || bottom === 0 ? 'no pause at the bottom' : `pause ${bottom}`;
  const lift = up === 'X' ? 'lift as fast as you can' : up === 0 ? 'lift without a set speed' : `lift in ${up}`;
  const hold = top === 'X' || top === 0 ? 'no pause at the top' : `pause ${top} at the top`;
  return `${lower}, ${pause}, ${lift}, ${hold}`;
}

// ─────────────────────────────────────────────────────────────
// Schemes
// ─────────────────────────────────────────────────────────────

function readLoad(raw: unknown, relMax: number): SetLoad {
  const fallback: SetLoad = { kind: 'rel', x: 1 };
  if (typeof raw !== 'object' || raw === null) return fallback;
  const { kind, x } = raw as { kind?: unknown; x?: unknown };
  if (kind === 'rel') {
    const n = clampNum(x, METHOD_LIMITS.LOAD_MIN, relMax);
    return n === null ? fallback : { kind: 'rel', x: n };
  }
  if (kind === 'pct') {
    const n = clampNum(x, METHOD_LIMITS.LOAD_MIN, METHOD_LIMITS.PCT_MAX);
    return n === null ? fallback : { kind: 'pct', x: n };
  }
  if (kind === 'kg') {
    const n = clampNum(x, 0, METHOD_LIMITS.KG_MAX);
    return n === null ? fallback : { kind: 'kg', x: round2(n) };
  }
  return fallback;
}

/** One stored scheme entry, clamped. Every field is present afterwards except the optional ones. */
function readEntry(raw: unknown, relMax: number): SetPrescription {
  const entry = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const reps = clampInt(entry.reps, 1, METHOD_LIMITS.REPS_MAX) ?? 1;
  const out: SetPrescription = { reps, load: readLoad(entry.load, relMax) };
  const repsMax = clampInt(entry.repsMax, 1, METHOD_LIMITS.REPS_MAX);
  // A ceiling at or below the floor is not a range.
  if (repsMax !== null && repsMax > reps) out.repsMax = repsMax;
  if (entry.amrap === true) out.amrap = true;
  const rest = readRestSec(entry.restSec);
  if (rest !== null) out.restSec = rest;
  // Never a warm-up: warm-ups sit outside the prescription and the model
  // treats them differently. Anything unrecognised is a working set.
  if (entry.type === 'backoff') out.type = 'backoff';
  return out;
}

/**
 * A stored scheme, clamped, or null when there is none worth using. A relative
 * load above 1 breaks the invariant that the heaviest set is the working weight;
 * on read it is capped rather than trusted, and saving puts it right.
 */
export function readScheme(raw: unknown): SetPrescription[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  return raw.slice(0, METHOD_LIMITS.SCHEME_MAX_SETS).map((entry) => readEntry(entry, 1));
}

/**
 * Make a scheme's heaviest relative load exactly 1.
 *
 * `rel: 1` is the slot's working weight, the one number the weekly review
 * moves. If the heaviest set were 0.9 or 1.1, "the heaviest working set" (what
 * progression reads) and "the weight the scheme hangs off" would be different
 * numbers and the two would drift apart with every step.
 *
 * Returns `scale`, the old heaviest relative load: multiply the slot's own
 * weight by it and every set still produces the same kilograms. 1 when nothing
 * changed, including a scheme with no relative loads at all.
 */
export function normaliseScheme(scheme: SetPrescription[]): { scheme: SetPrescription[]; scale: number } {
  // Read wide first: a stored 1.2 is exactly the value this exists to fix, so
  // it must not be capped to 1 before the heaviest is found.
  const entries = scheme.slice(0, METHOD_LIMITS.SCHEME_MAX_SETS).map((entry) => readEntry(entry, 10));
  const rels = entries.map((e) => (e.load?.kind === 'rel' ? e.load.x : 0));
  const heaviest = Math.max(0, ...rels);
  if (heaviest <= 0 || heaviest === 1) return { scheme: entries, scale: 1 };
  return {
    scale: heaviest,
    scheme: entries.map((e) =>
      e.load?.kind === 'rel'
        ? { ...e, load: { kind: 'rel' as const, x: Math.max(METHOD_LIMITS.LOAD_MIN, Math.round((e.load.x / heaviest) * 10000) / 10000) } }
        : e,
    ),
  };
}

// ─────────────────────────────────────────────────────────────
// Segment plans
// ─────────────────────────────────────────────────────────────

/** A stored segment plan, clamped, or null when there is none worth using. */
export function readSegments(raw: unknown): SegmentPlan | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const plan = raw as Record<string, unknown>;
  const style = plan.style;
  if (typeof style !== 'string' || !(SEGMENT_STYLES as readonly string[]).includes(style)) return null;

  const pieces = Array.isArray(plan.segmentReps) ? plan.segmentReps : [];
  const segmentReps = pieces
    .slice(0, METHOD_LIMITS.SEGMENTS_MAX)
    .map((reps) => (reps === null ? null : clampInt(reps, 1, METHOD_LIMITS.REPS_MAX)));
  const totalReps = clampInt(plan.totalReps, 1, METHOD_LIMITS.TOTAL_REPS_MAX);
  // A plan with no further pieces and no total to chase is a straight set.
  if (segmentReps.length === 0 && totalReps === null) return null;

  const out: SegmentPlan = {
    style: style as SegmentStyle,
    segmentReps,
    intraRestSec: clampInt(plan.intraRestSec, 0, METHOD_LIMITS.INTRA_REST_MAX_SEC) ?? 0,
    // A mechanical drop changes the movement, not the weight; a cluster repeats
    // the weight unless it deliberately sheds a little each time.
    dropFraction: style === 'mechanical-drop' ? 0 : (clampNum(plan.dropFraction, 0, METHOD_LIMITS.DROP_FRACTION_MAX) ?? 0),
  };
  if (totalReps !== null) out.totalReps = totalReps;
  if (Array.isArray(plan.labels)) {
    const labels = plan.labels
      .slice(0, METHOD_LIMITS.SEGMENTS_MAX + 1)
      .map((l) => (typeof l === 'string' ? l.trim().slice(0, METHOD_LIMITS.LABEL_MAX) : ''));
    if (labels.some((l) => l !== '')) out.labels = labels;
  }
  return out;
}

/** The pause an unplanned cluster or rest-pause piece gets: the usual fifteen seconds. */
export const UNPLANNED_PAUSE_SEC = 15;

/**
 * The plan for a piece nobody programmed: people decide to drop on the day, and
 * the app should not make them pre-programme it. A drop is 20% lighter and
 * straight away; a mechanical drop keeps the weight; a cluster or rest-pause
 * piece keeps the weight after a short pause. `alreadyLogged` is how many pieces
 * the set has after its first, so the one-more-piece plan continues from there.
 */
export function unplannedSegment(style: SegmentStyle = 'drop', alreadyLogged = 0): SegmentPlan {
  const segmentReps: (number | null)[] = Array.from({ length: Math.max(0, alreadyLogged) + 1 }, () => null);
  if (style === 'drop') return { style, segmentReps, intraRestSec: 0, dropFraction: UNPLANNED_DROP_FRACTION };
  if (style === 'mechanical-drop') return { style, segmentReps, intraRestSec: 0, dropFraction: 0 };
  return { style, segmentReps, intraRestSec: UNPLANNED_PAUSE_SEC, dropFraction: 0 };
}

/** A display weight rounded to the lifter's plate step, so a computed load is one they can actually load. */
export function roundToStep(value: number, step: number): number {
  if (!(step > 0)) return round2(value);
  return round2(Math.round(value / step) * step);
}

/**
 * A deep copy of a slot. Its method fields hold arrays and objects, and a
 * shallow copy would leave a copied routine sharing its scheme with the one it
 * came from — editing one would edit both. Keys the slot does not have are not
 * added.
 */
export function cloneSlot(slot: RoutineSlot): RoutineSlot {
  const out: RoutineSlot = { ...slot };
  if (Array.isArray(slot.tempo)) out.tempo = [...slot.tempo] as Tempo;
  if (Array.isArray(slot.scheme)) out.scheme = slot.scheme.map((entry) => ({ ...entry, ...(entry.load ? { load: { ...entry.load } } : {}) }));
  if (slot.segments && typeof slot.segments === 'object') {
    out.segments = {
      ...slot.segments,
      segmentReps: Array.isArray(slot.segments.segmentReps) ? [...slot.segments.segmentReps] : [],
      ...(Array.isArray(slot.segments.labels) ? { labels: [...slot.segments.labels] } : {}),
    };
  }
  return out;
}

export type NextSegment = {
  /** The piece about to be done, counting the set's first piece as 0. */
  index: number;
  /** Target reps for it; null means as many as possible. */
  reps: number | null;
  /** What a mechanical drop changes to for it, if the plan names it. */
  label: string | null;
};

/**
 * What comes next in a set made of pieces, or null when the set is finished.
 *
 * `pieces` is what has been logged of this set so far, its first piece
 * included. With a total-reps target the set carries on until the total is
 * reached, whatever the planned list says; a planned rep count is trimmed to
 * what is left so the last piece lands on the total rather than past it.
 */
export function nextSegment(plan: SegmentPlan, pieces: readonly { reps: number }[]): NextSegment | null {
  if (pieces.length === 0) return null;
  const done = pieces.length - 1;
  const index = done + 1;
  if (done >= METHOD_LIMITS.SEGMENTS_MAX) return null;
  const label = plan.labels?.[index] || null;

  if (plan.totalReps !== undefined) {
    const soFar = pieces.reduce((total, piece) => total + Math.max(0, piece.reps), 0);
    const left = plan.totalReps - soFar;
    if (left <= 0) return null;
    const planned = plan.segmentReps[done];
    return { index, reps: typeof planned === 'number' ? Math.min(planned, left) : null, label };
  }

  if (done >= plan.segmentReps.length) return null;
  return { index, reps: plan.segmentReps[done] ?? null, label };
}

/**
 * The weight for the next piece, in **display units**, rounded to the lifter's
 * plate step.
 *
 * Worked out from the weight on the entry card, in the unit the lifter is
 * using, and converted to kilograms once when the row is written. Reducing in
 * kilograms and converting back would round twice and drift.
 */
export function segmentWeight(entryWeight: number, plan: SegmentPlan, increment: number): number {
  if (!(entryWeight > 0)) return 0;
  const fraction = clampNum(plan.dropFraction, 0, METHOD_LIMITS.DROP_FRACTION_MAX) ?? 0;
  if (fraction === 0) return entryWeight;
  const reduced = entryWeight * (1 - fraction);
  if (!(increment > 0)) return round2(reduced);
  // Never round up to the weight just used: a drop is lighter by definition.
  const stepped = Math.round(reduced / increment) * increment;
  return round2(Math.max(0, stepped >= entryWeight ? entryWeight - increment : stepped));
}

// ─────────────────────────────────────────────────────────────
// The whole slot
// ─────────────────────────────────────────────────────────────

/** Everything a slot says about how it is trained, clamped and ready to use. */
export type SlotMethod = {
  tempo: Tempo | null;
  /** 'full' when the slot has none. */
  repStyle: RepStyle;
  /** Seconds per hold. Only ever set when repStyle is 'isometric'. */
  holdSec: number | null;
  /** Top of the rep range for straight sets, or null. */
  repsMax: number | null;
  scheme: SetPrescription[] | null;
  segments: SegmentPlan | null;
  /** The slot's own full rest, or null to use the lifter's preset. */
  restSec: number | null;
  /** The gap after this member of a group, or null to use the group's. */
  gapAfterSec: number | null;
  note: string | null;
  /** How many sets the slot prescribes before adaptation: the scheme's length when there is one. */
  setCount: number;
};

/** Read every method field off a slot. A slot with none reads as plain straight sets. */
export function resolveSlotMethod(slot: RoutineSlot): SlotMethod {
  const repStyle = readRepStyle(slot.repStyle);
  const scheme = readScheme(slot.scheme);
  const repsMax = clampInt(slot.repsMax, 1, METHOD_LIMITS.REPS_MAX);
  const note = typeof slot.note === 'string' ? slot.note.trim().slice(0, METHOD_LIMITS.NOTE_MAX) : '';
  return {
    tempo: readTempo(slot.tempo),
    repStyle,
    holdSec: repStyle === 'isometric' ? (readHoldSec(slot.holdSec) ?? null) : null,
    repsMax: repsMax !== null && repsMax > slot.reps ? repsMax : null,
    scheme,
    segments: readSegments(slot.segments),
    restSec: readRestSec(slot.restSec),
    gapAfterSec: readGapSec(slot.gapAfterSec),
    note: note === '' ? null : note,
    setCount: scheme ? scheme.length : slot.sets,
  };
}

/**
 * Tidy a slot for saving: what is stored is what will be read.
 *
 * Fields the slot does not have stay absent — a slot with no methods comes back
 * with exactly the keys it went in with, so nothing written before methods
 * existed changes shape by being saved again. A scheme is normalised so its
 * heaviest relative set is 1, with the slot's own weight scaled to match so no
 * set changes weight, and `sets` is kept equal to the scheme's length so
 * everything that still reads `sets` (pricing the week, the estimated minutes)
 * gets the right number.
 */
export function normaliseSlot(slot: RoutineSlot): RoutineSlot {
  const method = resolveSlotMethod(slot);
  const out: RoutineSlot = { ...slot };
  // Start from nothing and put back only what reads as valid.
  delete out.tempo;
  delete out.repStyle;
  delete out.holdSec;
  delete out.repsMax;
  delete out.scheme;
  delete out.segments;
  delete out.restSec;
  delete out.gapAfterSec;
  delete out.note;

  if (method.tempo) out.tempo = method.tempo;
  if (slot.repStyle !== undefined && method.repStyle !== 'full') out.repStyle = method.repStyle;
  if (method.holdSec !== null) out.holdSec = method.holdSec;
  if (method.repsMax !== null) out.repsMax = method.repsMax;
  if (Array.isArray(slot.scheme) && slot.scheme.length > 0) {
    const { scheme, scale } = normaliseScheme(slot.scheme);
    out.scheme = scheme;
    out.sets = scheme.length;
    if (scale !== 1) {
      if (out.targetWeightKg !== null) out.targetWeightKg = round2(out.targetWeightKg * scale);
      if (out.targetPct1RM !== null) out.targetPct1RM = Math.round(out.targetPct1RM * scale * 10000) / 10000;
    }
  }
  if (method.segments) out.segments = method.segments;
  if (method.restSec !== null) out.restSec = method.restSec;
  if (method.gapAfterSec !== null) out.gapAfterSec = method.gapAfterSec;
  if (method.note !== null) out.note = method.note;
  return out;
}

// ─────────────────────────────────────────────────────────────
// Per-set targets and rest
// ─────────────────────────────────────────────────────────────

/** What one set of a slot asks for. */
export type SetTarget = {
  /** 0-based: which set this is. Can run past the prescription if the lifter does extra. */
  setIndex: number;
  /** How many sets the slot prescribes. */
  setCount: number;
  reps: number;
  /** Top of the rep range, or null for a single number. */
  repsMax: number | null;
  /** As many as possible, with `reps` as the minimum. */
  amrap: boolean;
  /** Kilograms, to two places. */
  weightKg: number;
  type: 'working' | 'backoff';
  /** Rest after this set from the scheme or the slot, or null to use the lifter's preset. */
  restSec: number | null;
};

/** A set's target as the logger shows it: every rest resolved, and the effort to aim for. */
export type ActiveSetTarget = Omit<SetTarget, 'restSec'> & {
  /** Seconds of rest after this set, with the lifter's preset as the last resort. */
  restSec: number;
  rpe: number;
};

/**
 * The target for one set of a slot.
 *
 * `baseKg` is the slot's working weight after adaptation — what `resolveTarget`
 * produces — and a relative load hangs off it, so a progression step moves the
 * whole scheme together. A percentage hangs off `e1rm` instead, which is how
 * percentage programmes progress; with no estimate yet it falls back to the
 * working weight rather than prescribing zero. A fixed weight is just that.
 *
 * A set past the end of a scheme repeats its last entry: extra sets happen, and
 * they should look like the last one rather than like nothing.
 */
export function setTargetAt(slot: RoutineSlot, setIndex: number, baseKg: number, e1rm: number): SetTarget {
  const method = resolveSlotMethod(slot);
  const index = Math.max(0, Math.floor(setIndex));
  const plain: SetTarget = {
    setIndex: index,
    setCount: method.setCount,
    reps: slot.reps,
    repsMax: method.repsMax,
    amrap: false,
    weightKg: round2(baseKg),
    type: 'working',
    restSec: method.restSec,
  };
  if (!method.scheme) return plain;

  const entry = method.scheme[Math.min(index, method.scheme.length - 1)]!;
  const load = entry.load ?? { kind: 'rel', x: 1 };
  const weightKg =
    load.kind === 'kg' ? load.x : load.kind === 'pct' ? (e1rm > 0 ? e1rm : baseKg) * load.x : baseKg * load.x;
  return {
    ...plain,
    reps: entry.reps,
    repsMax: entry.repsMax ?? null,
    amrap: entry.amrap === true,
    weightKg: round2(weightKg),
    type: entry.type === 'backoff' ? 'backoff' : 'working',
    restSec: entry.restSec ?? method.restSec,
  };
}

/**
 * The full rest after set `setIndex` of a slot: the scheme entry's own rest,
 * then the slot's, then the lifter's preset. Written once so the logger and
 * anything that previews the session agree.
 */
export function fullRestSec(slot: RoutineSlot | null | undefined, setIndex: number, presetSec: number): number {
  if (!slot) return presetSec;
  return setTargetAt(slot, setIndex, 0, 0).restSec ?? presetSec;
}

// ─────────────────────────────────────────────────────────────
// Words
// ─────────────────────────────────────────────────────────────

/** What a group of this many lifts is called: two is a superset, three a triset, more a giant set. */
export function groupNoun(size: number): 'Superset' | 'Triset' | 'Giant set' {
  if (size >= 4) return 'Giant set';
  if (size === 3) return 'Triset';
  return 'Superset';
}

/**
 * Every method explainer, by key. One sheet each; the Train badge, the tempo
 * line and the builder's `?` buttons all open one of these.
 */
export const METHOD_GUIDE_KEYS = [
  'tempo',
  'paused',
  'one-and-half',
  'twenty-ones',
  'partial',
  'eccentric-only',
  'isometric',
  'drop',
  'mechanical-drop',
  'cluster',
  'rest-pause',
  'amrap',
  'wave',
  'pyramid',
  'descending-rest',
  'backoff',
  'groups',
] as const;

export type MethodGuideKey = (typeof METHOD_GUIDE_KEYS)[number];

export function isMethodGuideKey(raw: unknown): raw is MethodGuideKey {
  return typeof raw === 'string' && (METHOD_GUIDE_KEYS as readonly string[]).includes(raw);
}
