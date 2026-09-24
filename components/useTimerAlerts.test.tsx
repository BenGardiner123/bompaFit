// @vitest-environment jsdom

// The browser end of the timer alerts, with every browser API it touches
// replaced by a recorder: tones, buzzes, notifications and the screen lock.
// No sound is ever made; what is checked is what would have been asked for.

import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TONES, VIBRATE, resetAudio, unlockAudio } from './alertOutput';
import { resetAlertPrefs, setAlertPref } from './alertPrefs';
import { useCues, useIntervalAlerts, useRestNotification } from './useTimerAlerts';
import { useWakeLock } from './useWakeLock';

/** Every frequency started on a fake oscillator, in order. */
let tones: number[] = [];
let buzzes: number[][] = [];

class FakeParam {
  value = 0;
  setValueAtTime() {}
  linearRampToValueAtTime() {}
}
class FakeNode {
  frequency = new FakeParam();
  gain = new FakeParam();
  type = 'sine';
  connect(next: unknown) {
    return next;
  }
  start() {
    tones.push(this.frequency.value);
  }
  stop() {}
}
class FakeAudioContext {
  state = 'running';
  currentTime = 0;
  destination = {};
  resume() {
    return Promise.resolve();
  }
  createOscillator() {
    return new FakeNode();
  }
  createGain() {
    return new FakeNode();
  }
}

let hidden = false;

function setHidden(next: boolean) {
  hidden = next;
  document.dispatchEvent(new Event('visibilitychange'));
}

/** The zero tone's first note, which no tick shares. */
const ZERO_HZ = TONES.zero[0]!.hz;
const TICK_HZ = TONES.tick[0]!.hz;

beforeEach(() => {
  vi.useFakeTimers({ now: 0 });
  tones = [];
  buzzes = [];
  hidden = false;
  resetAlertPrefs();
  resetAudio();
  vi.stubGlobal('AudioContext', FakeAudioContext);
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (hidden ? 'hidden' : 'visible') });
  Object.defineProperty(navigator, 'vibrate', {
    configurable: true,
    value: (pattern: number[]) => {
      buzzes.push(pattern);
      return true;
    },
  });
  // The page has been tapped: audio is allowed.
  unlockAudio();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('rest cues', () => {
  function rest(endsAt: number | null, ticks?: number[]) {
    return renderHook(({ at }) => useCues(() => at, at !== null, ticks), { initialProps: { at: endsAt } });
  }

  it('beeps and buzzes 3, 2, 1 and the end once each', () => {
    rest(10_000);
    act(() => void vi.advanceTimersByTime(12_000));
    expect(tones.filter((hz) => hz === TICK_HZ)).toHaveLength(3);
    expect(tones.filter((hz) => hz === ZERO_HZ)).toHaveLength(1);
    expect(buzzes).toEqual([VIBRATE.tick, VIBRATE.tick, VIBRATE.tick, VIBRATE.zero]);
  });

  it('plays only the end for a pause between pieces', () => {
    rest(10_000, []);
    act(() => void vi.advanceTimersByTime(12_000));
    expect(buzzes).toEqual([VIBRATE.zero]);
  });

  it('skips stale ticks when the page wakes up late', () => {
    rest(10_000);
    // A frozen page: the clock jumps, no timer runs in between.
    act(() => {
      vi.setSystemTime(12_000);
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(buzzes).toEqual([VIBRATE.zero]);
  });

  it('plays nothing for a rest skipped before it ran out', () => {
    const hook = rest(10_000);
    act(() => void vi.advanceTimersByTime(5_000));
    hook.rerender({ at: null });
    act(() => void vi.advanceTimersByTime(10_000));
    expect(tones).toEqual([]);
    expect(buzzes).toEqual([]);
  });

  it('still plays the end when the rest is cleared on the tick it ran out', () => {
    const hook = rest(10_000);
    act(() => void vi.advanceTimersByTime(9_950));
    vi.setSystemTime(10_050);
    hook.rerender({ at: null });
    expect(buzzes.at(-1)).toEqual(VIBRATE.zero);
    expect(buzzes.filter((p) => p === VIBRATE.zero)).toHaveLength(1);
  });

  it('re-arms the countdown after +30', () => {
    const hook = rest(10_000);
    act(() => void vi.advanceTimersByTime(8_500));
    hook.rerender({ at: 40_000 });
    act(() => void vi.advanceTimersByTime(35_000));
    expect(buzzes).toEqual([VIBRATE.tick, VIBRATE.tick, VIBRATE.tick, VIBRATE.tick, VIBRATE.tick, VIBRATE.zero]);
  });

  it('stays quiet with sound off, and still buzzes', () => {
    setAlertPref('sound', false);
    rest(5_000);
    act(() => void vi.advanceTimersByTime(6_000));
    expect(tones).toEqual([]);
    expect(buzzes).toHaveLength(4);
  });

  it('stays still with vibrate off, and still beeps', () => {
    setAlertPref('vibrate', false);
    rest(5_000);
    act(() => void vi.advanceTimersByTime(6_000));
    expect(buzzes).toEqual([]);
    expect(tones.filter((hz) => hz === ZERO_HZ)).toHaveLength(1);
  });

  it('never makes an audio context outside a tap', () => {
    resetAudio();
    const made = vi.fn();
    vi.stubGlobal('AudioContext', class extends FakeAudioContext {
      constructor() {
        super();
        made();
      }
    });
    rest(2_000);
    act(() => void vi.advanceTimersByTime(3_000));
    expect(made).not.toHaveBeenCalled();
    expect(tones).toEqual([]);
  });
});

describe('interval timer cues', () => {
  it('counts down into every EMOM minute', () => {
    renderHook(() => useIntervalAlerts({ mode: 'emom', startedAt: 0, accumulatedMs: 0, capMs: 0, intervalMs: 60_000 }));
    act(() => void vi.advanceTimersByTime(181_000));
    expect(buzzes.filter((p) => p === VIBRATE.zero)).toHaveLength(3);
    expect(buzzes.filter((p) => p === VIBRATE.tick)).toHaveLength(9);
  });

  it('ends an AMRAP at the cap', () => {
    renderHook(() => useIntervalAlerts({ mode: 'amrap', startedAt: 0, accumulatedMs: 0, capMs: 480_000, intervalMs: 60_000 }));
    act(() => void vi.advanceTimersByTime(500_000));
    expect(buzzes.filter((p) => p === VIBRATE.zero)).toHaveLength(1);
  });

  it('says nothing for a stopwatch', () => {
    renderHook(() => useIntervalAlerts({ mode: 'stopwatch', startedAt: 0, accumulatedMs: 0, capMs: 480_000, intervalMs: 60_000 }));
    act(() => void vi.advanceTimersByTime(500_000));
    expect(buzzes).toEqual([]);
  });
});

describe('rest notification', () => {
  let shown: { title: string; options: NotificationOptions & { tag?: string } }[];
  let closed: number;

  beforeEach(() => {
    shown = [];
    closed = 0;
    vi.stubGlobal('Notification', { permission: 'granted', requestPermission: vi.fn() });
    const registration = {
      showNotification: (title: string, options: NotificationOptions) => {
        shown.push({ title, options });
        return Promise.resolve();
      },
      getNotifications: () => Promise.resolve([{ close: () => void closed++ }]),
    };
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: { getRegistration: () => Promise.resolve(registration) },
    });
  });

  function notify(endsAt: number | null, enabled = true) {
    return renderHook(({ at, on }) => useRestNotification(at, on, "Rest's up · Bench Press, set 3"), {
      initialProps: { at: endsAt, on: enabled },
    });
  }

  it('is scheduled for the end of rest when the page is hidden', async () => {
    notify(60_000);
    act(() => setHidden(true));
    await act(async () => void (await vi.advanceTimersByTimeAsync(59_000)));
    expect(shown).toEqual([]);
    await act(async () => void (await vi.advanceTimersByTimeAsync(1_000)));
    expect(shown).toHaveLength(1);
    expect(shown[0]!.options.body).toBe("Rest's up · Bench Press, set 3");
    expect(shown[0]!.options.tag).toBe('bompa-rest');
  });

  it('is cancelled when the page comes back before the end', async () => {
    notify(60_000);
    act(() => setHidden(true));
    await act(async () => void (await vi.advanceTimersByTimeAsync(30_000)));
    act(() => setHidden(false));
    await act(async () => void (await vi.advanceTimersByTimeAsync(60_000)));
    expect(shown).toEqual([]);
  });

  it('is never scheduled while the app is on screen', async () => {
    notify(60_000);
    await act(async () => void (await vi.advanceTimersByTimeAsync(70_000)));
    expect(shown).toEqual([]);
  });

  it('takes a shown notification down when the app is opened again', async () => {
    notify(10_000);
    act(() => setHidden(true));
    await act(async () => void (await vi.advanceTimersByTimeAsync(11_000)));
    expect(shown).toHaveLength(1);
    const before = closed;
    act(() => setHidden(false));
    await act(async () => void (await vi.advanceTimersByTimeAsync(0)));
    expect(closed).toBe(before + 1);
  });

  it('is still shown when the rest is cleared on the tick it ran out', async () => {
    const hook = notify(10_000);
    act(() => setHidden(true));
    vi.setSystemTime(10_200);
    hook.rerender({ at: null, on: true });
    await act(async () => void (await vi.advanceTimersByTimeAsync(0)));
    expect(shown).toHaveLength(1);
  });

  it('is dropped for a rest skipped early', async () => {
    const hook = notify(60_000);
    act(() => setHidden(true));
    await act(async () => void (await vi.advanceTimersByTimeAsync(10_000)));
    hook.rerender({ at: null, on: true });
    await act(async () => void (await vi.advanceTimersByTimeAsync(60_000)));
    expect(shown).toEqual([]);
  });

  it('does nothing when switched off', async () => {
    notify(10_000, false);
    act(() => setHidden(true));
    await act(async () => void (await vi.advanceTimersByTimeAsync(20_000)));
    expect(shown).toEqual([]);
  });

  it('does nothing without permission', async () => {
    vi.stubGlobal('Notification', { permission: 'denied', requestPermission: vi.fn() });
    notify(10_000);
    act(() => setHidden(true));
    await act(async () => void (await vi.advanceTimersByTimeAsync(20_000)));
    expect(shown).toEqual([]);
  });
});

describe('keep screen on', () => {
  type FakeSentinel = { released: boolean; release: () => Promise<void> };
  let requests: number;
  let sentinels: FakeSentinel[];

  beforeEach(() => {
    requests = 0;
    sentinels = [];
    Object.defineProperty(navigator, 'wakeLock', {
      configurable: true,
      value: {
        request: () => {
          requests++;
          const sentinel: FakeSentinel = {
            released: false,
            release() {
              sentinel.released = true;
              return Promise.resolve();
            },
          };
          sentinels.push(sentinel);
          return Promise.resolve(sentinel);
        },
      },
    });
  });

  it('asks for the lock while enabled, and not otherwise', async () => {
    renderHook(() => useWakeLock(false));
    await act(async () => void (await vi.advanceTimersByTimeAsync(0)));
    expect(requests).toBe(0);
    renderHook(() => useWakeLock(true));
    await act(async () => void (await vi.advanceTimersByTimeAsync(0)));
    expect(requests).toBe(1);
  });

  it('takes the lock back when the page is visible again', async () => {
    renderHook(() => useWakeLock(true));
    await act(async () => void (await vi.advanceTimersByTimeAsync(0)));
    // Hiding the page is what makes the browser drop the lock on its own.
    act(() => {
      sentinels[0]!.released = true;
      setHidden(true);
    });
    await act(async () => void (await vi.advanceTimersByTimeAsync(0)));
    expect(requests).toBe(1);
    act(() => setHidden(false));
    await act(async () => void (await vi.advanceTimersByTimeAsync(0)));
    expect(requests).toBe(2);
  });

  it('lets go when the session finishes', async () => {
    const hook = renderHook(({ on }) => useWakeLock(on), { initialProps: { on: true } });
    await act(async () => void (await vi.advanceTimersByTimeAsync(0)));
    hook.rerender({ on: false });
    expect(sentinels[0]!.released).toBe(true);
  });
});
