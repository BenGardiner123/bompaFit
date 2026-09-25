// Export and import. The `Envelope` type is the only interchange format
// v1 accepts, and it round-trips every table except syncQueue and the two
// content tables that must stay on the device: connections (they hold API
// keys) and cached provider content (it belongs to the provider, and a backup
// file is exactly the kind of copy their terms forbid).

import { isKnownProvider } from './content/registry';
import { MAX_ID_CHARS } from './content/provider';
import { db, warn } from './db';
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

/** The settings key the "Last backup" line reads. */
export const LAST_EXPORT_KEY = 'lastExportAt';

/** The later of two times, ignoring anything that is not a real positive timestamp. */
function newestTime(...times: unknown[]): number | null {
  const valid = times.filter((t): t is number => typeof t === 'number' && Number.isFinite(t) && t > 0);
  return valid.length ? Math.max(...valid) : null;
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
      // The last-backup time is the one setting a restore must not simply copy.
      // The file's own record is from the export before it, so copying it would
      // make "Last backup" claim an older date than the file in your hand, or
      // older than a backup this phone made since.
      const localLast = await db.settings.get(LAST_EXPORT_KEY);
      const newestBackup = newestTime(localLast?.value, Date.parse(envelope.exportedAt));
      const settings = envelope.settings.filter((row) => row.key !== LAST_EXPORT_KEY);
      if (settings.length) await db.settings.bulkPut(settings);
      if (newestBackup !== null) await db.settings.put({ key: LAST_EXPORT_KEY, value: newestBackup });
      // Links arrive without connections or content. Nothing is fetched until the
      // user connects the provider on this device.
      if (envelope.contentLinks?.length) await db.contentLinks.bulkPut(envelope.contentLinks);
    },
  );
}

/**
 * How a backup left the app.
 *
 * - `saved`: a save dialog or the share sheet finished, so a file exists somewhere.
 * - `downloaded`: handed to the browser as a download. Nothing reports whether
 *   it landed, so the caller should say where to look rather than promise it.
 * - `cancelled`: the person closed the dialog. No file, and nothing to record.
 */
export type SaveOutcome = 'saved' | 'downloaded' | 'cancelled';

type Writable = { write: (data: Blob) => Promise<void>; close: () => Promise<void> };
type SavePicker = (options: { suggestedName: string; types: { description: string; accept: Record<string, string[]> }[] }) => Promise<{
  createWritable: () => Promise<Writable>;
}>;
type ShareNavigator = { canShare?: (data: { files: File[] }) => boolean; share?: (data: { files: File[]; title?: string }) => Promise<void> };

/** The parts of the browser a save uses. A parameter so tests can hand in fakes. */
export type SaveHost = {
  showSaveFilePicker?: unknown;
  navigator?: unknown;
  download: (blob: Blob, filename: string) => void;
};

function isAbort(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError';
}

/**
 * Save the envelope as a file, preferring a route that tells us it worked: a
 * save dialog on desktop, the share sheet on a phone. Only when neither exists
 * does it fall back to a plain download, which never reports back. Any failure
 * other than a cancel also falls back, so a refused dialog still leaves a file.
 */
export async function saveEnvelope(envelope: Envelope, filename: string, host: SaveHost = browserHost()): Promise<SaveOutcome> {
  const blob = new Blob([JSON.stringify(envelope, null, 2)], { type: 'application/json' });

  if (typeof host.showSaveFilePicker === 'function') {
    try {
      const handle = await (host.showSaveFilePicker as SavePicker)({
        suggestedName: filename,
        types: [{ description: 'Bompa backup', accept: { 'application/json': ['.json'] } }],
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return 'saved';
    } catch (err) {
      if (isAbort(err)) return 'cancelled';
      warn(err);
    }
  } else {
    const nav = host.navigator as ShareNavigator | undefined;
    const file = typeof File === 'function' ? new File([blob], filename, { type: 'application/json' }) : null;
    if (file && typeof nav?.share === 'function' && typeof nav.canShare === 'function' && nav.canShare({ files: [file] })) {
      try {
        await nav.share({ files: [file], title: filename });
        return 'saved';
      } catch (err) {
        if (isAbort(err)) return 'cancelled';
        warn(err);
      }
    }
  }

  host.download(blob, filename);
  return 'downloaded';
}

function browserHost(): SaveHost {
  const w = globalThis as { showSaveFilePicker?: unknown; navigator?: unknown };
  // Bound, because the picker throws when called detached from the window.
  const picker = typeof w.showSaveFilePicker === 'function' ? (w.showSaveFilePicker as SavePicker).bind(globalThis) : undefined;
  return { showSaveFilePicker: picker, navigator: w.navigator, download: downloadBlob };
}

/** Trigger a download of a file. Browser-only. */
function downloadBlob(blob: Blob, filename: string): void {
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
