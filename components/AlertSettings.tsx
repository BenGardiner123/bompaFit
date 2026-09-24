'use client';

import { useEffect, useState } from 'react';
import { C, FONT, R, SHADOW, TOUCH } from '@/lib/tokens';
import { Row, Section } from '@/components/ui';
import { setAlertPref, useAlertPrefs } from './alertPrefs';
import { notificationPermission, requestNotificationPermission, type Permission } from './alertOutput';

/** Sound, buzz, notification and screen switches for the timers. */
export function AlertSettings() {
  const prefs = useAlertPrefs();
  const [permission, setPermission] = useState<Permission>('unsupported');
  const [wakeLockOk, setWakeLockOk] = useState(true);

  // Read after mount, never during render: the static export renders on a
  // server that has neither, and a mismatch would flash the wrong words.
  useEffect(() => {
    const refresh = () => setPermission(notificationPermission());
    refresh();
    setWakeLockOk('wakeLock' in navigator);
    // Changed in the browser's site settings while the app was in the background.
    document.addEventListener('visibilitychange', refresh);
    return () => document.removeEventListener('visibilitychange', refresh);
  }, []);

  const notifyOn = prefs.notify && permission === 'granted';

  const toggleNotify = async () => {
    if (notifyOn) {
      setAlertPref('notify', false);
      return;
    }
    // Asking from the switch counts as the one-time question: whatever the
    // answer, the rest screen will not ask again.
    setAlertPref('notifyAsked', true);
    const next = permission === 'granted' ? 'granted' : await requestNotificationPermission();
    setPermission(next);
    if (next === 'granted') setAlertPref('notify', true);
  };

  const notifySub =
    permission === 'unsupported'
      ? 'Not supported in this browser'
      : permission === 'denied'
        ? 'Blocked in browser settings'
        : permission === 'default'
          ? 'Needs permission. Turning this on will ask.'
          : 'When rest is up and the phone is locked';

  return (
    <Section title="Timer alerts">
      <Row
        title="Sound"
        titleSize={14}
        sub="3, 2, 1 and a tone when time is up"
        right={<Switch label="Sound" on={prefs.sound} onChange={(on) => setAlertPref('sound', on)} />}
      />
      <Row
        title="Vibrate"
        titleSize={14}
        sub="A short buzz each second, a long one at the end"
        right={<Switch label="Vibrate" on={prefs.vibrate} onChange={(on) => setAlertPref('vibrate', on)} />}
      />
      <Row
        title="Rest notifications"
        titleSize={14}
        sub={notifySub}
        right={
          <Switch
            label="Rest notifications"
            on={notifyOn}
            disabled={permission === 'denied' || permission === 'unsupported'}
            onChange={() => void toggleNotify()}
          />
        }
      />
      <Row
        title="Keep screen on during workouts"
        titleSize={14}
        sub={wakeLockOk ? 'Until the session is finished' : 'Not supported in this browser'}
        right={
          <Switch
            label="Keep screen on during workouts"
            on={prefs.wakeLock}
            disabled={!wakeLockOk}
            onChange={(on) => setAlertPref('wakeLock', on)}
          />
        }
      />
      <span style={{ fontSize: 12, lineHeight: 1.5, color: C.tertiary, paddingTop: 4 }}>
        Phones delay or pause apps in the background, so on a long rest the notification can arrive late.
      </span>
    </Section>
  );
}

const TRACK = { width: 46, height: 28, knob: 22 } as const;

/**
 * An on/off switch. A real `switch` role, so a screen reader says "on" and
 * "off" rather than "pressed"; the button is a full touch target tall even
 * though the track drawn inside it is smaller.
 */
function Switch({ label, on, onChange, disabled }: { label: string; on: boolean; onChange: (on: boolean) => void; disabled?: boolean }) {
  const inset = (TRACK.height - TRACK.knob) / 2;
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
      style={{
        fontFamily: FONT,
        flex: 'none',
        width: TRACK.width + 8,
        height: TOUCH,
        padding: 0,
        border: 'none',
        background: 'transparent',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'flex-end',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.45 : 1,
      }}
    >
      <span
        aria-hidden
        style={{
          position: 'relative',
          width: TRACK.width,
          height: TRACK.height,
          borderRadius: R.pill,
          background: on ? C.ink : C.lineStrong,
          transition: 'background .15s ease',
        }}
      >
        <span
          style={{
            position: 'absolute',
            top: inset,
            left: on ? TRACK.width - TRACK.knob - inset : inset,
            width: TRACK.knob,
            height: TRACK.knob,
            borderRadius: R.pill,
            background: C.white,
            boxShadow: SHADOW.segment,
            transition: 'left .15s ease',
          }}
        />
      </span>
    </button>
  );
}
