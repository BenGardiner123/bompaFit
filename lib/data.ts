// Seed content: the exercise library, movement cues, and starter routines.
//
// Cues for the seeded movements are transcribed from the design where it
// supplied them and written in the same voice where it didn't.
//
// Licensing: the bundled movements (names, muscles, equipment) come from Free
// Exercise DB. Their step-by-step cues in public/howtos.json were written for
// Bompa from those facts — the dataset's own instruction text is not used,
// because its origin could not be confirmed — and are CC0, like the 14
// hand-written seed movements below. No wger data is bundled; wger content
// arrives only through a connected service. `Exercise.licence` is still recorded per
// entry so the source of every movement stays on record — ingest is the only
// moment that answer is knowable.

import { INGESTED_EXERCISES } from './exercises.generated';
import type { Exercise, HowTo, Routine } from './types';

/**
 * The hand-written movements. Every lift in every seeded routine appears here,
 * each with full execution cues and a common fault, which is what separates
 * these from the ingested set — see HOWTOS below.
 */
export const SEED_EXERCISES: Exercise[] = [
  { id: 'barbell-bench-press', name: 'Bench Press', short: 'Bench', muscle: 'Chest · Compound', pattern: 'Horizontal push', equipment: 'Barbell', kind: 'compound', source: 'seed', licence: 'CC0-1.0' },
  { id: 'overhead-press', name: 'Overhead Press', short: 'OHP', muscle: 'Shoulders · Compound', pattern: 'Vertical push', equipment: 'Barbell', kind: 'compound', source: 'seed', licence: 'CC0-1.0' },
  { id: 'cable-fly', name: 'Cable Fly', short: 'Fly', muscle: 'Chest · Accessory', pattern: 'Horizontal push · accessory', equipment: 'Cable', kind: 'accessory', source: 'seed', licence: 'CC0-1.0' },
  { id: 'rope-extension', name: 'Rope Extension', short: 'Rope', muscle: 'Triceps · Accessory', pattern: 'Elbow extension · accessory', equipment: 'Cable', kind: 'accessory', source: 'seed', licence: 'CC0-1.0' },
  { id: 'back-squat', name: 'Back Squat', short: 'Squat', muscle: 'Quads · Compound', pattern: 'Squat', equipment: 'Barbell', kind: 'compound', source: 'seed', licence: 'CC0-1.0' },
  { id: 'deadlift', name: 'Deadlift', short: 'Dead', muscle: 'Posterior chain · Compound', pattern: 'Hinge', equipment: 'Barbell', kind: 'compound', source: 'seed', licence: 'CC0-1.0' },
  { id: 'romanian-deadlift', name: 'Romanian Deadlift', short: 'RDL', muscle: 'Hamstrings · Compound', pattern: 'Hinge', equipment: 'Barbell', kind: 'compound', source: 'seed', licence: 'CC0-1.0' },
  { id: 'barbell-row', name: 'Barbell Row', short: 'Row', muscle: 'Back · Compound', pattern: 'Horizontal pull', equipment: 'Barbell', kind: 'compound', source: 'seed', licence: 'CC0-1.0' },
  { id: 'lat-pulldown', name: 'Lat Pulldown', short: 'Pulldown', muscle: 'Lats · Compound', pattern: 'Vertical pull', equipment: 'Cable', kind: 'compound', source: 'seed', licence: 'CC0-1.0' },
  { id: 'face-pull', name: 'Face Pull', short: 'Face pull', muscle: 'Rear delts · Accessory', pattern: 'Horizontal pull · accessory', equipment: 'Cable', kind: 'accessory', source: 'seed', licence: 'CC0-1.0' },
  { id: 'hammer-curl', name: 'Hammer Curl', short: 'Curl', muscle: 'Biceps · Accessory', pattern: 'Elbow flexion · accessory', equipment: 'Dumbbell', kind: 'accessory', source: 'seed', licence: 'CC0-1.0' },
  { id: 'shrug', name: 'Shrug', short: 'Shrug', muscle: 'Traps · Accessory', pattern: 'Scapular elevation · accessory', equipment: 'Barbell', kind: 'accessory', source: 'seed', licence: 'CC0-1.0' },
  { id: 'leg-press', name: 'Leg Press', short: 'Leg press', muscle: 'Quads · Accessory', pattern: 'Squat · accessory', equipment: 'Machine', kind: 'accessory', source: 'seed', licence: 'CC0-1.0' },
  { id: 'calf-raise', name: 'Calf Raise', short: 'Calf', muscle: 'Calves · Accessory', pattern: 'Ankle extension · accessory', equipment: 'Machine', kind: 'accessory', source: 'seed', licence: 'CC0-1.0' },
];

const SEED_IDS = new Set(SEED_EXERCISES.map((e) => e.id));

/**
 * Everything that ships with the app: the hand-written 14, then Free Exercise DB.
 *
 * Three ingested ids collide with a seed — romanian-deadlift, face-pull and
 * leg-press — and the seed wins every time, because it carries a hand-written
 * common fault the dataset has no field for. Resolving the clash here rather
 * than in the ingest script means adding a seed can never leave the generated
 * file quietly out of date.
 *
 * This is not the whole library the user sees. Movements they create themselves
 * live in IndexedDB and are merged on top in BompaContext — see `db.exercises`
 * and the v3 migration, which explains why bundled content is deliberately not
 * stored there.
 */
export const EXERCISES: Exercise[] = [...SEED_EXERCISES, ...INGESTED_EXERCISES.filter((e) => !SEED_IDS.has(e.id))];

export const EXERCISE_BY_ID = new Map(EXERCISES.map((e) => [e.id, e]));

export function exerciseName(id: string): string {
  return EXERCISE_BY_ID.get(id)?.name ?? id;
}

export const HOWTOS: HowTo[] = [
  {
    exerciseId: 'barbell-bench-press',
    muscles: 'Primary: Chest · Secondary: Triceps, Front delts',
    mediaNote: 'Cues bundled offline · no demo clip yet',
    steps: [
      'Set eyes under the bar, squeeze shoulder blades down and back into the bench.',
      'Unrack to lockout, then bring the bar over the base of the sternum.',
      'Lower under control until the bar touches the chest — elbows tucked around 45°.',
      'Drive the bar back and slightly toward the face, keeping the upper back tight.',
    ],
    fault: 'Flaring the elbows straight out at the bottom. Keep them under the wrists — it protects the shoulder and shortens the bar path.',
  },
  {
    exerciseId: 'overhead-press',
    muscles: 'Primary: Front delts · Secondary: Triceps, Upper chest',
    mediaNote: 'Cues bundled offline · no demo clip yet',
    steps: [
      'Bar rests on the front delts, hands just outside shoulder width.',
      'Brace the trunk and squeeze the glutes — the ribcage stays down.',
      'Move the head back an inch and press straight up past the face.',
      'Finish with the bar over the ears, biceps by the temples.',
    ],
    fault: 'Leaning back to start the press. If the lower back arches, the load moved from delts to spine — lighten it.',
  },
  {
    exerciseId: 'cable-fly',
    muscles: 'Primary: Chest · Secondary: Front delts',
    mediaNote: 'Cues bundled offline · no demo clip yet',
    steps: [
      'Set pulleys slightly above shoulder height, take a short split stance.',
      'Soft bend in the elbows, held constant through the whole rep.',
      'Bring the handles together in front of the lower chest.',
      'Return until you feel a stretch, no further.',
    ],
    fault: 'Turning it into a press by bending the elbows. Keep the elbow angle locked so the chest does the work.',
  },
  {
    exerciseId: 'rope-extension',
    muscles: 'Primary: Triceps · Secondary: —',
    mediaNote: 'Cues bundled offline · no demo clip yet',
    steps: [
      'Rope at upper-pulley height, elbows pinned to the ribs.',
      'Extend down and slightly apart, turning the pinkies out at the end.',
      'Squeeze the lockout for a beat.',
      'Return to a 90° elbow without letting the elbows drift forward.',
    ],
    fault: 'Elbows travelling forward on the way up — that hands the rep to the shoulders.',
  },
  {
    exerciseId: 'back-squat',
    muscles: 'Primary: Quads, Glutes · Secondary: Spinal erectors, Adductors',
    mediaNote: 'Cues bundled offline · no demo clip yet',
    steps: [
      'Bar on the rear delts, hands as narrow as the shoulders allow without pain.',
      'Brace against the belt, unrack, and take two steps back.',
      'Sit down between the hips, knees tracking over the middle toes.',
      'Below parallel, then drive the whole foot into the floor and stand.',
    ],
    fault: 'Hips shooting up first out of the hole, which turns the squat into a good morning. Lead with the chest.',
  },
  {
    exerciseId: 'deadlift',
    muscles: 'Primary: Glutes, Hamstrings, Erectors · Secondary: Lats, Traps',
    mediaNote: 'Cues bundled offline · no demo clip yet',
    steps: [
      'Bar over mid-foot, shins an inch away, grip just outside the legs.',
      'Take the slack out of the bar until it clicks against the plates.',
      'Push the floor away rather than pulling the bar up.',
      'Lock out by squeezing the glutes, not by leaning back.',
    ],
    fault: 'Jerking the bar off the floor with slack in the arms. Pull the tension in first — the bar should leave the floor already loaded.',
  },
  {
    exerciseId: 'romanian-deadlift',
    muscles: 'Primary: Hamstrings, Glutes · Secondary: Erectors',
    mediaNote: 'Cues bundled offline · no demo clip yet',
    steps: [
      'Start from the top, bar against the thighs, knees softly bent.',
      'Push the hips back and let the bar slide down the legs.',
      'Stop when the hamstrings run out of stretch — usually mid-shin.',
      'Drive the hips forward to stand, keeping the bar in contact throughout.',
    ],
    fault: 'Turning it into a squat by bending the knees. The knee angle barely changes — the hips do the travelling.',
  },
  {
    exerciseId: 'barbell-row',
    muscles: 'Primary: Lats, Mid-back · Secondary: Biceps, Rear delts',
    mediaNote: 'Cues bundled offline · no demo clip yet',
    steps: [
      'Hinge to roughly 45°, bar hanging under the shoulders.',
      'Row toward the belly button, elbows past the ribs.',
      'Pause for a beat at the top without shrugging.',
      'Lower under control — the eccentric is most of the work.',
    ],
    fault: 'Standing up into every rep. If the torso angle changes, the weight is doing the choosing.',
  },
  {
    exerciseId: 'lat-pulldown',
    muscles: 'Primary: Lats · Secondary: Biceps, Rear delts',
    mediaNote: 'Cues bundled offline · no demo clip yet',
    steps: [
      'Thighs locked under the pad, hands just outside shoulder width.',
      'Start by pulling the shoulder blades down, then bend the elbows.',
      'Bring the bar to the collarbone with the chest lifted.',
      'Return all the way to a full stretch without letting the shoulders shrug up.',
    ],
    fault: 'Leaning back to drag the bar down. A little lean is fine; a rep that becomes a row is not.',
  },
  {
    exerciseId: 'face-pull',
    muscles: 'Primary: Rear delts · Secondary: Mid-traps, Rotator cuff',
    mediaNote: 'Cues bundled offline · no demo clip yet',
    steps: [
      'Rope at eye height, take an overhand grip with the thumbs back.',
      'Pull toward the forehead, splitting the rope apart.',
      'Finish with the hands beside the ears and the elbows high.',
      'Return slowly — this one is never about load.',
    ],
    fault: 'Loading it heavy enough that the lower back has to help. Light and clean beats heavy and ugly here.',
  },
  {
    exerciseId: 'hammer-curl',
    muscles: 'Primary: Biceps, Brachialis · Secondary: Forearms',
    mediaNote: 'Cues bundled offline · no demo clip yet',
    steps: [
      'Stand tall, dumbbells at the sides, palms facing in.',
      'Curl without letting the elbows drift forward.',
      'Squeeze at the top for a beat.',
      'Lower all the way to a straight arm.',
    ],
    fault: 'Swinging the weight up with the hips. If the torso moves, drop the dumbbells a size.',
  },
  {
    exerciseId: 'shrug',
    muscles: 'Primary: Upper traps · Secondary: Levator, Forearms',
    mediaNote: 'Cues bundled offline · no demo clip yet',
    steps: [
      'Bar or dumbbells hanging at arm’s length, shoulders relaxed down.',
      'Shrug straight up toward the ears.',
      'Hold the top for a full second.',
      'Lower under control to a complete stretch.',
    ],
    fault: 'Rolling the shoulders. Traps elevate; they don’t rotate. Straight up, straight down.',
  },
  {
    exerciseId: 'leg-press',
    muscles: 'Primary: Quads, Glutes · Secondary: Hamstrings',
    mediaNote: 'Cues bundled offline · no demo clip yet',
    steps: [
      'Feet mid-platform, shoulder width, whole foot in contact.',
      'Lower until the knees reach roughly 90° without the hips tucking.',
      'Press through the mid-foot and heel.',
      'Stop just short of locking the knees.',
    ],
    fault: 'Letting the lower back round off the pad at the bottom. That is the end of your range, whatever the machine allows.',
  },
  {
    exerciseId: 'calf-raise',
    muscles: 'Primary: Gastrocnemius, Soleus · Secondary: —',
    mediaNote: 'Cues bundled offline · no demo clip yet',
    steps: [
      'Balls of the feet on the platform, heels hanging free.',
      'Drop into a full stretch and pause there.',
      'Press up to the highest point the ankle allows.',
      'Pause at the top too — calves respond to time, not momentum.',
    ],
    fault: 'Bouncing through a half-range. The stretch is where the growth is.',
  },
];

export const HOWTO_BY_ID = new Map(HOWTOS.map((h) => [h.exerciseId, h]));

/**
 * What each RPE means, in reps left in the tank.
 *
 * Lives here rather than in the explainer sheet because the logger's ruler
 * shows the same sentence under the value as you pick it. Two copies of this
 * would drift, and the one the user reads mid-set is the one that matters.
 *
 * It includes the half steps because the logger offers all nine values, and
 * every one it offers needs a sentence.
 */
export const RPE_SCALE: { rpe: number; left: string }[] = [
  { rpe: 6, left: 'Four or more left. A warm-up weight that happens to be heavy.' },
  { rpe: 6.5, left: 'Three or four reps left.' },
  { rpe: 7, left: 'Three reps left. Moving fast, feels comfortable.' },
  { rpe: 7.5, left: 'Between two and three reps left.' },
  { rpe: 8, left: 'Two reps left.' },
  { rpe: 8.5, left: 'Between one and two reps left.' },
  { rpe: 9, left: 'One rep left in the tank.' },
  { rpe: 9.5, left: 'Maybe one more. Certainly not two.' },
  { rpe: 10, left: 'Nothing left. One more rep was not happening.' },
];

export const RPE_VALUES = RPE_SCALE.map((entry) => entry.rpe);

export const RPE_MEANING = new Map(RPE_SCALE.map((entry) => [entry.rpe, entry.left]));

// ─────────────────────────────────────────────────────────────
// Routines
// ─────────────────────────────────────────────────────────────

export const ROUTINE_TEMPLATES: Routine[] = [
  {
    id: 'push',
    name: 'Push Day',
    source: 'template',
    phase: 'strength',
    estMinutes: 62,
    slots: [
      { exerciseId: 'barbell-bench-press', order: 0, sets: 4, reps: 8, targetWeightKg: 80, targetPct1RM: null, targetRpe: 7, supersetGroup: null },
      { exerciseId: 'overhead-press', order: 1, sets: 3, reps: 8, targetWeightKg: 45, targetPct1RM: null, targetRpe: 7, supersetGroup: null },
      { exerciseId: 'cable-fly', order: 2, sets: 3, reps: 12, targetWeightKg: 20, targetPct1RM: null, targetRpe: 8, supersetGroup: 'A' },
      { exerciseId: 'rope-extension', order: 3, sets: 3, reps: 12, targetWeightKg: 25, targetPct1RM: null, targetRpe: 8, supersetGroup: 'A' },
    ],
  },
  {
    id: 'pull',
    name: 'Pull Day',
    source: 'template',
    phase: 'strength',
    estMinutes: 66,
    slots: [
      { exerciseId: 'barbell-row', order: 0, sets: 4, reps: 8, targetWeightKg: 70, targetPct1RM: null, targetRpe: 7, supersetGroup: null },
      { exerciseId: 'lat-pulldown', order: 1, sets: 3, reps: 10, targetWeightKg: 60, targetPct1RM: null, targetRpe: 8, supersetGroup: null },
      { exerciseId: 'face-pull', order: 2, sets: 3, reps: 15, targetWeightKg: 20, targetPct1RM: null, targetRpe: 8, supersetGroup: 'A' },
      { exerciseId: 'hammer-curl', order: 3, sets: 3, reps: 12, targetWeightKg: 14, targetPct1RM: null, targetRpe: 8, supersetGroup: 'A' },
      { exerciseId: 'shrug', order: 4, sets: 3, reps: 12, targetWeightKg: 90, targetPct1RM: null, targetRpe: 8, supersetGroup: null },
    ],
  },
  {
    id: 'legs',
    name: 'Legs · Squat focus',
    source: 'template',
    phase: 'strength',
    estMinutes: 74,
    slots: [
      { exerciseId: 'back-squat', order: 0, sets: 5, reps: 5, targetWeightKg: 120, targetPct1RM: null, targetRpe: 8, supersetGroup: null },
      { exerciseId: 'romanian-deadlift', order: 1, sets: 3, reps: 8, targetWeightKg: 100, targetPct1RM: null, targetRpe: 7, supersetGroup: null },
      { exerciseId: 'leg-press', order: 2, sets: 3, reps: 12, targetWeightKg: 160, targetPct1RM: null, targetRpe: 8, supersetGroup: null },
      { exerciseId: 'calf-raise', order: 3, sets: 4, reps: 15, targetWeightKg: 80, targetPct1RM: null, targetRpe: 8, supersetGroup: null },
    ],
  },
  {
    id: 'legs-accessory',
    name: 'Legs · Accessory',
    source: 'template',
    phase: 'hypertrophy',
    estMinutes: 58,
    slots: [
      { exerciseId: 'leg-press', order: 0, sets: 4, reps: 12, targetWeightKg: 150, targetPct1RM: null, targetRpe: 8, supersetGroup: null },
      { exerciseId: 'romanian-deadlift', order: 1, sets: 4, reps: 10, targetWeightKg: 90, targetPct1RM: null, targetRpe: 8, supersetGroup: null },
      { exerciseId: 'calf-raise', order: 2, sets: 4, reps: 15, targetWeightKg: 80, targetPct1RM: null, targetRpe: 8, supersetGroup: null },
    ],
  },
  {
    id: 'wendler-a',
    name: 'Wendler 5/3/1 — Week A',
    source: 'template',
    phase: 'hypertrophy',
    estMinutes: 55,
    slots: [
      { exerciseId: 'back-squat', order: 0, sets: 3, reps: 5, targetWeightKg: null, targetPct1RM: 0.75, targetRpe: 8, supersetGroup: null },
      { exerciseId: 'barbell-bench-press', order: 1, sets: 3, reps: 5, targetWeightKg: null, targetPct1RM: 0.75, targetRpe: 8, supersetGroup: null },
      { exerciseId: 'deadlift', order: 2, sets: 3, reps: 5, targetWeightKg: null, targetPct1RM: 0.75, targetRpe: 8, supersetGroup: null },
      { exerciseId: 'overhead-press', order: 3, sets: 3, reps: 5, targetWeightKg: null, targetPct1RM: 0.75, targetRpe: 8, supersetGroup: null },
    ],
  },
  {
    id: 'gzclp',
    name: 'GZCLP Linear',
    source: 'template',
    phase: 'hypertrophy',
    estMinutes: 50,
    slots: [
      { exerciseId: 'back-squat', order: 0, sets: 5, reps: 3, targetWeightKg: null, targetPct1RM: 0.85, targetRpe: 8, supersetGroup: null },
      { exerciseId: 'barbell-bench-press', order: 1, sets: 3, reps: 10, targetWeightKg: null, targetPct1RM: 0.65, targetRpe: 8, supersetGroup: null },
      { exerciseId: 'barbell-row', order: 2, sets: 3, reps: 15, targetWeightKg: 50, targetPct1RM: null, targetRpe: 8, supersetGroup: null },
    ],
  },
  {
    id: 'meet-openers',
    name: 'Meet openers rehearsal',
    source: 'template',
    phase: 'peak',
    estMinutes: 45,
    slots: [
      { exerciseId: 'back-squat', order: 0, sets: 3, reps: 1, targetWeightKg: null, targetPct1RM: 0.9, targetRpe: 8, supersetGroup: null },
      { exerciseId: 'barbell-bench-press', order: 1, sets: 3, reps: 1, targetWeightKg: null, targetPct1RM: 0.9, targetRpe: 8, supersetGroup: null },
      { exerciseId: 'deadlift', order: 2, sets: 3, reps: 1, targetWeightKg: null, targetPct1RM: 0.9, targetRpe: 8, supersetGroup: null },
    ],
  },
];

export const TEMPLATE_BY_ID = new Map(ROUTINE_TEMPLATES.map((r) => [r.id, r]));

export const EXERCISE_SOURCES = [
  { name: 'Free Exercise DB', detail: '736 movements · names, muscles, equipment', status: 'BUNDLED' },
];
