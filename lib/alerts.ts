// When a timer should beep. Pure: no audio, no vibration, no DOM — the caller
// passes the time in, and gets back which cue (if any) is owed right now.
//
// Every timer in the app is an absolute deadline read against the wall clock,
// so the cues are too. A cue is not "fire in 147 seconds"; it is "fire the
// first time we look and the deadline is 3 seconds away or less". That is what
// makes them survive a throttled tab: a late look still finds the right cue,
// and a very late look knows it is too late to be useful.

export type Cue = 'tick' | 'zero';

/** The countdown ticks, in seconds before the deadline. */
export const COUNTDOWN_SEC: readonly number[] = [3, 2, 1];

/**
 * A tick heard more than this late is noise, not a countdown. A phone that
 * wakes up with "3" long gone should not play it as if it were news.
 */
export const TICK_STALE_MS = 2000;

/**
 * The end tone is still worth hearing this long after the fact — the page may
 * have been throttled to one look per second or so. Much later than this and
 * the lifter has already noticed on their own.
 */
export const ZERO_GRACE_MS = 5000;

/** How often the page looks. Well under a second so "3, 2, 1" lands on the beat. */
export const POLL_MS = 200;

type Track = {
  endsAt: number;
  /** Milliseconds-before-the-end of each cue not yet played or given up on. */
  pending: number[];
};

/**
 * Follows one deadline at a time and hands out each cue exactly once.
 *
 * Call `step` on every look, with the current deadline (or null when there is
 * none) and the time. It returns the cue to play, or null.
 */
export class CueSchedule {
  private track: Track | null = null;

  step(endsAt: number | null, now: number, ticks: readonly number[] = COUNTDOWN_SEC): Cue | null {
    const track = this.track;

    if (track && endsAt === track.endsAt) return this.take(now);

    // The deadline moved or went away. If the old one had actually been
    // reached — the rest ran out, an EMOM minute turned over — its end tone
    // is still owed. If it had not — a skip, a pause, a −30 — nothing is.
    const owed = track && now >= track.endsAt ? this.take(now) : null;
    this.track = endsAt === null ? null : arm(endsAt, now, ticks);
    return owed;
  }

  private take(now: number): Cue | null {
    const track = this.track;
    if (!track) return null;
    const crossed = track.pending.filter((before) => now >= track.endsAt - before);
    if (crossed.length === 0) return null;

    // Everything crossed is used up, but only the most recent one plays: a
    // look that is 1.5 s late finds both "3" and "2" behind it, and "3, 2"
    // in one breath is not a countdown.
    track.pending = track.pending.filter((before) => now < track.endsAt - before);
    const latest = Math.min(...crossed);
    const late = now - (track.endsAt - latest);
    if (latest === 0) return late <= ZERO_GRACE_MS ? 'zero' : null;
    return late <= TICK_STALE_MS ? 'tick' : null;
  }
}

/**
 * A fresh deadline starts with only the cues still ahead of it. A +30 at two
 * seconds left re-arms the whole countdown; a −30 that lands at one second
 * left does not suddenly play a "3" that is already behind it.
 */
function arm(endsAt: number, now: number, ticks: readonly number[]): Track {
  const pending = [...ticks.map((sec) => sec * 1000), 0].filter((before) => endsAt - before > now);
  return { endsAt, pending };
}

/**
 * The next interval boundary of an EMOM clock, strictly after `now`.
 *
 * `anchor` is the wall-clock moment the clock would have read zero had it
 * never been paused: the start time minus whatever had accumulated before it.
 */
export function nextBoundary(anchor: number, intervalMs: number, now: number): number {
  const done = Math.floor((now - anchor) / intervalMs);
  return anchor + (done + 1) * intervalMs;
}

/** What the Tools interval timer needs to say when it is due. */
export type IntervalClock = {
  mode: 'stopwatch' | 'amrap' | 'emom';
  /** Wall-clock start of the current running stretch; null while paused. */
  startedAt: number | null;
  /** Time banked before the current stretch, from earlier runs. */
  accumulatedMs: number;
  capMs: number;
  intervalMs: number;
};

/**
 * The deadline the interval timer is counting towards right now, or null. A
 * stopwatch counts up to nothing, so it has none.
 */
export function intervalDeadline(clock: IntervalClock, now: number): number | null {
  if (clock.startedAt === null) return null;
  const anchor = clock.startedAt - clock.accumulatedMs;
  if (clock.mode === 'amrap') return anchor + clock.capMs;
  if (clock.mode === 'emom') return nextBoundary(anchor, clock.intervalMs, now);
  return null;
}

/** "Rest's up · Bench Press, set 3" — which lift and set the rest was for, if known. */
export function restNotificationBody(exerciseName: string | null, nextSetNo: number | null): string {
  if (!exerciseName) return "Rest's up";
  if (nextSetNo === null) return `Rest's up · ${exerciseName}`;
  return `Rest's up · ${exerciseName}, set ${nextSetNo}`;
}
