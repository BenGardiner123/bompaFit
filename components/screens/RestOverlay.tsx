'use client';

// The rest countdown, full screen.
//
// Logging a set opens it, because the next thing a lifter needs is how long
// they have left, readable from the bench with the phone on the floor. It sits
// over the tab bar as well as the logger, which is why it is mounted in the
// shell rather than inside the Train screen.
//
// Like every timer in the app it derives from the stored end time on each
// render and never counts down by itself: a phone that slept through the rest
// still wakes up showing the right number.

import { useEffect, useRef } from 'react';
import { countsAsWork, fmtClock, isSet } from '@/lib/calc';
import { C, TOUCH, Z, num, onInk } from '@/lib/tokens';
import { isBodyweightLift, weightShort } from '@/lib/bodyweight';
import { useBompa } from '@/state/BompaContext';
import { InkButton, Ring, useEscapeKey } from '@/components/ui';
import { offersDrop } from '@/components/screens/SegmentControls';

/**
 * The ring: radius 54 inside a 120 viewBox, drawn at 272px so it fills the
 * width of a phone with a margin either side. The dash length has to be the
 * circumference for the arc to empty exactly as the rest runs out.
 */
const REST_RING = { size: 272, viewBox: 120, radius: 54, stroke: 5, circumference: 339.3 } as const;

/** The last stretch, where the screen changes so it reads from across the room. */
const URGENT_SEC = 10;

export function RestOverlay() {
  const b = useBompa();
  const { s, openSession } = b;
  // Only over the logger, and only while a rest is really running — an
  // overlay showing 0:00 would just be in the way of the next set.
  // Never for the pause between the pieces of one set: it is seconds long and
  // lives on the entry card, and a takeover would cost more of it than it shows.
  const open =
    s.restFull &&
    b.restActive &&
    b.restKind !== 'intra' &&
    s.tab === 'log' &&
    !s.library &&
    openSession !== null &&
    s.summary === null;

  useEscapeKey(open, b.minimiseRest);
  const panel = useRef<HTMLDivElement>(null);

  // Focus moves in so a keyboard user is not left tabbing through the logger
  // hidden underneath, and goes back to "Log set" when the rest ends.
  useEffect(() => {
    if (!open) return;
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panel.current?.focus();
    return () => before?.focus();
  }, [open]);

  if (!open || !openSession) return null;

  const remaining = Math.ceil(b.restRemainingMs / 1000);
  const urgent = remaining <= URGENT_SEC;
  const color = urgent ? C.redLight : C.amberLight;
  // In the last seconds the background lifts to ink80, where the usual grey
  // for small text is too faint to read. Small text goes a step brighter.
  const quiet = urgent ? onInk.body : onInk.muted;

  const exercise = b.activeExerciseId ? b.exerciseById.get(b.activeExerciseId) : undefined;
  // Sets, not pieces: after a double drop the next set is one on, not three.
  const nextSetNo =
    b.sessionSets.filter((row) => row.exerciseId === b.activeExerciseId && countsAsWork(row.type) && isSet(row)).length + 1;

  const canDrop = b.restKind === 'full' && offersDrop(b.sessionSets);

  return (
    <div
      ref={panel}
      role="dialog"
      aria-modal="true"
      aria-label="Resting"
      tabIndex={-1}
      className="sheet"
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: Z.rest,
        background: urgent ? onInk.line : C.ink,
        color: onInk.text,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: '18px 22px 26px',
        gap: 18,
        transition: 'background .2s ease',
        outline: 'none',
      }}
    >
      <div style={{ alignSelf: 'stretch', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
        <span
          style={{
            fontSize: 10.5,
            fontWeight: 800,
            letterSpacing: '.16em',
            textTransform: 'uppercase',
            color: quiet,
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            ...num,
          }}
        >
          {openSession.routineName} · {fmtClock(Math.floor(openSession.elapsedMs / 1000))}
        </span>
        <InkButton onClick={b.minimiseRest} shape="pill" height={40} fontSize={12.5}>
          Minimise
        </InkButton>
      </div>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 22 }}>
        {/* White rather than red at the end: red is only readable here at the
            size of the countdown itself. */}
        <span style={{ fontSize: 12, fontWeight: 800, letterSpacing: '.2em', color: urgent ? onInk.text : C.amberLight }}>
          {urgent ? 'GET UNDER THE BAR' : 'RESTING'}
        </span>

        <div role="timer" aria-label={`${fmtClock(remaining)} of ${fmtClock(Math.round(b.restTotalMs / 1000))} rest left`}>
          <Ring
            size={REST_RING.size}
            viewBox={REST_RING.viewBox}
            radius={REST_RING.radius}
            stroke={REST_RING.stroke}
            circumference={REST_RING.circumference}
            progress={b.restTotalMs > 0 ? b.restRemainingMs / b.restTotalMs : 0}
            color={color}
            // The track would vanish into the lighter background otherwise.
            track={urgent ? onInk.control : onInk.line}
          >
            <span aria-hidden style={{ fontSize: 84, fontWeight: 800, lineHeight: 1, letterSpacing: '-0.05em', color, ...num }}>
              {fmtClock(remaining)}
            </span>
            <span aria-hidden style={{ fontSize: 12, fontWeight: 700, color: quiet, paddingTop: 4, ...num }}>
              of {fmtClock(Math.round(b.restTotalMs / 1000))}
            </span>
          </Ring>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, textAlign: 'center' }}>
          <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.14em', color: quiet }}>NEXT</span>
          <span style={{ fontSize: 22, fontWeight: 800 }}>{exercise?.name ?? 'Next set'}</span>
          <span style={{ fontSize: 15, fontWeight: 700, color: C.amberLight, ...num }}>
            Set {nextSetNo} · {weightShort(s.entryWeight, s.unit, isBodyweightLift(exercise))} × {s.entryReps}
          </span>
        </div>
      </div>

      {canDrop && (
        <InkButton
          onClick={() => b.startSegments('drop')}
          label="Drop the weight and carry on this set"
          height={56}
          fontSize={15}
          color={C.amberLight}
          style={{ alignSelf: 'stretch' }}
        >
          + Drop
        </InkButton>
      )}

      <div style={{ alignSelf: 'stretch', display: 'flex', gap: 8 }}>
        <InkButton onClick={b.subRest} height={60} fontSize={15} style={{ flex: 1 }}>
          −30
        </InkButton>
        <InkButton onClick={b.addRest} height={60} fontSize={15} style={{ flex: 1 }}>
          +30
        </InkButton>
        <InkButton onClick={b.skipRest} variant="white" height={60} fontSize={15} style={{ flex: 1.4, minWidth: TOUCH }}>
          Skip rest
        </InkButton>
      </div>
    </div>
  );
}
