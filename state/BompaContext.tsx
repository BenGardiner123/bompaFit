'use client';

// All app state. One context, deliberately — at this size (one screen active,
// one user, no server state) a context is enough, and every state library added
// is a concept the next reader has to learn.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  PRESCRIPTIONS_KEY,
  allTargetRpe,
  redistributeWithinWeek,
  resolveTarget,
  revertPrescription,
  reviewWeek,
  type Prescriptions,
} from '@/lib/adapt';
import {
  DAY_MS,
  acwr,
  buildLoads,
  countsAsWork,
  dateKey,
  daysBetween,
  daysSinceRest,
  e1RM,
  fmtDayMonth,
  fromDateKey,
  intensityAvg,
  startOfWeek,
  toDisplay,
  toKg,
  volumeLoad,
  scores as computeScores,
  type Scores,
} from '@/lib/calc';
import { EXERCISES, EXERCISE_BY_ID, HOWTOS, HOWTO_BY_ID, ROUTINE_TEMPLATES } from '@/lib/data';
import { contextFor, downloadContent as runDownload, resolveHowTo as resolveContent, testConnection, type DownloadRun, type ResolvedHowTo, type Resolution } from '@/lib/content/resolve';
import { findMatches as runFindMatches, isUsableLink, type MatchRun } from '@/lib/content/match';
import { MAX_ID_CHARS, type ExternalMatch, type TestResult } from '@/lib/content/provider';
import { loadProvider, providerEntries, providerEntry } from '@/lib/content/registry';
import { countCached, deleteConnection, deleteLink, putConnection, putLinks, sweepExpired } from '@/lib/content/store';
import { loadHowTo } from '@/lib/howtos';
import { db, onStorageFailure, queue, readSettings, requestPersistence, warn, writeSetting } from '@/lib/db';
import { copyName, uniqueId } from '@/lib/ids';
import { summariseSessions, type SessionSummary } from '@/lib/history';
import { buildInsights, type Insight } from '@/lib/insights';
import { DEFAULT_BLOCKS, generatePlan, predictPeak, reverseTaper, routineLoader, type PeakWindow, type TaperPlan } from '@/lib/plan';
import {
  isOverBudget,
  nextPendingSlot,
  normalisePlannedStatus,
  pendingSlotFor,
  planWeekOf,
  planWeekStart,
  renumber,
  trimToBudget,
  weekBudget,
  weekProgress,
  weekSlots,
  type WeekBudget,
} from '@/lib/schedule';
import {
  cloneSlot,
  fullRestSec,
  isSet,
  nextSegment,
  normaliseSlot,
  readHoldSec,
  resolveSlotMethod,
  roundToStep,
  segmentWeight,
  setTargetAt,
  unplannedSegment,
  type ActiveSetTarget,
  type MethodGuideKey,
  type SlotMethod,
} from '@/lib/methods';
import {
  chipLayout,
  groupFor,
  groupLabel,
  nextInRound,
  normaliseRoutine,
  restAfterSet,
  roundsCompleted,
  workingSetCount,
  type RestKind,
} from '@/lib/supersets';
import type {
  Adjustment,
  Block,
  Competition,
  ContentLink,
  Exercise,
  LoggedSet,
  Phase,
  Plan,
  PlannedSession,
  ProviderConnection,
  Routine,
  RoutineSlot,
  SegmentPlan,
  SegmentStyle,
  Session,
  SetType,
  Unit,
} from '@/lib/types';

/** Where the user's declared starting maxes live in the settings table. */
export const STARTING_MAXES_KEY = 'startingMaxes';

/**
 * Whether first-run setup has been completed or deliberately skipped.
 *
 * An empty plans table alone cannot tell the difference between 'new install'
 * and 'chose not to have a plan', and re-prompting someone who already said no
 * every single launch is its own kind of broken.
 */
export const SETUP_DONE_KEY = 'setupComplete';

/** A session with no set logged for this long is closed automatically. */
const SESSION_IDLE_TIMEOUT_MS = 4 * 3600_000;
/** Elapsed time flushes on this cadence rather than every tick. */
const ELAPSED_FLUSH_MS = 10_000;
const TOAST_MS = 3600;

export type Tab = 'home' | 'log' | 'plan' | 'stats' | 'tools';
export type PlanTab = 'cal' | 'meso' | 'peak';

type Toast = { id: number; text: string } | null;

/**
 * A set in progress that is made of pieces — a drop set between its drops, a
 * cluster between its singles. Null the rest of the time.
 *
 * Held in memory only. A reload mid-set loses it, and the set simply ends at the
 * last piece logged, which is the honest reading of what happened.
 */
export type SegmentState = {
  sessionId: number;
  exerciseId: string;
  /** The set's own number; every piece shares it. */
  setNo: number;
  /** Which set of the lift this is, 0-based, so the rest after it can be looked up. */
  setIndex: number;
  /** The set's type. Every piece carries it, so a set cannot be half one thing. */
  type: SetType;
  style: SegmentStyle;
  plan: SegmentPlan;
  /** The piece about to be logged: 1 for the first drop. */
  next: number;
  /** Pieces after the first the plan asks for, or null when a total-reps target decides. */
  planned: number | null;
  /** Target reps for the next piece; null means as many as possible. */
  nextReps: number | null;
  /** What a mechanical drop changes to for the next piece, if the plan names it. */
  label: string | null;
  /**
   * Wall-clock end of the pause before the next piece, or null for none. The
   * same moment as the rest timer's end time — the countdown derives from the
   * clock like every other timer, so it survives a locked phone.
   */
  pauseEndsAt: number | null;
  /** Reps of every piece logged so far, the first included. */
  pieceReps: number[];
  /** Their sum, for the running total on a total-reps set. */
  repsSoFar: number;
  totalReps: number | null;
  /** The effort of the set's first piece; a cluster's later pieces default to it. */
  parentRpe: number;
  /** Copied onto every piece so history keeps the set's meaning. */
  snapshot: Pick<LoggedSet, 'repStyle' | 'tempo' | 'holdSec'>;
};

type UIState = {
  tab: Tab;
  planTab: PlanTab;
  library: boolean;
  howToKey: string | null;
  editingRoutineId: string | null;
  /** The logged set being amended, if any. Id, never the object — see deleteSet. */
  editingSetId: number | null;
  rpeHelp: boolean;
  /** The warm-up / working / back-off explainer. */
  setTypeHelp: boolean;
  /** Which training-method explainer is open, if any. */
  methodGuide: MethodGuideKey | null;
  toast: Toast;
  statsLift: string;
  /**
   * Whether the rest timer is taking over the whole screen. Separate from the
   * timer itself: minimising hides the big countdown but the rest keeps
   * running, and the remaining time still comes from the stored end time.
   */
  restFull: boolean;
  /**
   * What the session just finished looked like, shown once on its own screen.
   * Null the rest of the time. It holds a copy rather than an id so the summary
   * cannot shift under the reader if history recomputes behind it.
   */
  summary: SessionSummary | null;

  unit: Unit;
  weekStart: 'Mon' | 'Sun';
  step: number;
  restPresetSec: number;

  exIdx: number;
  entryWeight: number;
  entryReps: number;
  entryRpe: number | null;
  entryType: SetType;
  /**
   * Seconds per hold for an isometric set, in the entry card. Null means the
   * slot's own hold length.
   */
  entryHoldSec: number | null;

  calcWeight: number;
  calcReps: number;

  builderPhase: Phase;
  builderWeeks: number;

  hydrated: boolean;
  storageOk: boolean;
};

const INITIAL: UIState = {
  tab: 'home',
  planTab: 'cal',
  library: false,
  howToKey: null,
  editingRoutineId: null,
  editingSetId: null,
  rpeHelp: false,
  setTypeHelp: false,
  methodGuide: null,
  toast: null,
  statsLift: 'barbell-bench-press',
  restFull: false,
  summary: null,

  unit: 'kg',
  weekStart: 'Mon',
  step: 2.5,
  restPresetSec: 150,

  exIdx: 0,
  entryWeight: 80,
  entryReps: 8,
  entryRpe: null,
  entryType: 'working',
  entryHoldSec: null,

  calcWeight: 100,
  calcReps: 5,

  builderPhase: 'strength',
  builderWeeks: 4,

  hydrated: false,
  storageOk: true,
};

/** The prescription fields a piece copies from the set it belongs to. */
function snapshotOf(row: LoggedSet): SegmentState['snapshot'] {
  const out: SegmentState['snapshot'] = {};
  if (row.repStyle !== undefined) out.repStyle = row.repStyle;
  if (row.tempo !== undefined) out.tempo = [...row.tempo];
  if (row.holdSec !== undefined) out.holdSec = row.holdSec;
  return out;
}

export type BompaValue = ReturnType<typeof useBompaState>;

const Ctx = createContext<BompaValue | null>(null);

export function BompaProvider({ children }: { children: ReactNode }) {
  const value = useBompaState();
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useBompa(): BompaValue {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useBompa must be used inside <BompaProvider>');
  return ctx;
}

// ─────────────────────────────────────────────────────────────

function useBompaState() {
  const [s, setS] = useState<UIState>(INITIAL);

  // Training data, mirrored in memory so the interface never awaits IndexedDB.
  const [sessions, setSessions] = useState<Session[]>([]);
  const [sets, setSets] = useState<LoggedSet[]>([]);
  const [planned, setPlanned] = useState<PlannedSession[]>([]);
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [adjustments, setAdjustments] = useState<Adjustment[]>([]);
  const [competition, setCompetition] = useState<Competition | null>(null);
  const [prescriptions, setPrescriptions] = useState<Prescriptions>({});
  const [startingMaxes, setStartingMaxesState] = useState<Record<string, number>>({});
  const [openSession, setOpenSession] = useState<Session | null>(null);
  // Routines are user data now, not a static import. Everything that used to
  // reach for a module-level map reads this instead.
  const [routines, setRoutines] = useState<Routine[]>([]);
  // Movements the user invented, which exist in `db.exercises` and nowhere else.
  // The bundled library is a module constant and is deliberately not stored —
  // see the v3 migration in lib/db.ts for why.
  const [userExercises, setUserExercises] = useState<Exercise[]>([]);
  const [setupDone, setSetupDone] = useState(false);
  // Exercise content from services the user connects. Connections carry API
  // keys, so the full rows stay inside this hook; what the context exposes
  // says whether a key exists, never what it is.
  const [contentLinks, setContentLinks] = useState<ContentLink[]>([]);
  const [connections, setConnections] = useState<ProviderConnection[]>([]);

  // The library the rest of the app sees: what shipped, plus anything the user
  // made. A user row wins on a duplicate id, so someone can correct a bundled
  // movement without the ingest overwriting them on the next regeneration.
  // Memoised on `userExercises` because the merge walks 750 entries and the
  // usual case is that it produces exactly the bundled list.
  const allExercises = useMemo<Exercise[]>(() => {
    if (userExercises.length === 0) return EXERCISES;
    const overridden = new Set(userExercises.map((e) => e.id));
    return [...EXERCISES.filter((e) => !overridden.has(e.id)), ...userExercises];
  }, [userExercises]);

  const allExerciseById = useMemo(
    () => (userExercises.length === 0 ? EXERCISE_BY_ID : new Map(allExercises.map((e) => [e.id, e]))),
    [allExercises, userExercises.length],
  );

  // Wall-clock ticker. Timers derive from it; they never count down themselves.
  const [now, setNow] = useState(() => Date.now());
  const [restEndsAt, setRestEndsAt] = useState<number | null>(null);
  const [restTotalMs, setRestTotalMs] = useState(150_000);
  /**
   * Which kind of rest is running, so the interface can tell a full rest from a
   * superset gap or the few seconds between cluster singles — those two never
   * take the whole screen. Null with no rest running.
   */
  const [restKind, setRestKind] = useState<RestKind | null>(null);
  const [segment, setSegment] = useState<SegmentState | null>(null);

  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTick = useRef(Date.now());
  const lastFlush = useRef(0);

  const patch = useCallback((next: Partial<UIState>) => setS((prev) => ({ ...prev, ...next })), []);

  const say = useCallback((text: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    const id = Date.now();
    setS((prev) => ({ ...prev, toast: { id, text } }));
    toastTimer.current = setTimeout(() => setS((prev) => (prev.toast?.id === id ? { ...prev, toast: null } : prev)), TOAST_MS);
  }, []);

  // ───────────────────────────────────────────────────────────
  // Hydration
  // ───────────────────────────────────────────────────────────

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        await db.open();
        void requestPersistence();

        // The exercise library ships with the app and is NOT copied in here. It
        // used to be, back when it was 14 rows; at 750 that is an awaited write
        // in the hydration path, 170KB of shipped content in every backup file,
        // and a copy frozen at whatever the library looked like on the day the
        // database was created. `db.exercises` now holds user-created movements
        // only — see the v3 migration in lib/db.ts.
        //
        // Routines and plans are different: setup builds those from the user's
        // own answers, and templates exist to be copied and
        // edited, so they have to be rows.
        //
        // Guarded on routines rather than exercises now that nothing seeds that
        // table. An empty routines table means a fresh database — or one the
        // user emptied, in which case handing the starting points back is the
        // right answer anyway.
        if ((await db.routines.count()) === 0) {
          // Templates are copyable starting points, never scheduled on their own.
          await db.routines.bulkPut(ROUTINE_TEMPLATES);
        }

        const planRow = await db.plans.toCollection().first();

        const [
          settingsRow,
          sessionRows,
          setRows,
          plannedRows,
          blockRows,
          routineRows,
          adjustmentRows,
          competitionRow,
          userExerciseRows,
          linkRows,
          connectionRows,
        ] = await Promise.all([
          readSettings(),
          db.sessions.toArray(),
          db.sets.toArray(),
          db.plannedSessions.toArray(),
          db.blocks.toArray(),
          db.routines.toArray(),
          db.adjustments.orderBy('at').reverse().limit(40).toArray(),
          db.competitions.toCollection().first(),
          db.exercises.toArray(),
          db.contentLinks.toArray(),
          db.providerConnections.toArray(),
        ]);

        if (cancelled) return;

        // Provider content past the provider's time limit goes before anything
        // could show it. Local only; with nothing connected there is nothing
        // to sweep and nothing leaves the device.
        void sweepExpired(Date.now()).catch(warn);

        setPlan(planRow ?? null);
        // Routines must land in the same batch as `hydrated`, or the logger
        // renders against an empty list for a frame and decides there is no
        // routine.
        setRoutines(routineRows);
        setBlocks(blockRows);
        setSessions(sessionRows);
        setSets(setRows);
        setPlanned(plannedRows);
        setAdjustments(adjustmentRows);
        setCompetition(competitionRow ?? null);
        setUserExercises(userExerciseRows);
        setContentLinks(linkRows);
        setConnections(connectionRows);
        setPrescriptions((settingsRow[PRESCRIPTIONS_KEY] as Prescriptions) ?? {});
        setStartingMaxesState((settingsRow[STARTING_MAXES_KEY] as Record<string, number>) ?? {});
        setSetupDone(settingsRow[SETUP_DONE_KEY] === true);

        const unit = (settingsRow.unit as Unit) ?? INITIAL.unit;
        patch({
          unit,
          weekStart: (settingsRow.weekStart as 'Mon' | 'Sun') ?? INITIAL.weekStart,
          step: (settingsRow.step as number) ?? (unit === 'kg' ? 2.5 : 5),
          restPresetSec: (settingsRow.restPresetSec as number) ?? INITIAL.restPresetSec,
          statsLift: (settingsRow.statsLift as string) ?? INITIAL.statsLift,
          hydrated: true,
        });
        setRestTotalMs(((settingsRow.restPresetSec as number) ?? INITIAL.restPresetSec) * 1000);

        // Reopen an unfinished session, or close it if it has gone stale.
        const stillOpen = sessionRows.find((row) => row.finishedAt === undefined);
        if (stillOpen) {
          if (Date.now() - stillOpen.lastSetAt > SESSION_IDLE_TIMEOUT_MS) {
            const closed: Session = { ...stillOpen, finishedAt: stillOpen.lastSetAt, autoClosed: true };
            void db.sessions.put(closed).catch(warn);
            setSessions((prev) => prev.map((row) => (row.id === closed.id ? closed : row)));
            say('You left a session open, so I closed it at your last set.');
          } else {
            setOpenSession(stillOpen);
          }
        }
      } catch (err) {
        warn(err);
        // Running from memory is a worse day than running from disk, but it is
        // a much better day than refusing to open at the gym.
        if (!cancelled) patch({ hydrated: true, storageOk: false });
      }
    })();

    return () => {
      cancelled = true;
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
    // Runs once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ───────────────────────────────────────────────────────────
  // Storage failures
  // ───────────────────────────────────────────────────────────

  /**
   * `storageOk` used to be set only when the *initial open* failed, and was
   * only visible if you went looking on Tools. Every write went through
   * `.catch(warn)`, which reached the console and nowhere else — so a device
   * that opened fine and then stopped accepting writes looked completely
   * normal while losing every set logged after that point.
   *
   * Surfaced as a banner in the shell rather than a toast. This is a condition
   * that stays true until reload, not an event, and a toast was measurably
   * wrong: `logSet` says "Set logged. Rest running." on the same tap, which
   * buried the warning under a reassurance that was not true.
   */
  useEffect(() => {
    return onStorageFailure(() => {
      // Idempotent, so no latch is needed here — `patch` with the same value is
      // a no-op and the banner is driven by the condition rather than by an
      // event that has to be caught as it goes past.
      patch({ storageOk: false });
    });
    // `patch` is stable; this subscribes once for the session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ───────────────────────────────────────────────────────────
  // Clocks
  // ───────────────────────────────────────────────────────────

  useEffect(() => {
    const id = setInterval(() => {
      const t = Date.now();
      const delta = t - lastTick.current;
      lastTick.current = t;
      setNow(t);

      // Session elapsed measures active logging time, so it only accrues on the
      // Log tab. Measuring the real delta rather than assuming 1000ms means a
      // throttled tick still books the time it actually covered.
      setOpenSession((prev) => {
        if (!prev || s.tab !== 'log') return prev;
        const next = { ...prev, elapsedMs: prev.elapsedMs + delta };
        if (t - lastFlush.current > ELAPSED_FLUSH_MS) {
          lastFlush.current = t;
          void db.sessions.put(next).catch(warn);
        }
        return next;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [s.tab]);

  // Clamped to the total as well as to zero: `now` comes from the one-second
  // ticker, so a freshly started timer can read a few milliseconds *over* its
  // own duration and briefly display 2:31 on a 2:30 rest.
  const restRemainingMs = restEndsAt === null ? 0 : Math.min(restTotalMs, Math.max(0, restEndsAt - now));
  const restActive = restEndsAt !== null && restRemainingMs > 0;

  // Clear the finished timer so the idle row comes back on its own.
  // The full-screen countdown goes with it; an overlay showing 0:00 over the
  // logger would just be in the way of the next set.
  useEffect(() => {
    if (restEndsAt !== null && restRemainingMs <= 0) {
      setRestEndsAt(null);
      setRestKind(null);
      patch({ restFull: false });
    }
  }, [restEndsAt, restRemainingMs, patch]);

  /**
   * Start a rest from an absolute end time, so a locked phone doesn't drift. A
   * real rest takes the whole screen, because the next thing the lifter needs is
   * how long they have, readable from the bench. A superset's short breather and
   * the pause between cluster singles do not: a takeover would sit between the
   * lifter and the entry card for a meaningful share of a short break.
   */
  const beginRest = useCallback(
    (at: number, sec: number, kind: RestKind) => {
      setRestEndsAt(at + sec * 1000);
      setRestTotalMs(sec * 1000);
      setRestKind(kind);
      patch({ restFull: kind === 'full' });
    },
    [patch],
  );

  /**
   * Clearing matters as much as starting: a straight-through superset must not
   * leave the previous round's timer running behind the entry card.
   */
  const clearRest = useCallback(() => {
    setRestEndsAt(null);
    setRestKind(null);
    patch({ restFull: false });
  }, [patch]);

  // ───────────────────────────────────────────────────────────
  // Derived training data
  // ───────────────────────────────────────────────────────────

  const loads = useMemo(() => buildLoads(sessions, sets), [sessions, sets]);

  const setsByExercise = useMemo(() => {
    const map = new Map<string, LoggedSet[]>();
    for (const row of sets) {
      const arr = map.get(row.exerciseId);
      if (arr) arr.push(row);
      else map.set(row.exerciseId, [row]);
    }
    return map;
  }, [sets]);

  const e1rmByExercise = useMemo(() => {
    // A lift the user has declared a max for but never logged still needs an
    // estimate, or every percentage-based routine prescribes zero kilograms.
    // Logged history wins as soon as it beats the declared number.
    const out: Record<string, number> = { ...startingMaxes };
    for (const [id, rows] of setsByExercise) out[id] = Math.max(e1RM(rows, now), startingMaxes[id] ?? 0);
    return out;
    // `now` changes every second; e1RM only needs the day, so key off that.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setsByExercise, startingMaxes, dateKey(now)]);

  // Read at `now` or the newest session, whichever is later. `now` ticks once a
  // second, so a session finished within a second of its last set can carry a
  // timestamp after it — reading at a stale `now` would leave that session out
  // and show a readiness that ignores what was just done, until the next day.
  const scores: Scores = useMemo(
    () => computeScores(loads, Math.max(now, ...loads.map((load) => load.at))),
    [loads, dateKey(now)], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const ratio = useMemo(() => acwr(loads, now), [loads, dateKey(now)]); // eslint-disable-line react-hooks/exhaustive-deps
  const restDays = useMemo(() => daysSinceRest(loads, now), [loads, dateKey(now)]); // eslint-disable-line react-hooks/exhaustive-deps


  const todayKey = dateKey(now);
  /** The week the plan files things under. Always Monday — see MODEL.WEEK_ANCHOR. */
  const currentWeek = planWeekStart(todayKey);

  const routineById = useCallback(
    (id: string) => routines.find((r) => r.id === id),
    [routines],
  );

  /** This week's slots, in order. Replaces the old "what's on today" lookup. */
  const thisWeekSlots = useMemo(() => weekSlots(planned, currentWeek), [planned, currentWeek]);

  /** The next thing to do, whenever you get to it. */
  const nextSlot = useMemo(() => nextPendingSlot(planned, currentWeek), [planned, currentWeek]);

  const progress = useMemo(() => weekProgress(planned, currentWeek), [planned, currentWeek]);

  const currentBlock = useMemo(() => {
    // From the week, not from "today's session" — a rest day used to leave this
    // null and take the block phase label down with it.
    const slot = thisWeekSlots[0];
    if (slot) return blocks.find((b) => b.id === slot.blockId) ?? null;
    // No slots this week: fall back to whichever block contains it by date.
    const ordered = [...blocks].sort((a, x) => (a.startDate < x.startDate ? -1 : 1));
    let found: Block | null = null;
    for (const b of ordered) if (b.startDate <= currentWeek) found = b;
    return found;
  }, [blocks, thisWeekSlots, currentWeek]);

  const activeRoutine: Routine | null = useMemo(() => {
    const id = openSession?.routineId ?? nextSlot?.routineId ?? '';
    return id ? (routineById(id) ?? null) : null;
  }, [openSession, nextSlot, routineById]);

  const priceSlot = useMemo(
    () => routineLoader(routineById, e1rmByExercise),
    [routineById, e1rmByExercise],
  );

  const peakWindow: PeakWindow = useMemo(
    () => predictPeak(loads, planned, priceSlot, now),
    [loads, planned, priceSlot, dateKey(now)], // eslint-disable-line react-hooks/exhaustive-deps
  );

  /** What this week was meant to cost, against what it is actually costing. */
  const budget: WeekBudget = useMemo(() => {
    const weekStartedAt = fromDateKey(currentWeek);
    const loggedThisWeek = loads
      .filter((l) => l.at >= weekStartedAt)
      .reduce((total, l) => total + l.load, 0);
    return weekBudget({ planned, weekStart: currentWeek, slotLoad: priceSlot, loggedLoad: loggedThisWeek });
  }, [planned, currentWeek, priceSlot, loads]);

  const isDeloadWeek = useMemo(() => {
    if (!currentBlock) return false;
    const weeksIn = Math.floor(daysBetween(currentBlock.startDate, currentWeek) / 7);
    return weeksIn >= currentBlock.weeks;
  }, [currentBlock, currentWeek]);

  const overBudget = useMemo(() => isOverBudget(budget, isDeloadWeek), [budget, isDeloadWeek]);

  const insights: Insight[] = useMemo(
    () =>
      buildInsights({
        scores,
        acwr: ratio,
        recentAdjustments: adjustments.slice(0, 3),
        daysSinceRest: restDays,
        now,
        week: budget,
        weekOverBudget: overBudget,
      }),
    [scores, ratio, adjustments, restDays, now, budget, overBudget],
  );

  const taper: TaperPlan | null = useMemo(
    () => (competition ? reverseTaper(todayKey, competition.date) : null),
    [competition, todayKey],
  );

  const sessionSets = useMemo(
    () => (openSession?.id ? sets.filter((row) => row.sessionId === openSession.id) : []),
    [sets, openSession],
  );

  const exerciseIds = openSession?.exerciseIds ?? activeRoutine?.slots.map((slot) => slot.exerciseId) ?? [];
  const activeExerciseId = exerciseIds[Math.min(s.exIdx, Math.max(0, exerciseIds.length - 1))] ?? null;

  const activeSlot = useMemo(
    () => activeRoutine?.slots.find((slot) => slot.exerciseId === activeExerciseId) ?? null,
    [activeRoutine, activeExerciseId],
  );

  /** The superset the active lift belongs to, if any. */
  const activeGroup = useMemo(() => groupFor(activeRoutine, activeExerciseId), [activeRoutine, activeExerciseId]);

  /** Chip-row layout, so the logger can draw a group as a group. */
  const chips = useMemo(() => chipLayout(exerciseIds, activeRoutine), [exerciseIds, activeRoutine]);

  const supersetLabel = useMemo(
    () => (activeGroup ? groupLabel(activeGroup, sessionSets) : null),
    [activeGroup, sessionSets],
  );

  const supersetRounds = useMemo(
    () => (activeGroup ? roundsCompleted(activeGroup, sessionSets) : 0),
    [activeGroup, sessionSets],
  );

  const activeTarget = useMemo(() => {
    if (!activeSlot) return null;
    return resolveTarget(activeSlot, prescriptions, e1rmByExercise[activeSlot.exerciseId] ?? 0);
  }, [activeSlot, prescriptions, e1rmByExercise]);

  /** How the active lift is trained: tempo, rep style, scheme, pieces, rests, note. */
  const activeMethod: SlotMethod | null = useMemo(
    () => (activeSlot ? resolveSlotMethod(activeSlot) : null),
    [activeSlot],
  );

  /**
   * What *this* set of the active lift asks for — for a wave or a pyramid that
   * changes from set to set, so the whole-lift `activeTarget` is not enough.
   * Indexed by sets of work already logged, pieces not counted.
   */
  const activeSetTarget: ActiveSetTarget | null = useMemo(() => {
    if (!activeSlot || !activeTarget) return null;
    const done = workingSetCount(sessionSets, activeSlot.exerciseId);
    const target = setTargetAt(activeSlot, done, activeTarget.weightKg, e1rmByExercise[activeSlot.exerciseId] ?? 0);
    return {
      ...target,
      // Adaptation can trim the set count; the scheme alone does not know that.
      setCount: activeTarget.sets,
      restSec: target.restSec ?? s.restPresetSec,
      rpe: activeTarget.rpe,
    };
  }, [activeSlot, activeTarget, sessionSets, e1rmByExercise, s.restPresetSec]);

  /**
   * The entry card for a slot's next set. For straight sets this is exactly the
   * adapted target it has always been. For a scheme it is the next entry's
   * reps, weight and type, rounded to the plate step so the stepper shows a
   * weight that can actually be loaded.
   */
  const entryFor = useCallback(
    (slot: RoutineSlot, rowsNow: LoggedSet[]) => {
      const e1rm = e1rmByExercise[slot.exerciseId] ?? 0;
      const target = resolveTarget(slot, prescriptions, e1rm);
      const method = resolveSlotMethod(slot);
      if (!method.scheme) {
        return {
          entryWeight: toDisplay(target.weightKg, s.unit),
          entryReps: target.reps,
          entryType: 'working' as SetType,
          entryHoldSec: null,
        };
      }
      const next = setTargetAt(slot, workingSetCount(rowsNow, slot.exerciseId), target.weightKg, e1rm);
      return {
        entryWeight: roundToStep(toDisplay(next.weightKg, s.unit), s.step),
        entryReps: next.reps,
        entryType: next.type as SetType,
        entryHoldSec: null,
      };
    },
    [prescriptions, e1rmByExercise, s.unit, s.step],
  );

  // ───────────────────────────────────────────────────────────
  // Settings
  // ───────────────────────────────────────────────────────────

  const setUnit = useCallback(
    (unit: Unit) => {
      setS((prev) => {
        if (prev.unit === unit) return prev;
        // Convert the pending entry exactly once, here. Converting on every
        // stepper tap is what accumulates rounding drift.
        const kg = toKg(prev.entryWeight, prev.unit);
        return {
          ...prev,
          unit,
          entryWeight: toDisplay(kg, unit),
          step: unit === 'kg' ? 2.5 : 5,
        };
      });
      writeSetting('unit', unit, Date.now());
      writeSetting('step', unit === 'kg' ? 2.5 : 5, Date.now());
    },
    [],
  );

  const setWeekStart = useCallback((weekStart: 'Mon' | 'Sun') => {
    patch({ weekStart });
    writeSetting('weekStart', weekStart, Date.now());
  }, [patch]);

  const setStep = useCallback((step: number) => {
    patch({ step });
    writeSetting('step', step, Date.now());
  }, [patch]);

  const setRestPreset = useCallback((seconds: number) => {
    patch({ restPresetSec: seconds });
    setRestTotalMs(seconds * 1000);
    writeSetting('restPresetSec', seconds, Date.now());
  }, [patch]);

  const setStatsLift = useCallback((exerciseId: string) => {
    patch({ statsLift: exerciseId });
    writeSetting('statsLift', exerciseId, Date.now());
  }, [patch]);

  // ───────────────────────────────────────────────────────────
  // Navigation
  // ───────────────────────────────────────────────────────────

  const go = useCallback((tab: Tab) => patch({ tab, library: false, howToKey: null }), [patch]);

  const pickExercise = useCallback(
    (index: number) => {
      const id = exerciseIds[index];
      if (!id) return;
      const slot = activeRoutine?.slots.find((x) => x.exerciseId === id);

      if (slot) {
        patch({ exIdx: index, entryRpe: null, ...entryFor(slot, sessionSets) });
        return;
      }

      // An unplanned lift added mid-session has no prescription, so fall back to
      // the last thing the user actually did with it.
      const history = sets.filter((row) => row.exerciseId === id && row.type !== 'warmup');
      const last = history[history.length - 1];
      patch({
        exIdx: index,
        entryWeight: last ? toDisplay(last.weightKg, s.unit) : s.entryWeight,
        entryReps: last?.reps ?? s.entryReps,
        entryRpe: null,
        entryType: 'working',
      });
    },
    [exerciseIds, activeRoutine, entryFor, sessionSets, sets, s.unit, s.entryWeight, s.entryReps, patch],
  );

  /** Add a lift that isn't in today's routine, without changing the routine. */
  const addExerciseToSession = useCallback(
    (exerciseId: string) => {
      if (!openSession) return;
      if (openSession.exerciseIds.includes(exerciseId)) {
        const index = openSession.exerciseIds.indexOf(exerciseId);
        patch({ exIdx: index, library: false });
        return;
      }

      const updated: Session = { ...openSession, exerciseIds: [...openSession.exerciseIds, exerciseId] };
      setOpenSession(updated);
      setSessions((prev) => prev.map((x) => (x.id === updated.id ? updated : x)));
      void db.sessions.put(updated).catch(warn);

      const history = sets.filter((row) => row.exerciseId === exerciseId && row.type !== 'warmup');
      const last = history[history.length - 1];
      patch({
        exIdx: updated.exerciseIds.length - 1,
        entryWeight: last ? toDisplay(last.weightKg, s.unit) : s.entryWeight,
        entryReps: last?.reps ?? s.entryReps,
        entryRpe: null,
        entryType: 'working',
      });
      say(`${EXERCISE_BY_ID.get(exerciseId)?.name ?? 'Lift'} added to this session only.`);
    },
    [openSession, sets, s.unit, s.entryWeight, s.entryReps, patch, say],
  );

  const persistAdjustments = useCallback(async (rows: Adjustment[]) => {
    if (rows.length === 0) return;
    const ids = await db.adjustments.bulkAdd(rows, { allKeys: true }).catch((err) => {
      warn(err);
      return [] as number[];
    });
    const withIds = rows.map((row, i) => ({ ...row, id: (ids as number[])[i] }));
    setAdjustments((prev) => [...withIds, ...prev]);
  }, []);

  // ───────────────────────────────────────────────────────────
  // First-run setup
  // ───────────────────────────────────────────────────────────

  /**
   * Write the plan, its blocks and its slots. Nothing above touches those three
   * tables — this is the only path that creates a plan, which is what guarantees
   * that no schedule exists until the user has said what they train.
   */
  const createPlanFromSetup = useCallback(
    async (args: { rotation: string[]; sessionsPerWeek: number; phase: Phase; weeks: number; name?: string }) => {
      const at = Date.now();

      // Re-running setup replaces the plan rather than stacking a second one on
      // top. Logged sessions and sets are untouched — those are history, not plan.
      if (plan?.id !== undefined) {
        const ids = planned.map((p) => p.id).filter((id): id is number => id !== undefined);
        await db.plannedSessions.bulkDelete(ids).catch(warn);
        await db.blocks.bulkDelete(blocks.map((b) => b.id!).filter((id) => id !== undefined)).catch(warn);
        await db.plans.delete(plan.id).catch(warn);
      }

      const generated = generatePlan({
        name: args.name ?? 'First block',
        startDate: dateKey(at),
        rotation: args.rotation,
        sessionsPerWeek: args.sessionsPerWeek,
        specs: [{ phase: args.phase, weeks: args.weeks, deloadWeeks: 1 }],
        planId: 1,
        createdAt: at,
      });

      await db.plans.put(generated.plan).catch(warn);
      await db.blocks.bulkPut(generated.blocks).catch(warn);
      const ids = await db.plannedSessions.bulkAdd(generated.sessions, { allKeys: true }).catch((err) => {
        warn(err);
        return [] as number[];
      });
      const withIds = generated.sessions.map((row, i) => ({ ...row, id: (ids as number[])[i] }));

      setPlan(generated.plan);
      setBlocks(generated.blocks);
      setPlanned(withIds);
      writeSetting(SETUP_DONE_KEY, true, at);
      setSetupDone(true);
      patch({ tab: 'home' });
    },
    [plan, planned, blocks, patch],
  );

  /**
   * Leave setup without building anything.
   *
   * Recorded so the user is not asked again every launch — "no plan" and "chose
   * not to have one" look identical in the database otherwise.
   */
  const skipSetup = useCallback(() => {
    writeSetting(SETUP_DONE_KEY, true, Date.now());
    setSetupDone(true);
    patch({ tab: 'home' });
  }, [patch]);

  /** Re-open setup from Tools. */
  const restartSetup = useCallback(() => {
    setSetupDone(false);
  }, []);

  /**
   * Accept the offer to bring an over-budget week back on plan.
   *
   * Advisory and one tap — nothing is ever trimmed silently, because an
   * overreaching week is sometimes exactly what you meant to do.
   */
  const trimWeekToBudget = useCallback(async () => {
    if (!plan?.id) return;
    const trimmed = trimToBudget(budget, priceSlot);
    if (trimmed.length === 0) {
      say('Nothing left this week to trim.');
      return;
    }

    const before = budget.remaining;
    setPlanned((prev) => prev.map((p) => trimmed.find((t) => t.id === p.id) ?? p));
    await db.plannedSessions.bulkPut(trimmed).catch(warn);

    await persistAdjustments([
      {
        at: Date.now(),
        planId: plan.id,
        scope: { kind: 'session', plannedSessionId: trimmed[0]!.id ?? 0 },
        rule: 'week-over-budget-trim',
        before: { sessions: before.map((p) => ({ id: p.id, slotIndex: p.slotIndex, volumeFactor: p.volumeFactor, status: p.status, adjustedByBompa: p.adjustedByBompa })) },
        after: { sessions: trimmed.map((p) => ({ id: p.id, slotIndex: p.slotIndex, volumeFactor: p.volumeFactor, status: p.status, adjustedByBompa: p.adjustedByBompa })) },
        narrative: `You were ${Math.round(budget.overshoot * 100)}% over this week, so I trimmed what was left to land back on plan.`,
      },
    ]);
  }, [plan, budget, priceSlot, persistAdjustments, say]);

  // ───────────────────────────────────────────────────────────
  // Routines
  // ───────────────────────────────────────────────────────────

  const persistRoutine = useCallback(async (routine: Routine) => {
    setRoutines((prev) => {
      const exists = prev.some((r) => r.id === routine.id);
      return exists ? prev.map((r) => (r.id === routine.id ? routine : r)) : [...prev, routine];
    });
    await db.routines.put(routine).catch(warn);
    queue('routines', 'put', routine, Date.now());
  }, []);

  /** Create an empty routine and open it for editing. */
  const createRoutine = useCallback(
    async (name: string): Promise<string> => {
      const taken = new Set(routines.map((r) => r.id));
      const id = uniqueId(name, (candidate) => taken.has(candidate));
      const routine: Routine = {
        id,
        name,
        source: 'user',
        phase: 'strength',
        estMinutes: 45,
        slots: [],
      };
      await persistRoutine(routine);
      patch({ editingRoutineId: id });
      return id;
    },
    [routines, persistRoutine, patch],
  );

  const saveRoutine = useCallback(
    async (routine: Routine) => {
      if (routine.slots.length === 0) {
        say('A workout needs at least one lift before it can be saved.');
        return;
      }
      // Method fields are clamped on the way in so what is stored is what will
      // be read, and a scheme's set count is written back into `sets`.
      const tidied: Routine = { ...routine, slots: routine.slots.map(normaliseSlot) };
      // Rough minutes from the work itself, so the library card stays honest as
      // the routine is edited.
      const sets = tidied.slots.reduce((total, slot) => total + slot.sets, 0);
      await persistRoutine({
        // Superset members must be contiguous or the group is a fiction — the
        // logger would bounce past an unrelated lift mid-round — and rest values
        // for letters nothing uses any more are dropped rather than left to be
        // inherited by whatever gets tagged with that letter next.
        ...normaliseRoutine(tidied),
        estMinutes: Math.max(10, Math.round(sets * 3.5)),
      });
    },
    [persistRoutine, say],
  );

  /**
   * Copy a template into a routine of the user's own.
   *
   * Templates are read-only starting points. Copying rather than editing in
   * place is what keeps "Wendler 5/3/1" meaning Wendler 5/3/1 next time you
   * look at it.
   */
  const copyTemplate = useCallback(
    async (templateId: string) => {
      const template = routines.find((r) => r.id === templateId);
      if (!template) return;
      const takenNames = new Set(routines.map((r) => r.name));
      const takenIds = new Set(routines.map((r) => r.id));
      const name = takenNames.has(template.name) ? copyName(template.name, (n) => takenNames.has(n)) : template.name;
      const copy: Routine = {
        ...template,
        id: uniqueId(name, (candidate) => takenIds.has(candidate)),
        name,
        source: 'user',
        slots: template.slots.map(cloneSlot),
        // Copied for the same reason the slots are: a spread would leave the
        // copy sharing the template's map, so editing one would edit both.
        supersetRest: { ...(template.supersetRest ?? {}) },
      };
      await persistRoutine(copy);
      patch({ editingRoutineId: copy.id });
      say(`Copied. ${name} is yours to change now.`);
    },
    [routines, persistRoutine, patch, say],
  );

  const duplicateRoutine = useCallback(
    async (routineId: string) => {
      await copyTemplate(routineId);
    },
    [copyTemplate],
  );

  /**
   * Delete a routine.
   *
   * History is untouched: sets reference `exerciseId`, and sessions snapshot
   * their own `routineName` and `exerciseIds`. Pending slots pointing at it are
   * dropped, because a slot with no routine cannot be priced or trained.
   */
  const deleteRoutine = useCallback(
    async (routineId: string) => {
      const routine = routines.find((r) => r.id === routineId);
      if (!routine) return;
      if (routine.source === 'template') {
        say('Templates are part of the app. Copy one instead of deleting it.');
        return;
      }

      const orphaned = planned.filter((p) => p.routineId === routineId && p.status === 'plan');
      setRoutines((prev) => prev.filter((r) => r.id !== routineId));
      await db.routines.delete(routineId).catch(warn);

      if (orphaned.length) {
        const ids = orphaned.map((p) => p.id).filter((id): id is number => id !== undefined);
        setPlanned((prev) => prev.filter((p) => !ids.includes(p.id ?? -1)));
        await db.plannedSessions.bulkDelete(ids).catch(warn);
      }
      say(
        orphaned.length
          ? `Deleted. ${orphaned.length} planned ${orphaned.length === 1 ? 'session' : 'sessions'} went with it — your logged history is untouched.`
          : 'Deleted. Your logged history is untouched.',
      );
    },
    [routines, planned, say],
  );

  // ───────────────────────────────────────────────────────────
  // Sessions
  // ───────────────────────────────────────────────────────────

  const startSession = useCallback(
    (routineId: string, preferSlotId?: number) => {
      const routine = routineById(routineId);
      if (!routine) return;

      if (openSession) {
        patch({ tab: 'log', library: false });
        return;
      }

      const at = Date.now();
      // Match on the routine, not on "the next slot in order" — doing
      // Wednesday's Push Day on Monday fills the Push Day slot, whatever
      // position it held. No slot means this is an additional session, which is
      // a legitimate thing to do and costs the week extra.
      //
      // `preferSlotId` is the one exception. When the user picked a specific
      // slot on Today, that is the one to fill — otherwise choosing #3 of two
      // identical Wendler slots fills #1 and turns the wrong card green.
      const week = planWeekOf(at);
      const picked = preferSlotId === undefined
        ? null
        : planned.find(
            (p) => p.id === preferSlotId && p.weekStart === week && p.status === 'plan' && p.routineId === routineId,
          ) ?? null;
      const claimed = picked ?? pendingSlotFor(planned, week, routineId);
      const session: Session = {
        date: dateKey(at),
        plannedSessionId: claimed?.id,
        routineId,
        routineName: routine.name,
        exerciseIds: routine.slots.map((slot) => slot.exerciseId),
        startedAt: at,
        lastSetAt: at,
        elapsedMs: 0,
      };

      void db.sessions
        .add(session)
        .then((id) => {
          const withId = { ...session, id: id as number };
          setOpenSession(withId);
          setSessions((prev) => [...prev, withId]);
          queue('sessions', 'put', withId, at);
        })
        .catch((err) => {
          warn(err);
          // No id means no persistence, but the session still runs in memory.
          setOpenSession({ ...session, id: -at });
        });

      const first = routine.slots[0];
      patch({
        tab: 'log',
        library: false,
        exIdx: 0,
        entryRpe: null,
        ...(first
          ? entryFor(first, [])
          : { entryWeight: 60, entryReps: 8, entryType: 'working' as SetType, entryHoldSec: null }),
      });
    },
    [openSession, planned, entryFor, patch, routineById],
  );

  /**
   * Write one row and keep the session's last-set time current. Optimistic: the
   * user sees the row land immediately, whatever IndexedDB is doing. A failed
   * write costs the next hydration, not this session.
   */
  const writeRow = useCallback(
    (row: LoggedSet) => {
      setSets((prev) => [...prev, row]);
      void db.sets
        .add(row)
        .then((id) => setSets((prev) => prev.map((x) => (x === row ? { ...row, id: id as number } : x))))
        .catch(warn);
      queue('sets', 'put', row, row.at);

      if (!openSession) return;
      const updated: Session = { ...openSession, lastSetAt: row.at };
      setOpenSession(updated);
      setSessions((prev) => prev.map((x) => (x.id === updated.id ? updated : x)));
      void db.sessions.put(updated).catch(warn);
    },
    [openSession],
  );

  /**
   * Everything that happens once a set is over — straight after it for a plain
   * set, after its last piece for a drop or cluster set: which rest, where the
   * logger goes next, and what it says.
   *
   * Supersets move straight to the next lift in the group. The rest that
   * belongs mid-round is the gap after this member — normally zero, which is
   * what makes it a superset — and never the full between-sets rest.
   */
  const settleSet = useCallback(
    (args: {
      after: LoggedSet[];
      exerciseId: string;
      type: SetType;
      setIndex: number;
      at: number;
      /** What to say when nothing more specific applies. */
      toast: string | null;
    }) => {
      const { after, exerciseId, type, setIndex, at } = args;
      const slot = activeRoutine?.slots.find((x) => x.exerciseId === exerciseId) ?? null;
      const group = groupFor(activeRoutine, exerciseId);
      // A warm-up sits outside the round, so it neither advances the group nor
      // borrows its gap; it gets the ordinary rest like any lone lift.
      const roundGroup = type === 'warmup' ? null : group;
      const rest = restAfterSet({
        group: roundGroup,
        sessionSetsAfterLogging: after,
        exerciseId,
        fullRestSec: type === 'warmup' ? s.restPresetSec : fullRestSec(slot, setIndex, s.restPresetSec),
      });
      if (rest.sec > 0) beginRest(at, rest.sec, rest.kind);
      else clearRest();

      const nextLift = roundGroup ? nextInRound(roundGroup, after, exerciseId) : null;
      if (nextLift) {
        const index = exerciseIds.indexOf(nextLift.exerciseId);
        patch({ entryRpe: null, ...(index >= 0 ? { exIdx: index } : {}), ...entryFor(nextLift, after) });
        const nextName = EXERCISE_BY_ID.get(nextLift.exerciseId)?.name ?? 'the next lift';
        say(rest.kind === 'transition' ? `${rest.sec}s, then ${nextName}.` : `Straight into ${nextName} — no rest yet.`);
        return;
      }

      // Back to the top of the group for the next round, so the sequence reads
      // the same way every time.
      const restartAt = group?.slots[0];
      if (restartAt && restartAt.exerciseId !== exerciseId) {
        const index = exerciseIds.indexOf(restartAt.exerciseId);
        patch({ entryRpe: null, ...(index >= 0 ? { exIdx: index } : {}), ...entryFor(restartAt, after) });
      } else if (slot && type !== 'warmup' && resolveSlotMethod(slot).scheme) {
        // A scheme's next set has its own reps, weight and type. Changing the
        // weight mid-workout overrides one set; the next is still the scheme's.
        patch({ entryRpe: null, ...entryFor(slot, after) });
      } else {
        patch({ entryRpe: null, entryType: 'working' });
      }

      if (args.toast !== null) say(args.toast);
      else if (group) say(`Round done. Rest running.`);
      else say('Set logged. Rest running.');
    },
    [activeRoutine, exerciseIds, entryFor, s.restPresetSec, beginRest, clearRest, patch, say],
  );

  /**
   * Move a set on to its next piece, or report that it is finished. Starts the
   * pause before the piece when the plan has one, and loads the piece's weight
   * and reps into the entry card: the weight worked out in display units from
   * what the lifter just used, rounded to their plate step.
   */
  const advanceSegment = useCallback(
    (state: Omit<SegmentState, 'next' | 'nextReps' | 'label' | 'pauseEndsAt'>, at: number, lastWeight: number): boolean => {
      const next = nextSegment(state.plan, state.pieceReps.map((reps) => ({ reps })));
      if (!next) return false;

      const pauseSec = state.plan.intraRestSec;
      if (pauseSec > 0) beginRest(at, pauseSec, 'intra');
      else clearRest();

      const lastReps = state.pieceReps[state.pieceReps.length - 1] ?? s.entryReps;
      const left = state.totalReps === null ? null : state.totalReps - state.repsSoFar;
      setSegment({
        ...state,
        next: next.index,
        nextReps: next.reps,
        label: next.label,
        pauseEndsAt: pauseSec > 0 ? at + pauseSec * 1000 : null,
      });
      patch({
        entryWeight: segmentWeight(lastWeight, state.plan, s.step),
        // As many as possible starts from what the last piece managed, which is
        // the nearest thing to a guess the lifter would make themselves.
        entryReps: next.reps ?? (left === null ? lastReps : Math.max(1, Math.min(lastReps, left))),
        entryRpe: null,
      });
      return true;
    },
    [beginRest, clearRest, patch, s.step, s.entryReps],
  );

  const logSegment = useCallback(() => {
    if (!segment || !openSession?.id || openSession.id !== segment.sessionId) return;
    const at = Date.now();
    // A drop or rest-pause piece is taken to failure by design. A cluster single
    // or a mechanical drop is as hard as the set it belongs to. Either way it is
    // a stand-in the lifter can correct, so it is marked estimated.
    const fallbackRpe = segment.style === 'drop' || segment.style === 'rest-pause' ? 10 : segment.parentRpe;
    const row: LoggedSet = {
      sessionId: segment.sessionId,
      exerciseId: segment.exerciseId,
      setNo: segment.setNo,
      type: segment.type,
      // The one place a piece's display weight becomes a stored one.
      weightKg: toKg(s.entryWeight, s.unit),
      reps: s.entryReps,
      rpe: s.entryRpe ?? fallbackRpe,
      rpeEstimated: s.entryRpe === null,
      at,
      segment: segment.next,
      segmentStyle: segment.style,
      ...segment.snapshot,
    };
    writeRow(row);

    const pieceReps = [...segment.pieceReps, row.reps];
    const carriesOn = advanceSegment(
      { ...segment, pieceReps, repsSoFar: segment.repsSoFar + row.reps },
      at,
      s.entryWeight,
    );
    if (carriesOn) return;

    setSegment(null);
    settleSet({
      after: [...sessionSets, row],
      exerciseId: segment.exerciseId,
      type: segment.type,
      setIndex: segment.setIndex,
      at,
      toast: 'Set done. Rest running.',
    });
  }, [segment, openSession, s.entryWeight, s.entryReps, s.entryRpe, s.unit, sessionSets, writeRow, advanceSegment, settleSet]);

  /** Finish a set made of pieces early. The full rest starts, as it would after the last piece. */
  const endSegments = useCallback(() => {
    if (!segment) return;
    setSegment(null);
    settleSet({
      after: sessionSets,
      exerciseId: segment.exerciseId,
      type: segment.type,
      setIndex: segment.setIndex,
      at: Date.now(),
      toast: 'Set done. Rest running.',
    });
  }, [segment, sessionSets, settleSet]);

  /**
   * Carry on the set just logged with another piece — an unplanned drop, from
   * the rest screen. People decide to drop on the day; the app should not make
   * them pre-programme it. The rest is cancelled and the logger goes back to
   * that set's lift with the dropped weight filled in.
   *
   * With no style, the slot's own plan is used when it has one, and otherwise
   * a single drop 20% lighter.
   */
  const startSegments = useCallback(
    (style?: SegmentStyle) => {
      if (!openSession?.id || segment) return;
      const parent = [...sessionSets]
        .filter((row) => countsAsWork(row.type) && isSet(row))
        .sort((a, b) => a.at - b.at)
        .pop();
      if (!parent) return;

      const pieces = sessionSets
        .filter((row) => row.exerciseId === parent.exerciseId && row.setNo === parent.setNo && !isSet(row))
        .sort((a, b) => a.at - b.at);
      const slot = activeRoutine?.slots.find((x) => x.exerciseId === parent.exerciseId) ?? null;
      const planned = slot ? resolveSlotMethod(slot).segments : null;
      const plan =
        planned && pieces.length === 0 && (style === undefined || style === planned.style)
          ? planned
          : unplannedSegment(style ?? 'drop', pieces.length);

      const index = exerciseIds.indexOf(parent.exerciseId);
      if (index >= 0) patch({ exIdx: index });
      patch({ entryType: parent.type });

      const pieceReps = [parent.reps, ...pieces.map((row) => row.reps)];
      const last = pieces[pieces.length - 1] ?? parent;
      const at = Date.now();
      const carriesOn = advanceSegment(
        {
          sessionId: openSession.id,
          exerciseId: parent.exerciseId,
          setNo: parent.setNo,
          setIndex: Math.max(0, workingSetCount(sessionSets, parent.exerciseId) - 1),
          type: parent.type,
          style: plan.style,
          plan,
          planned: plan.totalReps === undefined ? plan.segmentReps.length : null,
          pieceReps,
          repsSoFar: pieceReps.reduce((a, b) => a + b, 0),
          totalReps: plan.totalReps ?? null,
          parentRpe: parent.rpe,
          snapshot: snapshotOf(parent),
        },
        at,
        toDisplay(last.weightKg, s.unit),
      );
      // Straight into the piece: the lifter asked for it, so no pause first.
      if (carriesOn) {
        clearRest();
        setSegment((prev) => (prev ? { ...prev, pauseEndsAt: null } : prev));
      }
    },
    [openSession, segment, sessionSets, activeRoutine, exerciseIds, s.unit, patch, advanceSegment, clearRest],
  );

  const logSet = useCallback(() => {
    // Mid-set, the button logs the next piece. Starting a new set here would
    // strand the one in progress.
    if (segment) {
      logSegment();
      return;
    }
    if (!openSession?.id || !activeExerciseId) return;

    const at = Date.now();
    const targetRpe = activeTarget?.rpe ?? activeSlot?.targetRpe ?? 7;
    const rpe = s.entryRpe ?? targetRpe;

    // Sets, not pieces: the set after a double drop is the next set, not the one
    // three higher. The highest number so far guards against reusing one freed
    // by a deletion, which would tie two sets' pieces together.
    const priorSets = sessionSets.filter((row) => row.exerciseId === activeExerciseId && isSet(row));
    const setNo = Math.max(priorSets.length, ...priorSets.map((row) => row.setNo)) + 1;
    const setIndex = workingSetCount(sessionSets, activeExerciseId);
    const work = s.entryType !== 'warmup';

    const row: LoggedSet = {
      sessionId: openSession.id,
      exerciseId: activeExerciseId,
      setNo,
      type: s.entryType,
      // The one place a display value becomes a stored one.
      weightKg: toKg(s.entryWeight, s.unit),
      reps: s.entryReps,
      rpe,
      rpeEstimated: s.entryRpe === null,
      at,
    };
    // How the set was prescribed, copied onto it now so history keeps its
    // meaning if the routine is edited later. Warm-ups are ordinary reps done
    // on the way up, whatever the working sets ask for.
    if (work && activeMethod) {
      if (activeMethod.repStyle !== 'full') row.repStyle = activeMethod.repStyle;
      if (activeMethod.tempo) row.tempo = [...activeMethod.tempo];
      if (activeMethod.repStyle === 'isometric') {
        const hold = readHoldSec(s.entryHoldSec) ?? activeMethod.holdSec;
        if (hold !== null) row.holdSec = hold;
      }
      if (activeSetTarget?.amrap) row.amrap = true;
    }
    writeRow(row);

    const after = [...sessionSets, row];

    // A planned drop, cluster or rest-pause set: no rest yet, the entry card
    // moves on to the next piece. Warm-ups never have pieces.
    const plan = work ? (activeMethod?.segments ?? null) : null;
    if (plan) {
      const carriesOn = advanceSegment(
        {
          sessionId: openSession.id,
          exerciseId: activeExerciseId,
          setNo,
          setIndex,
          type: s.entryType,
          style: plan.style,
          plan,
          planned: plan.totalReps === undefined ? plan.segmentReps.length : null,
          pieceReps: [row.reps],
          repsSoFar: row.reps,
          totalReps: plan.totalReps ?? null,
          parentRpe: rpe,
          snapshot: snapshotOf(row),
        },
        at,
        s.entryWeight,
      );
      if (carriesOn) {
        say(plan.intraRestSec > 0 ? `${plan.intraRestSec}s, then the next piece.` : 'Straight into the next piece — no rest yet.');
        return;
      }
    }

    // Commentary only. Nothing about the plan changes until the weekly review.
    let toast: string | null = null;
    if (!work) toast = 'Warm-up logged — it stays out of your fatigue numbers.';
    else if (rpe >= targetRpe + 2) toast = `That's ${(rpe - targetRpe).toFixed(1)} over target. I'll watch it across the week.`;
    else if (activeTarget && row.weightKg > (activeSetTarget?.weightKg ?? activeTarget.weightKg))
      toast = 'Above programmed weight — logged as an overload set.';

    settleSet({ after, exerciseId: activeExerciseId, type: s.entryType, setIndex, at, toast });
  }, [
    segment,
    logSegment,
    openSession,
    activeExerciseId,
    activeTarget,
    activeSetTarget,
    activeSlot,
    activeMethod,
    sessionSets,
    s.entryRpe,
    s.entryType,
    s.entryWeight,
    s.entryReps,
    s.entryHoldSec,
    s.unit,
    writeRow,
    advanceSegment,
    settleSet,
    say,
  ]);

  const deleteSet = useCallback(
    (row: LoggedSet) => {
      // Deleting a set takes its pieces with it: a drop with no set above it is
      // a row nothing can explain. Deleting a piece deletes only that piece.
      const isPieceOf = (x: LoggedSet) =>
        isSet(row) &&
        !isSet(x) &&
        x.sessionId === row.sessionId &&
        x.exerciseId === row.exerciseId &&
        x.setNo === row.setNo;
      const pieces = sets.filter(isPieceOf);

      // Match on the database id, never on object identity. The optimistic
      // insert and the write-back that stamps the id both produce fresh
      // objects, so the reference the caller holds may already be stale.
      setSets((prev) =>
        prev.filter(
          (x) =>
            !isPieceOf(x) &&
            (row.id !== undefined ? x.id !== row.id : !(x.at === row.at && x.exerciseId === row.exerciseId)),
        ),
      );
      if (row.id !== undefined) {
        void db.sets.delete(row.id).catch(warn);
        queue('sets', 'delete', { id: row.id }, Date.now());
      }
      if (pieces.length > 0) {
        // Found by the session index rather than by the ids in memory: a piece
        // logged a moment ago may not have its id stamped yet.
        void db.sets.where('sessionId').equals(row.sessionId).filter(isPieceOf).delete().catch(warn);
        for (const piece of pieces) if (piece.id !== undefined) queue('sets', 'delete', { id: piece.id }, Date.now());
      }
      // Deleting the set in progress ends it: there is nothing left to add a piece to.
      if (
        segment &&
        isSet(row) &&
        segment.sessionId === row.sessionId &&
        segment.exerciseId === row.exerciseId &&
        segment.setNo === row.setNo
      ) {
        setSegment(null);
      }
      say(pieces.length > 0 ? 'Set and its pieces removed.' : 'Set removed.');
    },
    [sets, segment, say],
  );

  /**
   * Amend a logged set — weight, reps, RPE, or which kind of set it was.
   *
   * `weight` arrives in **display units** and is converted here, which keeps
   * this and the logging path the only places a display value becomes a stored
   * one. Doing it in the sheet would put a `toKg` call in a component and make
   * the boundary two files wide.
   *
   * Everything downstream — session load, chip counts, personal records, the
   * RPE deviation the weekly review reads — recomputes from `sets`, so nothing
   * here has to know about any of it. Correcting a set mistyped as working when
   * it was a warm-up therefore takes it back out of the fatigue model, which is
   * the whole reason type is editable and not just weight and reps.
   *
   * A set's type is its pieces' type too, so a set cannot be half warm-up:
   * changing it on the set changes every piece, and a piece's own type cannot
   * be changed on its own.
   */
  const updateSet = useCallback(
    (id: number, changes: { weight?: number; reps?: number; rpe?: number; type?: SetType }) => {
      // Build the row *before* touching state. A `setSets` updater does not run
      // synchronously, so capturing the new row from inside one leaves it null
      // by the time the write would fire — the interface updated and the
      // database quietly did not. A test caught exactly that.
      const current = sets.find((row) => row.id === id);
      if (!current) return;

      const at = Date.now();
      const ownsType = isSet(current);
      const next: LoggedSet = {
        ...current,
        weightKg: changes.weight === undefined ? current.weightKg : toKg(changes.weight, s.unit),
        reps: changes.reps === undefined ? current.reps : Math.max(1, Math.round(changes.reps)),
        rpe: changes.rpe ?? current.rpe,
        type: ownsType ? (changes.type ?? current.type) : current.type,
        // Naming an RPE by hand is no longer an estimate standing in for it.
        rpeEstimated: changes.rpe === undefined ? current.rpeEstimated : false,
      };

      const pieces =
        ownsType && next.type !== current.type
          ? sets
              .filter(
                (row) =>
                  !isSet(row) &&
                  row.sessionId === current.sessionId &&
                  row.exerciseId === current.exerciseId &&
                  row.setNo === current.setNo,
              )
              .map((row) => ({ ...row, type: next.type }))
          : [];

      // By id, never by object identity — same reasoning as deleteSet.
      setSets((prev) =>
        prev.map((row) => {
          if (row.id === id) return next;
          const piece = row.id === undefined ? undefined : pieces.find((p) => p.id === row.id);
          return piece ?? row;
        }),
      );
      void db.sets.put(next).catch(warn);
      queue('sets', 'put', next, at);
      const stored = pieces.filter((row) => row.id !== undefined);
      if (stored.length > 0) {
        void db.sets.bulkPut(stored).catch(warn);
        for (const row of stored) queue('sets', 'put', row, at);
      }
      say('Set updated.');
    },
    [sets, s.unit, say],
  );

  const finishSession = useCallback(() => {
    if (!openSession) return;
    const at = Date.now();
    const closed: Session = { ...openSession, finishedAt: at };

    setOpenSession(null);
    setSessions((prev) => prev.map((x) => (x.id === closed.id ? closed : x)));
    void db.sessions.put(closed).catch(warn);
    queue('sessions', 'put', closed, at);
    setRestEndsAt(null);
    setRestKind(null);
    setSegment(null);

    if (closed.plannedSessionId !== undefined) {
      const done: PlannedSession | undefined = planned.find((p) => p.id === closed.plannedSessionId);
      if (done) {
        // The slot gets its date now, and only now. A date on a planned session
        // means "this is when it actually happened", never "this is when it was
        // meant to happen".
        const next: PlannedSession = { ...done, status: 'done', sessionId: closed.id, date: closed.date };
        setPlanned((prev) => prev.map((p) => (p.id === next.id ? next : p)));
        void db.plannedSessions.put(next).catch(warn);
      }
    }

    // The summary replaces the old "session saved" toast: a finished session
    // deserves more than three seconds of small print. Built from the same
    // function History uses, so the two can never disagree about what you did.
    // Tab goes to Today underneath it, so dismissing the summary lands there
    // and nothing has to remember where the user came from.
    const summary = summariseSessions([closed], sets)[0] ?? null;
    patch({ tab: 'home', restFull: false, summary });
  }, [openSession, planned, sets, patch]);

  // ───────────────────────────────────────────────────────────
  // Rest timer
  // ───────────────────────────────────────────────────────────

  const startRest = useCallback(() => {
    setRestEndsAt(Date.now() + s.restPresetSec * 1000);
    setRestTotalMs(s.restPresetSec * 1000);
    setRestKind('full');
  }, [s.restPresetSec]);

  const addRest = useCallback(() => {
    setRestEndsAt((prev) => (prev === null ? Date.now() + 30_000 : prev + 30_000));
    setRestTotalMs((prev) => prev + 30_000);
    setRestKind((prev) => prev ?? 'full');
  }, []);

  const subRest = useCallback(() => {
    // Floor at a second remaining: −30 shortens the rest, it never ends it.
    setRestEndsAt((prev) => (prev === null ? null : Math.max(Date.now() + 1000, prev - 30_000)));
  }, []);

  const skipRest = useCallback(() => clearRest(), [clearRest]);

  /** Shrink the full-screen countdown back to the inline card. The rest keeps running. */
  const minimiseRest = useCallback(() => patch({ restFull: false }), [patch]);

  /**
   * Bring the full-screen countdown back. Does nothing with no rest running,
   * so an overlay can never open onto a timer that isn't there.
   */
  const showRestFull = useCallback(() => {
    // The pause between cluster singles is seconds long and lives on the entry
    // card; a full-screen takeover would cost more of it than it shows.
    if (restEndsAt !== null && restKind !== 'intra') patch({ restFull: true });
  }, [restEndsAt, restKind, patch]);

  /** Open one training-method explainer. */
  const openMethodGuide = useCallback((key: MethodGuideKey) => patch({ methodGuide: key }), [patch]);
  const closeMethodGuide = useCallback(() => patch({ methodGuide: null }), [patch]);

  /** Dismiss the finished-session summary and land on Today. */
  const closeSummary = useCallback(() => patch({ summary: null, tab: 'home' }), [patch]);

  // ───────────────────────────────────────────────────────────
  // Plan
  // ───────────────────────────────────────────────────────────


  const savePrescriptions = useCallback((next: Prescriptions) => {
    setPrescriptions(next);
    writeSetting(PRESCRIPTIONS_KEY, next, Date.now());
  }, []);

  const setStartingMax = useCallback((exerciseId: string, kg: number) => {
    setStartingMaxesState((prev) => {
      const next = { ...prev };
      if (kg > 0) next[exerciseId] = kg;
      else delete next[exerciseId];
      writeSetting(STARTING_MAXES_KEY, next, Date.now());
      return next;
    });
  }, []);

  /**
   * Reorder a slot within its week, or swap which routine fills it.
   *
   * There are no fixed training days any more, so there is nothing to move
   * *to* in calendar terms — what moves is the slot's position in the week's
   * order, or the work assigned to it. Recorded as an adjustment so it shows up
   * in the log and can be undone like anything else.
   */
  const moveSession = useCallback(
    async (slotId: number, toIndex: number) => {
      const slot = planned.find((p) => p.id === slotId);
      if (!slot || !plan?.id) return;
      if (slot.status === 'done') {
        say("That one's already logged — there's nothing left to move.");
        return;
      }

      const week = weekSlots(planned, slot.weekStart);
      const target = Math.max(0, Math.min(week.length - 1, toIndex));
      if (target === slot.slotIndex) return;

      // Lift it out and put it back at the new position, then renumber the
      // whole week. Dense indices are what make "the lowest pending slot"
      // unambiguous, and nothing else enforces uniqueness.
      const without = week.filter((p) => p.id !== slot.id);
      without.splice(target, 0, slot);
      // Rearranging any part of a week makes the whole week the user's own
      // arrangement rather than the generator's, so every surviving slot is
      // marked — a week reads as user-modified when any slot in it says so.
      const reordered = renumber(without.map((p, index) => ({ ...p, slotIndex: index, userModified: true })));
      const changed = reordered.filter((p) => {
        const before = week.find((w) => w.id === p.id);
        // Persist a slot whose position moved *or* which is newly marked, so
        // memory and disk cannot disagree about who arranged this week.
        return before && (before.slotIndex !== p.slotIndex || before.userModified !== true);
      });
      if (changed.length === 0) return;

      setPlanned((prev) => prev.map((p) => reordered.find((r) => r.id === p.id) ?? p));
      await db.plannedSessions.bulkPut(changed).catch(warn);

      await persistAdjustments([
        {
          at: Date.now(),
          planId: plan.id,
          scope: { kind: 'session', plannedSessionId: slot.id! },
          rule: 'user-reschedule',
          before: { sessions: week.map((p) => ({ id: p.id, slotIndex: p.slotIndex, routineId: p.routineId, volumeFactor: p.volumeFactor, status: p.status })) },
          after: { sessions: reordered.map((p) => ({ id: p.id, slotIndex: p.slotIndex, routineId: p.routineId, volumeFactor: p.volumeFactor, status: p.status })) },
          narrative: `You moved ${routineById(slot.routineId)?.name ?? 'a session'} to position ${target + 1} this week.`,
        },
      ]);
    },
    [planned, plan, persistAdjustments, routineById, say],
  );

  /** Swap the routine filling a pending slot. The week's budget re-prices to match. */
  const swapSlotRoutine = useCallback(
    async (slotId: number, routineId: string) => {
      const slot = planned.find((p) => p.id === slotId);
      const routine = routineById(routineId);
      if (!slot || !routine || !plan?.id || slot.routineId === routineId) return;
      if (slot.status === 'done') {
        say("That one's already logged — swapping it now would rewrite history.");
        return;
      }

      const next: PlannedSession = { ...slot, routineId, userModified: true };
      setPlanned((prev) => prev.map((p) => (p.id === slot.id ? next : p)));
      await db.plannedSessions.put(next).catch(warn);

      await persistAdjustments([
        {
          at: Date.now(),
          planId: plan.id,
          scope: { kind: 'session', plannedSessionId: slot.id! },
          rule: 'user-reschedule',
          before: { sessions: [{ id: slot.id, slotIndex: slot.slotIndex, routineId: slot.routineId, volumeFactor: slot.volumeFactor, status: slot.status }] },
          after: { sessions: [{ id: next.id, slotIndex: next.slotIndex, routineId: next.routineId, volumeFactor: next.volumeFactor, status: next.status }] },
          narrative: `You swapped that slot for ${routine.name}.`,
        },
      ]);
    },
    [planned, plan, persistAdjustments, routineById, say],
  );

  /**
   * Remove a pending slot you have decided not to do.
   *
   * Deliberately *not* a `skip`, and deliberately not an adjustment record. A
   * skip is something the app noticed; this is a decision you made. The
   * adjustment log exists to say what Bompa did and why, and filling it with the
   * user's own choices makes it less legible — which is the thing that makes the
   * coach worth reading.
   */
  const dropSlot = useCallback(
    async (slotId: number) => {
      const slot = planned.find((p) => p.id === slotId);
      if (!slot) return;
      if (slot.status === 'done') {
        say("That one's already logged — dropping it would lose the work.");
        return;
      }

      const week = weekSlots(planned, slot.weekStart).filter((p) => p.id !== slot.id);
      const reordered = renumber(week).map((p) => ({ ...p, userModified: true }));
      setPlanned((prev) =>
        prev.filter((p) => p.id !== slot.id).map((p) => reordered.find((r) => r.id === p.id) ?? p),
      );
      if (slot.id !== undefined) await db.plannedSessions.delete(slot.id).catch(warn);
      const changed = reordered.filter((p) => {
        const before = week.find((w) => w.id === p.id);
        return before && (before.slotIndex !== p.slotIndex || before.userModified !== true);
      });
      if (changed.length) await db.plannedSessions.bulkPut(changed).catch(warn);
      say('Dropped. This week expects less of you now.');
    },
    [planned, say],
  );

  /** Run the weekly review over the week that just closed. */
  const runWeeklyReview = useCallback(async () => {
    if (!plan?.id) return;
    // The plan's own anchor, not the display setting. If this followed
    // `s.weekStart`, a Sunday-start user would compare a Sunday key against
    // stored Monday keys, match nothing, and see the whole week reviewed or
    // skipped wrongly.
    const thisWeek = planWeekStart(todayKey);
    const settings = await readSettings().catch(() => ({}) as Record<string, unknown>);
    if (settings.lastReviewedWeek === thisWeek) return;

    const from = fromDateKey(thisWeek) - 7 * DAY_MS;
    const to = fromDateKey(thisWeek);
    const lastWeekSets = sets.filter((row) => row.at >= from && row.at < to);
    if (lastWeekSets.length === 0) {
      writeSetting('lastReviewedWeek', thisWeek, Date.now());
      return;
    }

    const targetRpe = allTargetRpe(routines);
    if (Object.keys(targetRpe).length === 0) {
      // No targets means `summariseWeek` skips every lift and the review
      // produces nothing — silently. Do NOT stamp the marker: doing so would
      // make this week un-reviewable forever, so a fixable fault would become
      // permanent data loss.
      warn(new Error('Weekly review skipped: no routine targets to measure against'));
      return;
    }

    const result = reviewWeek({
      sets: lastWeekSets,
      targetRpe,
      prescriptions,
      planId: plan.id,
      now: Date.now(),
    });

    if (result.adjustments.length > 0) {
      savePrescriptions(result.prescriptions);
      await persistAdjustments(result.adjustments);
    }
    writeSetting('lastReviewedWeek', thisWeek, Date.now());
  }, [plan, todayKey, sets, routines, prescriptions, savePrescriptions, persistAdjustments]);

  /**
   * Close out weeks that have rolled over.
   *
   * A slot still pending when its week ends is a `skip` — not because you missed
   * a particular day, but because the week you committed to is gone. Nothing
   * carries forward; next week has its own budget.
   */
  const sweepRolledOverWeeks = useCallback(async () => {
    if (!plan?.id) return;
    const planStarted = planWeekStart(dateKey(plan.createdAt));
    const stale = planned.filter(
      (p) => p.weekStart < currentWeek && p.weekStart >= planStarted && p.status === 'plan',
    );
    if (stale.length === 0) return;

    const skipped = stale.map((p) => ({ ...p, status: 'skip' as const }));
    setPlanned((prev) => prev.map((p) => skipped.find((k) => k.id === p.id) ?? p));
    await db.plannedSessions.bulkPut(skipped).catch(warn);
  }, [plan, planned, currentWeek]);

  /**
   * Mid-week catch-up: if the week is running behind, scale what is left.
   *
   * Same rule as before, different trigger. It used to fire because a weekday
   * had passed; now it fires because the week is live and short of time. Capped
   * at +25% per session, and the excess is written off rather than carried.
   */
  const catchUpThisWeek = useCallback(async () => {
    if (!plan?.id) return;

    // The week the plan was created in is short by construction — you set up on
    // a Wednesday, you were never going to fit the week's work in. Folding it
    // would be blaming the user for the calendar.
    if (currentWeek === planWeekStart(dateKey(plan.createdAt))) return;

    const week = weekSlots(planned, currentWeek);
    const remaining = week.filter((p) => p.status === 'plan');
    if (remaining.length < 2) return;

    // Days left in the week, counting today.
    const daysLeft = 7 - daysBetween(currentWeek, todayKey);
    // Only near the end of the week. Mid-week you might well do two in a day —
    // "planned days are a guide" means not pre-judging that on a Tuesday.
    if (daysLeft > 1 || daysLeft <= 0 || remaining.length <= daysLeft) return;

    // More sessions than days: the earliest ones cannot happen. Fold the
    // overflow forward rather than letting it silently become skips.
    const overflow = remaining.slice(0, remaining.length - daysLeft);
    const newAdjustments: Adjustment[] = [];
    const touched = new Map<number, PlannedSession>();
    let working = [...planned];

    for (const source of overflow) {
      const { adjustments: adj, sessions: moved } = redistributeWithinWeek({
        source,
        week: weekSlots(working, currentWeek),
        planId: plan.id,
        now: Date.now(),
        narrative: `There are more sessions left this week than days to do them, so I've moved that volume into the ones that fit.`,
      });
      if (moved.length === 0) continue;
      const dropped: PlannedSession = { ...source, status: 'skip' };
      touched.set(dropped.id!, dropped);
      working = working.map((p) => (p.id === dropped.id ? dropped : p));
      for (const row of moved) {
        touched.set(row.id!, row);
        working = working.map((p) => (p.id === row.id ? row : p));
      }
      newAdjustments.push(...adj);
    }

    if (touched.size === 0) return;
    setPlanned(working);
    await db.plannedSessions.bulkPut([...touched.values()]).catch(warn);
    await persistAdjustments(newAdjustments);
  }, [plan, planned, currentWeek, todayKey, persistAdjustments]);

  // All three passes want the same trigger: the app has loaded and knows what
  // day it is. Order matters — close old weeks before reviewing them, and
  // review before rebalancing what is left of this one.
  const swept = useRef(false);
  useEffect(() => {
    if (!s.hydrated || swept.current || !plan) return;
    swept.current = true;
    void sweepRolledOverWeeks()
      .then(() => runWeeklyReview())
      .then(() => catchUpThisWeek());
  }, [s.hydrated, plan, sweepRolledOverWeeks, runWeeklyReview, catchUpThisWeek]);

  const undoAdjustment = useCallback(
    (adjustment: Adjustment) => {
      const at = Date.now();
      const reverted: Adjustment = { ...adjustment, revertedAt: at };
      setAdjustments((prev) => prev.map((a) => (a.id === reverted.id ? reverted : a)));
      if (reverted.id !== undefined) void db.adjustments.put(reverted).catch(warn);

      if (adjustment.scope.kind === 'lift') {
        savePrescriptions(revertPrescription(adjustment, prescriptions));
        say('Reverted. Back to what was programmed.');
        return;
      }

      if (adjustment.scope.kind === 'session') {
        const before =
          (adjustment.before as {
            sessions?: {
              id: number;
              volumeFactor: number;
              status: unknown;
              routineId?: string;
              slotIndex?: number;
              adjustedByBompa?: boolean;
            }[];
          })?.sessions ?? [];
        const restored = planned.map((p) => {
          const match = before.find((b) => b.id === p.id);
          if (!match) return p;
          return {
            ...p,
            volumeFactor: match.volumeFactor,
            // Blobs written before the week migration carry 'rest' and
            // 'adjusted'. Restoring one verbatim would write a status the union
            // no longer has straight past the type system and into IndexedDB.
            status: normalisePlannedStatus(match.status),
            // Only a reorder records a position; a redistribution does not, so
            // keep whatever the row has in that case. Same for the routine.
            slotIndex: match.slotIndex ?? p.slotIndex,
            routineId: match.routineId ?? p.routineId,
            adjustedByBompa: match.adjustedByBompa ?? false,
          };
        });
        setPlanned(restored);
        void db.plannedSessions.bulkPut(restored.filter((p) => before.some((b) => b.id === p.id))).catch(warn);
        say('Reverted. The week is back as it was planned.');
      }
    },
    [prescriptions, planned, savePrescriptions, say],
  );

  const addBlock = useCallback(async () => {
    if (!plan?.id) return;
    const last = [...blocks].sort((a, b) => (a.startDate < b.startDate ? -1 : 1)).pop();
    const startAfter = last
      ? dateKey(fromDateKey(last.startDate) + (last.weeks + last.deloadWeeks) * 7 * DAY_MS)
      : todayKey;

    const generated = generatePlan({
      name: plan.name,
      startDate: startAfter,
      // The new block inherits the plan's rotation and cadence — adding a block
      // is a periodization decision, not a re-pick of which workouts you do.
      rotation: plan.rotation,
      sessionsPerWeek: plan.sessionsPerWeek,
      specs: [{ phase: s.builderPhase, weeks: s.builderWeeks, deloadWeeks: 1 }],
      planId: plan.id,
    });
    const nextBlockId = Math.max(0, ...blocks.map((b) => b.id ?? 0)) + 1;
    const block: Block = { ...generated.blocks[0]!, id: nextBlockId };
    const rows = generated.sessions.map((p) => ({ ...p, blockId: nextBlockId }));

    setBlocks((prev) => [...prev, block]);
    setPlanned((prev) => [...prev, ...rows]);
    await db.blocks.put(block).catch(warn);
    await db.plannedSessions.bulkAdd(rows).catch(warn);

    patch({ planTab: 'cal' });
    say(`${s.builderWeeks}-week ${s.builderPhase} block added after this one.`);
  }, [plan, blocks, todayKey, s.builderPhase, s.builderWeeks, patch, say]);

  const saveCompetition = useCallback(
    async (name: string, date: string, location: string) => {
      const row: Competition = { id: competition?.id, name, date, location };
      const id = await db.competitions.put(row).catch((err) => {
        warn(err);
        return undefined;
      });
      const saved = { ...row, id: (id as number | undefined) ?? row.id };
      setCompetition(saved);
      if (plan?.id) {
        const nextPlan = { ...plan, competitionId: saved.id };
        setPlan(nextPlan);
        void db.plans.put(nextPlan).catch(warn);
      }
      say(`${name} saved. I've worked the taper backwards from meet day.`);
    },
    [competition, plan, say],
  );

  // ───────────────────────────────────────────────────────────
  // Exercise content providers
  //
  // Nothing here touches the network unless the user has connected a
  // provider. Every request goes to that provider's own hosts, through the one
  // network helper, and downloads never run while a session is in progress —
  // mid-set is the worst time to spend someone's data, and the timing of
  // requests would tell the provider when they train.
  // ───────────────────────────────────────────────────────────

  const rankedConnections = useMemo(() => [...connections].sort((a, b) => a.rank - b.rank), [connections]);

  /** What the interface may know about a connection: everything but the key. */
  const contentConnections = useMemo(
    () =>
      rankedConnections.map(({ apiKey, ...rest }) => ({
        ...rest,
        name: providerEntry(rest.providerId)?.name ?? rest.providerId,
        hasKey: Boolean(apiKey),
      })),
    [rankedConnections],
  );

  const linkFor = useCallback(
    (exerciseId: string, providerId?: string): ContentLink | undefined => {
      if (providerId) return contentLinks.find((l) => l.providerId === providerId && l.exerciseId === exerciseId);
      // The top-ranked connected provider's link, so the sheet and Tools agree
      // on which one is in charge.
      for (const connection of rankedConnections) {
        const link = contentLinks.find((l) => l.providerId === connection.providerId && l.exerciseId === exerciseId);
        if (link) return link;
      }
      return undefined;
    },
    [contentLinks, rankedConnections],
  );

  /**
   * A movement's How-to: a first answer now, better ones through `onUpdate`.
   * Call `cancel` when the sheet closes so a late answer lands nowhere.
   */
  const resolveHowTo = useCallback(
    (exerciseId: string, onUpdate?: (next: ResolvedHowTo) => void): Resolution =>
      resolveContent(
        {
          exerciseId,
          // Movements don't carry cues of their own yet. When they do, they go
          // here and win over everything else, without a single read.
          userCues: null,
          seeded: HOWTO_BY_ID.get(exerciseId) ?? null,
          loadBundled: () => loadHowTo(exerciseId),
          candidates: rankedConnections.map((connection) => ({
            connection,
            name: providerEntry(connection.providerId)?.name ?? connection.providerId,
            link: contentLinks.find((l) => l.providerId === connection.providerId && l.exerciseId === exerciseId),
          })),
          loadProvider,
          online: isOnline,
          now: Date.now,
        },
        onUpdate,
      ),
    [contentLinks, rankedConnections],
  );

  // Lifts in the user's own routines first — those are the ones they will open
  // a sheet for — then anything else they have logged.
  const liftsThatMatter = useMemo(() => {
    const ids: string[] = [];
    const seen = new Set<string>();
    const add = (id: string) => {
      if (!seen.has(id)) {
        seen.add(id);
        ids.push(id);
      }
    };
    for (const routine of routines) if (routine.source !== 'template') routine.slots.forEach((slot) => add(slot.exerciseId));
    const inRoutines = ids.length;
    for (const row of sets) add(row.exerciseId);
    return { all: ids, inRoutines: ids.slice(0, inRoutines) };
  }, [routines, sets]);

  const contentJob = useRef<AbortController | null>(null);
  useEffect(() => () => contentJob.current?.abort(), []);

  const testProvider = useCallback(async (providerId: string, draft: { apiKey?: string; baseUrl?: string }): Promise<TestResult> => {
    if (!isOnline()) return { ok: false, reason: 'network' };
    const provider = await loadProvider(providerId);
    if (!provider) return { ok: false, reason: 'unexpected', detail: 'unknown provider' };
    return testConnection(provider, { apiKey: draft.apiKey?.trim() || undefined, baseUrl: draft.baseUrl?.trim() || undefined });
  }, []);

  const searchProvider = useCallback(
    async (providerId: string, query: string): Promise<ExternalMatch[]> => {
      const connection = connections.find((c) => c.providerId === providerId);
      const trimmed = query.trim().slice(0, MAX_ID_CHARS);
      if (!connection || !trimmed || !isOnline()) return [];
      const provider = await loadProvider(providerId);
      if (!provider) return [];
      try {
        return await provider.search(trimmed, contextFor(connection, new AbortController().signal));
      } catch {
        return [];
      }
    },
    [connections],
  );

  const findMatches = useCallback(
    async (providerId: string): Promise<MatchRun> => {
      const connection = connections.find((c) => c.providerId === providerId);
      if (!connection) return { suggestions: [], searched: 0, stoppedBy: 'unexpected' };
      if (!isOnline()) return { suggestions: [], searched: 0, stoppedBy: 'network' };
      const provider = await loadProvider(providerId);
      if (!provider) return { suggestions: [], searched: 0, stoppedBy: 'unexpected' };
      const controller = new AbortController();
      const movements = liftsThatMatter.all.map((id) => allExerciseById.get(id)).filter((e): e is Exercise => Boolean(e));
      const run = await runFindMatches({
        provider,
        ctx: () => contextFor(connection, controller.signal),
        movements,
        existing: contentLinks,
        now: Date.now(),
      });
      if (run.suggestions.length) {
        const fresh = new Set(run.suggestions.map((l) => l.exerciseId));
        setContentLinks((prev) => [...prev.filter((l) => !(l.providerId === providerId && fresh.has(l.exerciseId))), ...run.suggestions]);
        void putLinks(run.suggestions).catch(warn);
      }
      return run;
    },
    [connections, contentLinks, liftsThatMatter, allExerciseById],
  );

  /** Accept suggestions as they stand. */
  const confirmLinks = useCallback(
    (providerId: string, exerciseIds: string[]) => {
      const wanted = new Set(exerciseIds);
      const at = Date.now();
      const next = contentLinks
        .filter((l) => l.providerId === providerId && wanted.has(l.exerciseId) && l.status === 'suggested' && l.externalId)
        .map((l) => ({ ...l, status: 'confirmed' as const, at }));
      if (next.length === 0) return;
      const confirmed = new Set(next.map((l) => l.exerciseId));
      setContentLinks((prev) => [...prev.filter((l) => !(l.providerId === providerId && confirmed.has(l.exerciseId))), ...next]);
      void putLinks(next).catch(warn);
    },
    [contentLinks],
  );

  /**
   * Link a movement by hand, or record that the provider has no match for it
   * (`match` null), which stops it being suggested again.
   */
  const linkExercise = useCallback(
    (providerId: string, exerciseId: string, match: Pick<ExternalMatch, 'externalId' | 'name'> | null) => {
      const previous = contentLinks.find((l) => l.providerId === providerId && l.exerciseId === exerciseId);
      const link: ContentLink = {
        providerId,
        exerciseId,
        externalId: match ? match.externalId.slice(0, MAX_ID_CHARS) : null,
        ...(match ? { externalName: match.name.slice(0, MAX_ID_CHARS) } : {}),
        status: match ? 'confirmed' : 'none',
        method: 'manual',
        at: Date.now(),
      };
      setContentLinks((prev) => [...prev.filter((l) => !(l.providerId === providerId && l.exerciseId === exerciseId)), link]);
      // Pointing at a different entry means the old entry's saved content no
      // longer belongs to this movement.
      const stale = Boolean(previous?.externalId) && previous?.externalId !== link.externalId;
      void (stale ? deleteLink(providerId, exerciseId) : Promise.resolve())
        .then(() => putLinks([link]))
        .catch(warn);
    },
    [contentLinks],
  );

  /** Forget the link and the content it brought. */
  const unlinkExercise = useCallback((providerId: string, exerciseId: string) => {
    setContentLinks((prev) => prev.filter((l) => !(l.providerId === providerId && l.exerciseId === exerciseId)));
    void deleteLink(providerId, exerciseId).catch(warn);
  }, []);

  const downloadContent = useCallback(
    async (providerId: string, onProgress?: (done: number, total: number) => void): Promise<DownloadRun> => {
      const empty = { done: 0, total: 0, images: 0 };
      if (openSession) return { ...empty, stoppedBy: 'in-session' };
      if (!isOnline()) return { ...empty, stoppedBy: 'network' };
      const connection = connections.find((c) => c.providerId === providerId);
      const provider = connection ? await loadProvider(providerId) : null;
      if (!connection || !provider) return { ...empty, stoppedBy: 'unexpected' };
      const lifts = new Set(liftsThatMatter.inRoutines);
      contentJob.current?.abort();
      const controller = new AbortController();
      contentJob.current = controller;
      return runDownload({
        provider,
        connection,
        links: contentLinks.filter((l) => l.providerId === providerId && lifts.has(l.exerciseId) && isUsableLink(l)),
        now: Date.now,
        signal: controller.signal,
        onProgress,
      });
    },
    [openSession, connections, contentLinks, liftsThatMatter],
  );

  // A session starting cancels any download in flight.
  useEffect(() => {
    if (openSession) contentJob.current?.abort();
  }, [openSession]);

  /**
   * Save a connection. The interface only offers this after a passing test,
   * so it does not test again — a second call would spend the user's quota
   * twice for one connect.
   */
  const connectProvider = useCallback(
    (providerId: string, draft: { apiKey?: string; baseUrl?: string; cachingAllowed?: boolean }) => {
      const existing = connections.find((c) => c.providerId === providerId);
      const apiKey = draft.apiKey?.trim();
      const baseUrl = draft.baseUrl?.trim();
      const connection: ProviderConnection = {
        providerId,
        connectedAt: existing?.connectedAt ?? Date.now(),
        ...(apiKey ? { apiKey } : {}),
        ...(baseUrl ? { baseUrl } : {}),
        cachingAllowed: draft.cachingAllowed === true,
        rank: existing?.rank ?? connections.reduce((max, c) => Math.max(max, c.rank + 1), 0),
      };
      setConnections((prev) => [...prev.filter((c) => c.providerId !== providerId), connection]);
      // Straight to its own table, never through settings or the sync queue:
      // this row holds the key.
      void putConnection(connection).catch(warn);
    },
    [connections],
  );

  /** Deletes the key, the saved text and the saved images. Links stay unless asked. */
  const disconnectProvider = useCallback(async (providerId: string, opts: { forgetLinks?: boolean } = {}) => {
    contentJob.current?.abort();
    setConnections((prev) => prev.filter((c) => c.providerId !== providerId));
    if (opts.forgetLinks) setContentLinks((prev) => prev.filter((l) => l.providerId !== providerId));
    await deleteConnection(providerId, opts).catch(warn);
  }, []);

  // Right after a provider is connected, look for matches once so the user has
  // suggestions to review rather than an empty list. Connections restored at
  // startup are not new, so opening the app sends nothing.
  const knownConnections = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!s.hydrated) return;
    const ids = new Set(connections.map((c) => c.providerId));
    const before = knownConnections.current;
    knownConnections.current = ids;
    if (before === null || openSession || !isOnline()) return;
    for (const id of ids) if (!before.has(id)) void findMatches(id).catch(warn);
    // Runs on a change of connections only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.hydrated, connections]);

  /** For "Saved: 18 instructions, 15 images". */
  const savedContent = useCallback((providerId: string) => countCached(providerId), []);

  // Download for offline whenever the set of lifts in the user's routines
  // changes while online — never at startup, which would turn every app open
  // into a request.
  const prefetchKey = liftsThatMatter.inRoutines.join('|');
  const prefetchSeen = useRef<string | null>(null);
  useEffect(() => {
    if (!s.hydrated) return;
    const previous = prefetchSeen.current;
    prefetchSeen.current = prefetchKey;
    if (previous === null || previous === prefetchKey) return;
    if (connections.length === 0 || openSession || !isOnline()) return;
    for (const connection of connections) void downloadContent(connection.providerId).catch(warn);
    // Only a change of lifts decides; the callbacks change identity with every link.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.hydrated, prefetchKey]);

  // ───────────────────────────────────────────────────────────
  // Metrics for the dashboard
  // ───────────────────────────────────────────────────────────

  const metrics = useMemo(() => {
    const vol = volumeLoad(sets, now);
    const intensity = intensityAvg(sets, now);
    return {
      fatigue: scores.fatigueScore,
      volume7d: vol,
      intensity,
      daysSinceRest: restDays,
      acwr: ratio.ratio,
      peakInDays: peakWindow?.daysAway ?? null,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sets, scores, restDays, ratio, peakWindow, dateKey(now)]);

  return {
    s,
    patch,
    say,
    now,
    todayKey,
    /** Setup owns the screen until it is done or deliberately skipped. */
    needsSetup: s.hydrated && !setupDone,

    // data
    sessions,
    sets,
    setsByExercise,
    planned,
    blocks,
    plan,
    adjustments,
    competition,
    prescriptions,
    startingMaxes,
    openSession,
    sessionSets,
    loads,
    e1rmByExercise,

    // derived
    scores,
    acwr: ratio,
    insights,
    metrics,
    peakWindow,
    taper,
    currentBlock,
    activeRoutine,
    exerciseIds,
    activeExerciseId,
    activeSlot,
    activeTarget,
    /** How the active lift is trained, clamped and resolved. Null with no routine slot. */
    activeMethod,
    /** What this set of the active lift asks for, rest resolved down to the lifter's preset. */
    activeSetTarget,
    /** The set in progress when it is made of pieces; null otherwise. */
    segment,
    activeGroup,
    chips,
    supersetLabel,
    supersetRounds,

    // the week
    currentWeek,
    thisWeekSlots,
    nextSlot,
    progress,
    budget,
    overBudget,
    isDeloadWeek,
    routineById,
    priceSlot,

    // rest timer
    restActive,
    restRemainingMs,
    restTotalMs,
    restKind,

    // actions
    go,
    pickExercise,
    addExerciseToSession,
    setStartingMax,
    createPlanFromSetup,
    skipSetup,
    restartSetup,
    trimWeekToBudget,
    createRoutine,
    saveRoutine,
    copyTemplate,
    duplicateRoutine,
    deleteRoutine,
    moveSession,
    swapSlotRoutine,
    dropSlot,
    setUnit,
    setWeekStart,
    setStep,
    setRestPreset,
    setStatsLift,
    startSession,
    logSet,
    startSegments,
    logSegment,
    endSegments,
    openMethodGuide,
    closeMethodGuide,
    deleteSet,
    updateSet,
    finishSession,
    startRest,
    addRest,
    subRest,
    skipRest,
    minimiseRest,
    showRestFull,
    closeSummary,
    addBlock,
    saveCompetition,
    undoAdjustment,
    setPrescriptions: savePrescriptions,

    // content
    exercises: allExercises,
    exerciseById: allExerciseById,
    howTos: HOWTOS,
    /** Everything the user can train: their own routines and anything imported. */
    routines: routines.filter((r) => r.source !== 'template'),
    /** Bundled starting points. Copy one to make it yours; never scheduled directly. */
    templates: routines.filter((r) => r.source === 'template'),
    allRoutines: routines,

    // exercise content providers
    contentProviders: providerEntries(),
    contentConnections,
    contentLinks,
    linkFor,
    resolveHowTo,
    testProvider,
    connectProvider,
    disconnectProvider,
    searchProvider,
    findMatches,
    confirmLinks,
    linkExercise,
    unlinkExercise,
    downloadContent,
    savedContent,
  };
}

/** Browsers say when they are definitely offline; anything else is worth trying. */
function isOnline(): boolean {
  return typeof navigator === 'undefined' || navigator.onLine !== false;
}
