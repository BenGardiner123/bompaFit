// The warm-up routine: a short checklist of mobility and activation moves done
// before the first lift. It is a reminder, not training data — nothing here
// creates a logged set or feeds the fatigue model. (The "warm-up" set type is a
// different thing: ramp-up sets of the lift itself, which are logged.)
//
// Stored values are plain JSON that can be hand-edited or imported, so every
// read goes through `readWarmupItems`, which clamps them. Pure, so it tests
// with plain fixtures. The helpers the on-demand editor and Train card share
// are in lib/warmupList.ts.

import { uniqueId } from './ids';
import { WARMUP_LIMITS } from './warmupList';
import type { Routine, WarmupItem } from './types';

export { WARMUP_LIMITS };

/**
 * A stored list, checked. Anything that is not an object with a non-empty name
 * is dropped; names and doses are trimmed and cut to length; ids are kept when
 * they are usable and unique, and minted from the name when they are not, so a
 * tick can never land on two items at once.
 */
export function readWarmupItems(raw: unknown): WarmupItem[] {
  if (!Array.isArray(raw)) return [];
  const out: WarmupItem[] = [];
  const taken = new Set<string>();
  for (const entry of raw) {
    if (out.length >= WARMUP_LIMITS.ITEMS) break;
    if (typeof entry !== 'object' || entry === null) continue;
    const row = entry as Record<string, unknown>;
    const name = typeof row.name === 'string' ? row.name.trim().slice(0, WARMUP_LIMITS.NAME).trim() : '';
    if (!name) continue;
    const rawId = typeof row.id === 'string' ? row.id.trim().slice(0, WARMUP_LIMITS.NAME) : '';
    const id = rawId && !taken.has(rawId) ? rawId : uniqueId(name, (candidate) => taken.has(candidate));
    taken.add(id);
    const dose = typeof row.dose === 'string' ? row.dose.trim().slice(0, WARMUP_LIMITS.DOSE).trim() : '';
    out.push(dose ? { id, name, dose } : { id, name });
  }
  return out;
}

/**
 * The list a workout actually shows: the lifter's default when the workout
 * says to use it, otherwise its own. No routine means no warm-up — a session
 * whose routine was deleted still logs, it just has nothing to tick.
 */
export function resolveWarmup(routine: Pick<Routine, 'warmup' | 'warmupUsesDefault'> | null | undefined, defaults: unknown): WarmupItem[] {
  if (!routine) return [];
  return readWarmupItems(routine.warmupUsesDefault ? defaults : routine.warmup);
}

/**
 * Which items are ticked, stored against the session they belong to. Keyed on
 * the session's start time rather than its database id because the id arrives
 * a moment after the session opens, and a tick in that moment would be lost.
 * A stored value for any other session reads as nothing ticked — that is what
 * resets the list for the next workout.
 */
export type WarmupTicks = { sessionKey: number; done: string[] };

export function readWarmupTicks(raw: unknown, sessionKey: number | null): string[] {
  if (sessionKey === null || typeof raw !== 'object' || raw === null) return [];
  const row = raw as Record<string, unknown>;
  if (row.sessionKey !== sessionKey || !Array.isArray(row.done)) return [];
  return [...new Set(row.done.filter((id): id is string => typeof id === 'string' && id.length > 0))].slice(0, WARMUP_LIMITS.ITEMS);
}

/** Tick or untick one item. */
export function toggleTick(done: readonly string[], id: string): string[] {
  return done.includes(id) ? done.filter((x) => x !== id) : [...done, id];
}
