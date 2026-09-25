'use client';

// The toast: a short message after something happened, sometimes with an Undo.
//
// It is interactive, so it has to be reachable and has to stay long enough to
// reach. It holds still while a finger is on it (someone reading it, or
// reaching for Undo, should not have it vanish under them), it goes away early
// on a tap of the close button or a flick downwards, and it stays twice as long
// when it offers an action, because reading and then deciding takes longer
// than reading.

import { useCallback, useEffect, useRef, useState, type PointerEvent } from 'react';
import { Icon } from '@/components/icons';
import { Btn } from '@/components/ui';
import { C, R, SHADOW, T, TOUCH, Z, onInk } from '@/lib/tokens';
import { useBompa, type Toast as ToastMessage } from '@/state/BompaContext';

/** How long a toast with nothing to tap stays up. */
export const TOAST_INFO_MS = 3000;
/** How long a toast with an action stays up: long enough to read it and then decide. */
export const TOAST_ACTION_MS = 6000;
/** How far a toast has to be dragged down before letting go dismisses it. */
export const TOAST_SWIPE_PX = 40;
/**
 * Movement under this is a tap that wobbled, not a drag. Below it the buttons
 * inside still get their click; above it the gesture belongs to the toast.
 */
const DRAG_SLOP_PX = 6;

/**
 * Where the toast sits:
 * - `shell`: 12px above the tab bar, on every screen but an open session.
 * - `footer`: in Train's sticky footer, 10px above the Log button, so it never
 *   covers the one control that matters mid-set.
 */
export function Toast({ placement }: { placement: 'shell' | 'footer' }) {
  const { s, dismissToast } = useBompa();
  // On the dark Train screen an ink toast would vanish into the page, so it
  // lifts to the next shade up there.
  const onTrain = s.tab === 'log' && s.pushed === null;
  // Settings is an ink sheet over the tab bar. What its buttons say (a
  // backup exported, a file that is not a backup) has to land on top of it,
  // in the lifted shade an ink surface needs.
  const overSheet = placement === 'shell' && s.settingsOpen;
  return <ToastView toast={s.toast} onDismiss={dismissToast} placement={placement} onTrain={onTrain || overSheet} overSheet={overSheet} />;
}

/** The toast itself, apart from the app state, so its timing can be tested on its own. */
export function ToastView({
  toast,
  onDismiss: dismissToast,
  placement,
  onTrain,
  overSheet = false,
}: {
  toast: ToastMessage;
  onDismiss: (toast: ToastMessage) => void;
  placement: 'shell' | 'footer';
  /** On an ink surface, where the ink toast needs its lifted shade. */
  onTrain: boolean;
  /** Raise it above an open sheet. */
  overSheet?: boolean;
}) {

  const [drag, setDrag] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const remaining = useRef(0);
  const startedAt = useRef(0);
  const gesture = useRef<{ pointerId: number; startY: number; dragging: boolean } | null>(null);

  const pause = useCallback(() => {
    if (!timer.current) return;
    clearTimeout(timer.current);
    timer.current = null;
    remaining.current -= Date.now() - startedAt.current;
  }, []);

  const resume = useCallback(() => {
    if (!toast || timer.current) return;
    startedAt.current = Date.now();
    timer.current = setTimeout(() => {
      timer.current = null;
      dismissToast(toast);
    }, Math.max(0, remaining.current));
  }, [toast, dismissToast]);

  // A new toast object, even with the same words, is a new message: the clock
  // starts again from its full length.
  useEffect(() => {
    if (!toast) return;
    remaining.current = toast.action ? TOAST_ACTION_MS : TOAST_INFO_MS;
    resume();
    return () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
    };
  }, [toast, resume]);

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    gesture.current = { pointerId: event.pointerId, startY: event.clientY, dragging: false };
    pause();
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    if (!g || g.pointerId !== event.pointerId) return;
    const dy = event.clientY - g.startY;
    if (!g.dragging && Math.abs(dy) > DRAG_SLOP_PX) {
      g.dragging = true;
      // Captured only once it is clearly a drag. Capturing on the first touch
      // would steal the click from the Undo and close buttons underneath.
      event.currentTarget.setPointerCapture?.(event.pointerId);
    }
    // Downwards only: there is nowhere useful to push a toast up to.
    if (g.dragging) setDrag(Math.max(0, dy));
  };

  const onPointerEnd = (event: PointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    if (!g || g.pointerId !== event.pointerId) return;
    gesture.current = null;
    const dy = event.clientY - g.startY;
    setDrag(0);
    if (g.dragging && dy > TOAST_SWIPE_PX && toast) {
      dismissToast(toast);
      return;
    }
    resume();
  };

  const act = () => {
    if (!toast?.action) return;
    toast.action.run();
    dismissToast(toast);
  };

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: 'absolute',
        left: placement === 'shell' ? 18 : 0,
        right: placement === 'shell' ? 18 : 0,
        bottom: placement === 'shell' ? 12 : 'calc(100% + 10px)',
        zIndex: overSheet ? Z.toastOverSheet : Z.toast,
        // The empty region stays in place for screen readers to announce into,
        // but must not swallow taps meant for what is under it.
        pointerEvents: 'none',
      }}
    >
      {toast && (
        <div
          className="sheet"
          data-testid="toast"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerEnd}
          onPointerCancel={onPointerEnd}
          onPointerLeave={(event) => {
            // A finger that slides off without dragging never sends its "up"
            // here, which would leave the clock paused for good.
            if (!gesture.current?.dragging) onPointerEnd(event);
          }}
          style={{
            pointerEvents: 'auto',
            // Vertical drags are the toast's; the page underneath must not
            // scroll along with them.
            touchAction: 'none',
            transform: drag ? `translateY(${drag}px)` : undefined,
            opacity: drag ? Math.max(0.3, 1 - drag / (TOAST_SWIPE_PX * 3)) : 1,
            background: onTrain ? onInk.line : C.ink,
            borderRadius: R.control,
            padding: '4px 4px 4px 14px',
            display: 'flex',
            alignItems: 'center',
            gap: 2,
            boxShadow: SHADOW.toast,
          }}
        >
          <span style={{ flex: 1, minWidth: 0, padding: '8px 0', fontSize: T.md, fontWeight: 700, lineHeight: 1.35, color: C.white }}>
            {toast.text}
          </span>
          {toast.action && (
            <Btn onClick={act} style={{ flex: 'none', height: TOUCH, minWidth: TOUCH, padding: '0 10px', fontSize: T.md, fontWeight: 800, color: C.amberLight }}>
              {toast.action.label}
            </Btn>
          )}
          <Btn
            onClick={() => dismissToast(toast)}
            label="Dismiss"
            style={{ flex: 'none', width: TOUCH, height: TOUCH, color: onInk.body, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          >
            <Icon name="close" size={16} />
          </Btn>
        </div>
      )}
    </div>
  );
}
