// Export and import. The `Envelope` type is the only interchange format
// v1 accepts, and it round-trips every table except syncQueue and the two
// content tables that must stay on the device: connections (they hold API
// keys) and cached provider content (it belongs to the provider, and a backup
// file is exactly the kind of copy their terms forbid).

import { isKnownProvider } from './content/registry';
import { MAX_ID_CHARS } from './content/provider';
import { db } from './db';
import type { ContentLink, Envelope } from './types';

export const ENVELOPE_VERSION = 1;

export async function buildEnvelope(exportedAt: string): Promise<Envelope> {
  const [exercises, routines, plans, blocks, plannedSessions, sessions, sets, adjustments, competitions, settings, contentLinks] =
    await Promise.all([
      db.exercises.toArray(),
      db.routines.toArray(),
      db.plans.toArray(),
      db.blocks.toArray(),
      db.plannedSessions.toArray(),
      db.sessions.toArray(),
      db.sets.toArray(),
      db.adjustments.toArray(),
      db.competitions.toArray(),
      db.settings.toArray(),
      db.contentLinks.toArray(),
    ]);

  return {
    version: ENVELOPE_VERSION,
    exportedAt,
    exercises,
    routines,
    plans,
    blocks,
    plannedSessions,
    sessions,
    sets,
    adjustments,
    competitions,
    settings,
    contentLinks,
  };
}

export type ParseResult =
  | {
      ok: true;
      envelope: Envelope;
      counts: Record<string, number>;
      missing: string[];
      /** Rows refused by validation, per section. Only sections that dropped any appear. */
      dropped: Record<string, number>;
    }
  | { ok: false; error: string };

const TABLES = [
  'exercises',
  'routines',
  'plans',
  'blocks',
  'plannedSessions',
  'sessions',
  'sets',
  'adjustments',
  'competitions',
  'settings',
] as const;

/**
 * Validate before touching the database. An import that half-succeeds is worse
 * than one that refuses, so parsing and writing are separate steps and the
 * preview happens in between.
 */
export function parseEnvelope(text: string): ParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: "That file isn't valid JSON. Check it's the file Bompa exported." };
  }

  if (typeof raw !== 'object' || raw === null) {
    return { ok: false, error: 'That file is valid JSON but not a Bompa export — expected an object at the top level.' };
  }

  const obj = raw as Record<string, unknown>;
  if (obj.version !== ENVELOPE_VERSION) {
    return { ok: false, error: `This export is version ${String(obj.version)}. Bompa reads version ${ENVELOPE_VERSION}.` };
  }

  const counts: Record<string, number> = {};
  const missing: string[] = [];
  const envelope = { version: ENVELOPE_VERSION, exportedAt: String(obj.exportedAt ?? '') } as Envelope;

  for (const table of TABLES) {
    const value = obj[table];
    if (value === undefined) {
      missing.push(table);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (envelope as any)[table] = [];
      continue;
    }
    if (!Array.isArray(value)) {
      return { ok: false, error: `The "${table}" section should be a list, but it isn't. Nothing was imported.` };
    }
    counts[table] = value.length;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (envelope as any)[table] = value;
  }

  const dropped: Record<string, number> = {};
  const rawLinks = obj.contentLinks;
  if (rawLinks === undefined) {
    missing.push('contentLinks');
    envelope.contentLinks = [];
  } else if (!Array.isArray(rawLinks)) {
    return { ok: false, error: `The "contentLinks" section should be a list, but it isn't. Nothing was imported.` };
  } else {
    const links = rawLinks.filter(isValidLink);
    envelope.contentLinks = links;
    counts.contentLinks = links.length;
    if (links.length < rawLinks.length) dropped.contentLinks = rawLinks.length - links.length;
  }

  return { ok: true, envelope, counts, missing, dropped };
}

const LINK_STATUSES = new Set(['suggested', 'confirmed', 'none']);
const LINK_METHODS = new Set(['auto', 'manual']);

function shortString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_ID_CHARS;
}

/**
 * A link row is accepted only when every field is the shape the app writes.
 * An external id only ever travels URL-encoded to its own adapter's hosts, so
 * even a hand-edited file cannot point a request anywhere else — but there is
 * still no reason to keep a row that could not have come from Bompa.
 */
function isValidLink(raw: unknown): raw is ContentLink {
  if (typeof raw !== 'object' || raw === null) return false;
  const row = raw as Record<string, unknown>;
  if (!isKnownProvider(row.providerId)) return false;
  if (!shortString(row.exerciseId)) return false;
  if (typeof row.status !== 'string' || !LINK_STATUSES.has(row.status)) return false;
  if (typeof row.method !== 'string' || !LINK_METHODS.has(row.method)) return false;
  if (typeof row.at !== 'number' || !Number.isFinite(row.at)) return false;
  if (row.externalName !== undefined && (typeof row.externalName !== 'string' || row.externalName.length > MAX_ID_CHARS)) return false;
  // "No match" is the only status that may lack an entry to point at.
  if (row.status === 'none') return row.externalId === null || shortString(row.externalId);
  return shortString(row.externalId);
}

/** Write a parsed envelope. bulkPut so re-importing the same file is idempotent. */
export async function applyEnvelope(envelope: Envelope): Promise<void> {
  await db.transaction(
    'rw',
    [
      db.exercises,
      db.routines,
      db.plans,
      db.blocks,
      db.plannedSessions,
      db.sessions,
      db.sets,
      db.adjustments,
      db.competitions,
      db.settings,
      db.contentLinks,
    ],
    async () => {
      // User-created movements only. A backup from before the v3 migration carries
      // a copy of the bundled library, which the table no longer holds
      // — importing one would reinstate rows the v3 migration has already been
      // and gone, leaving them there for good. Nothing is lost by dropping
      // them: they are shipped content and the app has its own copy.
      const ownExercises = envelope.exercises.filter((exercise) => exercise.source === 'user');
      if (ownExercises.length) await db.exercises.bulkPut(ownExercises);
      if (envelope.routines.length) await db.routines.bulkPut(envelope.routines);
      if (envelope.plans.length) await db.plans.bulkPut(envelope.plans);
      if (envelope.blocks.length) await db.blocks.bulkPut(envelope.blocks);
      if (envelope.plannedSessions.length) await db.plannedSessions.bulkPut(envelope.plannedSessions);
      if (envelope.sessions.length) await db.sessions.bulkPut(envelope.sessions);
      if (envelope.sets.length) await db.sets.bulkPut(envelope.sets);
      if (envelope.adjustments.length) await db.adjustments.bulkPut(envelope.adjustments);
      if (envelope.competitions.length) await db.competitions.bulkPut(envelope.competitions);
      if (envelope.settings.length) await db.settings.bulkPut(envelope.settings);
      // Links arrive without connections or content. Nothing is fetched until the
      // user connects the provider on this device.
      if (envelope.contentLinks?.length) await db.contentLinks.bulkPut(envelope.contentLinks);
    },
  );
}

/** Trigger a download of the envelope. Browser-only. */
export function downloadEnvelope(envelope: Envelope, filename: string): void {
  const blob = new Blob([JSON.stringify(envelope, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke on the next tick — revoking synchronously can cancel the download in
  // some browsers before it starts.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
