'use client';

import { useEffect, useState } from 'react';
import { COUNTDOWN_SEC, restNotificationBody } from '@/lib/alerts';
import { countsAsWork, isSet } from '@/lib/calc';
import { C, R, SHADOW, Z, onInk } from '@/lib/tokens';
import { useBompa } from '@/state/BompaContext';
import { InkButton } from '@/components/ui';
import { loadAlertPrefs, setAlertPref, useAlertPrefs } from './alertPrefs';
import { notificationPermission, requestNotificationPermission, unlockAudio } from './alertOutput';
import { useCues, useRestNotification } from './useTimerAlerts';
import { useWakeLock } from './useWakeLock';

/** The pause between drop or cluster pieces is seconds long: one tone at the end is plenty. */
const NO_COUNTDOWN: readonly number[] = [];

/**
 * The rest timer's alerts, mounted once in the app shell so they keep working
 * whichever tab is open: tones and buzzes, the notification for a locked
 * phone, and the keep-screen-on lock for the length of a session.
 *
 * Renders nothing, except the one-time question about notifications.
 */
export function TimerAlerts() {
  const b = useBompa();
  const prefs = useAlertPrefs();
  const endsAt = b.restEndsAt;

  // Browsers keep audio muted until the page is touched, and the context has
  // to be made inside a touch to be allowed to play. Every tap is a chance;
  // after the first, this is a cheap no-op.
  useEffect(() => {
    const unlock = () => unlockAudio();
    document.addEventListener('pointerdown', unlock, true);
    document.addEventListener('keydown', unlock, true);
    return () => {
      document.removeEventListener('pointerdown', unlock, true);
      document.removeEventListener('keydown', unlock, true);
    };
  }, []);

  useCues(() => endsAt, endsAt !== null, b.restKind === 'intra' ? NO_COUNTDOWN : COUNTDOWN_SEC);

  const exercise = b.activeExerciseId ? b.exerciseById.get(b.activeExerciseId) : undefined;
  const nextSetNo = b.sessionSets.filter((row) => row.exerciseId === b.activeExerciseId && countsAsWork(row.type) && isSet(row)).length + 1;
  useRestNotification(
    b.restKind === 'intra' ? null : endsAt,
    prefs.notify,
    restNotificationBody(exercise?.name ?? null, exercise ? nextSetNo : null),
  );

  useWakeLock(prefs.wakeLock && b.openSession !== null);

  return <NotificationAsk />;
}

/**
 * Asked once, the first time a real rest starts: that is the moment the
 * question makes sense, and the answer is useful straight away. Never on
 * load — a permission prompt before the app has done anything gets refused
 * on reflex, and a refusal is permanent.
 *
 * The browser's own prompt only comes up after "Turn on", which is both
 * politer and the only way it is allowed to: it needs a tap to show.
 */
function NotificationAsk() {
  const b = useBompa();
  const prefs = useAlertPrefs();
  const [due, setDue] = useState(false);
  const resting = b.restEndsAt !== null && b.restKind === 'full' && b.s.restFull;

  useEffect(() => {
    if (!resting || prefs.notifyAsked) return;
    let live = true;
    // The stored answer has to be in before deciding; the defaults say "not
    // asked", and trusting them would ask again on every reload.
    void loadAlertPrefs().then(() => {
      if (!live) return;
      const permission = notificationPermission();
      // Already decided in the browser, or no notifications to ask about:
      // there is no question left to put.
      if (permission !== 'default') setAlertPref('notifyAsked', true);
      else setDue(true);
    });
    return () => {
      live = false;
    };
  }, [resting, prefs.notifyAsked]);

  if (!due || !resting || prefs.notifyAsked) return null;

  const answer = async (yes: boolean) => {
    setAlertPref('notifyAsked', true);
    setDue(false);
    if (!yes) return;
    const permission = await requestNotificationPermission();
    if (permission === 'granted') setAlertPref('notify', true);
  };

  return (
    <div
      role="region"
      aria-label="Rest notifications"
      className="sheet"
      style={{
        position: 'absolute',
        // Under the rest screen's top bar, over the ring: the bar's Minimise
        // button and the controls at the bottom stay reachable.
        top: 72,
        left: 18,
        right: 18,
        zIndex: Z.sheet,
        background: onInk.line,
        color: onInk.text,
        borderRadius: R.control,
        boxShadow: SHADOW.toast,
        padding: '14px 15px',
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
      }}
    >
      <span style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.4 }}>
        Get a notification when rest is up, even with the phone locked?
      </span>
      <div style={{ display: 'flex', gap: 8 }}>
        <InkButton onClick={() => void answer(true)} variant="amber" height={44} fontSize={13} style={{ flex: 1 }}>
          Turn on
        </InkButton>
        <InkButton onClick={() => void answer(false)} height={44} fontSize={13} color={C.lineStrong} style={{ flex: 1 }}>
          Not now
        </InkButton>
      </div>
    </div>
  );
}
