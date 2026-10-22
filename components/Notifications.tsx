'use client';

// The bell beside Settings, and the list it drops down.
//
// What Bompa changed and what it noticed used to sit in the middle of Today,
// where a note stayed until something newer pushed it off and the only button
// beside it was Undo, which reverses the change rather than clearing the note.
// Here each note can be dismissed on its own, and Undo is labelled as what it
// does. The badge counts the notes still waiting.

import { useEffect, useRef, useState } from 'react';
import type { Insight } from '@/lib/insights';
import { C, R, SCRIM_LIGHT, SHADOW, T, TOUCH, W, Z, num, onInk } from '@/lib/tokens';
import { useBompa } from '@/state/BompaContext';
import { Btn, useEscapeKey } from '@/components/ui';
import { Icon } from '@/components/icons';

/**
 * How far the list reaches past the bell's right edge: the gear beside it and
 * the gap between them, less a little, so the list ends about 12px from the
 * edge of the screen.
 */
const PANEL_OFFSET = 58;

export function Notifications({ notes }: { notes: Insight[] }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  // Focus goes back to the bell, so a keyboard user carries on from where
  // they opened the list. The bell is the wrapper's first button.
  const close = () => {
    setOpen(false);
    wrap.current?.querySelector('button')?.focus();
  };
  useEscapeKey(open, close);

  // A tap anywhere outside closes it, as a dropdown does. Pointerdown rather
  // than click, so the tap that lands on the gear closes this before the
  // Settings sheet opens over it.
  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !wrap.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    panel.current?.focus();
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);

  const count = notes.length;

  return (
    <div ref={wrap} style={{ position: 'relative', display: 'flex' }}>
      <Btn
        onClick={() => setOpen((was) => !was)}
        label={count > 0 ? `Notifications, ${count} new` : 'Notifications'}
        expanded={open}
        style={{
          position: 'relative',
          width: TOUCH,
          height: TOUCH,
          borderRadius: R.pill,
          // A step lighter while its list is open, so you can see which button the list belongs to.
          background: open ? onInk.line : onInk.raised,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: onInk.body,
        }}
      >
        <Icon name="bell" size={20} strokeWidth={1.8} />
        {count > 0 && (
          <span
            aria-hidden
            style={{
              position: 'absolute',
              top: -2,
              right: -2,
              minWidth: 18,
              height: 18,
              padding: '0 5px',
              borderRadius: R.pill,
              background: C.amber,
              color: C.ink,
              fontSize: T.xs,
              fontWeight: W.title,
              lineHeight: '18px',
              textAlign: 'center',
              // A ring of the hero's own ink, so the badge sits clear of the circle's edge.
              boxShadow: `0 0 0 2px ${C.ink}`,
              ...num,
            }}
          >
            {count}
          </span>
        )}
      </Btn>

      {open && (
        // A dim behind the list that every tap goes straight through, so a tap
        // outside still lands where it was aimed as well as closing the list.
        <span aria-hidden style={{ position: 'fixed', inset: 0, zIndex: Z.popover, background: SCRIM_LIGHT, pointerEvents: 'none' }} />
      )}
      {open && (
        <div
          ref={panel}
          role="dialog"
          aria-label="Notifications"
          tabIndex={-1}
          style={{
            position: 'absolute',
            top: 'calc(100% + 10px)',
            // Past the gear beside the bell, so the list's right edge sits near
            // the screen's rather than under the bell.
            right: -PANEL_OFFSET,
            zIndex: Z.popover,
            // Never wider than the phone less its gutters, so nothing runs off
            // the left edge on a narrow screen.
            width: 'min(340px, calc(100vw - 24px))',
            background: onInk.raised,
            borderRadius: R.raisedCard,
            boxShadow: `${SHADOW.toast}, 0 0 0 1px ${onInk.line}`,
            padding: '14px 6px 6px 16px',
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
            outline: 'none',
            textAlign: 'left',
            whiteSpace: 'normal',
          }}
        >
          {/* The pointer to the bell the list came from. */}
          <span
            aria-hidden
            style={{
              position: 'absolute',
              top: -6,
              right: PANEL_OFFSET + TOUCH / 2 - 6,
              width: 12,
              height: 12,
              background: onInk.raised,
              transform: 'rotate(45deg)',
              boxShadow: `-1px -1px 0 ${onInk.line}`,
            }}
          />
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, paddingRight: 10, paddingBottom: 4 }}>
            <span style={{ fontSize: T.lg, fontWeight: W.title }}>Notifications</span>
            {count > 0 && <span style={{ fontSize: T.sm, fontWeight: W.label, color: onInk.muted, ...num }}>{count} new</span>}
          </div>
          {count === 0 && (
            <span style={{ padding: '6px 8px 10px 0', fontSize: T.sm, lineHeight: 1.45, color: onInk.body }}>
              Nothing new. When I change your plan, I&rsquo;ll say so here.
            </span>
          )}
          {notes.map((note) => (
            <Note key={note.id} note={note} />
          ))}
        </div>
      )}
    </div>
  );
}

/** One note: what happened, what can be done about it, and a way to clear it. */
function Note({ note }: { note: Insight }) {
  const b = useBompa();
  const adjustment = note.adjustmentId === undefined ? undefined : b.adjustments.find((a) => a.id === note.adjustmentId);
  // One tap, and only ever an offer — an overreaching week is sometimes
  // exactly what you meant to do.
  const canTrim = note.id === 'week-over-budget' && b.budget.remaining.length > 0;

  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 4, paddingTop: 6, borderTop: `1px solid ${onInk.line}` }}>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 8, padding: '6px 0 8px' }}>
        <span style={{ fontSize: T.copy, fontWeight: W.body, lineHeight: 1.45, color: onInk.text }}>{note.text}</span>
        {(adjustment || canTrim) && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {adjustment && (
              <NoteAction onClick={() => b.undoAdjustment(adjustment)} label={`Undo this change: ${note.text}`}>
                Undo this change
              </NoteAction>
            )}
            {canTrim && <NoteAction onClick={() => void b.trimWeekToBudget()}>Trim what&rsquo;s left</NoteAction>}
          </div>
        )}
      </div>
      <Btn
        onClick={() => b.dismissNote(note)}
        label={`Dismiss: ${note.text}`}
        style={{ flex: 'none', width: TOUCH, height: TOUCH, display: 'flex', alignItems: 'center', justifyContent: 'center', color: onInk.muted }}
      >
        <Icon name="close" size={16} />
      </Btn>
    </div>
  );
}

function NoteAction({ onClick, children, label }: { onClick: () => void; children: string; label?: string }) {
  return (
    <Btn
      onClick={onClick}
      label={label}
      style={{
        minHeight: TOUCH,
        padding: '0 14px',
        borderRadius: R.pill,
        background: C.ink,
        fontSize: T.note,
        fontWeight: W.button,
        color: C.amberLight,
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </Btn>
  );
}
