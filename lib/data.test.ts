// The bundled movement library: what shipped, and the invariants a regenerated
// dataset must not break.
//
// These matter more than they look. `exerciseId` is a foreign key on every set
// rather than a name or a list position, so a duplicate or shifted id silently
// repoints the lifter's training history at a different movement, and nothing
// in the app would say so.

import { describe, expect, it } from 'vitest';
import { EXERCISES, EXERCISE_BY_ID, SEED_EXERCISES, HOWTOS } from './data';
import { INGESTED_EXERCISES } from './exercises.generated';

describe('the bundled library', () => {
  it('ships the full Free Exercise DB alongside the hand-written seeds', () => {
    expect(SEED_EXERCISES).toHaveLength(14);
    expect(INGESTED_EXERCISES.length).toBeGreaterThan(700);
    expect(EXERCISES.length).toBeGreaterThan(700);
  });

  it('has no duplicate ids', () => {
    const ids = EXERCISES.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('lets the seed win where an ingested id collides with it', () => {
    // Three real collisions in the current dataset. The seed carries a
    // hand-written common fault that Free Exercise DB has no field for, so
    // losing it to an import would be a downgrade.
    for (const id of ['romanian-deadlift', 'face-pull', 'leg-press']) {
      expect(INGESTED_EXERCISES.some((e) => e.id === id)).toBe(true);
      expect(EXERCISE_BY_ID.get(id)?.source).toBe('seed');
    }
    expect(EXERCISES.filter((e) => e.id === 'leg-press')).toHaveLength(1);
  });

  it('every entry records a licence and a source', () => {
    for (const exercise of EXERCISES) {
      expect(exercise.licence).toBeTruthy();
      expect(exercise.source).toBeTruthy();
    }
    // Free Exercise DB is Unlicense, not CC0 — both are public-domain
    // dedications, but the field records what was actually granted.
    expect(INGESTED_EXERCISES.every((e) => e.licence === 'Unlicense')).toBe(true);
    expect(INGESTED_EXERCISES.every((e) => e.source === 'free-exercise-db')).toBe(true);
  });

  it('keeps every chip label short enough to render', () => {
    // The logger chip does not truncate — an overlong label pushes the set
    // counter off the row. 15 is the ceiling the ingest script enforces.
    for (const exercise of EXERCISES) {
      expect(exercise.short.length).toBeLessThanOrEqual(15);
      expect(exercise.short.trim()).toBe(exercise.short);
      expect(exercise.short).not.toBe('');
    }
  });

  it('classifies every movement as compound or accessory', () => {
    // lib/adapt.ts reads `kind` to choose the weight step it adds after an easy
    // week. Anything unclassified would silently take the compound step.
    for (const exercise of EXERCISES) {
      expect(['compound', 'accessory']).toContain(exercise.kind);
    }
  });

  it('excludes cardio and stretching', () => {
    // Bompa tracks lifting, not cardio or mobility work.
    // Everything added to a session feeds session load, and a hamstring stretch
    // logged as three sets of ten produces a number that means nothing.
    expect(EXERCISES.some((e) => e.pattern === 'Cardio')).toBe(false);
    expect(EXERCISES.some((e) => e.pattern.startsWith('Stretch'))).toBe(false);
  });

  it('keeps a hand-written common fault on every seeded movement', () => {
    // The ingested entries have no fault — the dataset has no such field, and
    // inventing 736 of them would be fiction. The seeded 14 are the ones that do.
    for (const howTo of HOWTOS) {
      expect(howTo.fault).toBeTruthy();
      expect(SEED_EXERCISES.some((e) => e.id === howTo.exerciseId)).toBe(true);
    }
  });
});
