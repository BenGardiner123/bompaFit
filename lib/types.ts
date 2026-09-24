// Domain types: the shape of every record the app stores, exports and imports.

export type Phase = 'hypertrophy' | 'strength' | 'power' | 'peak' | 'deload';

/**
 * Warm-ups are excluded from session load, chip counts, personal records and
 * RPE deviation. This lives in version(1) of the schema on purpose: working out
 * after the fact which historical sets were warm-ups means guessing, and a wrong
 * guess corrupts the fatigue model in a way nobody notices.
 */
export type SetType = 'warmup' | 'working' | 'backoff';

export type Unit = 'kg' | 'lb';

export type Exercise = {
  /** Stable slug, e.g. 'barbell-bench-press'. Never a display name. */
  id: string;
  name: string;
  /** Short label shown on the exercise chips in the logger. */
  short: string;
  muscle: string;
  pattern: string;
  equipment: string;
  kind: 'compound' | 'accessory';
  source: 'seed' | 'free-exercise-db' | 'wger' | 'user';
  /**
   * Licence for this entry's content, as an SPDX-style identifier.
   *
   * Per-entry rather than per-source because some exercise datasets license
   * their content *entry by entry* — there is no single blanket licence to
   * point at. Anything ingested records its own terms or it doesn't get
   * ingested, because working out afterwards which movement came under which
   * licence is not possible.
   */
  licence: string;
  /** Credit line shown in the interface, where the licence requires one. */
  attribution?: string;
};

export type HowTo = {
  exerciseId: string;
  muscles: string;
  mediaNote: string;
  steps: string[];
  /**
   * Optional because Free Exercise DB records how to perform a movement and
   * nothing about what people get wrong with it. The seeded 14 have a
   * hand-written fault; the ingested ones have none, and the sheet drops the
   * block rather than printing an invented one.
   */
  fault?: string;
};

// ─────────────────────────────────────────────────────────────
// Training methods
//
// Every field below is optional and unindexed, so nothing already stored needs
// rewriting: an absent field means exactly what the row meant before these
// existed. Stored values are only ever read through lib/methods.ts, which
// clamps them — this is plain JSON that can be hand-edited or imported.
// ─────────────────────────────────────────────────────────────

/** One phase of a tempo, in seconds. 'X' means as fast as you can move it. */
export type TempoPhase = number | 'X';

/**
 * Lowering, pause at the bottom, lifting, pause at the top — always in that
 * order. A tuple rather than a string, because "4010" cannot say ten seconds.
 */
export type Tempo = [TempoPhase, TempoPhase, TempoPhase, TempoPhase];

/**
 * What a single rep is. Absent means a normal full-range rep.
 *
 * Separate from tempo because it changes what a rep *is*, and that decides
 * whether a set can claim a record. Tempo only changes how long a rep takes.
 */
export type RepStyle =
  | 'full'
  | 'one-and-half' // a full rep plus a half rep at one end, counted as one
  | 'twenty-ones' // 7 bottom-half + 7 top-half + 7 full, logged as 21
  | 'partial' // a deliberately shortened range
  | 'eccentric-only' // lowering only; a spotter or the other limb does the lifting
  | 'isometric'; // a held position; reps are holds and holdSec is their length

export type SegmentStyle = 'drop' | 'mechanical-drop' | 'cluster' | 'rest-pause';

/**
 * How a set carries on past its first piece. One shape for drops, clusters and
 * rest-pause, because all three are "one set made of pieces separated by a
 * short pause, possibly lighter each time".
 */
export type SegmentPlan = {
  style: SegmentStyle;
  /** Reps for each piece after the first. null means as many as possible. */
  segmentReps: (number | null)[];
  /** Seconds between pieces. 0 for a classic drop set. */
  intraRestSec: number;
  /** Fraction of the load removed before each further piece. 0 for clusters and mechanical drops. */
  dropFraction: number;
  /** A rest-pause target such as "50 reps in total": keep adding pieces until it is reached. */
  totalReps?: number;
  /**
   * Optional names for the pieces of a mechanical drop, first piece included —
   * ["incline", "flat"] means the set starts on the incline and moves to flat.
   */
  labels?: string[];
};

/** How one set of a scheme expresses its load. Absent means { kind: 'rel', x: 1 }. */
export type SetLoad =
  /** Fraction of the slot's working weight. The heaviest in a scheme is exactly 1. */
  | { kind: 'rel'; x: number }
  /** Fraction of the lift's estimated one-rep max. */
  | { kind: 'pct'; x: number }
  /** A fixed weight, ALWAYS kilograms. Adaptation cannot move it. */
  | { kind: 'kg'; x: number };

/** One set of a per-set scheme: a wave, a pyramid, 10-to-1 and so on. */
export type SetPrescription = {
  reps: number;
  /** Top of a rep range, e.g. 6 in "4–6". */
  repsMax?: number;
  /** As many reps as possible, with `reps` as the minimum to hit. */
  amrap?: boolean;
  load?: SetLoad;
  /** Rest after this set, overriding the slot's and the user's. */
  restSec?: number;
  /** 'backoff' for the lighter sets that follow the main work. Never 'warmup'. */
  type?: 'working' | 'backoff';
};

export type RoutineSlot = {
  exerciseId: string;
  order: number;
  /** When `scheme` is present this mirrors its length; saving keeps the two in step. */
  sets: number;
  reps: number;
  /** null means derive the weight from targetPct1RM against the current e1RM. */
  targetWeightKg: number | null;
  targetPct1RM: number | null;
  targetRpe: number;
  /** Slots sharing a letter are performed together as a superset. */
  supersetGroup: string | null;

  tempo?: Tempo;
  repStyle?: RepStyle;
  /** Length of each hold, in seconds, for repStyle 'isometric'. */
  holdSec?: number;
  /** Top of a rep range for plain straight sets. */
  repsMax?: number;
  /** When present, its length replaces `sets` and each entry is one set. */
  scheme?: SetPrescription[];
  segments?: SegmentPlan;
  /** Full rest after a set of this lift, overriding the user's rest preset. */
  restSec?: number;
  /** Inside a group: the gap after this member, overriding the group's gap. */
  gapAfterSec?: number;
  /** Free text for what the model does not capture. Capped at 140 characters. */
  note?: string;
};

export type Routine = {
  /** Stable slug, minted client-side by lib/ids.ts — this table has no ++id. */
  id: string;
  name: string;
  /**
   * `template` is a bundled starting point that is never loaded into a plan on
   * its own; it has to be copied into a `user` routine first. Everything the
   * plan actually schedules is `user` or `import`.
   */
  source: 'template' | 'user' | 'import' | 'saved';
  phase: Phase;
  /** Rough minutes, shown in the library. */
  estMinutes: number;
  slots: RoutineSlot[];
  /**
   * Seconds of deliberate gap between the lifts of a superset, keyed by group
   * letter. Absent or zero means straight into the next lift, which is what a
   * superset normally is — some programmes prescribe a short breather instead.
   *
   * Optional and not indexed, so routines written before this existed read as
   * undefined and resolve to zero: exactly the old behaviour, no migration.
   */
  supersetRest?: Record<string, number>;
  /**
   * This workout's own warm-up checklist, shown on Train when a session starts.
   * Optional and unindexed like `supersetRest`, so older rows need no
   * migration. Read only through lib/warmup.ts, which clamps it.
   */
  warmup?: WarmupItem[];
  /** Show the lifter's default warm-up instead of `warmup`. Absent means false. */
  warmupUsesDefault?: boolean;
};

/**
 * One move on a warm-up checklist. Never a logged set: ticking it touches no
 * load, record or chip count. `dose` is free text — "5 each side", "30 s".
 */
export type WarmupItem = {
  id: string;
  name: string;
  dose?: string;
};

export type Plan = {
  id?: number;
  name: string;
  /** YYYY-MM-DD, local. Always a Monday, so week boundaries line up. */
  startDate: string;
  /**
   * When the plan was actually created, epoch ms.
   *
   * `startDate` is snapped back to the Monday of the week the user set the plan
   * up in, so a plan created on a Wednesday owns two days that had already
   * passed. Without this, the missed-session sweep would greet a brand-new user
   * with "you skipped Monday" for a day before they installed the app.
   */
  createdAt: number;
  /**
   * The routines the week cycles through, in order. A 4-session week over
   * [push, pull, legs] runs push, pull, legs, push — and carries the cursor into
   * the next week rather than restarting.
   */
  rotation: string[];
  /** How many sessions a week the plan schedules. Not which days. */
  sessionsPerWeek: number;
  competitionId?: number;
};

export type Block = {
  id?: number;
  planId: number;
  phase: Phase;
  /** Working weeks, not counting deload. */
  weeks: number;
  deloadWeeks: number;
  startDate: string;
  /**
   * The workouts this block cycles through, in order, when it has its own.
   * Absent means the plan's `rotation` — which is how every block written
   * before this existed reads, so it needed no new schema version: optional
   * and unindexed, like `PlannedSession.userModified`.
   *
   * The slots were generated from it already; this records the choice so it
   * can be shown, and so a version made for the block can take its place.
   */
  rotation?: string[];
};

/**
 * `rest` and `adjusted` are gone. Rest days were an artefact of enumerating
 * weekdays, and "adjusted" duplicated the `adjustedByBompa` flag that already
 * meant it.
 */
export type PlannedStatus = 'plan' | 'done' | 'skip';

/**
 * A planned session belongs to a *week*, not a day.
 *
 * Training days vary, so pinning a routine to a weekday makes the app invent
 * "you missed Monday" against days the user never intended to train. The week is
 * the commitment; which day you do it is yours.
 */
export type PlannedSession = {
  id?: number;
  planId: number;
  blockId: number;
  /** Monday of the week this slot belongs to. Always Monday — see MODEL.WEEK_ANCHOR. */
  weekStart: string;
  /** Order within the week. Dense, 0..n-1, renumbered on every reorder or drop. */
  slotIndex: number;
  routineId: string;
  status: PlannedStatus;
  /**
   * The day it was actually trained. Present if and only if `status === 'done'`
   * — a pending slot has no date, which is what stops anyone writing
   * `p.date === todayKey` again.
   */
  date?: string;
  /** Set once the session is actually logged. */
  sessionId?: number;
  adjustedByBompa: boolean;
  /**
   * Set on the slots of a week the user has rearranged by hand — moved,
   * swapped, or left standing after a drop. Bompa's own changes set
   * `adjustedByBompa` instead; these two answer different questions and must
   * not be collapsed into one flag.
   *
   * Optional and unindexed on purpose, so this needed no `version(3)`. An
   * absent field reads as false, which is exactly how every row already
   * behaved — the same reasoning as `Routine.supersetRest`.
   *
   * A week is user-modified when any of its slots carries this. There is no
   * week entity to hang it on, and it cannot be derived from the adjustment
   * log: `Adjustment.scope` names a slot rather than a week, and a dropped
   * slot deliberately writes no adjustment before deleting its own row.
   */
  userModified?: boolean;
  /** Multiplier applied to prescribed volume, 1 = as programmed. */
  volumeFactor: number;
};

export type Session = {
  id?: number;
  date: string;
  plannedSessionId?: number;
  routineId: string;
  /** Snapshot — routines can be renamed later and history must not follow. */
  routineName: string;
  /** Snapshot of the exercise order presented at session start. */
  exerciseIds: string[];
  startedAt: number;
  /** Drives the 4-hour auto-close. */
  lastSetAt: number;
  elapsedMs: number;
  /** Absent means the session is still open. */
  finishedAt?: number;
  autoClosed?: boolean;
};

export type LoggedSet = {
  id?: number;
  sessionId: number;
  /** Foreign key into exercises. Never a name, never an index. */
  exerciseId: string;
  setNo: number;
  type: SetType;
  /** ALWAYS kilograms. Converted from display units once, when the set is written. */
  weightKg: number;
  reps: number;
  rpe: number;
  /** True when the programmed target RPE was substituted for a missing entry. */
  rpeEstimated: boolean;
  at: number;

  /**
   * Absent or 0: this row is a set. 1..n: a later piece of the set with the same
   * `setNo` — a drop, a cluster single, a rest-pause mini-set. One row per piece
   * so each keeps its own honest weight and reps, and tonnage stays addition.
   */
  segment?: number;
  /** Which kind of piece this is. Only present when segment >= 1. */
  segmentStyle?: SegmentStyle;
  // The next four are snapshots of the prescription when the set was logged.
  // History must not change meaning when the routine is edited later, for the
  // same reason `Session.exerciseIds` is a snapshot.

  /** Absent means a full-range rep. */
  repStyle?: RepStyle;
  /** This set was prescribed as many-as-possible. */
  amrap?: boolean;
  /** Display only. */
  tempo?: Tempo;
  /** Length of each hold, in seconds, for isometric sets. */
  holdSec?: number;
};

export type AdjustmentScope =
  | { kind: 'lift'; exerciseId: string }
  | { kind: 'session'; plannedSessionId: number }
  | { kind: 'block'; blockId: number };

export type Adjustment = {
  id?: number;
  at: number;
  planId: number;
  scope: AdjustmentScope;
  /** Machine-readable rule id, e.g. 'rpe-drift-high'. */
  rule: string;
  /** Enough detail to restore the prior state exactly. */
  before: unknown;
  after: unknown;
  /** The sentence shown to the user. */
  narrative: string;
  revertedAt?: number;
};

export type Competition = {
  id?: number;
  name: string;
  date: string;
  location: string;
};

export type Setting = { key: string; value: unknown };

export type SyncItem = {
  id?: number;
  table: string;
  op: 'put' | 'delete';
  payload: unknown;
  at: number;
};

/** The export envelope: the one file format for backup and restore. */
export type Envelope = {
  version: 1;
  exportedAt: string;
  exercises: Exercise[];
  routines: Routine[];
  plans: Plan[];
  blocks: Block[];
  plannedSessions: PlannedSession[];
  sessions: Session[];
  sets: LoggedSet[];
  adjustments: Adjustment[];
  competitions: Competition[];
  settings: Setting[];
  /**
   * Optional so a backup written before movements could be linked to a
   * content service still reads as version 1. Absent means "none recorded",
   * which the importer reports rather than refuses.
   */
  contentLinks?: ContentLink[];
};

// ─────────────────────────────────────────────────────────────
// Exercise content providers
//
// A provider is a service the user already has access to, which supplies
// instructions and pictures for movements Bompa already has. What it sends
// is the provider's content under the user's own account, so it is kept on
// this device only: never exported, never queued for sync.
// ─────────────────────────────────────────────────────────────

/**
 * "Bompa's barbell-back-squat is this provider's entry X."
 *
 * Keyed by exerciseId, never a name, so renaming a movement cannot repoint
 * it. Only a confirmed link ever supplies content: a suggestion is a
 * question, and a wrong automatic match shown with a credit line looks
 * authoritative while teaching the wrong lift.
 */
export type ContentLink = {
  providerId: string;
  exerciseId: string;
  /** null when status is 'none' — the user said the provider has no match. */
  externalId: string | null;
  /** What the provider calls it, shown when reviewing suggestions. */
  externalName?: string;
  status: 'suggested' | 'confirmed' | 'none';
  method: 'auto' | 'manual';
  at: number;
};

/**
 * One connected provider, including its API key.
 *
 * Lives in its own table because `settings` is exported whole, and a key in
 * there would sit in plain text in every backup file.
 */
export type ProviderConnection = {
  providerId: string;
  connectedAt: number;
  apiKey?: string;
  /** Only for providers that can be self-hosted. */
  baseUrl?: string;
  /**
   * The user's own statement that their plan lets them keep content on the
   * device. Defaults to false: the user is the one bound by the terms, and a
   * wrong "yes" is a breach of their contract, not ours to guess into.
   */
  cachingAllowed: boolean;
  /** Order among several connected providers; lower wins. */
  rank: number;
};

export type ProviderCredit = {
  /** e.g. "Instructions from wger". */
  line: string;
  /** Per entry where the provider licenses entry by entry. */
  licence?: string;
  /**
   * Where the licence's terms can be read. Creative Commons attribution asks
   * for a link to the licence, not just its name.
   */
  licenceUrl?: string;
  author?: string;
  url?: string;
};

export type ProviderMedia = { kind: 'image' | 'video'; url: string; credit?: ProviderCredit };

/** A provider's instructions, already normalised. Plain strings only — never HTML. */
export type ProviderHowTo = {
  externalId: string;
  /** 1–20 entries, each at most 400 characters. */
  steps: string[];
  fault?: string;
  muscles?: string;
  media: ProviderMedia[];
  credit: ProviderCredit;
};

/** A provider's content as stored on the device. */
export type ContentCacheRow = {
  providerId: string;
  externalId: string;
  howTo: ProviderHowTo;
  fetchedAt: number;
  /**
   * When the provider's terms say this copy must go. null means no limit.
   * Indexed, and null is left out of the index on purpose: a row that never
   * expires is never visited by the sweep.
   */
  expiresAt: number | null;
  /** The image saved in the content bucket, if any. */
  imageUrl?: string;
  imageExpiresAt?: number | null;
};
