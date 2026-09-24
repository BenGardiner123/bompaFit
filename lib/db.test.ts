import Dexie from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import { BompaDB } from './db';

const NAME = 'bompa-db-upgrade-test';

// The schema exactly as versions 1 to 3 left it. Declared by hand rather than
// imported, because the point is to prove that a database written by the old
// app — which knew nothing of later versions — opens in the new one.
const V1_STORES = {
  exercises: 'id, name, pattern',
  routines: 'id, source',
  plans: '++id, startDate',
  blocks: '++id, planId, startDate',
  plannedSessions: '++id, planId, date, blockId',
  sessions: '++id, date, startedAt',
  sets: '++id, sessionId, exerciseId, at',
  adjustments: '++id, at, planId',
  competitions: '++id, date',
  settings: 'key',
  syncQueue: '++id, at',
};

function openAtVersion3(): Dexie {
  const old = new Dexie(NAME);
  old.version(1).stores(V1_STORES);
  old.version(2).stores({ plannedSessions: '++id, planId, blockId, weekStart, [planId+weekStart]' });
  old.version(3).stores({});
  return old;
}

const AT = Date.UTC(2026, 8, 21, 18);

// One row in every table, each shaped as the app writes it.
const ROWS: Record<string, unknown[]> = {
  exercises: [
    { id: 'my-lift', name: 'My Lift', short: 'Mine', muscle: 'Chest', pattern: 'push', equipment: 'barbell', kind: 'compound', source: 'user', licence: 'user-authored' },
  ],
  routines: [{ id: 'my-push', name: 'My Push', source: 'user', phase: 'strength', estMinutes: 50, slots: [] }],
  plans: [{ id: 1, name: 'Plan', startDate: '2026-09-21', createdAt: AT, rotation: ['my-push'], sessionsPerWeek: 3 }],
  blocks: [{ id: 1, planId: 1, phase: 'strength', weeks: 4, deloadWeeks: 1, startDate: '2026-09-21' }],
  plannedSessions: [
    { id: 1, planId: 1, blockId: 1, weekStart: '2026-09-21', slotIndex: 0, routineId: 'my-push', status: 'plan', adjustedByBompa: false, volumeFactor: 1 },
  ],
  sessions: [{ id: 1, date: '2026-09-21', routineId: 'my-push', routineName: 'My Push', exerciseIds: ['my-lift'], startedAt: AT, lastSetAt: AT, elapsedMs: 0, finishedAt: AT }],
  sets: [{ id: 1, sessionId: 1, exerciseId: 'my-lift', setNo: 1, type: 'working', weightKg: 100, reps: 5, rpe: 8, rpeEstimated: false, at: AT }],
  adjustments: [{ id: 1, at: AT, planId: 1, scope: { kind: 'lift', exerciseId: 'my-lift' }, rule: 'rpe-drift-high', before: 100, after: 97.5, narrative: 'Eased off.' }],
  competitions: [{ id: 1, name: 'Meet', date: '2026-12-01', location: 'Hall' }],
  settings: [{ key: 'unit', value: 'kg' }],
  syncQueue: [{ id: 1, table: 'sets', op: 'put', payload: {}, at: AT }],
};

afterEach(async () => {
  await Dexie.delete(NAME);
});

describe('the content tables arrive without disturbing anything', () => {
  it('a database written by the previous version opens with every row intact and the new tables empty', async () => {
    const old = openAtVersion3();
    await old.open();
    for (const [table, rows] of Object.entries(ROWS)) await old.table(table).bulkPut(rows);
    old.close();

    const upgraded = new BompaDB(NAME);
    await upgraded.open();
    expect(upgraded.verno).toBe(4);

    for (const [table, rows] of Object.entries(ROWS)) {
      expect(await upgraded.table(table).toArray(), table).toEqual(rows);
    }
    expect(await upgraded.contentLinks.count()).toBe(0);
    expect(await upgraded.contentCache.count()).toBe(0);
    expect(await upgraded.providerConnections.count()).toBe(0);
    upgraded.close();
  });

  it('the new tables answer the queries the app makes of them', async () => {
    const fresh = new BompaDB(NAME);
    await fresh.open();
    await fresh.contentLinks.put({ providerId: 'p', exerciseId: 'squat', externalId: 'x1', status: 'confirmed', method: 'manual', at: AT });
    await fresh.contentCache.bulkPut([
      { providerId: 'p', externalId: 'x1', howTo: { externalId: 'x1', steps: ['Go'], media: [], credit: { line: 'From p' } }, fetchedAt: AT, expiresAt: AT + 10 },
      { providerId: 'p', externalId: 'x2', howTo: { externalId: 'x2', steps: ['Go'], media: [], credit: { line: 'From p' } }, fetchedAt: AT, expiresAt: null },
    ]);
    await fresh.providerConnections.put({ providerId: 'p', connectedAt: AT, cachingAllowed: false, rank: 0 });

    expect(await fresh.contentLinks.get(['p', 'squat'])).toMatchObject({ externalId: 'x1' });
    expect(await fresh.contentLinks.where('status').equals('confirmed').count()).toBe(1);
    // A row with no expiry is absent from the index, so a sweep never visits it.
    expect(await fresh.contentCache.where('expiresAt').below(Number.MAX_SAFE_INTEGER).count()).toBe(1);
    expect(await fresh.providerConnections.get('p')).toMatchObject({ rank: 0 });
    fresh.close();
  });
});
