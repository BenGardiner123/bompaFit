// Dexie / IndexedDB. Everything the app persists goes through here — no
// component talks to IndexedDB directly.
//
// RULE: never edit version(1) in place. Schema changes ship as
// db.version(2).stores({...}).upgrade(tx => ...). Editing an existing version
// destroys the history of anyone who already installed the app.

import Dexie, { type Table } from 'dexie';
import { dateKey } from './calc';
import { migratePlannedSessions, planWeekStart, type LegacyPlannedSession } from './schedule';
import type {
  Adjustment,
  Block,
  Competition,
  ContentCacheRow,
  ContentLink,
  Exercise,
  LoggedSet,
  Plan,
  PlannedSession,
  ProviderConnection,
  Routine,
  Session,
  Setting,
  SyncItem,
} from './types';

export class BompaDB extends Dexie {
  exercises!: Table<Exercise, string>;
  routines!: Table<Routine, string>;
  plans!: Table<Plan, number>;
  blocks!: Table<Block, number>;
  plannedSessions!: Table<PlannedSession, number>;
  sessions!: Table<Session, number>;
  sets!: Table<LoggedSet, number>;
  adjustments!: Table<Adjustment, number>;
  competitions!: Table<Competition, number>;
  settings!: Table<Setting, string>;
  syncQueue!: Table<SyncItem, number>;
  contentLinks!: Table<ContentLink, [string, string]>;
  contentCache!: Table<ContentCacheRow, [string, string]>;
  providerConnections!: Table<ProviderConnection, string>;

  constructor(name = 'bompa') {
    super(name);
    this.version(1).stores({
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
    });

    // v2 — planned sessions belong to a week, not a weekday.
    //
    // Only tables whose *indexes* change need listing; Dexie carries the rest
    // forward. The `date` index is dropped deliberately: `date` is now sparse
    // (present only on completed sessions), and a sparse index silently omits
    // every pending row from a `where('date')` query. An index that doesn't
    // exist throws, which is loud. One that returns a wrong subset is not.
    this.version(2)
      .stores({
        plannedSessions: '++id, planId, blockId, weekStart, [planId+weekStart]',
      })
      .upgrade(async (tx) => {
        const table = tx.table('plannedSessions');
        const plans = await tx.table('plans').toArray();
        // Somewhere to put rows whose date is missing or unparseable, so the
        // transform never has to throw. A throw here aborts the version
        // transaction, rejects db.open(), and drops the user into in-memory mode
        // — which looks exactly like their whole history has vanished.
        const fallbackWeek = planWeekStart(
          (plans[0] as { startDate?: string } | undefined)?.startDate ?? dateKey(Date.now()),
        );

        const rows = (await table.toArray()) as LegacyPlannedSession[];
        const { keep, drop } = migratePlannedSessions(rows, fallbackWeek);
        if (drop.length) await table.bulkDelete(drop);
        if (keep.length) await table.bulkPut(keep);
      });

    // v3 — the exercises table holds user-created movements only.
    //
    // It used to hold a copy of the bundled library, written once at first boot
    // and read by nothing but the exporter. That was harmless at 14 movements
    // and stops being harmless at 750: an awaited 750-row write in the hydration
    // path, 170KB of shipped content in every backup file, and a copy frozen at
    // whatever the library looked like the day the database was created — the
    // `count() === 0` seed guard meant it could never be refreshed.
    //
    // Bundled movements live in lib/data.ts and version with the app. What
    // genuinely belongs here is the movement a user invents, because that exists
    // nowhere else. No index changes, so no `.stores()` — this is a data
    // cleanup, and Dexie carries the schema forward.
    this.version(3).upgrade(async (tx) => {
      await tx
        .table('exercises')
        .filter((row: Exercise) => row.source !== 'user')
        .delete();
    });

    // v4 — exercise content from a service the user connects.
    //
    // Three new tables, nothing existing touched, and deliberately no
    // `.upgrade()`: there is no row to transform, so there is nothing that can
    // throw and abort the version transaction — which would drop the user into
    // in-memory mode looking as though their history had vanished.
    //
    // Separate tables because the three have different lifetimes. Links are the
    // user's own decisions and are exported. Cached content is the provider's
    // property, expires on the provider's terms, and must never be exported.
    // Connections hold API keys, which must never leave the device at all.
    this.version(4).stores({
      contentLinks: '[providerId+exerciseId], providerId, exerciseId, status',
      contentCache: '[providerId+externalId], providerId, expiresAt',
      providerConnections: 'providerId',
    });
  }
}

export const db = new BompaDB();

// ─────────────────────────────────────────────────────────────
// Sync queue
// ─────────────────────────────────────────────────────────────

/**
 * Every mutation lands here for a backend that does not exist yet. Nothing
 * drains it. The hook exists so adding sync later doesn't mean reworking every
 * write path.
 */
export function queue(table: string, op: 'put' | 'delete', payload: unknown, at: number): void {
  void db.syncQueue.add({ table, op, payload, at }).catch(warn);
}

// ─────────────────────────────────────────────────────────────
// Settings
// ─────────────────────────────────────────────────────────────

export async function readSettings(): Promise<Record<string, unknown>> {
  const rows = await db.settings.toArray();
  const out: Record<string, unknown> = {};
  for (const r of rows) out[r.key] = r.value;
  return out;
}

export function writeSetting(key: string, value: unknown, at: number): void {
  void db.settings.put({ key, value }).catch(warn);
  queue('settings', 'put', { key, value }, at);
}

// ─────────────────────────────────────────────────────────────
// Storage durability
// ─────────────────────────────────────────────────────────────

/**
 * Ask Chrome not to evict training history under storage pressure. Best effort —
 * some browsers refuse, and that is survivable.
 */
export async function requestPersistence(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.storage?.persist) return false;
  try {
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

export async function isPersisted(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.storage?.persisted) return false;
  try {
    return await navigator.storage.persisted();
  } catch {
    return false;
  }
}

// ─────────────────────────────────────────────────────────────
// Errors
// ─────────────────────────────────────────────────────────────

/**
 * Anyone who wants to know that storage stopped working. Kept as a plain
 * callback list because `lib/` knows nothing about React — the provider
 * subscribes and turns this into something the user can see, so a device that
 * stops saving never looks like it is working normally.
 */
type StorageFailureListener = (err: unknown) => void;
const storageFailureListeners = new Set<StorageFailureListener>();

/**
 * Subscribe to storage failures. Returns its own unsubscribe.
 *
 * Deliberately notifies on *every* failure rather than latching here. A latch
 * in this module would outlive the provider that `afterEach` unmounts and leak
 * into the next test; the subscriber latches instead.
 */
export function onStorageFailure(listener: StorageFailureListener): () => void {
  storageFailureListeners.add(listener);
  return () => {
    storageFailureListeners.delete(listener);
  };
}

/**
 * Storage failures degrade to in-memory operation rather than crashing. Losing
 * history is bad; refusing to open at the gym is worse.
 *
 * The console line is not enough on its own. A device that opens fine and then
 * stops accepting writes looks completely normal while losing every set, which
 * is the one failure this product cannot afford to keep to itself.
 */
export function warn(err: unknown): void {
  console.warn('[bompa] storage write failed, continuing in memory:', err);
  for (const listener of storageFailureListeners) {
    // A listener that throws must not stop the others, and must never turn a
    // failed write into a crash — degrading quietly is the whole point.
    try {
      listener(err);
    } catch {
      /* a broken listener is not worth escalating a failed write over */
    }
  }
}
