'use client';

import { useEffect, useRef } from 'react';
import { COUNTDOWN_SEC, CueSchedule, POLL_MS, intervalDeadline, type IntervalClock } from '@/lib/alerts';
import { alertPrefs } from './alertPrefs';
import { closeRestNotifications, playCue, showRestNotification } from './alertOutput';

/**
 * Beep and buzz towards a deadline.
 *
 * `deadline` is asked afresh on every look rather than captured once, because
 * for an EMOM it moves on by itself every minute, and for a rest a +30 moves
 * it. The schedule notices the move and re-arms.
 *
 * `active` only decides whether the page keeps looking. When it goes false the
 * hook takes one last look, which is how the end tone still plays when the
 * rest is cleared on the very tick it ran out.
 */
export function useCues(deadline: (now: number) => number | null, active: boolean, ticks: readonly number[] = COUNTDOWN_SEC): void {
  const schedule = useRef<CueSchedule | null>(null);
  schedule.current ??= new CueSchedule();
  const latest = useRef({ deadline, ticks });
  latest.current = { deadline, ticks };

  useEffect(() => {
    const cues = schedule.current;
    if (!cues) return;
    const look = () => {
      const now = Date.now();
      const cue = cues.step(latest.current.deadline(now), now, latest.current.ticks);
      if (cue) playCue(cue, alertPrefs());
    };
    look();
    if (!active) return;
    const id = setInterval(look, POLL_MS);
    // A page coming back from the background should not wait for the next
    // poll to find out the rest ended while it was away.
    document.addEventListener('visibilitychange', look);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', look);
      look();
    };
  }, [active]);
}

/** The interval timer: countdown and end tone for AMRAP and EMOM, nothing for the stopwatch. */
export function useIntervalAlerts(clock: IntervalClock): void {
  const running = clock.startedAt !== null && clock.mode !== 'stopwatch';
  useCues((now) => intervalDeadline(clock, now), running);
}

/**
 * Tell a locked phone that rest is over.
 *
 * Only while the page is hidden: on screen, the tone and the countdown already
 * say it. On hide, a timer is set for the rest's end; on show, it is cancelled
 * and anything already in the shade is taken down.
 *
 * Honest limits: this is a timer in a page the operating system has been told
 * nobody is looking at. Android delays background timers to save battery and,
 * on a long enough rest or an aggressive battery saver, freezes the page
 * outright — then the notification arrives late, or when the phone is next
 * woken. There is no reliable way for an offline web app to schedule one
 * ahead of time; the API that would have done it was abandoned by browsers.
 */
export function useRestNotification(endsAt: number | null, enabled: boolean, body: string): void {
  const text = useRef(body);
  text.current = body;

  useEffect(() => {
    if (!enabled || endsAt === null) return;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const cancel = () => {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
    };
    const fire = () => {
      timer = undefined;
      void showRestNotification(text.current);
    };
    const sync = () => {
      cancel();
      if (document.visibilityState !== 'hidden') {
        void closeRestNotifications();
        return;
      }
      const wait = endsAt - Date.now();
      if (wait > 0) timer = setTimeout(fire, wait);
    };

    sync();
    document.addEventListener('visibilitychange', sync);
    return () => {
      document.removeEventListener('visibilitychange', sync);
      // The rest ran out and was cleared in the same breath as the timer was
      // due — throttled timers in a hidden page fire in whatever order they
      // like. The end was reached, so the notification is still owed. A skip
      // or a +30 lands before the end and just cancels.
      const owed = timer !== undefined && document.visibilityState === 'hidden' && Date.now() >= endsAt;
      cancel();
      if (owed) fire();
    };
  }, [endsAt, enabled]);
}
