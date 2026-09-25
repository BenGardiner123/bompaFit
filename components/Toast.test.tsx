// @vitest-environment jsdom

// The toast is interactive now, so its timing is behaviour someone depends on:
// it has to stay long enough to reach Undo, hold still under a finger, and get
// out of the way when flicked or closed.

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Toast as ToastMessage } from '@/state/BompaContext';
import { TOAST_ACTION_MS, TOAST_INFO_MS, TOAST_SWIPE_PX, ToastView } from './Toast';

/**
 * Holds the toast in state the way the app does, and drops it on dismiss only
 * if it is still the one showing. "Say again" says the same words as a new
 * message, which is what a repeated action does.
 */
function Harness({ initial, onTrain = false }: { initial: NonNullable<ToastMessage>; onTrain?: boolean }) {
  const [toast, setToast] = useState<ToastMessage>(initial);
  return (
    <>
      <button type="button" onClick={() => setToast({ text: initial.text })}>
        Say again
      </button>
      <ToastView toast={toast} onDismiss={(t) => setToast((current) => (current === t ? null : current))} placement="shell" onTrain={onTrain} />
    </>
  );
}

// jsdom has no PointerEvent, so a fired pointer event would arrive without its
// pointer id or position. A mouse event carries the position; this adds the id.
if (typeof window !== 'undefined' && !('PointerEvent' in window)) {
  class PointerEventStandIn extends MouseEvent {
    pointerId: number;
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 0;
    }
  }
  (window as unknown as { PointerEvent: typeof PointerEventStandIn }).PointerEvent = PointerEventStandIn;
}

const card = () => screen.queryByTestId('toast');

function pointer(type: 'pointerDown' | 'pointerMove' | 'pointerUp', clientY: number) {
  fireEvent[type](screen.getByTestId('toast'), { pointerId: 1, clientY });
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('Toast', () => {
  it('says its message in a live region', () => {
    render(<Harness initial={{ text: 'Set removed.' }} />);
    expect(screen.getByRole('status').textContent).toContain('Set removed.');
  });

  it('goes after three seconds when there is nothing to tap', () => {
    render(<Harness initial={{ text: 'Set removed.' }} />);
    act(() => vi.advanceTimersByTime(TOAST_INFO_MS - 1));
    expect(card()).not.toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(card()).toBeNull();
    expect(TOAST_INFO_MS).toBe(3000);
  });

  it('stays six seconds when it offers an action, long enough to decide', () => {
    render(<Harness initial={{ text: 'Moved.', action: { label: 'Undo', run: () => {} } }} />);
    act(() => vi.advanceTimersByTime(TOAST_INFO_MS + 1));
    expect(card()).not.toBeNull();
    act(() => vi.advanceTimersByTime(TOAST_ACTION_MS - TOAST_INFO_MS));
    expect(card()).toBeNull();
    expect(TOAST_ACTION_MS).toBe(6000);
  });

  it('runs the action once and goes', () => {
    const run = vi.fn();
    render(<Harness initial={{ text: 'Moved.', action: { label: 'Undo', run } }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(run).toHaveBeenCalledTimes(1);
    expect(card()).toBeNull();
  });

  it('closes from its close button', () => {
    render(<Harness initial={{ text: 'Set removed.' }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(card()).toBeNull();
  });

  it('holds still while a finger is on it, and picks up where it left off', () => {
    render(<Harness initial={{ text: 'Set removed.' }} />);
    act(() => vi.advanceTimersByTime(2000));
    pointer('pointerDown', 100);
    act(() => vi.advanceTimersByTime(10_000));
    expect(card()).not.toBeNull();

    pointer('pointerUp', 100);
    act(() => vi.advanceTimersByTime(TOAST_INFO_MS - 2000 - 1));
    expect(card()).not.toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(card()).toBeNull();
  });

  it('goes when flicked down past the threshold', () => {
    render(<Harness initial={{ text: 'Set removed.' }} />);
    pointer('pointerDown', 100);
    pointer('pointerMove', 100 + TOAST_SWIPE_PX + 1);
    pointer('pointerUp', 100 + TOAST_SWIPE_PX + 1);
    expect(card()).toBeNull();
  });

  it('springs back from a short drag, and its clock resumes', () => {
    render(<Harness initial={{ text: 'Set removed.' }} />);
    pointer('pointerDown', 100);
    pointer('pointerMove', 100 + TOAST_SWIPE_PX - 5);
    pointer('pointerUp', 100 + TOAST_SWIPE_PX - 5);
    expect(card()).not.toBeNull();
    expect(card()!.style.transform).toBe('');
    act(() => vi.advanceTimersByTime(TOAST_INFO_MS));
    expect(card()).toBeNull();
  });

  it('does not move upwards', () => {
    render(<Harness initial={{ text: 'Set removed.' }} />);
    pointer('pointerDown', 100);
    pointer('pointerMove', 20);
    expect(card()!.style.transform).toBe('');
    pointer('pointerUp', 20);
    expect(card()).not.toBeNull();
  });

  it('starts the clock again for a new message, even with the same words', () => {
    render(<Harness initial={{ text: 'Set removed.' }} />);
    act(() => vi.advanceTimersByTime(2500));
    fireEvent.click(screen.getByRole('button', { name: 'Say again' }));
    act(() => vi.advanceTimersByTime(2500));
    // Past the first message's three seconds, and still up: the clock restarted.
    expect(card()).not.toBeNull();
    expect(screen.getByRole('status').textContent).toContain('Set removed.');
    act(() => vi.advanceTimersByTime(TOAST_INFO_MS - 2500));
    expect(card()).toBeNull();
  });

  it('lifts to the lighter ink on Train, where plain ink would disappear', () => {
    const { unmount } = render(<Harness initial={{ text: 'Set logged.' }} onTrain />);
    const onTrain = card()!.style.background;
    unmount();
    render(<Harness initial={{ text: 'Set logged.' }} />);
    expect(card()!.style.background).not.toBe(onTrain);
  });

  it('leaves the empty region transparent to taps', () => {
    render(<ToastView toast={null} onDismiss={() => {}} placement="shell" onTrain={false} />);
    expect(screen.getByRole('status').style.pointerEvents).toBe('none');
    expect(card()).toBeNull();
  });
});
