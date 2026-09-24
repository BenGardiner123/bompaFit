// Turns the Free Exercise DB dump into the two files the app ships.
//
//   node scripts/ingest-exercises.mjs <path-to-exercises.json>
//
// Source: https://github.com/yuhonas/free-exercise-db (dist/exercises.json).
// The raw dump is ~1MB and is deliberately not committed — it is an input, not
// a source file. Re-download it when you want to regenerate.
//
// Two outputs, because the data has two very different read patterns:
//
//   lib/exercises.generated.ts  the list. Read constantly — search, name lookup,
//                               and the compound/accessory test in lib/adapt.ts.
//                               Ships in the app bundle.
//   public/howtos.json          the cues. Read only when someone opens the sheet
//                               for one movement. Fetched on demand, and a plain
//                               file in public/ so the URL is stable enough for
//                               the service worker to precache it by name.
//
// Nothing here reads lib/data.ts. Collisions with the 14 seeded movements are
// resolved at runtime in lib/data.ts instead, so adding a seed can never leave
// this script silently out of date.

import { readFileSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

const SOURCE_URL = 'https://github.com/yuhonas/free-exercise-db';

// Unlicense, not CC0. Both are public-domain dedications and neither restricts
// use, but the licence is recorded exactly rather than approximated, because
// ingest is the only moment the answer is knowable.
const LICENCE = 'Unlicense';

const input = process.argv[2];
if (!input) {
  console.error('usage: node scripts/ingest-exercises.mjs <path-to-exercises.json>');
  process.exit(1);
}

/**
 * Categories that belong in a periodization-first strength tracker.
 *
 * Cardio is excluded because the app does not track it — the model is load-based and
 * lift-specific, so a rowing machine has nothing to contribute to it.
 *
 * Stretching is excluded on purpose. Everything added to a
 * session feeds session load and mean RPE, and a hamstring stretch logged as
 * three sets of ten produces numbers that are arithmetically fine and
 * physiologically meaningless. Mobility work is worth tracking one day, but as
 * its own kind of thing rather than disguised as a working set.
 *
 * Plyometrics stay: box jumps and med-ball throws are programmed inside strength
 * blocks and carry real load.
 */
const KEEP_CATEGORIES = new Set(['strength', 'powerlifting', 'olympic weightlifting', 'strongman', 'plyometrics']);

/** Display names for the dataset's equipment slugs. `null` is a real value in it. */
const EQUIPMENT = {
  barbell: 'Barbell',
  dumbbell: 'Dumbbell',
  cable: 'Cable',
  machine: 'Machine',
  'body only': 'Bodyweight',
  kettlebells: 'Kettlebell',
  bands: 'Bands',
  'medicine ball': 'Medicine ball',
  'exercise ball': 'Exercise ball',
  'foam roll': 'Foam roller',
  'e-z curl bar': 'EZ bar',
  other: 'Other',
};

// The dataset's anatomical names, in the voice the seeded 14 already use, so an
// ingested movement and a seeded one don't read as coming from two apps.
const MUSCLE = {
  quadriceps: 'Quads',
  abdominals: 'Abs',
  'middle back': 'Mid back',
  'lower back': 'Lower back',
  hamstrings: 'Hamstrings',
  shoulders: 'Shoulders',
  chest: 'Chest',
  triceps: 'Triceps',
  biceps: 'Biceps',
  lats: 'Lats',
  calves: 'Calves',
  forearms: 'Forearms',
  glutes: 'Glutes',
  traps: 'Traps',
  adductors: 'Adductors',
  abductors: 'Abductors',
  neck: 'Neck',
};

const muscleName = (slug) => MUSCLE[slug] ?? (slug ? slug[0].toUpperCase() + slug.slice(1) : '');

/**
 * Movement pattern, in the vocabulary the seeded 14 use.
 *
 * The dataset has no pattern field — only `force` (push/pull/static), which
 * cannot tell a bench press from an overhead press. Primary muscle plus force
 * recovers the distinction where it matters and falls back to the bare force
 * elsewhere. Vague beats wrong: this string is search text and one line in the
 * How-to sheet, and feeds no calculation anywhere.
 */
function patternFor(entry, kind) {
  // Stretching and cardio never reach here — see KEEP_CATEGORIES.
  if (entry.category === 'plyometrics') return 'Plyometric';

  const muscle = entry.primaryMuscles?.[0] ?? '';
  const force = entry.force;
  let base;

  if (force === 'static') base = 'Static hold';
  else if (force === 'push' && ['quadriceps', 'glutes', 'adductors', 'abductors'].includes(muscle)) base = 'Squat';
  else if (force === 'pull' && ['hamstrings', 'lower back'].includes(muscle)) base = 'Hinge';
  else if (force === 'push' && muscle === 'chest') base = 'Horizontal push';
  else if (force === 'push' && muscle === 'shoulders') base = 'Vertical push';
  else if (force === 'pull' && muscle === 'lats') base = 'Vertical pull';
  else if (force === 'pull' && ['middle back', 'traps'].includes(muscle)) base = 'Horizontal pull';
  else if (muscle === 'triceps') base = 'Elbow extension';
  else if (muscle === 'biceps' || muscle === 'forearms') base = 'Elbow flexion';
  else if (muscle === 'calves') base = 'Ankle extension';
  else if (muscle === 'abdominals') base = 'Trunk flexion';
  else if (force === 'push') base = 'Push';
  else if (force === 'pull') base = 'Pull';
  else base = 'General';

  // Matches the seed convention: 'Squat' vs 'Squat · accessory'.
  return kind === 'accessory' ? `${base} · accessory` : base;
}

/** Longest chip label that still leaves room for the set counter beside it. */
const SHORT_MAX = 15;

// Applied in order — 'Smith Machine' has to win before 'Machine' does.
const ABBREVIATIONS = [
  [/\bSmith Machine\b/gi, 'Smith'],
  [/\bMedicine Ball\b/gi, 'Med ball'],
  [/\bExercise Ball\b/gi, 'Ball'],
  [/\bBarbell\b/gi, 'BB'],
  [/\bDumbbell\b/gi, 'DB'],
  [/\bKettlebell\b/gi, 'KB'],
  [/\bMachine\b/gi, 'Mch'],
  [/\bCable\b/gi, 'Cbl'],
  [/\bExtensions?\b/gi, 'Ext'],
  [/\bAlternating\b/gi, 'Alt'],
  [/\b(Single|One)[- ]Arm\b/gi, '1-Arm'],
  [/\bTwo[- ]Arm\b/gi, '2-Arm'],
  [/\b(Single|One)[- ]Leg\b/gi, '1-Leg'],
  [/\bBodyweight\b/gi, 'BW'],
];

// A trailing prepositional phrase describes the setup, not the movement:
// '...Raise With Head On Bench' is still a raise. Note what is missing — 'over'
// would eat 'Bent Over Dumbbell Row' from the wrong end, and 'to' would turn
// 'Squat To Press' into 'Squat'.
const TRAILING_PHRASE = /\s+\b(with|behind|above|against|using|onto|on)\b.*$/i;

/**
 * Chip label for the logger. Deliberately dumb and deterministic — the seeded 14
 * have hand-written shorts ('OHP', 'RDL') and nothing derived will match that,
 * so the goal here is only "fits the chip, still recognisable".
 */
function shortFor(name) {
  // Names carry their variant after a dash — 'Bench Press - Medium Grip'. The
  // variant is what the search box is for; the chip only needs the movement.
  let label = name.split(' - ')[0].trim();
  for (const [pattern, replacement] of ABBREVIATIONS) label = label.replace(pattern, replacement);
  label = label.replace(/\s+/g, ' ').trim();

  if (label.length > SHORT_MAX) label = label.replace(TRAILING_PHRASE, '').trim() || label;
  if (label.length <= SHORT_MAX) return label;

  // Drop words from the FRONT, not the back. An exercise name puts its movement
  // at the end and stacks qualifiers ahead of it, so the tail is the half worth
  // keeping: 'Lying Close-Grip BB Triceps Ext' should read 'Triceps Ext', which
  // is the lift, not 'Lying', which is furniture.
  const words = label.split(' ');
  while (words.length > 1 && words.join(' ').length > SHORT_MAX) words.shift();
  const trimmed = words.join(' ');
  return trimmed.length <= SHORT_MAX ? trimmed : `${trimmed.slice(0, SHORT_MAX - 1)}…`;
}

const slugify = (name) =>
  name
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const raw = JSON.parse(readFileSync(input, 'utf8'));

const exercises = [];
const howTos = {};
const seenIds = new Set();
const skipped = [];

const dropped = { category: 0 };

for (const entry of raw) {
  if (!entry.name) {
    skipped.push('(unnamed entry)');
    continue;
  }

  if (!KEEP_CATEGORIES.has(entry.category)) {
    dropped.category += 1;
    continue;
  }

  const id = slugify(entry.name);
  // The dump has no slug collisions today, but it is someone else's data and a
  // duplicate id would silently repoint one movement's history at another.
  if (seenIds.has(id)) {
    skipped.push(`${entry.name} (duplicate id ${id})`);
    continue;
  }
  seenIds.add(id);

  // 87 entries record no mechanic, most of them stretches and cardio. Defaulting
  // to accessory is the cautious read: lib/adapt.ts adds a smaller weight step to
  // an accessory, so a wrong guess under-loads rather than over-loads.
  const kind = entry.mechanic === 'compound' ? 'compound' : 'accessory';
  const primary = entry.primaryMuscles?.[0] ?? '';

  exercises.push({
    id,
    name: entry.name,
    short: shortFor(entry.name),
    muscle: `${muscleName(primary) || 'General'} · ${kind === 'compound' ? 'Compound' : 'Accessory'}`,
    pattern: patternFor(entry, kind),
    equipment: EQUIPMENT[entry.equipment] ?? 'Other',
    kind,
    source: 'free-exercise-db',
    licence: LICENCE,
  });

  const steps = (entry.instructions ?? []).map((step) => step.trim()).filter(Boolean);
  if (steps.length === 0) continue;

  const secondary = (entry.secondaryMuscles ?? []).map(muscleName).filter(Boolean);
  howTos[id] = {
    muscles: `Primary: ${muscleName(primary) || '—'} · Secondary: ${secondary.length ? secondary.join(', ') : '—'}`,
    steps,
    // No `fault`. The dataset carries execution steps and nothing about what
    // people get wrong, and inventing one for 873 movements would be fiction.
    // HowTo.fault is optional for exactly this reason — the sheet omits the
    // block rather than printing a guess.
  };
}

const header = `// GENERATED FILE — do not edit by hand.
//
// Produced by scripts/ingest-exercises.mjs from Free Exercise DB:
//   ${SOURCE_URL}
//
// ${exercises.length} movements, all ${LICENCE} (public domain). Cues for these live in
// public/howtos.json and load on demand — see lib/howtos.ts.
//
// Ids clashing with a seeded movement are dropped in lib/data.ts, not here, so
// this file never needs regenerating just because a seed was added.

import type { Exercise } from './types';

export const INGESTED_EXERCISES: Exercise[] = [
`;

// Emitted as hand-written-looking literals rather than JSON, because the repo
// writes bare keys and single quotes and lint would otherwise rewrite every line.
// Escaping is explicit: 'Farmer's Walk' is a real name in this dataset, and a
// naive double-to-single quote swap turns it into a syntax error.
const quote = (value) => `'${String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

const body = exercises
  .map(
    (e) =>
      `  { id: ${quote(e.id)}, name: ${quote(e.name)}, short: ${quote(e.short)}, muscle: ${quote(e.muscle)},` +
      ` pattern: ${quote(e.pattern)}, equipment: ${quote(e.equipment)}, kind: ${quote(e.kind)},` +
      ` source: ${quote(e.source)}, licence: ${quote(e.licence)} },`,
  )
  .join('\n');

writeFileSync('lib/exercises.generated.ts', `${header}${body}\n];\n`);
writeFileSync('public/howtos.json', JSON.stringify(howTos));

const listJson = JSON.stringify(exercises);
const howToJson = JSON.stringify(howTos);
const kb = (bytes) => `${(bytes / 1024).toFixed(1)}KB`;

console.log(`read     ${raw.length} entries from ${input}`);
console.log(`dropped  ${dropped.category} outside ${[...KEEP_CATEGORIES].join('/')}`);
console.log(`wrote    lib/exercises.generated.ts   ${exercises.length} movements`);
console.log(`wrote    public/howtos.json           ${Object.keys(howTos).length} how-tos`);
if (skipped.length) console.log(`skipped  ${skipped.length}: ${skipped.join(', ')}`);
console.log('');
console.log(`list     ${kb(Buffer.byteLength(listJson))} raw, ${kb(gzipSync(listJson).length)} gzipped   ships in the bundle`);
console.log(`how-tos  ${kb(Buffer.byteLength(howToJson))} raw, ${kb(gzipSync(howToJson).length)} gzipped   fetched on demand`);
