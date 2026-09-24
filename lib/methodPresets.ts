// Ready-made training methods for the workout builder.
//
// Each preset is a starting point: it writes ordinary slot fields, and
// everything it writes stays editable afterwards. Nothing records which preset
// was chosen — the slot's fields are the whole truth, so a hand-edited wave and
// a preset wave are the same thing.
//
// Relative loads are written with the heaviest set at exactly 1, because that
// set is the lift's working weight — the one number the weekly review moves.
// Written any other way, saving would rescale it and the preview would not
// match what was stored.
//
// Pure: no React, no Dexie.

import { formatTempo, parseTempo, resolveSlotMethod, cloneSlot, type MethodGuideKey } from './methods';
import type { RepStyle, RoutineSlot, SegmentPlan, SetPrescription, Tempo } from './types';

export type PresetGroup = 'sets' | 'intensity' | 'tempo' | 'rest';

/** The sheet's sections, in the order it shows them. */
export const PRESET_GROUPS: readonly { key: PresetGroup; label: string }[] = [
  { key: 'sets', label: 'Sets & reps' },
  { key: 'intensity', label: 'Intensity techniques' },
  { key: 'tempo', label: 'Tempo & reps' },
  { key: 'rest', label: 'Rest' },
];

export type MethodPreset = {
  id: string;
  label: string;
  /** One line, shown under the label in the sheet. */
  description: string;
  group: PresetGroup;
  /** The explainer the row's "?" opens. */
  guide: MethodGuideKey;
  apply: (slot: RoutineSlot) => RoutineSlot;
};

// ─────────────────────────────────────────────────────────────
// Building blocks
// ─────────────────────────────────────────────────────────────

/** Four places is plenty for a load and keeps 0.7333… from reaching storage as noise. */
function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

type Step = [reps: number, load: number, extra?: Partial<SetPrescription>];

function rel(steps: Step[]): SetPrescription[] {
  return steps.map(([reps, x, extra]) => ({ reps, load: { kind: 'rel', x: round4(x) }, ...extra }));
}

/** Replace the slot's sets with a scheme, keeping `sets` in step with it. */
function withScheme(scheme: SetPrescription[], restSec?: number) {
  return (slot: RoutineSlot): RoutineSlot => {
    const out = cloneSlot(slot);
    out.scheme = scheme.map((entry) => ({ ...entry, load: entry.load ? { ...entry.load } : { kind: 'rel', x: 1 } }));
    out.sets = scheme.length;
    if (restSec !== undefined) out.restSec = restSec;
    else delete out.restSec;
    return out;
  };
}

/** Drop any scheme, so the slot's own sets and reps are what gets trained. */
function withoutScheme(out: RoutineSlot): RoutineSlot {
  if (out.scheme) {
    out.sets = out.scheme.length;
    delete out.scheme;
  }
  return out;
}

function withSegments(plan: SegmentPlan, patch: Partial<RoutineSlot> = {}, dropScheme = false) {
  return (slot: RoutineSlot): RoutineSlot => {
    let out = cloneSlot(slot);
    if (dropScheme) out = withoutScheme(out);
    out.segments = { ...plan, segmentReps: [...plan.segmentReps] };
    return { ...out, ...patch };
  };
}

function withTempo(text: string) {
  const tempo = parseTempo(text);
  return (slot: RoutineSlot): RoutineSlot => {
    const out = cloneSlot(slot);
    if (tempo) out.tempo = [...tempo] as Tempo;
    return out;
  };
}

function withRepStyle(repStyle: Exclude<RepStyle, 'full'>, patch: Partial<RoutineSlot> = {}) {
  return (slot: RoutineSlot): RoutineSlot => {
    const out = cloneSlot(slot);
    out.repStyle = repStyle;
    if (repStyle !== 'isometric') delete out.holdSec;
    return { ...out, ...patch };
  };
}

/** Switch the slot to a percentage of the estimated max. */
function pctOfMax(pct: number): Partial<RoutineSlot> {
  return { targetPct1RM: pct, targetWeightKg: null };
}

// Programmes written in percentages usually work off a training max a little
// under the real one, so the numbers on paper are reachable on a bad day.
const TRAINING_MAX = 0.9;
function pctWeek(steps: [reps: number, pct: number][]): SetPrescription[] {
  return steps.map(([reps, pct], i) => ({
    reps,
    load: { kind: 'pct', x: round4(pct * TRAINING_MAX) },
    ...(i === steps.length - 1 ? { amrap: true } : {}),
  }));
}

function tenToOne(): SetPrescription[] {
  return rel(Array.from({ length: 10 }, (_, i): Step => [10 - i, 0.7 + (0.3 * i) / 9]));
}

// ─────────────────────────────────────────────────────────────
// The presets
// ─────────────────────────────────────────────────────────────

export const METHOD_PRESETS: readonly MethodPreset[] = [
  // Sets & reps
  {
    id: 'wave-753',
    label: 'Wave 7/5/3 ×2',
    description: 'Two climbs of 7, 5 and 3 reps; the second climb a little heavier.',
    group: 'sets',
    guide: 'wave',
    apply: withScheme(rel([[7, 0.85], [5, 0.9], [3, 0.95], [7, 0.875], [5, 0.925], [3, 1]]), 150),
  },
  {
    id: 'wave-531',
    label: 'Wave 5/3/1 ×2',
    description: 'Two climbs of 5, 3 and 1, finishing on the heaviest single.',
    group: 'sets',
    guide: 'wave',
    apply: withScheme(rel([[5, 0.88], [3, 0.94], [1, 0.975], [5, 0.9], [3, 0.96], [1, 1]]), 180),
  },
  {
    id: 'wave-51',
    label: '5/1 waves ×3',
    description: 'A set of five then a single, three times, each pair heavier.',
    group: 'sets',
    guide: 'wave',
    apply: withScheme(rel([[5, 0.85], [1, 0.95], [5, 0.875], [1, 0.975], [5, 0.9], [1, 1]]), 180),
  },
  {
    id: 'wave-descending',
    label: 'Descending wave',
    description: 'Reps fall from 5 to 3 while the singles between them climb.',
    group: 'sets',
    guide: 'wave',
    apply: withScheme(rel([[5, 0.85], [1, 0.96], [4, 0.87], [1, 0.98], [3, 0.89], [1, 1]]), 180),
  },
  {
    id: 'pct-week-1',
    label: '5/3/1 week 1',
    description: 'Three fives off a training max, the last as many as you can.',
    group: 'sets',
    guide: 'amrap',
    apply: withScheme(pctWeek([[5, 0.65], [5, 0.75], [5, 0.85]]), 180),
  },
  {
    id: 'pct-week-2',
    label: '5/3/1 week 2',
    description: 'Three triples off a training max, the last as many as you can.',
    group: 'sets',
    guide: 'amrap',
    apply: withScheme(pctWeek([[3, 0.7], [3, 0.8], [3, 0.9]]), 180),
  },
  {
    id: 'pct-week-3',
    label: '5/3/1 week 3',
    description: 'A five, a three and a single off a training max, the single open-ended.',
    group: 'sets',
    guide: 'amrap',
    apply: withScheme(pctWeek([[5, 0.75], [3, 0.85], [1, 0.95]]), 180),
  },
  {
    id: 'pyramid-864',
    label: 'Pyramid 8/6/4 +8',
    description: 'Up to a heavy four, then one more eight a touch heavier than the first.',
    group: 'sets',
    guide: 'pyramid',
    apply: withScheme(rel([[8, 0.85], [6, 0.92], [4, 1], [8, 0.88]]), 120),
  },
  {
    id: 'pyramid-reverse',
    label: 'Reverse pyramid 4/6/8',
    description: 'Heaviest set first while fresh, then lighter with more reps.',
    group: 'sets',
    guide: 'pyramid',
    apply: withScheme(rel([[4, 1], [6, 0.92], [8, 0.85]]), 120),
  },
  {
    id: 'pyramid-broad-up',
    label: 'Broad pyramid up and down',
    description: '8, 6, 4 up to the top, then back down 4, 6, 8.',
    group: 'sets',
    guide: 'pyramid',
    apply: withScheme(rel([[8, 0.85], [6, 0.92], [4, 1], [4, 1], [6, 0.92], [8, 0.85]]), 120),
  },
  {
    id: 'pyramid-broad-down',
    label: 'Broad pyramid down and up',
    description: 'Start heavy at 4, ease out to 8s, then climb back to 4.',
    group: 'sets',
    guide: 'pyramid',
    apply: withScheme(rel([[4, 1], [6, 0.92], [8, 0.85], [8, 0.85], [6, 0.92], [4, 1]]), 120),
  },
  {
    id: 'ten-to-one',
    label: '10-to-1',
    description: 'Ten sets counting down from 10 reps to 1 as the weight climbs.',
    group: 'sets',
    guide: 'pyramid',
    apply: withScheme(tenToOne(), 90),
  },
  {
    id: 'five-to-one',
    label: '5/4/3/2/1',
    description: 'One rep fewer and a little heavier every set.',
    group: 'sets',
    guide: 'pyramid',
    apply: withScheme(rel([[5, 0.9], [4, 0.925], [3, 0.95], [2, 0.975], [1, 1]]), 90),
  },
  {
    id: 'two-four-six',
    label: '2×2, 2×4, 2×6',
    description: 'Two heavy doubles, then two fours, then two sixes.',
    group: 'sets',
    guide: 'wave',
    apply: withScheme(rel([[2, 0.97], [2, 1], [4, 0.9], [4, 0.92], [6, 0.84], [6, 0.86]]), 150),
  },
  {
    id: 'four-by-four-plus',
    label: '4×4 + 1×10 + 1×20',
    description: 'Four heavy fours, then two lighter back-off sets of 10 and 20.',
    group: 'sets',
    guide: 'backoff',
    apply: withScheme(
      rel([[4, 0.94], [4, 0.96], [4, 0.98], [4, 1], [10, 0.7, { type: 'backoff' }], [20, 0.5, { type: 'backoff' }]]),
      120,
    ),
  },
  {
    id: 'five-by-five-ramp',
    label: '5×5 ramp',
    description: 'Five fives, adding a little weight each set up to the top one.',
    group: 'sets',
    guide: 'pyramid',
    apply: withScheme(rel([[5, 0.88], [5, 0.91], [5, 0.94], [5, 0.97], [5, 1]]), 120),
  },
  {
    id: 'five-by-five-descending',
    label: '5×5 descending',
    description: 'Three fives at the top weight, then lighter so the last two stay at five.',
    group: 'sets',
    guide: 'pyramid',
    apply: withScheme(rel([[5, 1], [5, 1], [5, 1], [5, 0.95], [5, 0.9]]), 120),
  },
  {
    id: 'amrap-last',
    label: 'Last set as many as you can',
    description: 'Your usual sets, with the final one taken as far as it will go.',
    group: 'sets',
    guide: 'amrap',
    apply: (slot) => {
      const base = baseSets(slot);
      return withScheme(base.map((entry, i) => (i === base.length - 1 ? { ...entry, amrap: true } : entry)), resolveSlotMethod(slot).restSec ?? undefined)(slot);
    },
  },
  {
    id: 'backoff-heavy',
    label: 'Back-off set',
    description: 'Your usual sets, then one lighter set of 15 to finish.',
    group: 'sets',
    guide: 'backoff',
    apply: (slot) =>
      withScheme([...baseSets(slot), ...rel([[15, 0.5, { type: 'backoff' }]])], resolveSlotMethod(slot).restSec ?? undefined)(slot),
  },

  // Intensity techniques
  {
    id: 'drop-double',
    label: 'Drop set ×2',
    description: 'At the end of the set, strip 20% and go again, twice, with no rest.',
    group: 'intensity',
    guide: 'drop',
    apply: withSegments({ style: 'drop', segmentReps: [null, null], intraRestSec: 0, dropFraction: 0.2 }),
  },
  {
    id: 'drop-triple-10',
    label: 'Triple drop 10+10+10',
    description: 'Ten reps, drop 20%, ten more, drop again, ten more.',
    group: 'intensity',
    guide: 'drop',
    apply: withSegments({ style: 'drop', segmentReps: [10, 10], intraRestSec: 0, dropFraction: 0.2 }, { reps: 10 }),
  },
  {
    id: 'mechanical-drop',
    label: 'Mechanical drop',
    description: 'Same weight, switch to an easier version of the lift to keep going.',
    group: 'intensity',
    guide: 'mechanical-drop',
    apply: withSegments({ style: 'mechanical-drop', segmentReps: [null, null], intraRestSec: 0, dropFraction: 0 }),
  },
  {
    id: 'cluster-5x1',
    label: 'Cluster 5 × 1',
    description: 'Five heavy singles at 90% with a 15-second breather between each.',
    group: 'intensity',
    guide: 'cluster',
    apply: withSegments(
      { style: 'cluster', segmentReps: [1, 1, 1, 1], intraRestSec: 15, dropFraction: 0 },
      { reps: 1, restSec: 240, ...pctOfMax(0.9) },
      true,
    ),
  },
  {
    id: 'cluster-heavy',
    label: 'Heavy cluster 3+1+1+1+1',
    description: 'A triple, then four singles at the same weight, ten seconds apart.',
    group: 'intensity',
    guide: 'cluster',
    apply: withSegments({ style: 'cluster', segmentReps: [1, 1, 1, 1], intraRestSec: 10, dropFraction: 0 }, { reps: 3, restSec: 240 }, true),
  },
  {
    id: 'singles-small-drops',
    label: 'Singles with small drops',
    description: 'Six singles, ten seconds apart, taking 3% off before each.',
    group: 'intensity',
    guide: 'cluster',
    apply: withSegments(
      { style: 'cluster', segmentReps: [1, 1, 1, 1, 1], intraRestSec: 10, dropFraction: 0.03 },
      { reps: 1, restSec: 270 },
      true,
    ),
  },
  {
    id: 'rest-pause',
    label: 'Rest-pause',
    description: 'Five reps, 15 seconds, as many as you can, 15 seconds, again.',
    group: 'intensity',
    guide: 'rest-pause',
    apply: withSegments({ style: 'rest-pause', segmentReps: [null, null], intraRestSec: 15, dropFraction: 0 }, { reps: 5, restSec: 180 }, true),
  },
  {
    id: 'total-50',
    label: '50 total reps',
    description: 'Keep taking short breaks and chipping away until 50 reps are done.',
    group: 'intensity',
    guide: 'rest-pause',
    apply: withSegments(
      { style: 'rest-pause', segmentReps: [], intraRestSec: 15, dropFraction: 0.05, totalReps: 50 },
      { reps: 6, restSec: 180 },
      true,
    ),
  },

  // Tempo & reps
  {
    id: 'tempo-paused',
    label: 'Paused reps',
    description: 'Three seconds down, a dead stop for three, then up.',
    group: 'tempo',
    guide: 'paused',
    apply: withTempo('3310'),
  },
  {
    id: 'tempo-slow-lowering',
    label: 'Slow lowering',
    description: 'Five seconds on the way down, one on the way up.',
    group: 'tempo',
    guide: 'tempo',
    apply: withTempo('5010'),
  },
  {
    id: 'tempo-controlled',
    label: 'Controlled 2110',
    description: 'Two down, a one-second hold at the bottom, one up.',
    group: 'tempo',
    guide: 'tempo',
    apply: withTempo('2110'),
  },
  {
    id: 'tempo-explosive',
    label: 'Explosive 30X',
    description: 'Three seconds down, then drive it up as fast as you can.',
    group: 'tempo',
    guide: 'tempo',
    apply: withTempo('30X0'),
  },
  {
    id: 'one-and-half',
    label: '1½ reps',
    description: 'A full rep plus a half rep at the bottom, counted as one.',
    group: 'tempo',
    guide: 'one-and-half',
    apply: withRepStyle('one-and-half'),
  },
  {
    id: 'twenty-ones',
    label: '21s',
    description: 'Seven bottom halves, seven top halves, seven full reps.',
    group: 'tempo',
    guide: 'twenty-ones',
    apply: (slot) => withRepStyle('twenty-ones', { reps: 21 })(withoutScheme(cloneSlot(slot))),
  },
  {
    id: 'partial',
    label: 'Partial reps',
    description: 'A deliberately shortened range, usually the strongest part.',
    group: 'tempo',
    guide: 'partial',
    apply: withRepStyle('partial'),
  },
  {
    id: 'eccentric-only',
    label: 'Lowering only',
    description: 'Heavier than you can lift; lower it slowly and have a spotter lift it.',
    group: 'tempo',
    guide: 'eccentric-only',
    apply: (slot) => withRepStyle('eccentric-only', { restSec: 240, ...pctOfMax(1.1) })(withoutScheme(cloneSlot(slot))),
  },
  {
    id: 'isometric',
    label: 'Isometric hold',
    description: 'Hold one position still for ten seconds per rep.',
    group: 'tempo',
    guide: 'isometric',
    apply: withRepStyle('isometric', { holdSec: 10 }),
  },

  // Rest
  {
    id: 'descending-rest',
    label: 'Descending rest',
    description: 'Five fives with the rest shrinking from 90 to 30 seconds.',
    group: 'rest',
    guide: 'descending-rest',
    apply: withScheme(
      rel([
        [5, 1, { restSec: 90 }],
        [5, 0.95, { restSec: 60 }],
        [5, 0.9, { restSec: 45 }],
        [5, 0.85, { restSec: 30 }],
        [5, 0.8],
      ]),
    ),
  },
  {
    id: 'short-rest-8x3',
    label: '8 × 3 short rest',
    description: 'Eight triples at one weight, 50 seconds apart, driven up fast.',
    group: 'rest',
    guide: 'tempo',
    apply: (slot) => {
      const out = withTempo('30X0')(withoutScheme(cloneSlot(slot)));
      return { ...out, sets: 8, reps: 3, restSec: 50 };
    },
  },
];

/** The slot's current sets as scheme entries, so a preset can add to them rather than replace them. */
function baseSets(slot: RoutineSlot): SetPrescription[] {
  const method = resolveSlotMethod(slot);
  if (method.scheme) return method.scheme.map((entry) => ({ ...entry, amrap: undefined })).map(stripUndefined);
  return Array.from({ length: Math.max(1, slot.sets) }, () => ({ reps: slot.reps, load: { kind: 'rel' as const, x: 1 } }));
}

function stripUndefined<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T;
}

export function presetById(id: string): MethodPreset | undefined {
  return METHOD_PRESETS.find((preset) => preset.id === id);
}

/**
 * Take every method off a slot: straight sets of the slot's own reps. A scheme
 * leaves its length behind as the set count, so clearing a six-set wave gives
 * six straight sets rather than whatever number was there before it.
 */
export function clearMethod(slot: RoutineSlot): RoutineSlot {
  const out = withoutScheme(cloneSlot(slot));
  delete out.tempo;
  delete out.repStyle;
  delete out.holdSec;
  delete out.repsMax;
  delete out.segments;
  delete out.restSec;
  delete out.gapAfterSec;
  delete out.note;
  return out;
}

// ─────────────────────────────────────────────────────────────
// The one-line summary under each lift
// ─────────────────────────────────────────────────────────────

const REP_STYLE_LABEL: Record<RepStyle, string> = {
  full: 'Full reps',
  'one-and-half': '1½ reps',
  'twenty-ones': '21s',
  partial: 'Partials',
  'eccentric-only': 'Lowering only',
  isometric: 'Hold',
};

export function repStyleLabel(style: RepStyle): string {
  return REP_STYLE_LABEL[style];
}

const SEGMENT_LABEL: Record<SegmentPlan['style'], string> = {
  drop: 'Drop',
  'mechanical-drop': 'Mechanical drop',
  cluster: 'Cluster',
  'rest-pause': 'Rest-pause',
};

export function segmentStyleLabel(style: SegmentPlan['style']): string {
  return SEGMENT_LABEL[style];
}

/** Seconds as the builder writes them: `45 s`, `2:30`. */
export function formatRest(sec: number): string {
  if (sec < 60) return `${sec} s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** Which scheme preset a slot's scheme matches exactly, if any. */
function matchScheme(slot: RoutineSlot, scheme: SetPrescription[]): MethodPreset | undefined {
  const key = JSON.stringify(scheme.map(stripUndefined));
  return METHOD_PRESETS.filter((preset) => preset.group === 'sets' || preset.id === 'descending-rest').find((preset) => {
    const applied = resolveSlotMethod(preset.apply(slot)).scheme;
    return applied !== null && JSON.stringify(applied.map(stripUndefined)) === key;
  });
}

function describeScheme(scheme: SetPrescription[]): string {
  return `Sets ${scheme.map((entry) => `${entry.reps}${entry.amrap ? '+' : ''}`).join('/')}`;
}

function describeSegments(plan: SegmentPlan): string {
  const label = SEGMENT_LABEL[plan.style];
  if (plan.totalReps !== undefined) return `${label} · ${plan.totalReps} total`;
  const count = plan.segmentReps.length;
  if (plan.style === 'drop') return `${label} ×${count} · ${Math.round(plan.dropFraction * 100)}%`;
  if (plan.style === 'mechanical-drop') return `${label} ×${count}`;
  return `${label} +${count} · ${plan.intraRestSec} s`;
}

/**
 * Everything a slot does beyond straight sets, in one line: `Wave 7/5/3 ×2 ·
 * tempo 3110`. "Straight sets" when it does nothing extra, so the row never
 * reads blank.
 */
export function describeMethod(slot: RoutineSlot): string {
  const method = resolveSlotMethod(slot);
  const parts: string[] = [];
  if (method.scheme) parts.push(matchScheme(slot, method.scheme)?.label ?? describeScheme(method.scheme));
  if (method.segments) parts.push(describeSegments(method.segments));
  if (method.repStyle === 'isometric') parts.push(`Hold ${method.holdSec ?? 10} s`);
  else if (method.repStyle !== 'full') parts.push(REP_STYLE_LABEL[method.repStyle]);
  if (method.tempo) parts.push(`tempo ${formatTempo(method.tempo)}`);
  if (method.restSec !== null && !method.scheme?.some((entry) => entry.restSec !== undefined)) parts.push(`rest ${formatRest(method.restSec)}`);
  if (method.gapAfterSec !== null) parts.push(`gap ${formatRest(method.gapAfterSec)}`);
  if (method.note) parts.push('note');
  return parts.length === 0 ? 'Straight sets' : parts.join(' · ');
}
