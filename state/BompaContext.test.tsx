// @vitest-environment jsdom

// Integration tests over the real provider, the real Dexie driver (via
// fake-indexeddb) and the real maths. Nothing here is mocked, so these cover the
// wiring that unit tests can't: hydration, setup, and the write path.

import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ReactNode } from 'react';
import { db } from '@/lib/db';
import { PROVIDER_ENTRIES } from '@/lib/content/providers';
import type { ContentProvider } from '@/lib/content/provider';
import { dateKey, toKg } from '@/lib/calc';
import { planWeekStart, weekIsUserModified } from '@/lib/schedule';
import type { Routine } from '@/lib/types';
import { BompaProvider, TRAIN_HINTS_SESSIONS, useBompa, type BompaValue } from './BompaContext';
import Page from '@/app/page';
import { EditSetSheet } from '@/components/screens/EditSetSheet';
import { FinishSummary } from '@/components/screens/FinishSummary';

function wrapper({ children }: { children: ReactNode }) {
  return <BompaProvider>{children}</BompaProvider>;
}

async function mount() {
  const view = renderHook(() => useBompa(), { wrapper });
  await waitFor(() => expect(view.result.current.s.hydrated).toBe(true), { timeout: 4000 });
  return view;
}

/** A minimal user routine, since nothing is seeded into a plan any more. */
const PUSH: Routine = {
  id: 'my-push',
  name: 'My Push Day',
  source: 'user',
  phase: 'strength',
  estMinutes: 50,
  slots: [
    { exerciseId: 'barbell-bench-press', order: 0, sets: 4, reps: 8, targetWeightKg: 80, targetPct1RM: null, targetRpe: 7, supersetGroup: null },
    { exerciseId: 'overhead-press', order: 1, sets: 3, reps: 8, targetWeightKg: 45, targetPct1RM: null, targetRpe: 7, supersetGroup: null },
  ],
};

const PULL: Routine = {
  id: 'my-pull',
  name: 'My Pull Day',
  source: 'user',
  phase: 'strength',
  estMinutes: 50,
  slots: [
    { exerciseId: 'barbell-row', order: 0, sets: 4, reps: 8, targetWeightKg: 70, targetPct1RM: null, targetRpe: 7, supersetGroup: null },
  ],
};

/**
 * Put the app in the state setup would leave it in: routines plus a plan.
 * Takes anything with a live `result` so a destructured `{ result }` works too.
 */
async function withPlan(view: { result: { current: BompaValue } }, sessionsPerWeek = 4) {
  await act(async () => {
    await view.result.current.saveRoutine(PUSH);
    await view.result.current.saveRoutine(PULL);
  });
  await act(async () => {
    await view.result.current.createPlanFromSetup({
      rotation: [PUSH.id, PULL.id],
      sessionsPerWeek,
      phase: 'strength',
      weeks: 4,
    });
  });
  await waitFor(() => expect(view.result.current.plan).not.toBeNull());
}

beforeEach(async () => {
  await db.delete();
  await db.open();
});

afterEach(async () => {
  // Unmount every provider first. A live one keeps its one-second ticker running
  // and keeps flushing session time, and those fire-and-forget writes would land
  // in the *next* test's database.
  cleanup();
  await db.close();
});

// ─────────────────────────────────────────────────────────────

describe('first launch', () => {
  it('seeds the templates, but no plan', async () => {
    const { result } = await mount();

    expect(await db.routines.count()).toBeGreaterThan(0);
    // Nothing is scheduled until setup says so.
    expect(await db.plans.count()).toBe(0);
    expect(await db.blocks.count()).toBe(0);
    expect(await db.plannedSessions.count()).toBe(0);
    expect(result.current.plan).toBeNull();
  });

  it('the bundled library is served from the app, never copied into storage', async () => {
    const { result } = await mount();

    // The whole library is on offer...
    expect(result.current.exercises.length).toBeGreaterThan(700);
    expect(result.current.exerciseById.get('back-squat')?.name).toBe('Back Squat');

    // ...and none of it is in IndexedDB. That table is for movements the user
    // invents; shipped content versions with the app instead, so it can never go
    // stale behind a `count() === 0` seed guard and never bloats a backup file.
    expect(await db.exercises.count()).toBe(0);
  });

  it('seeds no routine the user could train by accident', async () => {
    const { result } = await mount();
    // Templates exist, but nothing is in the trainable list until it is copied.
    expect(result.current.templates.length).toBeGreaterThan(0);
    expect(result.current.routines).toHaveLength(0);
  });

  it('asks for setup on a database with no plan', async () => {
    const { result } = await mount();
    expect(result.current.needsSetup).toBe(true);
  });

  it('says nothing on the dashboard when there is nothing to say', async () => {
    const { result } = await mount();
    expect(result.current.insights).toHaveLength(0);
    expect(result.current.scores.historyDays).toBe(0);
  });

  it('hides the peak prediction until there is enough history', async () => {
    const { result } = await mount();
    expect(result.current.peakWindow).toBeNull();
  });
});

describe('setup', () => {
  it('writes exactly one plan and its slots when it completes', async () => {
    const view = await mount();
    await withPlan(view);

    expect(await db.plans.count()).toBe(1);
    expect(await db.blocks.count()).toBe(1);
    // 4 working weeks at 4 sessions, plus a deload week at 3.
    expect(await db.plannedSessions.count()).toBe(4 * 4 + 3);
    expect(view.result.current.needsSetup).toBe(false);
  });

  it('cycles the rotation through the week', async () => {
    const view = await mount();
    await withPlan(view);
    expect(view.result.current.thisWeekSlots.map((p) => p.routineId)).toEqual([
      'my-push',
      'my-pull',
      'my-push',
      'my-pull',
    ]);
  });

  it('skipping leaves the tables empty and does not ask again', async () => {
    const first = await mount();
    await act(async () => first.result.current.skipSetup());
    await waitFor(() => expect(first.result.current.needsSetup).toBe(false));
    expect(await db.plans.count()).toBe(0);
    first.unmount();

    const second = await mount();
    expect(second.result.current.needsSetup).toBe(false);
    expect(second.result.current.plan).toBeNull();
  });

  it('re-running replaces the plan rather than stacking another', async () => {
    const view = await mount();
    await withPlan(view, 4);
    await withPlan(view, 3);

    expect(await db.plans.count()).toBe(1);
    expect(await db.plannedSessions.count()).toBe(4 * 3 + 2);
    expect(view.result.current.plan?.sessionsPerWeek).toBe(3);
  });

  it('a starting max set in setup is the same value Tools reads', async () => {
    const view = await mount();
    await act(async () => view.result.current.setStartingMax('back-squat', 160));
    await waitFor(() => expect(view.result.current.startingMaxes['back-squat']).toBe(160));
    expect(view.result.current.e1rmByExercise['back-squat']).toBe(160);
  });
});

describe('logging', () => {
  it('starts a session against a routine and loads its first lift', async () => {
    const { result } = await mount();
    await withPlan({ result });

    await act(async () => {
      result.current.startSession('my-push');
    });
    await waitFor(() => expect(result.current.openSession).not.toBeNull());

    expect(result.current.s.tab).toBe('log');
    expect(result.current.openSession?.routineName).toBe('My Push Day');
    expect(result.current.openSession?.exerciseIds).toEqual(['barbell-bench-press', 'overhead-press']);
    expect(result.current.activeExerciseId).toBe('barbell-bench-press');
    expect(result.current.s.entryWeight).toBe(80);
    expect(result.current.s.entryReps).toBe(8);
  });

  it('substitutes the programmed RPE when none is picked', async () => {
    const { result } = await mount();
    await withPlan({ result });
    await act(async () => result.current.startSession('my-push'));
    await waitFor(() => expect(result.current.openSession).not.toBeNull());

    await act(async () => result.current.logSet());
    await waitFor(() => expect(result.current.sets).toHaveLength(1));

    const row = result.current.sets[0]!;
    expect(row.weightKg).toBe(80);
    expect(row.reps).toBe(8);
    expect(row.rpe).toBe(7);
    expect(row.rpeEstimated).toBe(true);
    expect(row.type).toBe('working');
    expect(row.exerciseId).toBe('barbell-bench-press');
  });

  it('stores kilograms even when the display is in pounds', async () => {
    const { result } = await mount();
    await withPlan({ result });
    await act(async () => result.current.startSession('my-push'));
    await waitFor(() => expect(result.current.openSession).not.toBeNull());

    await act(async () => result.current.setUnit('lb'));
    await act(async () => result.current.patch({ entryWeight: 176 }));
    await act(async () => result.current.logSet());
    await waitFor(() => expect(result.current.sets).toHaveLength(1));

    expect(result.current.sets[0]!.weightKg).toBe(79.83);
    expect(result.current.sets[0]!.weightKg).not.toBe(176);
  });

  it('converts a pending entry once when units change, and touches nothing stored', async () => {
    const { result } = await mount();
    await withPlan({ result });
    await act(async () => result.current.startSession('my-push'));
    await waitFor(() => expect(result.current.openSession).not.toBeNull());

    await act(async () => result.current.logSet());
    await waitFor(() => expect(result.current.sets).toHaveLength(1));
    const storedBefore = result.current.sets[0]!.weightKg;

    await act(async () => result.current.setUnit('lb'));
    expect(result.current.s.entryWeight).toBe(176.5); // 80 kg on the nose
    expect(result.current.sets[0]!.weightKg).toBe(storedBefore);

    // Round-tripping the unit must not drift the entry either.
    await act(async () => result.current.setUnit('kg'));
    expect(result.current.s.entryWeight).toBe(toKg(176.5, 'lb'));
  });

  it('starts the rest timer from a wall-clock end time', async () => {
    const { result } = await mount();
    await withPlan({ result });
    await act(async () => result.current.startSession('my-push'));
    await waitFor(() => expect(result.current.openSession).not.toBeNull());

    await act(async () => result.current.logSet());
    await waitFor(() => expect(result.current.sets).toHaveLength(1));

    expect(result.current.restActive).toBe(true);
    expect(result.current.restRemainingMs).toBeGreaterThan(148_000);
    expect(result.current.restRemainingMs).toBeLessThanOrEqual(150_000);
  });

  it('skipping rest returns the idle row', async () => {
    const { result } = await mount();
    await withPlan({ result });
    await act(async () => result.current.startSession('my-push'));
    await waitFor(() => expect(result.current.openSession).not.toBeNull());
    await act(async () => result.current.logSet());
    await waitFor(() => expect(result.current.restActive).toBe(true));

    await act(async () => result.current.skipRest());
    expect(result.current.restActive).toBe(false);
  });

  it('warm-ups stay out of the working-set count, and cost less in the model', async () => {
    const { result } = await mount();
    await withPlan({ result });
    await act(async () => result.current.startSession('my-push'));
    await waitFor(() => expect(result.current.openSession).not.toBeNull());

    await act(async () => result.current.patch({ entryType: 'warmup' }));
    await act(async () => result.current.logSet());
    await act(async () => result.current.patch({ entryType: 'warmup' }));
    await act(async () => result.current.logSet());
    await act(async () => result.current.logSet()); // entryType resets to working
    await waitFor(() => expect(result.current.sets).toHaveLength(3));

    const working = result.current.sessionSets.filter((row) => row.type !== 'warmup');
    expect(working).toHaveLength(1);

    // The two warm-ups went in at the same 80kg as the working set, because the
    // entry weight does not move when the type does. So each is measured at
    // full proximity and still costs only the WARMUP_SHARE fraction:
    //   working  80 * 8 * 0.7               = 448
    //   warm-up  80 * 8 * 1 * 0.3  x2       = 384
    expect(result.current.loads[0]?.load).toBeCloseTo(448 + 384, 6);
  });

  it('numbers sets per exercise, not per session', async () => {
    const { result } = await mount();
    await withPlan({ result });
    await act(async () => result.current.startSession('my-push'));
    await waitFor(() => expect(result.current.openSession).not.toBeNull());

    await act(async () => result.current.logSet());
    await act(async () => result.current.logSet());
    await act(async () => result.current.pickExercise(1));
    await act(async () => result.current.logSet());
    await waitFor(() => expect(result.current.sets).toHaveLength(3));

    const ohp = result.current.sets.filter((row) => row.exerciseId === 'overhead-press');
    expect(ohp).toHaveLength(1);
    expect(ohp[0]!.setNo).toBe(1);
    expect(ohp[0]!.weightKg).toBe(45); // loaded that lift's own prescription
  });

  it('removes a mis-tapped set', async () => {
    const { result } = await mount();
    await withPlan({ result });
    await act(async () => result.current.startSession('my-push'));
    await waitFor(() => expect(result.current.openSession).not.toBeNull());
    await act(async () => result.current.logSet());
    await waitFor(() => expect(result.current.sets).toHaveLength(1));

    await act(async () => result.current.deleteSet(result.current.sets[0]!));
    await waitFor(() => expect(result.current.sets).toHaveLength(0));
  });
});

// ─────────────────────────────────────────────────────────────

describe('finishing and reloading', () => {
  it('a reload mid-session restores the session and its sets', async () => {
    const first = await mount();
    await withPlan(first);
    await act(async () => first.result.current.startSession('my-push'));
    await waitFor(() => expect(first.result.current.openSession).not.toBeNull());
    await act(async () => first.result.current.logSet());
    await act(async () => first.result.current.logSet());
    await waitFor(() => expect(first.result.current.sets).toHaveLength(2));
    first.unmount();

    const second = await mount();
    await waitFor(() => expect(second.result.current.openSession).not.toBeNull());
    expect(second.result.current.sets).toHaveLength(2);
    expect(second.result.current.openSession?.routineName).toBe('My Push Day');
  });

  it('finishing closes the session and marks the day done', async () => {
    const { result } = await mount();
    await withPlan({ result });
    await act(async () => result.current.startSession('my-push'));
    await waitFor(() => expect(result.current.openSession).not.toBeNull());
    await act(async () => result.current.logSet());
    await waitFor(() => expect(result.current.sets).toHaveLength(1));

    const plannedId = result.current.openSession?.plannedSessionId;
    const sessionId = result.current.openSession?.id;
    await act(async () => result.current.finishSession());

    expect(result.current.openSession).toBeNull();
    expect(result.current.s.tab).toBe('home');
    expect(result.current.restActive).toBe(false);

    await waitFor(async () => {
      expect((await db.sessions.get(sessionId!))?.finishedAt).toBeDefined();
    });

    if (plannedId !== undefined) {
      await waitFor(async () => {
        expect((await db.plannedSessions.get(plannedId))?.status).toBe('done');
      });
    }
  });

  it('closes a session left open overnight, backdated to the last set', async () => {
    const started = Date.now() - 9 * 3600_000;
    const lastSet = Date.now() - 8 * 3600_000;
    const staleId = await db.sessions.add({
      date: dateKey(started),
      routineId: 'push',
      routineName: 'My Push Day',
      exerciseIds: ['barbell-bench-press'],
      startedAt: started,
      lastSetAt: lastSet,
      elapsedMs: 3600_000,
    });

    const { result } = await mount();
    await withPlan({ result });

    expect(result.current.openSession).toBeNull();
    // The close is a fire-and-forget write, so give it a beat to land.
    await waitFor(async () => {
      const stored = await db.sessions.get(staleId);
      expect(stored?.autoClosed).toBe(true);
      expect(stored?.finishedAt).toBe(lastSet);
    });
  });

  it('leaves a session from an hour ago open', async () => {
    const at = Date.now() - 3600_000;
    await db.sessions.add({
      date: dateKey(at),
      routineId: 'push',
      routineName: 'My Push Day',
      exerciseIds: ['barbell-bench-press'],
      startedAt: at,
      lastSetAt: at,
      elapsedMs: 600_000,
    });

    const { result } = await mount();
    await withPlan({ result });
    await waitFor(() => expect(result.current.openSession).not.toBeNull());
    expect(result.current.openSession?.autoClosed).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────

describe('settings', () => {
  it('unit choice persists and never rewrites stored weights', async () => {
    const first = await mount();
    await withPlan(first);
    await act(async () => first.result.current.startSession('my-push'));
    await waitFor(() => expect(first.result.current.openSession).not.toBeNull());
    await act(async () => first.result.current.logSet());
    await waitFor(() => expect(first.result.current.sets).toHaveLength(1));
    await act(async () => first.result.current.setUnit('lb'));
    first.unmount();

    const second = await mount();
    expect(second.result.current.s.unit).toBe('lb');
    expect(second.result.current.sets[0]!.weightKg).toBe(80);
    // Pound mode gets pound-shaped steps rather than a converted 2.5kg.
    expect(second.result.current.s.step).toBe(5);
  });

  it('persists the rest preset', async () => {
    const first = await mount();
    await act(async () => first.result.current.setRestPreset(240));
    first.unmount();

    const second = await mount();
    expect(second.result.current.s.restPresetSec).toBe(240);
  });
});

// ─────────────────────────────────────────────────────────────

describe('starting maxes', () => {
  it('prices a percentage-based routine off a declared max', async () => {
    const { result } = await mount();
    await withPlan({ result });
    // A routine written as a percentage of 1RM rather than a fixed weight.
    await act(async () =>
      result.current.saveRoutine({
        id: 'my-pct',
        name: 'Percent day',
        source: 'user',
        phase: 'strength',
        estMinutes: 40,
        slots: [
          { exerciseId: 'back-squat', order: 0, sets: 3, reps: 5, targetWeightKg: null, targetPct1RM: 0.75, targetRpe: 8, supersetGroup: null },
        ],
      }),
    );

    // Without a max there is nothing to prescribe.
    await act(async () => result.current.startSession('my-pct'));
    await waitFor(() => expect(result.current.openSession).not.toBeNull());
    expect(result.current.activeTarget?.weightKg).toBe(0);

    await act(async () => result.current.setStartingMax('back-squat', 160));
    await waitFor(() => expect(result.current.activeTarget?.weightKg).toBe(120)); // 75% of 160
  });

  it('lets a logged set overtake the declared max', async () => {
    const { result } = await mount();
    await withPlan({ result });
    await act(async () => result.current.setStartingMax('barbell-bench-press', 100));
    await waitFor(() => expect(result.current.e1rmByExercise['barbell-bench-press']).toBe(100));

    await act(async () => result.current.startSession('my-push'));
    await waitFor(() => expect(result.current.openSession).not.toBeNull());
    await act(async () => result.current.patch({ entryWeight: 110, entryReps: 5 }));
    await act(async () => result.current.logSet());

    // 110 x 5 estimates to 128.3, which beats the declared 100.
    await waitFor(() => expect(result.current.e1rmByExercise['barbell-bench-press']).toBeCloseTo(128.3, 1));
  });

  it('persists across a reload', async () => {
    const first = await mount();
    await act(async () => first.result.current.setStartingMax('deadlift', 200));
    await waitFor(() => expect(first.result.current.startingMaxes.deadlift).toBe(200));
    first.unmount();

    const second = await mount();
    expect(second.result.current.startingMaxes.deadlift).toBe(200);
  });
});

describe('bodyweight', () => {
  const CALISTHENICS: Routine = {
    id: 'my-calisthenics',
    name: 'Calisthenics',
    source: 'user',
    phase: 'hypertrophy',
    estMinutes: 30,
    slots: [
      { exerciseId: 'pullups', order: 0, sets: 3, reps: 10, targetWeightKg: 0, targetPct1RM: null, targetRpe: 8, supersetGroup: null },
    ],
  };

  it('is empty until entered, then persists as kilograms across a reload', async () => {
    const first = await mount();
    expect(first.result.current.bodyweightKg).toBeNull();
    await act(async () => first.result.current.setBodyweightKg(80));
    await waitFor(async () => expect((await db.settings.get('bodyweightKg'))?.value).toBe(80));
    first.unmount();

    const second = await mount();
    expect(second.result.current.bodyweightKg).toBe(80);
    await act(async () => second.result.current.setBodyweightKg(null));
    expect(second.result.current.bodyweightKg).toBeNull();
  });

  it('knows library bodyweight lifts, and remembers the ones marked by hand until unmarked', async () => {
    const first = await mount();
    expect(first.result.current.isBodyweightLift('pullups')).toBe(true);
    expect(first.result.current.isBodyweightLift('hyperextensions-back-extensions')).toBe(false);
    expect(first.result.current.isBodyweightLift(null)).toBe(false);

    await act(async () => first.result.current.markBodyweightLift('hyperextensions-back-extensions', true));
    expect(first.result.current.isBodyweightLift('hyperextensions-back-extensions')).toBe(true);
    await waitFor(async () =>
      expect((await db.settings.get('bodyweightLifts'))?.value).toEqual(['hyperextensions-back-extensions']),
    );
    first.unmount();

    const second = await mount();
    expect(second.result.current.isBodyweightLift('hyperextensions-back-extensions')).toBe(true);
    await act(async () => second.result.current.markBodyweightLift('hyperextensions-back-extensions', false));
    expect(second.result.current.isBodyweightLift('hyperextensions-back-extensions')).toBe(false);
    // A library lift has no mark to take off.
    await act(async () => second.result.current.markBodyweightLift('pullups', false));
    expect(second.result.current.isBodyweightLift('pullups')).toBe(true);
  });

  it('turns logged pull-ups into load, and prices the planned slot the same way', async () => {
    const view = await mount();
    const { result } = view;
    await act(async () => result.current.saveRoutine(CALISTHENICS));
    await act(async () =>
      result.current.createPlanFromSetup({ rotation: [CALISTHENICS.id], sessionsPerWeek: 1, phase: 'hypertrophy', weeks: 4 }),
    );
    await waitFor(() => expect(result.current.plan).not.toBeNull());

    await act(async () => result.current.startSession(CALISTHENICS.id));
    await waitFor(() => expect(result.current.openSession).not.toBeNull());
    expect(result.current.s.entryWeight).toBe(0);
    for (let i = 0; i < 3; i++) await act(async () => result.current.logSet());
    await act(async () => result.current.finishSession());
    await waitFor(() => expect(result.current.sets).toHaveLength(3));

    // With no bodyweight, three sets of pull-ups weigh nothing.
    expect(result.current.loads).toHaveLength(0);
    expect(result.current.scores.fatigue).toBe(0);

    await act(async () => result.current.setBodyweightKg(80));
    // 3 × 10 × 80 × 0.8 = 1920, whatever volume the week was planned at.
    await waitFor(() => expect(result.current.loads).toHaveLength(1));
    expect(result.current.loads[0]!.load).toBeCloseTo(1920, 6);
    expect(result.current.scores.fatigue).toBeGreaterThan(0);
    expect(result.current.budget.budget).toBeGreaterThan(0);
  });
});

describe('adding an unplanned lift', () => {
  it('appends it to this session without touching the routine', async () => {
    const { result } = await mount();
    await withPlan({ result });
    await act(async () => result.current.startSession('my-push'));
    await waitFor(() => expect(result.current.openSession).not.toBeNull());

    await act(async () => result.current.addExerciseToSession('hammer-curl'));
    await waitFor(() => expect(result.current.openSession?.exerciseIds).toContain('hammer-curl'));

    expect(result.current.activeExerciseId).toBe('hammer-curl');
    // The routine itself is unchanged — this was today, not a programme edit.
    expect(result.current.activeRoutine?.slots.map((slot) => slot.exerciseId)).not.toContain('hammer-curl');

    await act(async () => result.current.logSet());
    await waitFor(() => expect(result.current.sets).toHaveLength(1));
    expect(result.current.sets[0]!.exerciseId).toBe('hammer-curl');
  });

  it('jumps to a lift that is already in the session rather than duplicating it', async () => {
    const { result } = await mount();
    await withPlan({ result });
    await act(async () => result.current.startSession('my-push'));
    await waitFor(() => expect(result.current.openSession).not.toBeNull());

    await act(async () => result.current.addExerciseToSession('overhead-press'));
    expect(result.current.openSession?.exerciseIds.filter((id) => id === 'overhead-press')).toHaveLength(1);
    expect(result.current.activeExerciseId).toBe('overhead-press');
  });
});

describe('moving, dropping and swapping', () => {
  it('reordering leaves the week budget unchanged', async () => {
    const view = await mount();
    await withPlan(view);
    const { result } = view;

    const before = result.current.budget.budget;
    const first = result.current.thisWeekSlots[0]!;
    await act(async () => {
      await result.current.moveSession(first.id!, 2);
    });

    await waitFor(() => expect(result.current.thisWeekSlots[2]?.id).toBe(first.id));
    // Dense, no gaps, no repeats.
    expect(result.current.thisWeekSlots.map((p) => p.slotIndex)).toEqual([0, 1, 2, 3]);
    expect(result.current.budget.budget).toBeCloseTo(before, 5);
  });

  it('a move is recorded and can be undone', async () => {
    const view = await mount();
    await withPlan(view);
    const { result } = view;

    const first = result.current.thisWeekSlots[0]!;
    await act(async () => {
      await result.current.moveSession(first.id!, 2);
    });

    const adjustment = await waitFor(() => {
      const found = result.current.adjustments.find((a) => a.rule === 'user-reschedule');
      expect(found).toBeDefined();
      return found!;
    });

    await act(async () => result.current.undoAdjustment(adjustment));
    await waitFor(() => expect(result.current.thisWeekSlots[0]?.id).toBe(first.id));
  });

  it('a move offers Undo in its toast, and the Undo puts the week back', async () => {
    const view = await mount();
    await withPlan(view);
    const { result } = view;

    const first = result.current.thisWeekSlots[0]!;
    await act(async () => {
      await result.current.moveSession(first.id!, 2);
    });
    await waitFor(() => expect(result.current.thisWeekSlots[2]?.id).toBe(first.id));

    const toast = result.current.s.toast;
    expect(toast?.text).toMatch(/moved to position 3 this week/);
    expect(toast?.action?.label).toBe('Undo');

    await act(async () => toast!.action!.run());
    await waitFor(() => expect(result.current.thisWeekSlots[0]?.id).toBe(first.id));
    expect(result.current.adjustments.find((a) => a.rule === 'user-reschedule')?.revertedAt).toBeDefined();
  });

  it('a dismissed toast only takes itself down, never a newer one', async () => {
    const { result } = await mount();
    act(() => result.current.say('First'));
    const first = result.current.s.toast;
    act(() => result.current.say('Second'));
    act(() => result.current.dismissToast(first));
    expect(result.current.s.toast?.text).toBe('Second');
    act(() => result.current.dismissToast(result.current.s.toast));
    expect(result.current.s.toast).toBeNull();
  });

  it('dropping lowers the budget and is not a skip', async () => {
    const view = await mount();
    await withPlan(view);
    const { result } = view;

    const before = result.current.budget.budget;
    const target = result.current.thisWeekSlots[1]!;
    await act(async () => {
      await result.current.dropSlot(target.id!);
    });

    await waitFor(() => expect(result.current.thisWeekSlots).toHaveLength(3));
    expect(result.current.budget.budget).toBeLessThan(before);
    // A drop is a decision, not a miss — no skip, and nothing in the coaching log.
    expect(result.current.thisWeekSlots.some((p) => p.status === 'skip')).toBe(false);
    expect(result.current.adjustments).toHaveLength(0);
    expect(result.current.thisWeekSlots.map((p) => p.slotIndex)).toEqual([0, 1, 2]);
  });

  it("a drop's Undo puts the same row back where it was, in memory and on disk, still with no adjustment", async () => {
    const view = await mount();
    await withPlan(view);
    const { result } = view;

    const before = result.current.thisWeekSlots.map((p) => p.id);
    const budget = result.current.budget.budget;
    const target = result.current.thisWeekSlots[1]!;
    await act(async () => {
      await result.current.dropSlot(target.id!);
    });
    await waitFor(() => expect(result.current.thisWeekSlots).toHaveLength(3));

    const toast = result.current.s.toast;
    expect(toast?.action?.label).toBe('Undo');
    await act(async () => toast!.action!.run());

    await waitFor(() => expect(result.current.thisWeekSlots.map((p) => p.id)).toEqual(before));
    expect(result.current.budget.budget).toBeCloseTo(budget, 5);
    expect(weekIsUserModified(result.current.thisWeekSlots, result.current.currentWeek)).toBe(false);
    expect(result.current.adjustments).toHaveLength(0);

    await waitFor(async () => {
      const stored = await db.plannedSessions.where('weekStart').equals(result.current.currentWeek).sortBy('slotIndex');
      expect(stored.map((p) => p.id)).toEqual(before);
      expect(stored.some((p) => p.userModified === true)).toBe(false);
    });
  });

  it("a drop's Undo keeps the mark on a slot swapped since the drop", async () => {
    const view = await mount();
    await withPlan(view);
    const { result } = view;

    const target = result.current.thisWeekSlots[1]!;
    await act(async () => {
      await result.current.dropSlot(target.id!);
    });
    const undo = result.current.s.toast!.action!;
    const other = result.current.thisWeekSlots.find((p) => p.routineId === 'my-pull')!;
    await act(async () => {
      await result.current.swapSlotRoutine(other.id!, 'my-push');
    });
    await act(async () => undo.run());

    await waitFor(() => expect(result.current.thisWeekSlots.some((p) => p.id === target.id)).toBe(true));
    expect(result.current.thisWeekSlots.find((p) => p.id === other.id)?.userModified).toBe(true);
    expect(weekIsUserModified(result.current.thisWeekSlots, result.current.currentWeek)).toBe(true);
    await waitFor(async () => expect((await db.plannedSessions.get(other.id!))?.userModified).toBe(true));
  });

  it('swapping a routine re-prices the week', async () => {
    const view = await mount();
    await withPlan(view);
    const { result } = view;

    // my-pull is a single 4x8 lift; my-push is two lifts. Swapping one for the
    // other has to move the number.
    const pullSlot = result.current.thisWeekSlots.find((p) => p.routineId === 'my-pull')!;
    const before = result.current.budget.budget;
    await act(async () => {
      await result.current.swapSlotRoutine(pullSlot.id!, 'my-push');
    });

    await waitFor(() => expect(result.current.budget.budget).not.toBeCloseTo(before, 5));
    expect(result.current.thisWeekSlots.find((p) => p.id === pullSlot.id)?.routineId).toBe('my-push');
  });

  it('refuses to move or drop something already logged', async () => {
    const view = await mount();
    await withPlan(view);
    const { result } = view;

    await act(async () => result.current.startSession('my-push'));
    await waitFor(() => expect(result.current.openSession).not.toBeNull());
    await act(async () => result.current.logSet());
    await act(async () => result.current.finishSession());

    const done = await waitFor(() => {
      const found = result.current.thisWeekSlots.find((p) => p.status === 'done');
      expect(found).toBeDefined();
      return found!;
    });

    await act(async () => {
      await result.current.dropSlot(done.id!);
    });
    expect(result.current.thisWeekSlots.some((p) => p.id === done.id)).toBe(true);
  });

  it('moving a slot marks its week user-modified, on disk too', async () => {
    const view = await mount();
    await withPlan(view);
    const { result } = view;

    expect(weekIsUserModified(result.current.thisWeekSlots, result.current.currentWeek)).toBe(false);

    const first = result.current.thisWeekSlots[0]!;
    await act(async () => {
      await result.current.moveSession(first.id!, 2);
    });

    await waitFor(() =>
      expect(weekIsUserModified(result.current.thisWeekSlots, result.current.currentWeek)).toBe(true),
    );

    // The flag has to survive a reload, or the Plan screen forgets who
    // rearranged the week the moment the app is reopened.
    const stored = await db.plannedSessions.where('weekStart').equals(result.current.currentWeek).toArray();
    expect(stored.some((p) => p.userModified === true)).toBe(true);
  });

  it('swapping a routine marks the week too', async () => {
    const view = await mount();
    await withPlan(view);
    const { result } = view;

    const pullSlot = result.current.thisWeekSlots.find((p) => p.routineId === 'my-pull')!;
    await act(async () => {
      await result.current.swapSlotRoutine(pullSlot.id!, 'my-push');
    });

    await waitFor(() =>
      expect(weekIsUserModified(result.current.thisWeekSlots, result.current.currentWeek)).toBe(true),
    );
  });

  it('dropping marks the slots left standing', async () => {
    const view = await mount();
    await withPlan(view);
    const { result } = view;

    const target = result.current.thisWeekSlots[0]!;
    await act(async () => {
      await result.current.dropSlot(target.id!);
    });

    // The dropped row is gone, so the mark has to live on the survivors —
    // otherwise a drop would be the one rearrangement the week forgot.
    await waitFor(() =>
      expect(weekIsUserModified(result.current.thisWeekSlots, result.current.currentWeek)).toBe(true),
    );
  });

  it('Bompa adjusting a week does not mark it user-modified', async () => {
    const view = await mount();
    await withPlan(view);
    const { result } = view;

    // Nothing the user did — so whatever else is true of this week, it is not
    // theirs to have rearranged.
    expect(weekIsUserModified(result.current.thisWeekSlots, result.current.currentWeek)).toBe(false);
    expect(result.current.thisWeekSlots.every((p) => p.userModified === undefined)).toBe(true);
  });
});

describe("a block's own version of a workout", () => {
  it('records which workout and block it was made for, and reuses it instead of making another', async () => {
    const view = await mount();
    await withPlan(view);
    const { result } = view;
    const blockId = result.current.blocks[0]!.id!;
    const pushSlot = result.current.thisWeekSlots.find((p) => p.routineId === 'my-push')!;

    act(() => result.current.makeBlockVersion(pushSlot.id!));
    const version = await waitFor(() => {
      const found = result.current.routines.find((r) => r.name === 'My Push Day (Strength)');
      expect(found).toBeDefined();
      return found!;
    });
    expect(version.versionOf).toEqual({ routineId: 'my-push', blockId });
    expect(result.current.s.editingRoutineId).toBe(version.id);
    await waitFor(async () => expect((await db.routines.get(version.id))?.versionOf).toEqual({ routineId: 'my-push', blockId }));

    // Undo puts the slots back on the original but keeps the copy.
    const adjustment = await waitFor(() => {
      const found = result.current.adjustments.find((a) => a.narrative.startsWith('You made My Push Day (Strength)'));
      expect(found).toBeDefined();
      return found!;
    });
    await act(async () => result.current.undoAdjustment(adjustment));
    await waitFor(() => expect(result.current.thisWeekSlots.find((p) => p.id === pushSlot.id)?.routineId).toBe('my-push'));
    expect(result.current.routines.some((r) => r.id === version.id)).toBe(true);

    // Asking again goes back to that copy; the library does not grow.
    const count = result.current.routines.length;
    act(() => {
      result.current.patch({ editingRoutineId: null });
      result.current.makeBlockVersion(pushSlot.id!);
    });
    await waitFor(() => expect(result.current.thisWeekSlots.find((p) => p.id === pushSlot.id)?.routineId).toBe(version.id));
    expect(result.current.routines).toHaveLength(count);
    expect(result.current.s.editingRoutineId).toBe(version.id);
  });

  it('a duplicate of a version belongs to no block', async () => {
    const view = await mount();
    await withPlan(view);
    const { result } = view;
    const pushSlot = result.current.thisWeekSlots.find((p) => p.routineId === 'my-push')!;
    act(() => result.current.makeBlockVersion(pushSlot.id!));
    const version = await waitFor(() => {
      const found = result.current.routines.find((r) => r.versionOf);
      expect(found).toBeDefined();
      return found!;
    });
    await act(async () => {
      await result.current.duplicateRoutine(version.id);
    });
    const copy = await waitFor(() => {
      const found = result.current.routines.find((r) => r.name === `${version.name} copy`);
      expect(found).toBeDefined();
      return found!;
    });
    expect(copy.versionOf).toBeUndefined();
  });
});

describe('filling a slot versus adding to the week', () => {
  it('training a pending routine fills its slot, budget unchanged', async () => {
    const view = await mount();
    await withPlan(view);
    const { result } = view;

    const before = result.current.budget.budget;
    // my-pull sits at position 2, but doing it first is early, not extra.
    await act(async () => result.current.startSession('my-pull'));
    await waitFor(() => expect(result.current.openSession).not.toBeNull());

    const pullSlot = result.current.thisWeekSlots.find((p) => p.routineId === 'my-pull')!;
    expect(result.current.openSession?.plannedSessionId).toBe(pullSlot.id);
    expect(result.current.budget.budget).toBeCloseTo(before, 5);
  });

  it('a session with no pending slot consumes none', async () => {
    const view = await mount();
    await withPlan(view);
    const { result } = view;

    // Mark every my-push slot done so a further push session is genuinely extra.
    const pushSlots = result.current.thisWeekSlots.filter((p) => p.routineId === 'my-push');
    await act(async () => {
      for (const slot of pushSlots) await result.current.dropSlot(slot.id!);
    });
    await waitFor(() => expect(result.current.thisWeekSlots.every((p) => p.routineId !== 'my-push')).toBe(true));

    await act(async () => result.current.startSession('my-push'));
    await waitFor(() => expect(result.current.openSession).not.toBeNull());
    expect(result.current.openSession?.plannedSessionId).toBeUndefined();
  });

  it('training on any day is never reported as a miss', async () => {
    const view = await mount();
    await withPlan(view);
    const { result } = view;

    await act(async () => result.current.startSession('my-pull'));
    await waitFor(() => expect(result.current.openSession).not.toBeNull());
    await act(async () => result.current.logSet());
    await act(async () => result.current.finishSession());

    await waitFor(() => expect(result.current.thisWeekSlots.some((p) => p.status === 'done')).toBe(true));
    expect(result.current.thisWeekSlots.some((p) => p.status === 'skip')).toBe(false);
    expect(result.current.adjustments.some((a) => a.rule === 'missed-session-redistribute')).toBe(false);
  });

  it('stamps the day it was actually trained onto the slot it filled', async () => {
    const view = await mount();
    await withPlan(view);
    const { result } = view;

    await act(async () => result.current.startSession('my-push'));
    await waitFor(() => expect(result.current.openSession).not.toBeNull());
    await act(async () => result.current.logSet());
    await act(async () => result.current.finishSession());

    await waitFor(() => {
      const done = result.current.thisWeekSlots.find((p) => p.status === 'done');
      expect(done?.date).toBe(dateKey(Date.now()));
    });
  });
});

describe('the week anchor', () => {
  it('files slots under Monday regardless of the display setting', async () => {
    const view = await mount();
    await act(async () => view.result.current.setWeekStart('Sun'));
    await withPlan(view);

    // The disaster this prevents: with a Sunday-anchored key, the rollover sweep
    // compares Sunday keys against stored Monday keys, matches nothing, and marks
    // the entire current week skipped on first launch.
    expect(view.result.current.currentWeek).toBe(planWeekStart(dateKey(Date.now())));
    expect(view.result.current.thisWeekSlots.length).toBeGreaterThan(0);
    expect(view.result.current.thisWeekSlots.every((p) => p.status === 'plan')).toBe(true);
  });

  it('survives a reload with a Sunday-start setting without skipping the week', async () => {
    const first = await mount();
    await act(async () => first.result.current.setWeekStart('Sun'));
    await withPlan(first);
    first.unmount();

    const second = await mount();
    await waitFor(() => expect(second.result.current.thisWeekSlots.length).toBeGreaterThan(0));
    expect(second.result.current.thisWeekSlots.every((p) => p.status === 'plan')).toBe(true);
  });
});

describe('the routine builder', () => {
  it('a built routine is startable and drives the logger targets', async () => {
    const view = await mount();
    await withPlan(view);
    const { result } = view;

    await act(async () => result.current.startSession('my-push'));
    await waitFor(() => expect(result.current.openSession).not.toBeNull());
    expect(result.current.activeTarget?.weightKg).toBe(80);
    expect(result.current.activeTarget?.sets).toBe(4);
  });

  it('refuses to save a routine with no lifts', async () => {
    const { result } = await mount();
    await act(async () => {
      await result.current.saveRoutine({ ...PUSH, id: 'empty', name: 'Empty', slots: [] });
    });
    expect(result.current.routines.some((r) => r.id === 'empty')).toBe(false);
  });

  it('renaming leaves the name recorded on past sessions alone', async () => {
    const view = await mount();
    await withPlan(view);
    const { result } = view;

    await act(async () => result.current.startSession('my-push'));
    await waitFor(() => expect(result.current.openSession).not.toBeNull());
    await act(async () => result.current.logSet());
    await act(async () => result.current.finishSession());

    await act(async () => {
      await result.current.saveRoutine({ ...PUSH, name: 'Renamed entirely' });
    });

    // Session.routineName is a snapshot on purpose — history should read as it
    // was, not as the routine is now.
    const stored = await db.sessions.toArray();
    expect(stored[0]?.routineName).toBe('My Push Day');
  });

  it('deleting a routine leaves logged sets intact', async () => {
    const view = await mount();
    await withPlan(view);
    const { result } = view;

    await act(async () => result.current.startSession('my-push'));
    await waitFor(() => expect(result.current.openSession).not.toBeNull());
    await act(async () => result.current.logSet());
    await waitFor(() => expect(result.current.sets).toHaveLength(1));
    await act(async () => result.current.finishSession());

    await act(async () => {
      await result.current.deleteRoutine('my-push');
    });

    await waitFor(() => expect(result.current.routines.some((r) => r.id === 'my-push')).toBe(false));
    // Sets point at exerciseId, never at the routine.
    expect(await db.sets.count()).toBe(1);
    expect(result.current.setsByExercise.get('barbell-bench-press')).toHaveLength(1);
    // Its *pending* slots go, because a slot with no routine cannot be priced.
    // The completed one stays — that is history, and it happened.
    expect(result.current.thisWeekSlots.filter((p) => p.routineId === 'my-push' && p.status === 'plan')).toHaveLength(0);
    expect(result.current.thisWeekSlots.some((p) => p.routineId === 'my-push' && p.status === 'done')).toBe(true);
  });

  it('a copied template becomes an editable routine of your own', async () => {
    const { result } = await mount();
    const template = result.current.templates[0]!;

    await act(async () => {
      await result.current.copyTemplate(template.id);
    });

    await waitFor(() => expect(result.current.routines).toHaveLength(1));
    const copy = result.current.routines[0]!;
    expect(copy.source).toBe('user');
    expect(copy.slots).toEqual(template.slots);
    // The template itself is untouched, so "Wendler 5/3/1" still means that.
    expect(result.current.templates.find((t) => t.id === template.id)?.slots).toEqual(template.slots);
  });

  it('refuses to delete a bundled template', async () => {
    const { result } = await mount();
    const template = result.current.templates[0]!;
    await act(async () => {
      await result.current.deleteRoutine(template.id);
    });
    expect(result.current.templates.some((t) => t.id === template.id)).toBe(true);
  });
});

describe('the logger survives a deleted routine', () => {
  it('keeps an open session loggable off its own snapshot', async () => {
    const view = await mount();
    await withPlan(view);
    const { result } = view;

    await act(async () => result.current.startSession('my-push'));
    await waitFor(() => expect(result.current.openSession).not.toBeNull());

    await act(async () => {
      await result.current.deleteRoutine('my-push');
    });

    // The session is still open, still has its exercise list, and can still log.
    expect(result.current.openSession).not.toBeNull();
    expect(result.current.exerciseIds).toEqual(['barbell-bench-press', 'overhead-press']);
    await act(async () => result.current.logSet());
    await waitFor(() => expect(result.current.sets).toHaveLength(1));
    await act(async () => result.current.finishSession());
    expect(result.current.openSession).toBeNull();
  });
});

describe('the week budget', () => {
  it('trimming an over-budget week lands it back on plan', async () => {
    const view = await mount();
    await withPlan(view);
    const { result } = view;

    // Do the same workout twice: the first fills its slot, the second is extra.
    for (let i = 0; i < 2; i++) {
      await act(async () => result.current.startSession('my-push'));
      await waitFor(() => expect(result.current.openSession).not.toBeNull());
      await act(async () => result.current.patch({ entryWeight: 200, entryReps: 12 }));
      await act(async () => result.current.logSet());
      await act(async () => result.current.logSet());
      await act(async () => result.current.finishSession());
      await waitFor(() => expect(result.current.openSession).toBeNull());
    }

    await waitFor(() => expect(result.current.overBudget).toBe(true));
    expect(result.current.insights.some((i) => i.id === 'week-over-budget')).toBe(true);

    const before = result.current.budget.remaining.map((p) => p.volumeFactor);
    await act(async () => {
      await result.current.trimWeekToBudget();
    });

    await waitFor(() => {
      const after = result.current.budget.remaining.map((p) => p.volumeFactor);
      expect(after.length).toBe(before.length);
      after.forEach((v, i) => expect(v).toBeLessThan(before[i]!));
    });
    expect(result.current.adjustments.some((a) => a.rule === 'week-over-budget-trim')).toBe(true);
  });

  it('does not fire alongside the acute:chronic warning', async () => {
    const view = await mount();
    await withPlan(view);
    const { result } = view;
    // Both describe load running ahead of plan; the dashboard shows at most two
    // and ACWR is the longer, more reliable signal.
    const ids = result.current.insights.map((i) => i.id);
    expect(ids.includes('acwr-high') && ids.includes('week-over-budget')).toBe(false);
  });
});

describe('supersets', () => {
  /** Bench alone, then a Fly + Rope superset. */
  const SS: Routine = {
    id: 'my-ss',
    name: 'Superset day',
    source: 'user',
    phase: 'strength',
    estMinutes: 40,
    slots: [
      { exerciseId: 'barbell-bench-press', order: 0, sets: 3, reps: 8, targetWeightKg: 80, targetPct1RM: null, targetRpe: 7, supersetGroup: null },
      { exerciseId: 'cable-fly', order: 1, sets: 3, reps: 12, targetWeightKg: 20, targetPct1RM: null, targetRpe: 8, supersetGroup: 'A' },
      { exerciseId: 'rope-extension', order: 2, sets: 3, reps: 12, targetWeightKg: 25, targetPct1RM: null, targetRpe: 8, supersetGroup: 'A' },
    ],
  };

  async function inSupersetSession() {
    const view = await mount();
    await act(async () => {
      await view.result.current.saveRoutine(SS);
    });
    await act(async () => {
      await view.result.current.createPlanFromSetup({ rotation: [SS.id], sessionsPerWeek: 3, phase: 'strength', weeks: 4 });
    });
    await waitFor(() => expect(view.result.current.plan).not.toBeNull());
    await act(async () => view.result.current.startSession(SS.id));
    await waitFor(() => expect(view.result.current.openSession).not.toBeNull());
    return view;
  }

  /** Move the logger onto a named lift. */
  async function select(view: Awaited<ReturnType<typeof mount>>, exerciseId: string) {
    const index = view.result.current.exerciseIds.indexOf(exerciseId);
    await act(async () => view.result.current.pickExercise(index));
  }

  it('renders grouped lifts as a group', async () => {
    const view = await inSupersetSession();
    const { result } = view;

    expect(result.current.chips.map((c) => c.letter)).toEqual([null, 'A', 'A']);
    expect(result.current.chips.map((c) => c.startsGroup)).toEqual([false, true, false]);
    expect(result.current.chips.map((c) => c.endsGroup)).toEqual([false, false, true]);
  });

  it('knows which group the active lift belongs to', async () => {
    const view = await inSupersetSession();
    const { result } = view;

    // Bench is trained on its own.
    expect(result.current.activeGroup).toBeNull();

    await select(view, 'cable-fly');
    expect(result.current.activeGroup?.letter).toBe('A');
    expect(result.current.activeGroup?.slots.map((s) => s.exerciseId)).toEqual(['cable-fly', 'rope-extension']);
    expect(result.current.supersetLabel).toBe('Superset A · round 1 of 3');
  });

  it('advances to the next lift in the group and holds the rest timer', async () => {
    const view = await inSupersetSession();
    const { result } = view;

    await select(view, 'cable-fly');
    await act(async () => result.current.logSet());
    await waitFor(() => expect(result.current.activeExerciseId).toBe('rope-extension'));

    // The whole point of the format: the rest comes after the round, not
    // between its parts.
    expect(result.current.restActive).toBe(false);
    // And the entry fields carry the next lift's prescription, not the last one's.
    expect(result.current.s.entryWeight).toBe(25);
    expect(result.current.s.entryReps).toBe(12);
  });

  it('rests once the round is complete and returns to the top of the group', async () => {
    const view = await inSupersetSession();
    const { result } = view;

    await select(view, 'cable-fly');
    await act(async () => result.current.logSet());
    await waitFor(() => expect(result.current.activeExerciseId).toBe('rope-extension'));
    await act(async () => result.current.logSet());

    await waitFor(() => expect(result.current.restActive).toBe(true));
    // Back to the first lift so the sequence reads the same way every round.
    expect(result.current.activeExerciseId).toBe('cable-fly');
    expect(result.current.supersetRounds).toBe(1);
    expect(result.current.supersetLabel).toBe('Superset A · round 2 of 3');
  });

  it('rests normally after a lift trained on its own', async () => {
    const view = await inSupersetSession();
    const { result } = view;

    // Bench is not in a group, so it behaves exactly as before.
    expect(result.current.activeExerciseId).toBe('barbell-bench-press');
    await act(async () => result.current.logSet());
    await waitFor(() => expect(result.current.restActive).toBe(true));
    expect(result.current.activeExerciseId).toBe('barbell-bench-press');
  });

  it('does not treat a warm-up as part of the round', async () => {
    const view = await inSupersetSession();
    const { result } = view;

    await select(view, 'cable-fly');
    await act(async () => result.current.patch({ entryType: 'warmup' }));
    await act(async () => result.current.logSet());

    // A warm-up neither advances the group nor counts toward a round.
    await waitFor(() => expect(result.current.sets).toHaveLength(1));
    expect(result.current.activeExerciseId).toBe('cable-fly');
    expect(result.current.supersetRounds).toBe(0);
  });

  it('picks up mid-group if the user jumps into the middle', async () => {
    const view = await inSupersetSession();
    const { result } = view;

    // Start on the second lift of the group.
    await select(view, 'rope-extension');
    await act(async () => result.current.logSet());

    // It wraps back to the member that still owes this round.
    await waitFor(() => expect(result.current.activeExerciseId).toBe('cable-fly'));
    expect(result.current.restActive).toBe(false);
  });

  it('counts a round only once every member has been done', async () => {
    const view = await inSupersetSession();
    const { result } = view;

    await select(view, 'cable-fly');
    await act(async () => result.current.logSet());
    await waitFor(() => expect(result.current.sets).toHaveLength(1));
    // Half a round is not a round.
    expect(result.current.supersetRounds).toBe(0);
  });

  it('logs supersetted sets into the fatigue model like any other work', async () => {
    const view = await inSupersetSession();
    const { result } = view;

    await select(view, 'cable-fly');
    await act(async () => result.current.logSet());
    await waitFor(() => expect(result.current.activeExerciseId).toBe('rope-extension'));
    await act(async () => result.current.logSet());
    await act(async () => result.current.finishSession());

    await waitFor(() => expect(result.current.loads).toHaveLength(1));
    // 20x12 and 25x12, both at RPE 8.
    expect(result.current.loads[0]!.load).toBeCloseTo((20 * 12 + 25 * 12) * 0.8, 5);
  });

  it('leaves a session whose routine was deleted ungrouped but loggable', async () => {
    const view = await inSupersetSession();
    const { result } = view;

    await select(view, 'cable-fly');
    await act(async () => {
      await result.current.deleteRoutine(SS.id);
    });

    // No routine means no grouping to draw, but the session still works.
    expect(result.current.activeGroup).toBeNull();
    expect(result.current.chips.every((c) => c.letter === null)).toBe(true);
    await act(async () => result.current.logSet());
    await waitFor(() => expect(result.current.sets).toHaveLength(1));
  });

  describe('a deliberate gap between the lifts', () => {
    /** The same routine, but group A has a 15-second breather written into it. */
    const GAPPED: Routine = { ...SS, supersetRest: { A: 15 } };

    async function inGappedSession() {
      const view = await mount();
      await act(async () => {
        await view.result.current.saveRoutine(GAPPED);
      });
      await act(async () => {
        await view.result.current.createPlanFromSetup({ rotation: [GAPPED.id], sessionsPerWeek: 3, phase: 'strength', weeks: 4 });
      });
      await waitFor(() => expect(view.result.current.plan).not.toBeNull());
      await act(async () => view.result.current.startSession(GAPPED.id));
      await waitFor(() => expect(view.result.current.openSession).not.toBeNull());
      return view;
    }

    it('runs the group gap, not the full rest, partway through a round', async () => {
      const view = await inGappedSession();
      const { result } = view;

      await select(view, 'cable-fly');
      expect(result.current.activeGroup?.restSec).toBe(15);

      await act(async () => result.current.logSet());
      await waitFor(() => expect(result.current.activeExerciseId).toBe('rope-extension'));

      // A timer runs, but it is the group's 15 seconds and not the 150-second
      // preset — the gap replaces the rest between the parts, nothing else.
      expect(result.current.restActive).toBe(true);
      expect(result.current.restTotalMs).toBe(15_000);
      // The breather stays in the small card: the lifter is walking to the next
      // lift and needs its entry card, not a countdown filling the screen.
      expect(result.current.s.restFull).toBe(false);
    });

    it('still runs the full rest at the end of the round', async () => {
      const view = await inGappedSession();
      const { result } = view;

      await select(view, 'cable-fly');
      await act(async () => result.current.logSet());
      await waitFor(() => expect(result.current.activeExerciseId).toBe('rope-extension'));
      await act(async () => result.current.logSet());

      await waitFor(() => expect(result.current.restTotalMs).toBe(result.current.s.restPresetSec * 1000));
      expect(result.current.restActive).toBe(true);
      expect(result.current.activeExerciseId).toBe('cable-fly');
      // The rest that ends a round is a real one, so it does take the screen.
      expect(result.current.s.restFull).toBe(true);
    });

    it('clears a running timer when the group has no gap', async () => {
      // A straight-through superset must not leave the previous round's rest
      // ticking behind the entry card.
      const view = await inSupersetSession();
      const { result } = view;

      await act(async () => result.current.logSet());
      await waitFor(() => expect(result.current.restActive).toBe(true));

      await select(view, 'cable-fly');
      await act(async () => result.current.logSet());
      await waitFor(() => expect(result.current.activeExerciseId).toBe('rope-extension'));
      expect(result.current.restActive).toBe(false);
    });

    it('is written to storage, not just held in memory', async () => {
      // Read the row itself rather than remounting: a save path that dropped the
      // new field would still look right in state until the next launch.
      await inGappedSession();
      await waitFor(async () => {
        expect((await db.routines.get(GAPPED.id))?.supersetRest).toEqual({ A: 15 });
      });
    });

    it('drops the gap when the group it belonged to is disbanded', async () => {
      const view = await inGappedSession();
      const { result } = view;

      await act(async () => {
        await result.current.saveRoutine({
          ...GAPPED,
          slots: GAPPED.slots.map((slot) => ({ ...slot, supersetGroup: null })),
        });
      });

      await waitFor(() => expect(result.current.allRoutines.find((r) => r.id === GAPPED.id)?.supersetRest).toEqual({}));
    });
  });
});

describe('the sync queue', () => {
  it('collects one entry per mutation', async () => {
    const { result } = await mount();
    await withPlan({ result });
    await act(async () => result.current.startSession('my-push'));
    await waitFor(() => expect(result.current.openSession).not.toBeNull());

    await act(async () => result.current.logSet());
    await act(async () => result.current.logSet());
    await act(async () => result.current.logSet());
    await waitFor(() => expect(result.current.sets).toHaveLength(3));

    await waitFor(async () => {
      // `table` isn't an index — the queue is only ever drained in order, so it
      // carries the one index that matters and nothing else.
      const queued = (await db.syncQueue.toArray()).filter((row) => row.table === 'sets');
      expect(queued).toHaveLength(3);
    });
  });
});

// ─────────────────────────────────────────────────────────────
// Storage failures reach the user
// ─────────────────────────────────────────────────────────────

describe('storage failures', () => {
  it('a failed write flips the storage indicator', async () => {
    const view = await mount();
    await withPlan(view);
    const { result } = view;

    await act(async () => result.current.startSession('my-push'));
    // The session id arrives via a write-back. Closing storage before it lands
    // would make logSet return early, and the test would prove nothing.
    await waitFor(() => expect(result.current.openSession?.id).toBeDefined());
    expect(result.current.s.storageOk).toBe(true);

    // Take storage away mid-session, the way an evicted database or a private
    // window revoking it would. The app opened fine, so nothing before this
    // point would have told the user anything was wrong.
    await db.close();
    await act(async () => result.current.logSet());

    await waitFor(() => expect(result.current.s.storageOk).toBe(false));
  });

  it('the notice survives the success toast fired on the same tap', async () => {
    const view = await mount();
    await withPlan(view);
    const { result } = view;

    await act(async () => result.current.startSession('my-push'));
    // The session id arrives via a write-back. Closing storage before it lands
    // would make logSet return early, and the test would prove nothing.
    await waitFor(() => expect(result.current.openSession?.id).toBeDefined());
    await db.close();
    await act(async () => result.current.logSet());

    await waitFor(() => expect(result.current.s.storageOk).toBe(false));

    // This is the failure the first attempt at this had. logSet raises its own
    // toast on the same tap that failed to save, so a transient warning is
    // replaced by "Set logged. Rest running." — a reassurance that is false.
    // The condition has to outlive the message.
    expect(result.current.s.toast?.text).toBe('Set logged. Rest running.');
    expect(result.current.s.storageOk).toBe(false);
  });

  it('the indicator stays down however many further writes fail', async () => {
    const view = await mount();
    await withPlan(view);
    const { result } = view;

    await act(async () => result.current.startSession('my-push'));
    await waitFor(() => expect(result.current.openSession?.id).toBeDefined());
    await db.close();
    await act(async () => result.current.logSet());
    await waitFor(() => expect(result.current.s.storageOk).toBe(false));

    await act(async () => {
      result.current.logSet();
      result.current.logSet();
    });
    await new Promise((resolve) => setTimeout(resolve, 20));

    // Still down, and every set is still landing in memory.
    expect(result.current.s.storageOk).toBe(false);
    expect(result.current.sets.length).toBe(3);
  });

  it('logging still works with storage gone', async () => {
    const view = await mount();
    await withPlan(view);
    const { result } = view;

    await act(async () => result.current.startSession('my-push'));
    // The session id arrives via a write-back. Closing storage before it lands
    // would make logSet return early, and the test would prove nothing.
    await waitFor(() => expect(result.current.openSession?.id).toBeDefined());
    await db.close();
    await act(async () => result.current.logSet());

    // Degrading to memory is the point. Refusing to log at the gym is worse
    // than losing the row later.
    await waitFor(() => expect(result.current.s.storageOk).toBe(false));
    expect(result.current.sets.length).toBe(1);
  });

  it('the banner lives in the shell, not on a screen you must visit', async () => {
    render(<Page />);

    // Wait for hydration to finish. Closing storage *before* mounting proves
    // nothing: the provider calls db.open() itself, which reopens it.
    const skip = await screen.findByRole('button', { name: 'Skip' });

    await db.close();
    await act(async () => {
      fireEvent.click(skip);
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    // Rendered by the shell rather than by a screen, so it is visible on
    // whichever tab you happen to be on. This condition used to be legible
    // only from Tools, which is the last place anyone looks mid-session.
    expect(await screen.findByText(/not saving to this device/i)).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────
// Choosing which slot to train — Today's week strip
// ─────────────────────────────────────────────────────────────

describe('picking a specific slot', () => {
  /** A week with the same routine in more than one slot, as a rotation produces. */
  async function weekWithRepeats() {
    const view = await mount();
    await withPlan(view, 4);
    const { result } = view;
    const repeats = result.current.thisWeekSlots.filter((p) => p.routineId === 'my-push');
    expect(repeats.length).toBeGreaterThan(1);
    return { view, result, repeats };
  }

  it('starting a chosen slot fills that one, not the first with the same routine', async () => {
    const { result, repeats } = await weekWithRepeats();
    const later = repeats[1]!;

    await act(async () => result.current.startSession('my-push', later.id));
    await waitFor(() => expect(result.current.openSession?.id).toBeDefined());

    // Without the explicit choice this would claim repeats[0] and turn the
    // wrong card green — the user tapped #3 and #1 would light up.
    expect(result.current.openSession?.plannedSessionId).toBe(later.id);
  });

  it('falls back to matching on the routine when no slot is named', async () => {
    const { result, repeats } = await weekWithRepeats();

    await act(async () => result.current.startSession('my-push'));
    await waitFor(() => expect(result.current.openSession?.id).toBeDefined());

    expect(result.current.openSession?.plannedSessionId).toBe(repeats[0]!.id);
  });

  it('a slot id for another routine is ignored', async () => {
    const view = await mount();
    await withPlan(view, 4);
    const { result } = view;

    const pushSlot = result.current.thisWeekSlots.find((p) => p.routineId === 'my-push')!;
    // Asking to start Pull while naming a Push slot is incoherent. The routine
    // is what was actually chosen, so the slot id is discarded rather than
    // allowed to stamp a session onto a slot for a different workout.
    await act(async () => result.current.startSession('my-pull', pushSlot.id));
    await waitFor(() => expect(result.current.openSession?.id).toBeDefined());

    const pullSlot = result.current.thisWeekSlots.find((p) => p.routineId === 'my-pull')!;
    expect(result.current.openSession?.plannedSessionId).toBe(pullSlot.id);
  });

  it('a done slot cannot be claimed again by naming it', async () => {
    const { result, repeats } = await weekWithRepeats();
    const first = repeats[0]!;

    await act(async () => result.current.startSession('my-push', first.id));
    await waitFor(() => expect(result.current.openSession?.id).toBeDefined());
    await act(async () => result.current.logSet());
    await act(async () => result.current.finishSession());
    await waitFor(() => expect(result.current.openSession).toBeNull());

    // Naming the slot that is now done falls through to the next pending one
    // for that routine, rather than rewriting history.
    await act(async () => result.current.startSession('my-push', first.id));
    await waitFor(() => expect(result.current.openSession?.id).toBeDefined());
    expect(result.current.openSession?.plannedSessionId).not.toBe(first.id);
  });
});

// ─────────────────────────────────────────────────────────────
// Amending a logged set
// ─────────────────────────────────────────────────────────────

describe('editing a logged set', () => {
  /** Start a session and log one working set, returning that row. */
  async function oneLoggedSet(view: { result: { current: BompaValue } }) {
    const { result } = view;
    await act(async () => result.current.startSession('my-push'));
    await waitFor(() => expect(result.current.openSession?.id).toBeDefined());
    await act(async () => result.current.logSet());
    return waitFor(() => {
      const row = result.current.sets.find((x) => x.id !== undefined);
      expect(row).toBeDefined();
      return row!;
    });
  }

  it('changes reps and RPE, and the change survives a reload', async () => {
    const view = await mount();
    await withPlan(view);
    const { result } = view;
    const row = await oneLoggedSet(view);

    await act(async () => result.current.updateSet(row.id!, { reps: 3, rpe: 9.5 }));

    await waitFor(() => {
      const after = result.current.sets.find((x) => x.id === row.id)!;
      expect(after.reps).toBe(3);
      expect(after.rpe).toBe(9.5);
    });

    const stored = await waitFor(async () => {
      const found = await db.sets.get(row.id!);
      expect(found?.reps).toBe(3);
      return found!;
    });
    expect(stored.rpe).toBe(9.5);
  });

  it('naming an RPE by hand clears the estimated flag', async () => {
    const view = await mount();
    await withPlan(view);
    const { result } = view;
    const row = await oneLoggedSet(view);
    // Logged with no RPE chosen, so the target was recorded on its behalf.
    expect(row.rpeEstimated).toBe(true);

    await act(async () => result.current.updateSet(row.id!, { rpe: 8 }));

    await waitFor(() => {
      expect(result.current.sets.find((x) => x.id === row.id)?.rpeEstimated).toBe(false);
    });
  });

  it('saving the edit sheet with only the reps changed leaves an unrated set unrated', async () => {
    const seen: { current: BompaValue | null } = { current: null };
    function Grab() {
      seen.current = useBompa();
      return null;
    }
    render(
      <BompaProvider>
        <Grab />
        <EditSetSheet />
      </BompaProvider>,
    );
    await waitFor(() => expect(seen.current?.s.hydrated).toBe(true), { timeout: 4000 });
    const view = { result: seen as { current: BompaValue } };
    await withPlan(view);
    const row = await oneLoggedSet(view);
    expect(row.rpeEstimated).toBe(true);

    await act(async () => view.result.current.patch({ editingSetId: row.id! }));
    fireEvent.click(await screen.findByRole('button', { name: 'Increase reps' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(async () => {
      const stored = await db.sets.get(row.id!);
      expect(stored?.reps).toBe(row.reps + 1);
      expect(stored?.rpeEstimated).toBe(true);
    });
    expect(view.result.current.sets.find((x) => x.id === row.id)?.rpeEstimated).toBe(true);
  });

  it('an edit in pounds still stores kilograms', async () => {
    const view = await mount();
    await withPlan(view);
    const { result } = view;
    await act(async () => result.current.setUnit('lb'));
    const row = await oneLoggedSet(view);

    await act(async () => result.current.updateSet(row.id!, { weight: 176 }));

    // 176lb is 79.83kg. Storing 176 would corrupt the history silently, which
    // is the entire reason conversion happens at the write boundary.
    await waitFor(() => {
      expect(result.current.sets.find((x) => x.id === row.id)?.weightKg).toBeCloseTo(79.83, 2);
    });
  });

  it('correcting a set to a warm-up takes it out of the fatigue model', async () => {
    const view = await mount();
    await withPlan(view);
    const { result } = view;
    const row = await oneLoggedSet(view);

    const before = result.current.scores.fatigue;
    await act(async () => result.current.updateSet(row.id!, { type: 'warmup' }));

    // Warm-ups are excluded from session load, so the one contribution this
    // session made has to disappear with it.
    await waitFor(() => {
      expect(result.current.sets.find((x) => x.id === row.id)?.type).toBe('warmup');
    });
    expect(result.current.scores.fatigue).toBeLessThanOrEqual(before);
  });

  it('reps cannot be edited below 1', async () => {
    const view = await mount();
    await withPlan(view);
    const { result } = view;
    const row = await oneLoggedSet(view);

    await act(async () => result.current.updateSet(row.id!, { reps: 0 }));

    await waitFor(() => {
      expect(result.current.sets.find((x) => x.id === row.id)?.reps).toBe(1);
    });
  });

  it('leaves every other set alone', async () => {
    const view = await mount();
    await withPlan(view);
    const { result } = view;
    await oneLoggedSet(view);
    await act(async () => result.current.logSet());
    await waitFor(() => expect(result.current.sets.length).toBe(2));

    const [first, second] = result.current.sets;
    await act(async () => result.current.updateSet(first!.id!, { reps: 2 }));

    await waitFor(() => {
      expect(result.current.sets.find((x) => x.id === first!.id)?.reps).toBe(2);
    });
    expect(result.current.sets.find((x) => x.id === second!.id)?.reps).toBe(second!.reps);
  });

  it('an unknown id changes nothing', async () => {
    const view = await mount();
    await withPlan(view);
    const { result } = view;
    const row = await oneLoggedSet(view);

    await act(async () => result.current.updateSet(-999, { reps: 99 }));
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(result.current.sets.find((x) => x.id === row.id)?.reps).toBe(row.reps);
  });
});

// ─────────────────────────────────────────────────────────────

describe('the full-screen rest', () => {
  async function inSession() {
    const view = await mount();
    await withPlan(view);
    await act(async () => view.result.current.startSession('my-push'));
    await waitFor(() => expect(view.result.current.openSession).not.toBeNull());
    return view;
  }

  it('takes the screen when a set starts a rest', async () => {
    const { result } = await inSession();
    expect(result.current.s.restFull).toBe(false);

    await act(async () => result.current.logSet());
    await waitFor(() => expect(result.current.restActive).toBe(true));
    expect(result.current.s.restFull).toBe(true);
  });

  it('skipping the rest closes it along with the timer', async () => {
    const { result } = await inSession();
    await act(async () => result.current.logSet());
    await waitFor(() => expect(result.current.s.restFull).toBe(true));

    await act(async () => result.current.skipRest());
    expect(result.current.s.restFull).toBe(false);
    expect(result.current.restActive).toBe(false);
  });

  it('minimising hides it but leaves the rest running, and it can come back', async () => {
    const { result } = await inSession();
    await act(async () => result.current.logSet());
    await waitFor(() => expect(result.current.s.restFull).toBe(true));

    await act(async () => result.current.minimiseRest());
    expect(result.current.s.restFull).toBe(false);
    // Minimise is a view change, not a skip: the countdown is untouched.
    expect(result.current.restActive).toBe(true);

    await act(async () => result.current.showRestFull());
    expect(result.current.s.restFull).toBe(true);
  });

  it('will not reopen onto a rest that is not running', async () => {
    const { result } = await inSession();
    await act(async () => result.current.showRestFull());
    expect(result.current.s.restFull).toBe(false);
  });

  it('closes itself when the rest runs out', async () => {
    const { result } = await inSession();
    // A one-second rest, so the real wall clock runs it out inside the test.
    await act(async () => result.current.setRestPreset(1));
    await act(async () => result.current.logSet());
    await waitFor(() => expect(result.current.s.restFull).toBe(true));

    await waitFor(() => expect(result.current.restActive).toBe(false), { timeout: 4000 });
    expect(result.current.s.restFull).toBe(false);
  });
});

describe('the finished-session summary', () => {
  it('describes the session just finished', async () => {
    const { result } = await mount();
    await withPlan({ result });
    await act(async () => result.current.startSession('my-push'));
    await waitFor(() => expect(result.current.openSession).not.toBeNull());

    await act(async () => result.current.patch({ entryType: 'warmup', entryWeight: 40, entryReps: 5 }));
    await act(async () => result.current.logSet());
    await act(async () => result.current.patch({ entryType: 'working', entryWeight: 80, entryReps: 8 }));
    await act(async () => result.current.logSet());
    await waitFor(() => expect(result.current.sets).toHaveLength(2));

    const sessionId = result.current.openSession?.id;
    await act(async () => result.current.finishSession());

    const summary = result.current.s.summary;
    expect(summary?.session.id).toBe(sessionId);
    expect(summary?.session.finishedAt).toBeDefined();
    // Warm-ups are in the lift's set list but not in the work figures.
    expect(summary?.workingSets).toBe(1);
    expect(summary?.tonnageKg).toBe(toKg(80, result.current.s.unit) * 8);
    expect(summary?.lifts.map((lift) => lift.exerciseId)).toEqual(['barbell-bench-press']);
    expect(summary?.lifts[0]?.sets).toHaveLength(2);

    // The summary replaces the old toast rather than doubling up with it.
    expect(result.current.s.toast?.text ?? '').not.toMatch(/Session saved/);
    expect(result.current.s.restFull).toBe(false);
  });

  it('closing it clears it and lands on Today', async () => {
    const { result } = await mount();
    await withPlan({ result });
    await act(async () => result.current.startSession('my-push'));
    await waitFor(() => expect(result.current.openSession).not.toBeNull());
    await act(async () => result.current.logSet());
    await act(async () => result.current.finishSession());
    expect(result.current.s.summary).not.toBeNull();

    // Wherever the user has wandered to underneath, Done goes to Today.
    await act(async () => result.current.go('plan'));
    await act(async () => result.current.closeSummary());
    expect(result.current.s.summary).toBeNull();
    expect(result.current.s.tab).toBe('home');
  });
});

// ─────────────────────────────────────────────────────────────
// Rating after the set, finishing with care, and taking things back
// ─────────────────────────────────────────────────────────────

/** One set of each lift, so the plan runs out in two sets. */
const TINY: Routine = {
  id: 'tiny',
  name: 'Tiny Day',
  source: 'user',
  phase: 'strength',
  estMinutes: 10,
  slots: [
    { exerciseId: 'barbell-bench-press', order: 0, sets: 1, reps: 5, targetWeightKg: 80, targetPct1RM: null, targetRpe: 7, supersetGroup: null },
    { exerciseId: 'overhead-press', order: 1, sets: 1, reps: 5, targetWeightKg: 45, targetPct1RM: null, targetRpe: 7, supersetGroup: null },
  ],
};

async function pushSession() {
  const view = await mount();
  await withPlan(view);
  await act(async () => view.result.current.startSession('my-push'));
  await waitFor(() => expect(view.result.current.openSession).not.toBeNull());
  return view;
}

async function tinySession() {
  const view = await mount();
  await act(async () => {
    await view.result.current.saveRoutine(TINY);
  });
  await act(async () => view.result.current.startSession(TINY.id));
  await waitFor(() => expect(view.result.current.openSession).not.toBeNull());
  return view;
}

/** Log a set and wait for its database id, which rating and deleting go by. */
async function logAndStore(view: { result: { current: BompaValue } }) {
  const before = view.result.current.sets.length;
  await act(async () => view.result.current.logSet());
  await waitFor(() => {
    expect(view.result.current.sets).toHaveLength(before + 1);
    expect(view.result.current.sets.every((row) => row.id !== undefined)).toBe(true);
  });
}

describe('RPE after the set', () => {
  it('the rest screen asks about the set just logged, and only that one', async () => {
    const view = await pushSession();
    await logAndStore(view);
    expect(view.result.current.justLoggedRows.map((row) => row.setNo)).toEqual([1]);

    await logAndStore(view);
    expect(view.result.current.justLoggedRows.map((row) => row.setNo)).toEqual([2]);
  });

  it('a rating writes the RPE and clears the estimate, on disk too', async () => {
    const view = await pushSession();
    await logAndStore(view);
    const id = view.result.current.sets[0]!.id!;

    await act(async () => view.result.current.rateSet(id, 8.5));
    expect(view.result.current.sets[0]).toMatchObject({ rpe: 8.5, rpeEstimated: false });
    await waitFor(async () => expect(await db.sets.get(id)).toMatchObject({ rpe: 8.5, rpeEstimated: false }));
  });

  it('leaving a lift with unrated sets raises the catch-up line, and the next set clears it', async () => {
    const view = await pushSession();
    await logAndStore(view);
    await act(async () => view.result.current.pickExercise(1));
    expect(view.result.current.s.catchUpLift).toBe('barbell-bench-press');

    await logAndStore(view);
    expect(view.result.current.s.catchUpLift).toBeNull();
  });

  it('leaving a lift whose sets are all rated raises nothing', async () => {
    const view = await pushSession();
    await logAndStore(view);
    await act(async () => view.result.current.rateSet(view.result.current.sets[0]!.id!, 7));
    await act(async () => view.result.current.pickExercise(1));
    expect(view.result.current.s.catchUpLift).toBeNull();
  });

  it('after a superset round, asks about every set in the round', async () => {
    const SS: Routine = {
      id: 'rate-ss',
      name: 'Round day',
      source: 'user',
      phase: 'strength',
      estMinutes: 30,
      slots: [
        { exerciseId: 'cable-fly', order: 0, sets: 3, reps: 12, targetWeightKg: 20, targetPct1RM: null, targetRpe: 8, supersetGroup: 'A' },
        { exerciseId: 'rope-extension', order: 1, sets: 3, reps: 12, targetWeightKg: 25, targetPct1RM: null, targetRpe: 8, supersetGroup: 'A' },
      ],
    };
    const view = await mount();
    await act(async () => {
      await view.result.current.saveRoutine(SS);
    });
    await act(async () => view.result.current.startSession(SS.id));
    await waitFor(() => expect(view.result.current.openSession).not.toBeNull());

    await logAndStore(view);
    // Mid-round: nothing is asked, and no rest takes the screen.
    expect(view.result.current.justLoggedRows).toEqual([]);
    await logAndStore(view);
    expect(view.result.current.justLoggedRows.map((row) => row.exerciseId)).toEqual(['cable-fly', 'rope-extension']);
  });
});

describe('the rest screen', () => {
  it('minimising once starts later rests minimised, until the next session', async () => {
    const view = await pushSession();
    await logAndStore(view);
    expect(view.result.current.s.restFull).toBe(true);
    await act(async () => view.result.current.minimiseRest());
    await act(async () => view.result.current.skipRest());

    await logAndStore(view);
    expect(view.result.current.restActive).toBe(true);
    expect(view.result.current.s.restFull).toBe(false);

    await act(async () => view.result.current.finishSession());
    await act(async () => view.result.current.closeSummary());
    await act(async () => view.result.current.startSession('my-pull'));
    await waitFor(() => expect(view.result.current.openSession?.routineId).toBe('my-pull'));
    expect(view.result.current.s.restPrefersMinimised).toBe(false);
  });

  it('names the next set from the plan, not from the steppers', async () => {
    const view = await pushSession();
    await logAndStore(view);
    // The lifter nudged the weight; the plan still says 80.
    await act(async () => view.result.current.patch({ entryWeight: 100, entryReps: 3 }));
    expect(view.result.current.restNext).toEqual({ exerciseId: 'barbell-bench-press', setNo: 2, weight: 80, reps: 8 });
  });

  it('names the next lift once this one has run out of planned sets', async () => {
    const view = await tinySession();
    await logAndStore(view);
    expect(view.result.current.restNext).toMatchObject({ exerciseId: 'overhead-press', setNo: 1, weight: 45, reps: 5 });
  });

  it('once a lift has run out of planned sets, Train moves to the lift the rest screen names', async () => {
    const THREE: Routine = {
      ...TINY,
      id: 'three',
      slots: [
        { ...TINY.slots[0]!, sets: 3 },
        { ...TINY.slots[1]!, sets: 3 },
      ],
    };
    const view = await mount();
    await act(async () => {
      await view.result.current.saveRoutine(THREE);
    });
    await act(async () => view.result.current.startSession(THREE.id));
    await waitFor(() => expect(view.result.current.openSession).not.toBeNull());

    await logAndStore(view);
    await logAndStore(view);
    expect(view.result.current.activeExerciseId).toBe('barbell-bench-press');
    await logAndStore(view);
    expect(view.result.current.restNext).toMatchObject({ exerciseId: 'overhead-press', setNo: 1, weight: 45, reps: 5 });

    await act(async () => view.result.current.skipRest());
    expect(view.result.current.activeExerciseId).toBe('overhead-press');
    expect(view.result.current.s.entryWeight).toBe(45);

    // Logging now records the next lift's first set, not a fourth bench.
    await logAndStore(view);
    expect(view.result.current.sessionSets.filter((row) => row.exerciseId === 'barbell-bench-press')).toHaveLength(3);
    expect(view.result.current.sessionSets.filter((row) => row.exerciseId === 'overhead-press')).toHaveLength(1);
  });

  it('a superset whose lifts have different set counts finishes the plan on the last set, and asks about it', async () => {
    const UNEVEN: Routine = {
      id: 'uneven',
      name: 'Uneven Day',
      source: 'user',
      phase: 'strength',
      estMinutes: 30,
      slots: [
        { exerciseId: 'barbell-bench-press', order: 0, sets: 4, reps: 8, targetWeightKg: 80, targetPct1RM: null, targetRpe: 8, supersetGroup: 'A' },
        { exerciseId: 'cable-fly', order: 1, sets: 3, reps: 12, targetWeightKg: 20, targetPct1RM: null, targetRpe: 8, supersetGroup: 'A' },
      ],
    };
    const view = await mount();
    await act(async () => {
      await view.result.current.saveRoutine(UNEVEN);
    });
    await act(async () => view.result.current.startSession(UNEVEN.id));
    await waitFor(() => expect(view.result.current.openSession).not.toBeNull());

    for (let round = 0; round < 3; round++) {
      await logAndStore(view);
      await logAndStore(view);
    }
    expect(view.result.current.activeExerciseId).toBe('barbell-bench-press');
    expect(view.result.current.s.sessionComplete).toBe(false);

    await logAndStore(view);
    expect(view.result.current.s.sessionComplete).toBe(true);
    // The last round was bench alone, so bench's fourth set is all it asks about.
    expect(view.result.current.justLoggedRows.map((row) => [row.exerciseId, row.setNo])).toEqual([['barbell-bench-press', 4]]);
    expect(view.result.current.activeExerciseId).toBe('barbell-bench-press');
    expect(view.result.current.sessionSets.filter((row) => row.exerciseId === 'cable-fly')).toHaveLength(3);
  });

  it('the set that finishes the plan opens the plan-done screen, and an extra set does not', async () => {
    const view = await tinySession();
    await logAndStore(view);
    expect(view.result.current.s.sessionComplete).toBe(false);

    await act(async () => view.result.current.pickExercise(1));
    await logAndStore(view);
    expect(view.result.current.s.sessionComplete).toBe(true);
    expect(view.result.current.restNext).toBeNull();

    await act(async () => view.result.current.keepTraining());
    expect(view.result.current.s.sessionComplete).toBe(false);
    await logAndStore(view);
    expect(view.result.current.s.sessionComplete).toBe(false);
  });
});

describe('finishing', () => {
  it('with a planned lift untrained, asks first and finishes nothing', async () => {
    const view = await pushSession();
    await logAndStore(view);
    await act(async () => view.result.current.requestFinish());
    expect(view.result.current.s.finishGuardOpen).toBe(true);
    expect(view.result.current.openSession).not.toBeNull();
  });

  it('with every planned lift started, finishes straight away', async () => {
    const view = await tinySession();
    await logAndStore(view);
    await act(async () => view.result.current.pickExercise(1));
    await logAndStore(view);
    await act(async () => view.result.current.requestFinish());
    expect(view.result.current.s.finishGuardOpen).toBe(false);
    expect(view.result.current.openSession).toBeNull();
    expect(view.result.current.s.summary).not.toBeNull();
  });

  it('undo reopens the session and puts its slot back exactly as it was', async () => {
    const view = await pushSession();
    await logAndStore(view);
    const session = view.result.current.openSession!;
    const slotBefore = view.result.current.planned.find((p) => p.id === session.plannedSessionId)!;
    expect(slotBefore.status).toBe('plan');

    await act(async () => view.result.current.finishSession());
    await waitFor(async () => expect((await db.plannedSessions.get(slotBefore.id!))?.status).toBe('done'));
    expect(view.result.current.lastFinishedAt).not.toBeNull();

    await act(async () => view.result.current.undoFinish());
    expect(view.result.current.openSession?.id).toBe(session.id);
    expect(view.result.current.openSession?.finishedAt).toBeUndefined();
    expect(view.result.current.s.summary).toBeNull();
    expect(view.result.current.s.tab).toBe('log');
    expect(view.result.current.planned.find((p) => p.id === slotBefore.id)).toEqual(slotBefore);

    await waitFor(async () => {
      const stored = await db.plannedSessions.get(slotBefore.id!);
      // A pending slot has no date and no session, and undo leaves none behind.
      expect(stored).toEqual(slotBefore);
      expect(stored?.date).toBeUndefined();
      expect(stored?.sessionId).toBeUndefined();
      expect((await db.sessions.get(session.id!))?.finishedAt).toBeUndefined();
    });
    // The sets were never touched.
    expect(view.result.current.sessionSets).toHaveLength(1);
  });

  it('undo does nothing once its 30 seconds are up', async () => {
    const view = await pushSession();
    await logAndStore(view);
    await act(async () => view.result.current.finishSession());
    const later = Date.now() + 31_000;
    const clock = vi.spyOn(Date, 'now').mockReturnValue(later);
    try {
      await act(async () => view.result.current.undoFinish());
    } finally {
      clock.mockRestore();
    }
    expect(view.result.current.openSession).toBeNull();
  });

  it('Done on the summary ends the chance to undo', async () => {
    const view = await pushSession();
    await logAndStore(view);
    await act(async () => view.result.current.finishSession());
    await act(async () => view.result.current.closeSummary());
    expect(view.result.current.lastFinishedAt).toBeNull();
    await act(async () => view.result.current.undoFinish());
    expect(view.result.current.openSession).toBeNull();
  });

  it('counts finished sessions for the hint, keeps the count, and undo uncounts it', async () => {
    const view = await pushSession();
    expect(view.result.current.s.trainHintsSeen).toBe(0);
    await act(async () => view.result.current.finishSession());
    expect(view.result.current.s.trainHintsSeen).toBe(1);
    await act(async () => view.result.current.undoFinish());
    expect(view.result.current.s.trainHintsSeen).toBe(0);
    await act(async () => view.result.current.finishSession());
    await waitFor(async () => expect((await db.settings.get('trainHintsSeen'))?.value).toBe(1));
  });

  it('undo puts the hint count back exactly, even when finishing did not move it', async () => {
    const view = await pushSession();
    await act(async () => view.result.current.patch({ trainHintsSeen: TRAIN_HINTS_SESSIONS }));
    await act(async () => view.result.current.finishSession());
    expect(view.result.current.s.trainHintsSeen).toBe(TRAIN_HINTS_SESSIONS);
    await act(async () => view.result.current.undoFinish());
    // Past the cap finishing counts nothing, so undo has nothing to take back.
    expect(view.result.current.s.trainHintsSeen).toBe(TRAIN_HINTS_SESSIONS);
  });

  it('undo tapped after its window says it is too late, rather than doing nothing silently', async () => {
    const view = await pushSession();
    await logAndStore(view);
    await act(async () => view.result.current.finishSession());
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 31_000);
    try {
      await act(async () => view.result.current.undoFinish());
    } finally {
      clock.mockRestore();
    }
    expect(view.result.current.openSession).toBeNull();
    expect(view.result.current.s.toast?.text).toBe('Too late to undo. The session is saved.');
  });

  it('the undo pill never shows more than its 30 seconds, however the clock tick lines up', async () => {
    const seen: { current: BompaValue | null } = { current: null };
    function Grab() {
      seen.current = useBompa();
      return null;
    }
    render(
      <BompaProvider>
        <Grab />
        <FinishSummary />
      </BompaProvider>,
    );
    await waitFor(() => expect(seen.current?.s.hydrated).toBe(true), { timeout: 4000 });
    const view = { result: seen as { current: BompaValue } };
    await withPlan(view);
    await act(async () => view.result.current.startSession('my-push'));
    await waitFor(() => expect(view.result.current.openSession).not.toBeNull());
    await logAndStore(view);

    // The finish lands most of a second after the last tick of the app's clock.
    const clock = vi.spyOn(Date, 'now').mockReturnValue(view.result.current.now + 900);
    try {
      await act(async () => view.result.current.finishSession());
    } finally {
      clock.mockRestore();
    }
    expect(screen.getByRole('button', { name: /^Undo finish/ }).textContent).toBe('Undo finish · 0:30');
  });

  describe('the summary screen', () => {
    async function finishedWithSummary(logs: number) {
      const seen: { current: BompaValue | null } = { current: null };
      function Grab() {
        seen.current = useBompa();
        return null;
      }
      render(
        <BompaProvider>
          <Grab />
          <FinishSummary />
        </BompaProvider>,
      );
      await waitFor(() => expect(seen.current?.s.hydrated).toBe(true), { timeout: 4000 });
      const view = { result: seen as { current: BompaValue } };
      await withPlan(view);
      await act(async () => view.result.current.startSession('my-push'));
      await waitFor(() => expect(view.result.current.openSession).not.toBeNull());
      for (let i = 0; i < logs; i++) await logAndStore(view);
      await act(async () => view.result.current.finishSession());
      return view;
    }

    it('does not call unrated sets on target, and names the lift never started', async () => {
      await finishedWithSummary(2);
      expect(screen.queryByText(/On target across the board/)).toBeNull();
      expect(
        screen.getByText("You didn't get to Overhead Press, and with nothing rated I can't judge the rest yet."),
      ).toBeTruthy();
    });

    it("reads tomorrow's readiness as still learning while Today does", async () => {
      const view = await finishedWithSummary(1);
      // A first session: Today has almost no history to stand on.
      expect(view.result.current.scores.lowConfidence).toBe(true);
      const figure = screen.getByRole('img', { name: /^Tomorrow's readiness/ });
      expect(figure.getAttribute('aria-label')).toMatch(/still learning/);
      expect(figure.textContent).toMatch(/Still learning/);
      expect(figure.textContent).not.toMatch(/Primed|Steady|Buried/);
    });
  });

  it('a rating on the summary rebuilds it, so the verdict reads the new number', async () => {
    const view = await pushSession();
    await logAndStore(view);
    const id = view.result.current.sets[0]!.id!;
    await act(async () => view.result.current.finishSession());
    await act(async () => view.result.current.rateSet(id, 9.5));
    expect(view.result.current.s.summary?.lifts[0]?.sets[0]).toMatchObject({ rpe: 9.5, rpeEstimated: false });
  });
});

describe('taking a set back', () => {
  it('deleting a set offers Undo, which puts it back under the same id, on disk too', async () => {
    const view = await pushSession();
    await logAndStore(view);
    const row = view.result.current.sets[0]!;

    await act(async () => view.result.current.deleteSet(row));
    expect(view.result.current.sets).toHaveLength(0);
    await waitFor(async () => expect(await db.sets.get(row.id!)).toBeUndefined());
    const toast = view.result.current.s.toast;
    expect(toast?.text).toBe('Deleted Bench set 1');
    expect(toast?.action?.label).toBe('Undo');

    await act(async () => toast!.action!.run());
    expect(view.result.current.sets).toEqual([row]);
    await waitFor(async () => expect(await db.sets.get(row.id!)).toEqual(row));
  });

  /** Log a set and then an unplanned drop off it, both with their ids. */
  async function setWithDrop(view: { result: { current: BompaValue } }) {
    await logAndStore(view);
    await act(async () => view.result.current.startSegments('drop'));
    await logAndStore(view);
    expect(view.result.current.segment).toBeNull();
  }

  it("undoing the delete of a set with a drop brings every row back, with its id, in time order, on disk too", async () => {
    const view = await pushSession();
    await logAndStore(view);
    await act(async () => view.result.current.skipRest());
    await setWithDrop(view);
    const before = view.result.current.sets;
    expect(before.map((row) => [row.setNo, row.segment])).toEqual([
      [1, undefined],
      [2, undefined],
      [2, 1],
    ]);

    await act(async () => view.result.current.deleteSet(before[1]!));
    expect(view.result.current.sets).toEqual([before[0]]);
    await waitFor(async () => expect(await db.sets.count()).toBe(1));

    await act(async () => view.result.current.s.toast!.action!.run());
    expect(view.result.current.sets).toEqual(before);
    await waitFor(async () => expect(await db.sets.orderBy('at').toArray()).toEqual(before));
  });

  it('undoing a delete after the set number was reused puts the set back above the others, pieces with it', async () => {
    const view = await pushSession();
    await logAndStore(view);
    await logAndStore(view);
    await act(async () => view.result.current.skipRest());
    await setWithDrop(view);
    const [, , third, drop] = view.result.current.sets;
    expect([third!.setNo, drop!.setNo]).toEqual([3, 3]);

    await act(async () => view.result.current.deleteSet(third!));
    const undo = view.result.current.s.toast!.action!;
    await act(async () => view.result.current.skipRest());
    await logAndStore(view);
    const fresh = view.result.current.sets.find((row) => row.at > drop!.at)!;
    expect(fresh.setNo).toBe(3);

    await act(async () => undo.run());
    const bench = view.result.current.sets.filter((row) => row.exerciseId === 'barbell-bench-press');
    // Each set number belongs to one set, and the drop still hangs off its own.
    expect(bench.filter((row) => row.segment === undefined).map((row) => row.setNo).sort()).toEqual([1, 2, 3, 4]);
    expect(bench.find((row) => row.id === third!.id)).toMatchObject({ setNo: 4, weightKg: third!.weightKg });
    expect(bench.find((row) => row.id === drop!.id)).toMatchObject({ setNo: 4, segment: 1 });
    expect(bench.find((row) => row.id === fresh.id)).toEqual(fresh);
    await waitFor(async () => {
      expect((await db.sets.get(third!.id!))?.setNo).toBe(4);
      expect((await db.sets.get(drop!.id!))?.setNo).toBe(4);
      expect((await db.sets.get(fresh.id!))?.setNo).toBe(3);
    });
  });

  it("rating a set leaves its drop's own RPE alone", async () => {
    const view = await pushSession();
    await setWithDrop(view);
    const [main, drop] = view.result.current.sets;
    expect(drop).toMatchObject({ rpe: 10, rpeEstimated: true, segmentStyle: 'drop' });

    await act(async () => view.result.current.rateSet(main!.id!, 8));
    expect(view.result.current.sets[0]).toMatchObject({ rpe: 8, rpeEstimated: false });
    expect(view.result.current.sets[1]).toEqual(drop);
    await waitFor(async () => expect(await db.sets.get(main!.id!)).toMatchObject({ rpe: 8, rpeEstimated: false }));
    expect(await db.sets.get(drop!.id!)).toEqual(drop);
  });
});

describe('Train controls', () => {
  it('a long press moves the weight step on, and says so', async () => {
    const view = await pushSession();
    expect(view.result.current.s.step).toBe(2.5);
    await act(async () => view.result.current.setStepByLongPress());
    expect(view.result.current.s.step).toBe(5);
    expect(view.result.current.s.toast?.text).toBe('Step 5 kg');
    await act(async () => view.result.current.setStepByLongPress());
    expect(view.result.current.s.step).toBe(1.25);
  });

  it('reordering moves a lift in this session only, and the lift on screen stays on screen', async () => {
    const view = await pushSession();
    await act(async () => view.result.current.moveSessionLift(0, 1));
    expect(view.result.current.openSession?.exerciseIds).toEqual(['overhead-press', 'barbell-bench-press']);
    expect(view.result.current.activeExerciseId).toBe('barbell-bench-press');
    expect(view.result.current.routineById('my-push')?.slots[0]?.exerciseId).toBe('barbell-bench-press');
  });
});

// ─────────────────────────────────────────────────────────────

describe('training methods', () => {
  // The routines the browser tests import, so both suites exercise the same
  // shapes.
  const FIXTURE = JSON.parse(readFileSync(join(process.cwd(), 'e2e', 'fixtures', 'methods.json'), 'utf8')) as {
    routines: Routine[];
  };
  const routine = (id: string) => FIXTURE.routines.find((r) => r.id === id)!;

  async function training(routineId: string) {
    const view = await mount();
    await act(async () => {
      await view.result.current.saveRoutine(routine(routineId));
    });
    await act(async () => view.result.current.startSession(routineId));
    await waitFor(() => expect(view.result.current.openSession).not.toBeNull());
    return view;
  }

  async function select(view: Awaited<ReturnType<typeof mount>>, exerciseId: string) {
    const index = view.result.current.exerciseIds.indexOf(exerciseId);
    await act(async () => view.result.current.pickExercise(index));
  }

  async function log(view: Awaited<ReturnType<typeof mount>>, changes: Partial<BompaValue['s']> = {}) {
    const before = view.result.current.sets.length;
    if (Object.keys(changes).length > 0) await act(async () => view.result.current.patch(changes));
    await act(async () => view.result.current.logSet());
    await waitFor(() => expect(view.result.current.sets).toHaveLength(before + 1));
  }

  describe('a routine with no methods', () => {
    it('saves with exactly the shape it went in with', async () => {
      const { result } = await mount();
      await act(async () => {
        await result.current.saveRoutine(PUSH);
      });
      const stored = await db.routines.get(PUSH.id);
      expect(stored?.slots).toEqual(PUSH.slots);
    });

    it('logs rows with no method fields, rests on the preset and loads nothing new', async () => {
      const view = await mount();
      await act(async () => {
        await view.result.current.saveRoutine(PUSH);
      });
      await act(async () => view.result.current.startSession(PUSH.id));
      await waitFor(() => expect(view.result.current.openSession).not.toBeNull());
      await log(view);

      const row = view.result.current.sets[0]!;
      // The id is stamped by the write-back and was always there.
      expect(Object.keys(row).filter((key) => key !== 'id').sort()).toEqual(
        ['at', 'exerciseId', 'reps', 'rpe', 'rpeEstimated', 'sessionId', 'setNo', 'type', 'weightKg'].sort(),
      );
      expect(view.result.current.restKind).toBe('full');
      expect(view.result.current.restTotalMs).toBe(150_000);
      expect(view.result.current.segment).toBeNull();
      expect(view.result.current.activeMethod?.scheme).toBeNull();
      expect(view.result.current.activeSetTarget).toMatchObject({ reps: 8, weightKg: 80, setCount: 4, restSec: 150, amrap: false });
    });
  });

  describe('schemes', () => {
    it('each logged set loads the next set of the wave, and the target follows it', async () => {
      const view = await training('methods-schemes');
      const { result } = view;
      expect(result.current.s.entryWeight).toBe(85);
      expect(result.current.s.entryReps).toBe(7);
      expect(result.current.activeSetTarget).toMatchObject({ setIndex: 0, setCount: 6, reps: 7, weightKg: 85 });

      await log(view);
      expect(result.current.s.entryWeight).toBe(90);
      expect(result.current.s.entryReps).toBe(5);
      expect(result.current.activeSetTarget).toMatchObject({ setIndex: 1, reps: 5, weightKg: 90 });

      // Overriding one set's weight does not move the next one.
      await log(view, { entryWeight: 100 });
      expect(result.current.s.entryWeight).toBe(95);
    });

    it('copies the tempo onto the set, so history keeps it if the routine changes', async () => {
      const view = await training('methods-schemes');
      await log(view);
      expect(view.result.current.sets[0]!.tempo).toEqual([2, 1, 1, 0]);
      expect(view.result.current.activeMethod?.note).toBe('Two down, one hold, one up.');
    });

    it('a scheme with rests of 90, 60, 45 and 30 runs those rests after sets one to four', async () => {
      const view = await training('methods-schemes');
      await select(view, 'barbell-bench-press');
      const rests: number[] = [];
      for (let i = 0; i < 5; i++) {
        await log(view);
        rests.push(view.result.current.restTotalMs / 1000);
        await act(async () => view.result.current.skipRest());
      }
      expect(rests).toEqual([90, 60, 45, 30, 150]);
    });

    it('a scheme entry typed back-off pre-selects back-off when the logger reaches it', async () => {
      const view = await training('methods-schemes');
      await select(view, 'barbell-row');
      for (let i = 0; i < 4; i++) {
        expect(view.result.current.s.entryType).toBe('working');
        await log(view);
      }
      expect(view.result.current.s.entryType).toBe('backoff');
      expect(view.result.current.s.entryReps).toBe(10);
      expect(view.result.current.s.entryWeight).toBe(50); // 0.7 x 70 = 49, on the 2.5 step
      await log(view);
      expect(view.result.current.sets.at(-1)!.type).toBe('backoff');
    });

    it('marks the AMRAP set as such on the row, and only that set', async () => {
      const view = await training('methods-schemes');
      await select(view, 'overhead-press');
      for (let i = 0; i < 3; i++) await log(view);
      expect(view.result.current.sets.map((row) => row.amrap === true)).toEqual([false, false, true]);
    });

    it('snapshots the rep style and hold length, and never onto a warm-up', async () => {
      const view = await training('methods-schemes');
      await select(view, 'calf-raise');
      await log(view, { entryType: 'warmup' });
      await log(view);
      await log(view, { entryHoldSec: 20 });
      const [warm, first, second] = view.result.current.sets;
      expect(warm).not.toHaveProperty('repStyle');
      expect(first).toMatchObject({ repStyle: 'isometric', holdSec: 10 });
      expect(second).toMatchObject({ repStyle: 'isometric', holdSec: 20 });
    });
  });

  describe('pieces', () => {
    it('a planned double drop starts no rest, fills in each dropped weight, then rests in full', async () => {
      const view = await training('methods-pieces');
      const { result } = view;

      await log(view);
      expect(result.current.restActive).toBe(false);
      expect(result.current.segment).toMatchObject({ next: 1, planned: 2, style: 'drop', setNo: 1 });
      expect(result.current.s.entryWeight).toBe(65); // 80 less 20%, on the 2.5 step

      await log(view, { entryReps: 6 });
      expect(result.current.segment).toMatchObject({ next: 2 });
      expect(result.current.s.entryWeight).toBe(52.5);
      expect(result.current.restActive).toBe(false);

      await log(view, { entryReps: 5 });
      expect(result.current.segment).toBeNull();
      expect(result.current.restKind).toBe('full');
      expect(result.current.restActive).toBe(true);

      const rows = result.current.sets;
      expect(rows.map((row) => [row.setNo, row.segment, row.weightKg, row.reps])).toEqual([
        [1, undefined, 80, 8],
        [1, 1, 65, 6],
        [1, 2, 52.5, 5],
      ]);
      // A drop is taken to failure by design; the lifter can correct it.
      expect(rows[1]).toMatchObject({ rpe: 10, rpeEstimated: true, segmentStyle: 'drop', type: 'working' });
    });

    it('the set logged after a drop set with two pieces gets the next set number', async () => {
      const view = await training('methods-pieces');
      await log(view);
      await log(view);
      await log(view);
      await act(async () => view.result.current.skipRest());
      await log(view);
      const rows = view.result.current.sets;
      expect(rows.map((row) => row.setNo)).toEqual([1, 1, 1, 2]);
      expect(rows[3]!.segment).toBeUndefined();
      expect(view.result.current.activeSetTarget?.setIndex).toBe(2);
    });

    it('in pounds, a drop is worked out in pounds and stored in kilograms once', async () => {
      const view = await training('methods-pieces');
      await act(async () => view.result.current.setUnit('lb'));
      await act(async () => view.result.current.patch({ entryWeight: 225 }));
      await log(view);
      expect(view.result.current.s.entryWeight).toBe(180);
      await log(view);
      expect(view.result.current.sets[1]!.weightKg).toBe(toKg(180, 'lb'));
    });

    it('cluster singles pause inline between pieces, never full screen, then rest in full', async () => {
      const view = await training('methods-pieces');
      const { result } = view;
      await select(view, 'deadlift');

      await log(view);
      expect(result.current.restKind).toBe('intra');
      expect(result.current.s.restFull).toBe(false);
      expect(result.current.restTotalMs).toBe(15_000);
      expect(result.current.segment?.pauseEndsAt).toBeGreaterThan(Date.now());
      // The pause lives on the entry card; it cannot be blown up to full screen.
      await act(async () => result.current.showRestFull());
      expect(result.current.s.restFull).toBe(false);

      for (let i = 0; i < 4; i++) await log(view);
      expect(result.current.segment).toBeNull();
      expect(result.current.restKind).toBe('full');
      expect(result.current.restTotalMs).toBe(240_000);

      const pieces = result.current.sets.filter((row) => row.segment !== undefined);
      expect(pieces.map((row) => row.segment)).toEqual([1, 2, 3, 4]);
      // A cluster single is as hard as the set it belongs to.
      expect(pieces.every((row) => row.rpe === 8 && row.weightKg === 140)).toBe(true);
    });

    it('a cluster is rated once, after its last piece, and its singles take the rating', async () => {
      const view = await training('methods-pieces');
      const { result } = view;
      await select(view, 'deadlift');

      await log(view);
      // Between singles nothing is asked.
      expect(result.current.justLoggedRows).toEqual([]);
      for (let i = 0; i < 4; i++) await log(view);
      expect(result.current.justLoggedRows.map((row) => row.segment)).toEqual([undefined]);

      await waitFor(() => expect(result.current.sets.every((row) => row.id !== undefined)).toBe(true));
      await act(async () => result.current.rateSet(result.current.justLoggedRows[0]!.id!, 9));
      expect(result.current.sets.every((row) => row.rpe === 9 && !row.rpeEstimated)).toBe(true);
    });

    it('a rest-pause set with a 50-rep target ends itself on the piece that reaches 50', async () => {
      const view = await training('methods-pieces');
      const { result } = view;
      await select(view, 'lat-pulldown');

      await log(view, { entryReps: 20 });
      expect(result.current.segment).toMatchObject({ repsSoFar: 20, totalReps: 50, planned: null });
      await log(view, { entryReps: 15 });
      await log(view, { entryReps: 10 });
      expect(result.current.segment?.repsSoFar).toBe(45);
      // As many as possible, but never more than is left of the target.
      expect(result.current.s.entryReps).toBe(5);
      await log(view, { entryReps: 5 });
      expect(result.current.segment).toBeNull();
      expect(result.current.restKind).toBe('full');
    });

    it('ending a set early starts the full rest', async () => {
      const view = await training('methods-pieces');
      await log(view);
      await act(async () => view.result.current.endSegments());
      expect(view.result.current.segment).toBeNull();
      expect(view.result.current.restKind).toBe('full');
      expect(view.result.current.sets).toHaveLength(1);
    });

    it('a warm-up never has pieces', async () => {
      const view = await training('methods-pieces');
      await log(view, { entryType: 'warmup' });
      expect(view.result.current.segment).toBeNull();
      expect(view.result.current.restKind).toBe('full');
    });

    it('an unplanned drop cancels the rest and continues the same set 20% lighter', async () => {
      const view = await mount();
      await act(async () => {
        await view.result.current.saveRoutine(PUSH);
      });
      await act(async () => view.result.current.startSession(PUSH.id));
      await waitFor(() => expect(view.result.current.openSession).not.toBeNull());
      await log(view);
      expect(view.result.current.restActive).toBe(true);

      await act(async () => view.result.current.startSegments());
      expect(view.result.current.restActive).toBe(false);
      expect(view.result.current.segment).toMatchObject({ style: 'drop', next: 1, setNo: 1, pauseEndsAt: null });
      expect(view.result.current.s.entryWeight).toBe(65);

      await log(view);
      expect(view.result.current.sets[1]).toMatchObject({ setNo: 1, segment: 1, weightKg: 65 });
      expect(view.result.current.segment).toBeNull();
      expect(view.result.current.restKind).toBe('full');
    });

    it('deleting a set with two drops removes all three rows, on disk too', async () => {
      const view = await training('methods-pieces');
      await log(view);
      await log(view);
      await log(view);
      await waitFor(() => expect(view.result.current.sets.every((row) => row.id !== undefined)).toBe(true));

      const set = view.result.current.sets.find((row) => row.segment === undefined)!;
      await act(async () => view.result.current.deleteSet(set));
      expect(view.result.current.sets).toHaveLength(0);
      await waitFor(async () => expect(await db.sets.count()).toBe(0));
    });

    it('deleting one piece deletes only that piece', async () => {
      const view = await training('methods-pieces');
      await log(view);
      await log(view);
      await waitFor(() => expect(view.result.current.sets.every((row) => row.id !== undefined)).toBe(true));
      const piece = view.result.current.sets.find((row) => row.segment === 1)!;
      await act(async () => view.result.current.deleteSet(piece));
      expect(view.result.current.sets).toHaveLength(1);
    });

    it("changing a set's type changes its pieces' type, and a piece cannot change on its own", async () => {
      const view = await training('methods-pieces');
      await log(view);
      await log(view);
      await log(view);
      await waitFor(() => expect(view.result.current.sets.every((row) => row.id !== undefined)).toBe(true));

      const [set, piece] = view.result.current.sets;
      await act(async () => view.result.current.updateSet(piece!.id!, { type: 'warmup', reps: 7 }));
      expect(view.result.current.sets[1]).toMatchObject({ type: 'working', reps: 7 });

      await act(async () => view.result.current.updateSet(set!.id!, { type: 'backoff' }));
      expect(view.result.current.sets.map((row) => row.type)).toEqual(['backoff', 'backoff', 'backoff']);
      await waitFor(async () => expect((await db.sets.toArray()).map((row) => row.type)).toEqual(['backoff', 'backoff', 'backoff']));
    });

    it('a drop does not advance a superset round', async () => {
      const PAIR: Routine = {
        ...PUSH,
        id: 'dropped-pair',
        slots: [
          { ...PUSH.slots[0]!, supersetGroup: 'A', segments: { style: 'drop', segmentReps: [null], intraRestSec: 0, dropFraction: 0.2 } },
          { ...PUSH.slots[1]!, supersetGroup: 'A' },
        ],
      };
      const view = await mount();
      await act(async () => {
        await view.result.current.saveRoutine(PAIR);
      });
      await act(async () => view.result.current.startSession(PAIR.id));
      await waitFor(() => expect(view.result.current.openSession).not.toBeNull());

      await log(view);
      expect(view.result.current.activeExerciseId).toBe('barbell-bench-press');
      await log(view);
      // The set is over, so now — and only now — the round moves on.
      expect(view.result.current.activeExerciseId).toBe('overhead-press');
      expect(view.result.current.supersetRounds).toBe(0);
    });
  });

  describe('groups', () => {
    it('a triset with gaps of 10 and 10 and a full rest of 180 runs 10 s, 10 s, then 180 s', async () => {
      const view = await training('methods-groups');
      expect(view.result.current.supersetLabel).toBe('Triset B · round 1 of 3');
      const gaps: [string | null, number][] = [];
      for (let i = 0; i < 3; i++) {
        await log(view);
        gaps.push([view.result.current.restKind, view.result.current.restTotalMs / 1000]);
      }
      expect(gaps).toEqual([
        ['transition', 10],
        ['transition', 10],
        ['full', 180],
      ]);
    });

    it('a group of four is a giant set', async () => {
      const view = await training('methods-groups');
      await select(view, 'shrug');
      expect(view.result.current.supersetLabel).toBe('Giant set C · round 1 of 2');
    });
  });

  it('opens and closes a method explainer', async () => {
    const { result } = await mount();
    await act(async () => result.current.openMethodGuide('tempo'));
    expect(result.current.s.methodGuide).toBe('tempo');
    await act(async () => result.current.closeMethodGuide());
    expect(result.current.s.methodGuide).toBeNull();
  });

  it('a saved scheme is normalised, and a copied routine shares no scheme with its source', async () => {
    const { result } = await mount();
    const off: Routine = {
      ...PUSH,
      id: 'off-by-a-bit',
      slots: [{ ...PUSH.slots[0]!, sets: 2, scheme: [{ reps: 5, load: { kind: 'rel', x: 0.9 } }, { reps: 5, load: { kind: 'rel', x: 0.8 } }, { reps: 5 }] }],
    };
    await act(async () => {
      await result.current.saveRoutine(off);
    });
    const stored = (await db.routines.get(off.id))!.slots[0]!;
    expect(stored.sets).toBe(3);
    expect(stored.scheme!.map((e) => e.load)).toEqual([
      { kind: 'rel', x: 0.9 },
      { kind: 'rel', x: 0.8 },
      { kind: 'rel', x: 1 },
    ]);

    await act(async () => {
      await result.current.duplicateRoutine(off.id);
    });
    const copy = result.current.allRoutines.find((r) => r.id !== off.id && r.name.startsWith(off.name))!;
    expect(copy.slots[0]!.scheme).toEqual(stored.scheme);
    expect(copy.slots[0]!.scheme).not.toBe(result.current.allRoutines.find((r) => r.id === off.id)!.slots[0]!.scheme);
  });
});

// ─────────────────────────────────────────────────────────────
// Exercise content providers
// ─────────────────────────────────────────────────────────────

describe('exercise content providers', () => {
  const KEY = 'sk-kept-on-this-device';

  // An in-memory adapter: it answers like a service would without any network,
  // so a fetch anywhere in these tests is a request the app made on its own.
  function fakeProvider(): ContentProvider {
    return {
      id: 'fake',
      name: 'Fake',
      auth: { kind: 'apiKey', headerName: 'X-Api-Key', helpUrl: 'https://fake.example.org/keys' },
      capabilities: { search: true, steps: true, images: false, video: false },
      apiHosts: ['fake.example.org'],
      mediaHosts: ['fake.example.org'],
      cachePolicy: (connection) => ({ textMaxAgeMs: connection.cachingAllowed ? null : 0, imageMaxAgeMs: 0, cacheVideo: false }),
      test: vi.fn(async (ctx) => (ctx.apiKey === KEY ? { ok: true as const } : { ok: false as const, reason: 'unauthorised' as const })),
      search: vi.fn(async (query: string) => (query === 'Bench Press' ? [{ externalId: 'bp-1', name: 'Barbell Bench Press' }] : [])),
      fetchHowTo: vi.fn(async (externalId: string) =>
        externalId === 'bp-1' ? { externalId, steps: ['Fake provider step'], media: [], credit: { line: 'Instructions from Fake' } } : null,
      ),
    };
  }

  let provider: ContentProvider;
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    provider = fakeProvider();
    PROVIDER_ENTRIES.push({ id: 'fake', name: 'Fake', load: async () => provider });
    fetchSpy = vi.fn(async () => new Response('{}'));
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    PROVIDER_ENTRIES.length = 0;
    vi.unstubAllGlobals();
  });

  it('with nothing connected, nothing is fetched: not at startup, not on saving a routine, not for a How-to', async () => {
    const { result } = await mount();
    await act(async () => result.current.saveRoutine(PUSH));
    const resolution = result.current.resolveHowTo('barbell-bench-press');
    expect(resolution.first.textSource).toBe('bundled');
    expect((await resolution.done).textSource).toBe('bundled');
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result.current.contentConnections).toEqual([]);
  });

  it('a failed test reports the reason and saves nothing', async () => {
    const { result } = await mount();
    await expect(result.current.testProvider('fake', { apiKey: 'wrong' })).resolves.toEqual({ ok: false, reason: 'unauthorised' });
    expect(await db.providerConnections.count()).toBe(0);
  });

  it('the key goes to its own table only, never to settings, the sync queue or the exposed state', async () => {
    const { result } = await mount();
    await expect(result.current.testProvider('fake', { apiKey: ` ${KEY} ` })).resolves.toEqual({ ok: true });
    act(() => result.current.connectProvider('fake', { apiKey: KEY }));

    await waitFor(async () => expect(await db.providerConnections.get('fake')).toMatchObject({ apiKey: KEY, cachingAllowed: false }));
    expect(result.current.contentConnections).toEqual([
      expect.objectContaining({ providerId: 'fake', name: 'Fake', hasKey: true, cachingAllowed: false }),
    ]);
    expect(JSON.stringify(result.current.contentConnections)).not.toContain(KEY);
    expect(JSON.stringify(await db.settings.toArray())).not.toContain(KEY);
    expect(JSON.stringify(await db.syncQueue.toArray())).not.toContain(KEY);
  });

  it('suggests, confirms, resolves and survives a reload; disconnecting keeps the links', async () => {
    const first = await mount();
    await act(async () => first.result.current.saveRoutine(PUSH));
    act(() => first.result.current.connectProvider('fake', { apiKey: KEY, cachingAllowed: true }));

    // Connecting looks for matches on its own, once.
    await waitFor(() => expect(first.result.current.linkFor('barbell-bench-press')?.status).toBe('suggested'));
    expect(first.result.current.linkFor('overhead-press')).toBeUndefined();

    // A suggestion supplies nothing.
    expect((await first.result.current.resolveHowTo('barbell-bench-press').done).textSource).toBe('bundled');

    act(() => first.result.current.confirmLinks('fake', ['barbell-bench-press']));
    await waitFor(() => expect(first.result.current.linkFor('barbell-bench-press')?.status).toBe('confirmed'));
    const resolved = await first.result.current.resolveHowTo('barbell-bench-press').done;
    expect(resolved).toMatchObject({ textSource: 'provider', text: { steps: ['Fake provider step'] } });
    await waitFor(async () => expect(await db.contentCache.count()).toBe(1));

    first.unmount();
    const second = await mount();
    expect(second.result.current.linkFor('barbell-bench-press')?.externalId).toBe('bp-1');
    expect(second.result.current.contentConnections).toHaveLength(1);

    await act(async () => second.result.current.disconnectProvider('fake'));
    expect(second.result.current.contentConnections).toEqual([]);
    expect(await db.providerConnections.count()).toBe(0);
    expect(await db.contentCache.count()).toBe(0);
    expect(await db.contentLinks.count()).toBe(1);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('remembers "no match", and a manual link can be undone', async () => {
    const { result } = await mount();
    await act(async () => result.current.saveRoutine(PUSH));
    act(() => result.current.connectProvider('fake', { apiKey: KEY }));
    await waitFor(() => expect(result.current.linkFor('barbell-bench-press')?.status).toBe('suggested'));

    act(() => result.current.linkExercise('fake', 'barbell-bench-press', null));
    act(() => result.current.linkExercise('fake', 'overhead-press', { externalId: 'ohp-9', name: 'Overhead Press' }));
    await waitFor(() => expect(result.current.linkFor('overhead-press')?.status).toBe('confirmed'));

    const search = provider.search as ReturnType<typeof vi.fn>;
    search.mockClear();
    const run = await act(async () => result.current.findMatches('fake'));
    expect(run.searched).toBe(0);
    expect(search).not.toHaveBeenCalled();
    expect(result.current.linkFor('barbell-bench-press')?.status).toBe('none');

    act(() => result.current.unlinkExercise('fake', 'overhead-press'));
    await waitFor(async () => expect(await db.contentLinks.get(['fake', 'overhead-press'])).toBeUndefined());
  });

  it('does not download while a session is in progress', async () => {
    const { result } = await mount();
    await withPlan({ result });
    act(() => result.current.connectProvider('fake', { apiKey: KEY, cachingAllowed: true }));
    await act(async () => result.current.startSession('my-push'));
    await waitFor(() => expect(result.current.openSession).not.toBeNull());
    await expect(result.current.downloadContent('fake')).resolves.toMatchObject({ stoppedBy: 'in-session', done: 0 });
    expect(provider.fetchHowTo).not.toHaveBeenCalled();
  });
});

describe('warm-up checklist', () => {
  const WARMUP = [
    { id: 'cat-cow', name: 'Cat-cow', dose: '8 slow' },
    { id: 'band-marches', name: 'Band marches', dose: '10 each side' },
  ];

  it('persists on the routine, clamped, and a workout with none stores no field at all', async () => {
    const { result } = await mount();
    await act(async () => {
      await result.current.saveRoutine({ ...PUSH, warmup: [...WARMUP, { id: 'x', name: '   ' }] });
      await result.current.saveRoutine(PULL);
    });

    const push = await db.routines.get(PUSH.id);
    // The blank item is dropped on the way in, so what is stored is what is read.
    expect(push?.warmup).toEqual(WARMUP);
    expect(push?.warmupUsesDefault).toBeUndefined();
    const pull = await db.routines.get(PULL.id);
    expect(pull && 'warmup' in pull).toBe(false);
  });

  it('keeps the default warm-up in settings across a reload', async () => {
    const first = await mount();
    expect(first.result.current.defaultWarmup).toEqual([]);
    await act(async () => first.result.current.setDefaultWarmup(WARMUP));
    await waitFor(async () => expect((await db.settings.get('defaultWarmup'))?.value).toEqual(WARMUP));
    first.unmount();

    const second = await mount();
    expect(second.result.current.defaultWarmup).toEqual(WARMUP);
  });

  it("shows the default list for a workout that uses it, and the workout's own otherwise", async () => {
    const { result } = await mount();
    await withPlan({ result });
    await act(async () => {
      result.current.setDefaultWarmup([{ id: 'leg-swings', name: 'Leg swings' }]);
      await result.current.saveRoutine({ ...PUSH, warmup: WARMUP, warmupUsesDefault: true });
    });
    // Nothing to tick before a session starts.
    expect(result.current.activeWarmup).toEqual([]);

    await act(async () => result.current.startSession('my-push'));
    await waitFor(() => expect(result.current.openSession).not.toBeNull());
    expect(result.current.activeWarmup.map((item) => item.name)).toEqual(['Leg swings']);

    await act(async () => {
      await result.current.saveRoutine({ ...PUSH, warmup: WARMUP, warmupUsesDefault: false });
    });
    expect(result.current.activeWarmup).toEqual(WARMUP);
  });

  it('ticking never logs a set or moves a load, and the ticks survive a reload mid-session', async () => {
    const first = await mount();
    await withPlan(first);
    await act(async () => {
      await first.result.current.saveRoutine({ ...PUSH, warmup: WARMUP });
    });
    await act(async () => first.result.current.startSession('my-push'));
    await waitFor(() => expect(first.result.current.openSession?.id).toBeDefined());

    const loadsBefore = JSON.stringify(first.result.current.loads);
    act(() => first.result.current.toggleWarmupItem('cat-cow'));
    act(() => first.result.current.toggleWarmupItem('band-marches'));
    act(() => first.result.current.toggleWarmupItem('band-marches'));
    expect(first.result.current.warmupDone).toEqual(['cat-cow']);

    expect(first.result.current.sessionSets).toHaveLength(0);
    expect(first.result.current.sets).toHaveLength(0);
    expect(JSON.stringify(first.result.current.loads)).toBe(loadsBefore);
    expect(await db.sets.count()).toBe(0);
    await waitFor(async () => expect((await db.settings.get('warmupTicks'))?.value).toMatchObject({ done: ['cat-cow'] }));
    first.unmount();

    const second = await mount();
    expect(second.result.current.openSession).not.toBeNull();
    expect(second.result.current.warmupDone).toEqual(['cat-cow']);
  });

  it('starts the next session with nothing ticked', async () => {
    const { result } = await mount();
    await withPlan({ result });
    await act(async () => {
      await result.current.saveRoutine({ ...PUSH, warmup: WARMUP });
    });
    await act(async () => result.current.startSession('my-push'));
    await waitFor(() => expect(result.current.openSession?.id).toBeDefined());
    act(() => result.current.toggleWarmupItem('cat-cow'));
    expect(result.current.warmupDone).toEqual(['cat-cow']);
    await act(async () => {
      await result.current.finishSession();
    });
    await waitFor(() => expect(result.current.openSession).toBeNull());

    await act(async () => result.current.startSession('my-push'));
    await waitFor(() => expect(result.current.openSession?.id).toBeDefined());
    expect(result.current.warmupDone).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────
// Navigation: the Workouts tab, pushed views and the Settings sheet
// ─────────────────────────────────────────────────────────────

describe('navigation', () => {
  it('a pushed view keeps its tab lit, and Back returns to the tab', async () => {
    const { result } = await mount();
    act(() => result.current.go('workouts'));
    act(() => result.current.openView('timer'));
    expect(result.current.s.tab).toBe('workouts');
    expect(result.current.s.pushed).toEqual({ view: 'timer', from: 'tab' });

    act(() => result.current.closeView());
    expect(result.current.s.pushed).toBeNull();
    expect(result.current.s.settingsOpen).toBe(false);
  });

  it('a view opened from Settings closes the sheet, and Back reopens it', async () => {
    const { result } = await mount();
    act(() => result.current.openSettings());
    act(() => result.current.openView('alerts', 'settings'));
    // Not drawn under the sheet it came from.
    expect(result.current.s.settingsOpen).toBe(false);

    act(() => result.current.closeView());
    expect(result.current.s.pushed).toBeNull();
    expect(result.current.s.settingsOpen).toBe(true);
  });

  it('a tab tap clears any view or sheet left open', async () => {
    const { result } = await mount();
    act(() => result.current.openView('calc'));
    act(() => result.current.openSettings());
    act(() => result.current.go('plan'));
    expect(result.current.s.pushed).toBeNull();
    expect(result.current.s.settingsOpen).toBe(false);
    expect(result.current.s.tab).toBe('plan');
  });

  it('starting a session lands on Train, not on a view left open', async () => {
    const view = await mount();
    await withPlan(view);
    act(() => view.result.current.go('workouts'));
    act(() => view.result.current.openView('timer'));
    act(() => view.result.current.startSession(PUSH.id));
    expect(view.result.current.s.tab).toBe('log');
    expect(view.result.current.s.pushed).toBeNull();
  });

  it('running setup again closes the Settings sheet it was started from', async () => {
    const view = await mount();
    await withPlan(view);
    act(() => view.result.current.openSettings());
    act(() => view.result.current.restartSetup());
    expect(view.result.current.s.settingsOpen).toBe(false);
    expect(view.result.current.needsSetup).toBe(true);
  });
});

describe('last backup', () => {
  it('is never until an export, then kept across a reload', async () => {
    const first = await mount();
    expect(first.result.current.s.lastExportAt).toBeNull();

    const at = Date.UTC(2026, 8, 20, 9);
    act(() => first.result.current.recordExport(at));
    expect(first.result.current.s.lastExportAt).toBe(at);
    await waitFor(async () => expect((await db.settings.get('lastExportAt'))?.value).toBe(at));

    first.unmount();
    const second = await mount();
    expect(second.result.current.s.lastExportAt).toBe(at);
  });

  it('reads a damaged value as never', async () => {
    await db.settings.put({ key: 'lastExportAt', value: 'yesterday' });
    const { result } = await mount();
    expect(result.current.s.lastExportAt).toBeNull();
  });
});
