// @vitest-environment jsdom

// The one-time notification question and the alert switches in Settings. The app
// context is replaced with just the rest-timer fields these read, so each test
// can put a rest on screen without logging a set.

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db';
import { ALERT_KEYS, alertPrefs, loadAlertPrefs, resetAlertPrefs } from './alertPrefs';
import { AlertSettings } from './AlertSettings';
import { TimerAlerts } from './TimerAlerts';

type FakeBompa = {
  restEndsAt: number | null;
  restKind: 'full' | 'intra' | 'transition' | null;
  s: { restFull: boolean };
  activeExerciseId: string | null;
  exerciseById: Map<string, { name: string }>;
  sessionSets: never[];
  openSession: object | null;
};

let fake: FakeBompa;

vi.mock('@/state/BompaContext', () => ({ useBompa: () => fake }));

function resting(endsAt: number): FakeBompa {
  return {
    restEndsAt: endsAt,
    restKind: 'full',
    s: { restFull: true },
    activeExerciseId: 'barbell-bench-press',
    exerciseById: new Map([['barbell-bench-press', { name: 'Bench Press' }]]),
    sessionSets: [],
    openSession: {},
  };
}

const idle: FakeBompa = { ...resting(0), restEndsAt: null, restKind: null, s: { restFull: false } };

let requestPermission: ReturnType<typeof vi.fn>;

function permission(value: NotificationPermission, answer: NotificationPermission = value) {
  requestPermission = vi.fn(() => Promise.resolve(answer));
  vi.stubGlobal('Notification', { permission: value, requestPermission });
}

/** Let storage reads and permission promises settle. */
async function settle() {
  await act(async () => {
    await loadAlertPrefs();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

beforeEach(async () => {
  await db.settings.clear();
  resetAlertPrefs();
  fake = idle;
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('the notification question', () => {
  const question = () => screen.queryByRole('region', { name: 'Rest notifications' });

  it('is never asked on load, only once a rest starts', async () => {
    permission('default');
    const view = render(<TimerAlerts />);
    await settle();
    expect(question()).toBeNull();

    fake = resting(Date.now() + 90_000);
    view.rerender(<TimerAlerts />);
    await settle();
    expect(question()).not.toBeNull();
    expect(requestPermission).not.toHaveBeenCalled();
  });

  it('asks the browser only after "Turn on", and switches notifications on when allowed', async () => {
    permission('default', 'granted');
    fake = resting(Date.now() + 90_000);
    render(<TimerAlerts />);
    await settle();
    fireEvent.click(screen.getByRole('button', { name: 'Turn on' }));
    await settle();
    expect(requestPermission).toHaveBeenCalledTimes(1);
    expect(alertPrefs().notify).toBe(true);
    expect(question()).toBeNull();
  });

  it('is not asked again after "Not now", even after a reload', async () => {
    permission('default');
    fake = resting(Date.now() + 90_000);
    const view = render(<TimerAlerts />);
    await settle();
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
    await settle();
    expect(question()).toBeNull();
    expect(requestPermission).not.toHaveBeenCalled();

    view.unmount();
    resetAlertPrefs();
    fake = resting(Date.now() + 120_000);
    render(<TimerAlerts />);
    await settle();
    expect(question()).toBeNull();
  });

  it('is never asked once the browser has said no', async () => {
    permission('denied');
    fake = resting(Date.now() + 90_000);
    render(<TimerAlerts />);
    await settle();
    expect(question()).toBeNull();
    expect(requestPermission).not.toHaveBeenCalled();
    expect(alertPrefs().notifyAsked).toBe(true);
    expect(alertPrefs().notify).toBe(false);
  });

  it('is not asked for the short pause between pieces', async () => {
    permission('default');
    fake = { ...resting(Date.now() + 15_000), restKind: 'intra', s: { restFull: false } };
    render(<TimerAlerts />);
    await settle();
    expect(question()).toBeNull();
  });
});

describe('alert settings', () => {
  it('starts with sound and vibrate on, notifications and screen lock off', async () => {
    permission('default');
    render(<AlertSettings />);
    await settle();
    expect(screen.getByRole('switch', { name: 'Sound' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('switch', { name: 'Vibrate' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('switch', { name: 'Rest notifications' }).getAttribute('aria-checked')).toBe('false');
    expect(screen.getByRole('switch', { name: 'Keep screen on during workouts' }).getAttribute('aria-checked')).toBe('false');
  });

  it('stores a switch as a setting', async () => {
    permission('default');
    render(<AlertSettings />);
    await settle();
    fireEvent.click(screen.getByRole('switch', { name: 'Sound' }));
    await settle();
    expect(screen.getByRole('switch', { name: 'Sound' }).getAttribute('aria-checked')).toBe('false');
    expect((await db.settings.get(ALERT_KEYS.sound))?.value).toBe(false);
  });

  it('says notifications are blocked, and never asks, when the browser has refused', async () => {
    permission('denied');
    render(<AlertSettings />);
    await settle();
    expect(screen.getByText('Blocked in browser settings')).toBeTruthy();
    const toggle = screen.getByRole('switch', { name: 'Rest notifications' }) as HTMLButtonElement;
    expect(toggle.disabled).toBe(true);
    fireEvent.click(toggle);
    await settle();
    expect(requestPermission).not.toHaveBeenCalled();
  });

  it('asks for permission from the switch when it has not been asked', async () => {
    permission('default', 'granted');
    render(<AlertSettings />);
    await settle();
    fireEvent.click(screen.getByRole('switch', { name: 'Rest notifications' }));
    await settle();
    expect(requestPermission).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('switch', { name: 'Rest notifications' }).getAttribute('aria-checked')).toBe('true');
    expect(alertPrefs().notifyAsked).toBe(true);
  });
});
