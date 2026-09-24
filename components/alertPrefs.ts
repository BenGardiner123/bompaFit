'use client';

import { useSyncExternalStore } from 'react';
import { readSettings, writeSetting } from '@/lib/db';

// The alert switches, kept out of the app-wide context on purpose: two small
// components read them (the settings section and the invisible alert driver),
// nothing else in the app cares, and a context change re-renders every screen.
//
// Stored as ordinary settings rows, one key each, so they ride along with
// export and import and need no schema change.

export type AlertPrefs = {
  sound: boolean;
  vibrate: boolean;
  /** Off until the lifter says yes: a notification nobody asked for is spam. */
  notify: boolean;
  wakeLock: boolean;
  /** Whether the one-time notification question has been asked. Never asked twice. */
  notifyAsked: boolean;
};

export const ALERT_DEFAULTS: AlertPrefs = { sound: true, vibrate: true, notify: false, wakeLock: false, notifyAsked: false };

export const ALERT_KEYS: Record<keyof AlertPrefs, string> = {
  sound: 'alertSound',
  vibrate: 'alertVibrate',
  notify: 'alertNotify',
  wakeLock: 'alertWakeLock',
  notifyAsked: 'alertNotifyAsked',
};

let prefs: AlertPrefs = ALERT_DEFAULTS;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();
/** Switches flipped before storage answered; the stored value must not undo the tap. */
const touched = new Set<keyof AlertPrefs>();

function emit() {
  for (const listener of listeners) listener();
}

/** Read the stored switches once, the first time anything subscribes. */
export function loadAlertPrefs(): Promise<void> {
  loading ??= readSettings()
    .then((row) => {
      const next = { ...prefs };
      for (const key of Object.keys(ALERT_KEYS) as (keyof AlertPrefs)[]) {
        const value = row[ALERT_KEYS[key]];
        if (typeof value === 'boolean' && !touched.has(key)) next[key] = value;
      }
      prefs = next;
      emit();
    })
    // No storage: the defaults are a working set of alerts, so carry on.
    .catch(() => undefined);
  return loading;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  void loadAlertPrefs();
  return () => listeners.delete(listener);
}

/** The current switches, for code that runs outside React (a beep from a timer). */
export function alertPrefs(): AlertPrefs {
  return prefs;
}

export function setAlertPref<K extends keyof AlertPrefs>(key: K, value: AlertPrefs[K]): void {
  touched.add(key);
  prefs = { ...prefs, [key]: value };
  emit();
  writeSetting(ALERT_KEYS[key], value, Date.now());
}

export function useAlertPrefs(): AlertPrefs {
  return useSyncExternalStore(subscribe, alertPrefs, () => ALERT_DEFAULTS);
}

/** For tests: forget what was loaded, so the next subscriber reads storage again. */
export function resetAlertPrefs(): void {
  prefs = ALERT_DEFAULTS;
  loading = null;
  touched.clear();
}
