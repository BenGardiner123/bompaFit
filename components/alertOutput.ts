'use client';

import type { Cue } from '@/lib/alerts';

// The noisy end of the timer alerts: tones, buzzes and the system notification.
// Every API here is feature-detected and every call is allowed to fail — an
// alert that throws must never take a set log down with it.

/**
 * Short buzz for a countdown tick; a long, broken one for the end, so the two
 * are told apart through a pocket.
 */
export const VIBRATE: Record<Cue, number[]> = {
  tick: [40],
  zero: [300, 120, 300, 120, 500],
};

/**
 * The tick is a single quiet blip; the end is two rising notes, louder and
 * longer. Different in pitch, length and shape, so nobody has to count beeps
 * to know which one they heard.
 */
export const TONES: Record<Cue, { hz: number; ms: number; gain: number }[]> = {
  tick: [{ hz: 880, ms: 70, gain: 0.12 }],
  zero: [
    { hz: 784, ms: 170, gain: 0.3 },
    { hz: 1175, ms: 420, gain: 0.3 },
  ],
};

const NOTE_GAP_MS = 40;

type AudioContextCtor = typeof AudioContext;

let audio: AudioContext | null = null;

function audioCtor(): AudioContextCtor | null {
  if (typeof window === 'undefined') return null;
  // Older Safari only has the prefixed name.
  const w = window as unknown as { AudioContext?: AudioContextCtor; webkitAudioContext?: AudioContextCtor };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

/**
 * Create (once) and wake the shared audio context. Must run inside a tap:
 * browsers keep audio muted until the page has had a user gesture, and a
 * context created before one starts, and stays, suspended.
 */
export function unlockAudio(): void {
  const Ctor = audioCtor();
  if (!Ctor) return;
  try {
    audio ??= new Ctor();
    if (audio.state !== 'running') void audio.resume().catch(() => undefined);
  } catch {
    // No audio device, or the browser said no. Silent it is.
  }
}

function playTones(cue: Cue): void {
  // Never create the context here. Outside a gesture it would be born
  // suspended, and the first tap that could have woken it is long gone.
  if (!audio) return;
  try {
    if (audio.state === 'suspended') void audio.resume().catch(() => undefined);
    let at = audio.currentTime + 0.01;
    for (const note of TONES[cue]) {
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.type = 'sine';
      osc.frequency.value = note.hz;
      // A few milliseconds of fade either side: a tone switched on and off
      // square clicks, and the click is what you hear, not the note.
      const end = at + note.ms / 1000;
      gain.gain.setValueAtTime(0, at);
      gain.gain.linearRampToValueAtTime(note.gain, at + 0.008);
      gain.gain.setValueAtTime(note.gain, end - 0.02);
      gain.gain.linearRampToValueAtTime(0, end);
      osc.connect(gain).connect(audio.destination);
      osc.start(at);
      osc.stop(end + 0.01);
      at = end + NOTE_GAP_MS / 1000;
    }
  } catch {
    // A tone that fails is a missed beep, not a broken app.
  }
}

function buzz(pattern: number[]): void {
  // iOS has no vibrate at all; Chrome ignores it until the page has been tapped.
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;
  try {
    navigator.vibrate(pattern);
  } catch {
    // Ignored for the same reason as a failed tone.
  }
}

/** Play one cue through whichever channels are switched on. */
export function playCue(cue: Cue, channels: { sound: boolean; vibrate: boolean }): void {
  if (channels.sound) playTones(cue);
  if (channels.vibrate) buzz(VIBRATE[cue]);
}

// ─────────────────────────────────────────────────────────────
// Notifications
// ─────────────────────────────────────────────────────────────

/** One tag for every rest, so a new one replaces the last instead of stacking. */
export const REST_TAG = 'bompa-rest';

export type Permission = 'granted' | 'denied' | 'default' | 'unsupported';

export function notificationPermission(): Permission {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
  return Notification.permission;
}

export async function requestNotificationPermission(): Promise<Permission> {
  if (notificationPermission() === 'unsupported') return 'unsupported';
  try {
    return await Notification.requestPermission();
  } catch {
    return notificationPermission();
  }
}

// The DOM typings dropped `vibrate` and `renotify`, but Chrome on Android
// still honours both, and they are the point: buzz, even if the last rest's
// notification is still sitting in the shade.
type RestNotificationOptions = NotificationOptions & { vibrate?: number[]; renotify?: boolean };

async function registration(): Promise<ServiceWorkerRegistration | undefined> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return undefined;
  try {
    return await navigator.serviceWorker.getRegistration();
  } catch {
    return undefined;
  }
}

/**
 * Show the rest-over notification. Through the service worker, because Chrome
 * on Android refuses `new Notification()` outright; the constructor is only a
 * fallback for a desktop browser with no worker (a development build).
 */
export async function showRestNotification(body: string): Promise<void> {
  if (notificationPermission() !== 'granted') return;
  const options: RestNotificationOptions = {
    body,
    tag: REST_TAG,
    renotify: true,
    vibrate: VIBRATE.zero,
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
  };
  try {
    const reg = await registration();
    if (reg) await reg.showNotification('Bompa', options);
    else new Notification('Bompa', options);
  } catch {
    // Not shown. The in-page tone still plays when the lifter comes back.
  }
}

/** Take a rest notification back down — the lifter is looking at the app already. */
export async function closeRestNotifications(): Promise<void> {
  try {
    const reg = await registration();
    const shown = reg ? await reg.getNotifications({ tag: REST_TAG }) : [];
    for (const n of shown) n.close();
  } catch {
    // Nothing to close, or no way to find out. Either way, nothing to do.
  }
}

/** For tests: drop the shared audio context. */
export function resetAudio(): void {
  audio = null;
}
