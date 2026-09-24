import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { db } from './db';
import { ENVELOPE_VERSION, applyEnvelope, buildEnvelope, parseEnvelope } from './exchange';
import { normaliseSlot, resolveSlotMethod } from './methods';
import { PROVIDER_ENTRIES } from './content/providers';
import type { ContentProvider } from './content/provider';
import type { ContentLink, Exercise, LoggedSet, Session } from './types';

const NOW = new Date(2026, 7, 19, 18, 0, 0).getTime();

const SESSION: Session = {
  id: 1,
  date: '2026-08-19',
  routineId: 'push',
  routineName: 'Push Day',
  exerciseIds: ['barbell-bench-press'],
  startedAt: NOW,
  lastSetAt: NOW,
  elapsedMs: 3600_000,
  finishedAt: NOW + 60_000,
};

const SET: LoggedSet = {
  id: 1,
  sessionId: 1,
  exerciseId: 'barbell-bench-press',
  setNo: 1,
  type: 'working',
  weightKg: 80,
  reps: 8,
  rpe: 7,
  rpeEstimated: false,
  at: NOW,
};

async function clearAll() {
  await Promise.all([
    db.exercises.clear(),
    db.routines.clear(),
    db.plans.clear(),
    db.blocks.clear(),
    db.plannedSessions.clear(),
    db.sessions.clear(),
    db.sets.clear(),
    db.adjustments.clear(),
    db.competitions.clear(),
    db.settings.clear(),
    db.syncQueue.clear(),
    db.contentLinks.clear(),
    db.contentCache.clear(),
    db.providerConnections.clear(),
  ]);
}

beforeEach(async () => {
  await clearAll();
});

describe('the database', () => {
  it('opens with every table the app needs', async () => {
    await db.open();
    const names = db.tables.map((t) => t.name).sort();
    expect(names).toEqual(
      [
        'adjustments',
        'blocks',
        'competitions',
        'contentCache',
        'contentLinks',
        'exercises',
        'plannedSessions',
        'plans',
        'providerConnections',
        'routines',
        'sessions',
        'sets',
        'settings',
        'syncQueue',
      ].sort(),
    );
  });

  it('stores and reads back a logged set unchanged', async () => {
    await db.sets.put(SET);
    expect(await db.sets.get(1)).toEqual(SET);
  });

  it('finds sets by session without a full scan', async () => {
    await db.sets.bulkPut([SET, { ...SET, id: 2, sessionId: 2 }]);
    expect(await db.sets.where('sessionId').equals(1).toArray()).toHaveLength(1);
  });
});

describe('export and import', () => {
  it('a round trip through an empty database reproduces the data', async () => {
    await db.sessions.put(SESSION);
    await db.sets.put(SET);
    await db.settings.put({ key: 'unit', value: 'kg' });

    const envelope = await buildEnvelope(new Date(NOW).toISOString());
    const text = JSON.stringify(envelope);

    await clearAll();
    expect(await db.sets.count()).toBe(0);

    const parsed = parseEnvelope(text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    await applyEnvelope(parsed.envelope);

    expect(await db.sessions.get(1)).toEqual(SESSION);
    expect(await db.sets.get(1)).toEqual(SET);
    expect(await db.settings.get('unit')).toEqual({ key: 'unit', value: 'kg' });
  });

  it('does not carry the sync queue across', async () => {
    await db.syncQueue.put({ id: 1, table: 'sets', op: 'put', payload: SET, at: NOW });
    const envelope = await buildEnvelope(new Date(NOW).toISOString());
    expect(Object.keys(envelope)).not.toContain('syncQueue');
  });

  it('is idempotent — importing the same file twice adds nothing new', async () => {
    await db.sets.put(SET);
    const envelope = await buildEnvelope(new Date(NOW).toISOString());
    await applyEnvelope(envelope);
    await applyEnvelope(envelope);
    expect(await db.sets.count()).toBe(1);
  });

  it('reports which sections were missing rather than refusing', () => {
    const result = parseEnvelope(JSON.stringify({ version: ENVELOPE_VERSION, exportedAt: '', sets: [SET] }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.counts.sets).toBe(1);
    expect(result.missing).toContain('sessions');
    expect(result.envelope.sessions).toEqual([]);
  });
});

describe('import validation', () => {
  it('rejects malformed JSON with a message that says what to do', () => {
    const result = parseEnvelope('{not json');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/valid JSON/i);
  });

  it('rejects a JSON file that is not an export', () => {
    const result = parseEnvelope('[1,2,3]');
    expect(result.ok).toBe(false);
  });

  it('rejects a future envelope version rather than guessing at its shape', () => {
    const result = parseEnvelope(JSON.stringify({ version: 99, sets: [] }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('version 99');
  });

  it('rejects a section that is the wrong shape, and changes nothing', async () => {
    const result = parseEnvelope(JSON.stringify({ version: ENVELOPE_VERSION, sets: { nope: true } }));
    expect(result.ok).toBe(false);
    expect(await db.sets.count()).toBe(0);
  });

  it('imports user-created movements and drops a stale copy of the bundled library', async () => {
    const mine: Exercise = {
      id: 'zercher-squat',
      name: 'Zercher Squat',
      short: 'Zercher',
      muscle: 'Quads · Compound',
      pattern: 'Squat',
      equipment: 'Barbell',
      kind: 'compound',
      source: 'user',
      licence: 'user-authored',
    };
    // What a backup from before the v3 migration looks like: the whole shipped
    // library, copied into a table that no longer holds it.
    const stale: Exercise = { ...mine, id: 'back-squat', name: 'Back Squat', source: 'seed', licence: 'CC0-1.0' };

    await applyEnvelope({
      version: ENVELOPE_VERSION,
      exportedAt: new Date(NOW).toISOString(),
      exercises: [mine, stale],
      routines: [],
      plans: [],
      blocks: [],
      plannedSessions: [],
      sessions: [],
      sets: [],
      adjustments: [],
      competitions: [],
      settings: [],
    });

    const stored = await db.exercises.toArray();
    // The v3 migration has already run and will not run again, so a reinstated
    // seed row would sit there for good.
    expect(stored.map((e) => e.id)).toEqual(['zercher-squat']);
  });
});

describe('training methods in a backup', () => {
  // The same file the browser tests import, so the fixture they rely on is
  // proven to be a valid export as well.
  const FIXTURE = readFileSync(join(process.cwd(), 'e2e', 'fixtures', 'methods.json'), 'utf8');

  it('a routine using every method and a session containing a drop set come back unchanged', async () => {
    const parsed = parseEnvelope(FIXTURE);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const original = parsed.envelope;

    await applyEnvelope(original);
    const text = JSON.stringify(await buildEnvelope(new Date(NOW).toISOString()));

    await clearAll();
    const again = parseEnvelope(text);
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    await applyEnvelope(again.envelope);

    const routines = (await db.routines.toArray()).sort((a, b) => a.id.localeCompare(b.id));
    expect(routines).toEqual([...original.routines].sort((a, b) => a.id.localeCompare(b.id)));
    expect(await db.sessions.toArray()).toEqual(original.sessions);
    expect((await db.sets.toArray()).sort((a, b) => a.id! - b.id!)).toEqual(original.sets);

    // Spot-check that the fields that matter really made the trip.
    const pieces = (await db.sets.toArray()).filter((row) => row.segment !== undefined);
    expect(pieces.map((row) => [row.segment, row.segmentStyle])).toEqual([
      [1, 'drop'],
      [2, 'drop'],
    ]);
    const squat = routines.find((r) => r.id === 'methods-schemes')!.slots[0]!;
    expect(squat.tempo).toEqual([2, 1, 1, 0]);
    expect(squat.scheme).toHaveLength(6);
  });

  it('the fixture routines are already in the shape saving would write', () => {
    const parsed = parseEnvelope(FIXTURE);
    if (!parsed.ok) throw new Error(parsed.error);
    for (const routine of parsed.envelope.routines) {
      for (const slot of routine.slots) expect(normaliseSlot(slot)).toEqual(slot);
    }
    // And between them they use every rep style and every kind of piece.
    const slots = parsed.envelope.routines.flatMap((r) => r.slots);
    const styles = new Set(slots.map((s) => resolveSlotMethod(s).repStyle));
    expect([...styles].sort()).toEqual(['eccentric-only', 'full', 'isometric', 'one-and-half', 'partial', 'twenty-ones']);
    const pieces = new Set(slots.map((s) => resolveSlotMethod(s).segments?.style).filter(Boolean));
    expect([...pieces].sort()).toEqual(['cluster', 'drop', 'mechanical-drop', 'rest-pause']);
  });

  it('keeps the envelope at version 1', async () => {
    expect(ENVELOPE_VERSION).toBe(1);
    expect((await buildEnvelope(new Date(NOW).toISOString())).version).toBe(1);
  });
});

describe('blocks in a backup', () => {
  it("a block's own workouts come back, and a block without any still has none", async () => {
    const own = { id: 1, planId: 1, phase: 'strength' as const, weeks: 4, deloadWeeks: 1, startDate: '2026-08-17', rotation: ['push-a-strength', 'legs-b'] };
    const plain = { id: 2, planId: 1, phase: 'peak' as const, weeks: 3, deloadWeeks: 0, startDate: '2026-09-21' };
    await db.blocks.bulkPut([own, plain]);

    const text = JSON.stringify(await buildEnvelope(new Date(NOW).toISOString()));
    await clearAll();
    const parsed = parseEnvelope(text);
    if (!parsed.ok) throw new Error(parsed.error);
    await applyEnvelope(parsed.envelope);

    expect(await db.blocks.get(1)).toEqual(own);
    const back = await db.blocks.get(2);
    expect(back).toEqual(plain);
    expect(back && 'rotation' in back).toBe(false);
  });
});

describe('warm-ups in a backup', () => {
  it("a workout's own warm-up, the default-list switch and the default list all come back unchanged", async () => {
    const warmup = [
      { id: 'cat-cow', name: 'Cat-cow', dose: '8 slow' },
      { id: 'w2', name: 'Kettlebell halos' },
    ];
    const defaults = [{ id: 'leg-swings', name: 'Leg swings', dose: '10 each way' }];
    const routine = {
      id: 'legs',
      name: 'Legs',
      source: 'user' as const,
      phase: 'strength' as const,
      estMinutes: 40,
      slots: [],
      warmup,
      warmupUsesDefault: true,
    };
    await db.routines.put(routine);
    await db.settings.put({ key: 'defaultWarmup', value: defaults });

    const text = JSON.stringify(await buildEnvelope(new Date(NOW).toISOString()));
    await clearAll();
    const parsed = parseEnvelope(text);
    if (!parsed.ok) throw new Error(parsed.error);
    await applyEnvelope(parsed.envelope);

    expect(await db.routines.get('legs')).toEqual(routine);
    expect((await db.settings.get('defaultWarmup'))?.value).toEqual(defaults);
  });
});

// ─────────────────────────────────────────────────────────────
// Links to content providers
// ─────────────────────────────────────────────────────────────

describe('links to a content provider in a backup', () => {
  const SECRET = 'sk-this-must-never-reach-a-file';
  const LINKS: ContentLink[] = [
    { providerId: 'fake', exerciseId: 'barbell-back-squat', externalId: 'sq-1', externalName: 'Barbell Squat', status: 'confirmed', method: 'auto', at: NOW },
    { providerId: 'fake', exerciseId: 'deadlift', externalId: null, status: 'none', method: 'manual', at: NOW },
  ];

  beforeEach(() => {
    // The registry ships empty; links are only kept for a service Bompa has an adapter for.
    PROVIDER_ENTRIES.push({ id: 'fake', name: 'Fake', load: async () => ({ id: 'fake' }) as ContentProvider });
  });

  afterEach(() => {
    PROVIDER_ENTRIES.length = 0;
  });

  async function withContent() {
    await db.contentLinks.bulkPut(LINKS);
    await db.providerConnections.put({ providerId: 'fake', connectedAt: NOW, apiKey: SECRET, cachingAllowed: true, rank: 0 });
    await db.contentCache.put({
      providerId: 'fake',
      externalId: 'sq-1',
      howTo: { externalId: 'sq-1', steps: ['Provider-owned instruction text'], media: [], credit: { line: 'From Fake' } },
      fetchedAt: NOW,
      expiresAt: null,
    });
  }

  it('exports the links and no key and no cached content anywhere in the file', async () => {
    await withContent();
    const text = JSON.stringify(await buildEnvelope(new Date(NOW).toISOString()));
    const parsed = JSON.parse(text) as Record<string, unknown>;
    expect(parsed.contentLinks).toEqual(LINKS);
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain('Provider-owned instruction text');
    expect(Object.keys(parsed)).not.toContain('providerConnections');
    expect(Object.keys(parsed)).not.toContain('contentCache');
  });

  it('importing into an empty database restores the links, and only the links', async () => {
    await withContent();
    const text = JSON.stringify(await buildEnvelope(new Date(NOW).toISOString()));
    await clearAll();

    const parsed = parseEnvelope(text);
    if (!parsed.ok) throw new Error(parsed.error);
    expect(parsed.counts.contentLinks).toBe(2);
    await applyEnvelope(parsed.envelope);

    expect(await db.contentLinks.toArray()).toEqual(expect.arrayContaining(LINKS));
    expect(await db.providerConnections.count()).toBe(0);
    expect(await db.contentCache.count()).toBe(0);
  });

  it('a backup from before links existed imports and reports them absent', async () => {
    const result = parseEnvelope(JSON.stringify({ version: ENVELOPE_VERSION, exportedAt: '', sets: [SET] }));
    if (!result.ok) throw new Error(result.error);
    expect(result.missing).toContain('contentLinks');
    expect(result.envelope.contentLinks).toEqual([]);
    await applyEnvelope(result.envelope);
    expect(await db.sets.count()).toBe(1);
  });

  it('drops and counts rows that could not have come from Bompa', () => {
    const bad = [
      { ...LINKS[0], providerId: 'no-such-service' },
      { ...LINKS[0], status: 'maybe' },
      { ...LINKS[0], externalId: 'x'.repeat(201) },
      { ...LINKS[0], externalId: null },
      { ...LINKS[0], exerciseId: '' },
      { ...LINKS[0], at: 'yesterday' },
      'not even an object',
    ];
    const result = parseEnvelope(JSON.stringify({ version: ENVELOPE_VERSION, exportedAt: '', contentLinks: [...LINKS, ...bad] }));
    if (!result.ok) throw new Error(result.error);
    expect(result.envelope.contentLinks).toEqual(LINKS);
    expect(result.counts.contentLinks).toBe(2);
    expect(result.dropped.contentLinks).toBe(bad.length);
  });

  it('refuses a links section that is not a list, and changes nothing', () => {
    const result = parseEnvelope(JSON.stringify({ version: ENVELOPE_VERSION, exportedAt: '', contentLinks: {} }));
    expect(result.ok).toBe(false);
  });
});
