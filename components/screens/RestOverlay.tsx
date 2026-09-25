'use client';

// The rest countdown, full screen, and the question that belongs in it.
//
// Logging a set opens it, because the next thing a lifter needs is how long
// they have left, readable from the bench with the phone on the floor. It is
// also where RPE is asked: straight after the set, when the lifter knows how
// it felt and has nothing else to do. Asking on Train, before the set, was
// asking the wrong moment. It sits over the tab bar as well as the logger,
// which is why it is mounted in the shell rather than inside the Train screen.
//
// Three looks: resting; the last ten seconds, when the whole screen turns
// amber so it reads from across the room; and "That's the plan done" after the
// last planned set, which offers to finish.
//
// Like every timer in the app it derives from the stored end time on each
// render and never counts down by itself: a phone that slept through the rest
// still wakes up showing the right number.

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { countsAsWork, fmtClock, isSet, toDisplay } from '@/lib/calc';
import { weightShort } from '@/lib/bodyweight';
import { unratedSets } from '@/lib/train';
import { C, HERO_SIZE, R, T, TOUCH, Z, num, onInk } from '@/lib/tokens';
import type { LoggedSet } from '@/lib/types';
import { useBompa } from '@/state/BompaContext';
import { Btn, DarkSheet, InkButton, Ring, useEscapeKey, useLongPress } from '@/components/ui';
import { RateSetRow, RpeChipRow, targetFor } from '@/components/RpeChips';
import { offersDrop } from '@/components/screens/SegmentControls';

/**
 * The ring: radius 54 inside a 120 viewBox, drawn at 212px, which leaves room
 * under it for the question about the set. The dash length has to be the
 * circumference for the arc to empty exactly as the rest runs out.
 */
const REST_RING = { size: 212, viewBox: 120, radius: 54, stroke: 5, circumference: 339.3 } as const;

/** The last stretch, where the screen changes so it reads from across the room. */
const URGENT_SEC = 10;

/** The default rests on offer when the ring is held. */
const REST_PRESETS_SEC = [60, 90, 120, 150, 180, 240] as const;

/**
 * Whether the rest screen is showing, and which look. Exported so the shell
 * can paint the phone's status bar to match.
 */
export function useRestView() {
  const b = useBompa();
  const { s, openSession } = b;
  // Only over the logger. Never for the pause between the pieces of one set:
  // it is seconds long and lives on the entry card, and a takeover would cost
  // more of it than it shows.
  const onTrain = s.tab === 'log' && s.pushed === null && openSession !== null && s.summary === null;
  const complete = onTrain && s.sessionComplete;
  const resting = onTrain && s.restFull && b.restActive && b.restKind !== 'intra';
  const remaining = Math.ceil(b.restRemainingMs / 1000);
  return { open: complete || resting, complete, urgent: resting && !complete && remaining <= URGENT_SEC, remaining };
}

export function RestOverlay() {
  const b = useBompa();
  const { s, openSession } = b;
  const view = useRestView();
  const [choosingPreset, setChoosingPreset] = useState(false);

  // Escape belongs to whichever sheet is on top of this screen, not to it.
  const sheetOnTop = choosingPreset || s.editingSetId !== null || s.rpeHelp;
  useEscapeKey(view.open && !sheetOnTop, view.complete ? b.keepTraining : b.minimiseRest);
  const panel = useRef<HTMLDivElement>(null);

  // Focus moves in so a keyboard user is not left tabbing through the logger
  // hidden underneath, and goes back to "Log set" when the rest ends.
  useEffect(() => {
    if (!view.open) return;
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panel.current?.focus();
    return () => before?.focus();
  }, [view.open]);

  if (!view.open || !openSession) return null;

  const urgent = view.urgent;
  const ink = urgent ? C.ink : onInk.text;
  const quiet = urgent ? C.ink : onInk.muted;
  const clock = `${openSession.routineName} · ${fmtClock(Math.floor(openSession.elapsedMs / 1000))}`;
  const canDrop = !view.complete && b.restKind === 'full' && offersDrop(b.sessionSets);

  return (
    <div
      ref={panel}
      role="dialog"
      aria-modal="true"
      aria-label={view.complete ? 'Session complete' : 'Resting'}
      tabIndex={-1}
      className="sheet no-scrollbar"
      data-urgent={urgent ? 'true' : undefined}
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: Z.rest,
        background: urgent ? C.amber : C.ink,
        color: ink,
        display: 'flex',
        flexDirection: 'column',
        padding: '12px 20px 24px',
        gap: 16,
        overflowY: 'auto',
        transition: 'background .2s ease',
        outline: 'none',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, minHeight: TOUCH }}>
        <span
          style={{
            fontSize: T.sm,
            fontWeight: 700,
            color: quiet,
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            ...num,
          }}
        >
          {clock}
        </span>
        {!view.complete && (
          <Btn
            onClick={b.minimiseRest}
            style={{
              height: TOUCH,
              padding: '0 16px',
              borderRadius: R.pill,
              border: urgent ? `1.5px solid ${C.ink}` : `1px solid ${onInk.control}`,
              color: ink,
              fontSize: T.sm,
              fontWeight: 800,
              flex: 'none',
            }}
          >
            Minimise
          </Btn>
        )}
      </div>

      {urgent ? (
        <UrgentBody seconds={view.remaining} />
      ) : (
        <>
          {view.complete ? (
            <h2 style={{ margin: 0, fontSize: T.xxl, fontWeight: 800, letterSpacing: '-0.02em' }}>That&rsquo;s the plan done</h2>
          ) : (
            <RestRing seconds={view.remaining} onHold={() => setChoosingPreset(true)} />
          )}
          <JustLogged complete={view.complete} />
          {!view.complete && <NextRow />}
        </>
      )}

      {canDrop && !urgent && (
        <InkButton
          onClick={() => b.startSegments('drop')}
          label="Drop the weight and carry on this set"
          height={56}
          fontSize={T.title}
          color={C.amberLight}
          style={{ flex: 'none' }}
        >
          + Drop
        </InkButton>
      )}

      <div style={{ marginTop: 'auto', display: 'flex', gap: 8, flex: 'none' }}>
        {view.complete ? (
          <>
            <InkButton variant="amber" onClick={b.requestFinish} height={60} fontSize={T.title} style={{ flex: 1.4 }}>
              Finish session
            </InkButton>
            <InkButton onClick={b.keepTraining} height={60} fontSize={T.title} style={{ flex: 1 }}>
              Keep training
            </InkButton>
          </>
        ) : urgent ? (
          <>
            <Btn onClick={b.addRest} style={{ ...URGENT_BUTTON, flex: 1, border: `1.5px solid ${C.ink}` }}>
              +30
            </Btn>
            {/* The same as Skip: the lifter is on their way to the bar. */}
            <Btn onClick={b.skipRest} style={{ ...URGENT_BUTTON, flex: 2, background: C.ink, color: C.white }}>
              I&rsquo;m going
            </Btn>
          </>
        ) : (
          <>
            <InkButton onClick={b.subRest} height={60} fontSize={T.title} style={{ flex: 1 }}>
              −30
            </InkButton>
            <InkButton onClick={b.addRest} height={60} fontSize={T.title} style={{ flex: 1 }}>
              +30
            </InkButton>
            <InkButton onClick={b.skipRest} variant="white" height={60} fontSize={T.title} style={{ flex: 1.4, minWidth: TOUCH }}>
              Skip rest
            </InkButton>
          </>
        )}
      </div>

      <PresetSheet open={choosingPreset} onClose={() => setChoosingPreset(false)} />
    </div>
  );
}

const URGENT_BUTTON: CSSProperties = {
  height: 60,
  borderRadius: R.block,
  color: C.ink,
  fontSize: T.title,
  fontWeight: 800,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};

/**
 * The countdown. Holding it opens the default-rest picker: the one place a
 * lifter is looking at the rest length and thinking "that's too long".
 */
function RestRing({ seconds, onHold }: { seconds: number; onHold: () => void }) {
  const b = useBompa();
  const press = useLongPress(onHold);
  const total = fmtClock(Math.round(b.restTotalMs / 1000));
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, paddingTop: 4, flex: 'none' }}>
      <span style={{ fontSize: T.md, fontWeight: 800, color: onInk.body }}>Resting</span>
      <div
        role="timer"
        tabIndex={0}
        aria-label={`${fmtClock(seconds)} of ${total} rest left. Press and hold to change your default rest.`}
        {...press.handlers}
        style={{ borderRadius: '50%', userSelect: 'none', WebkitUserSelect: 'none', WebkitTouchCallout: 'none', touchAction: 'manipulation' }}
      >
        <Ring
          size={REST_RING.size}
          viewBox={REST_RING.viewBox}
          radius={REST_RING.radius}
          stroke={REST_RING.stroke}
          circumference={REST_RING.circumference}
          progress={b.restTotalMs > 0 ? b.restRemainingMs / b.restTotalMs : 0}
          color={C.amberLight}
          track={onInk.line}
        >
          <span aria-hidden style={{ fontSize: HERO_SIZE.restClock, fontWeight: 800, lineHeight: 1, letterSpacing: '-0.05em', color: onInk.text, ...num }}>
            {fmtClock(seconds)}
          </span>
          <span aria-hidden style={{ fontSize: T.sm, fontWeight: 700, color: onInk.muted, paddingTop: 4, ...num }}>
            of {total}
          </span>
        </Ring>
      </div>
    </div>
  );
}

/**
 * The last ten seconds: seconds only, as big as the screen allows, and what
 * is next. Nothing to read or rate here; the question waits.
 */
function UrgentBody({ seconds }: { seconds: number }) {
  const b = useBompa();
  const next = b.restNext;
  const name = next ? (b.exerciseById.get(next.exerciseId)?.name ?? next.exerciseId) : null;
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, textAlign: 'center' }}>
      <h2 style={{ margin: 0, fontSize: T.xxl, fontWeight: 800, letterSpacing: '-0.02em' }}>Get under the bar</h2>
      <div
        role="timer"
        aria-label={`${seconds} seconds of rest left`}
        style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'center', gap: 8, maxWidth: '100%' }}
      >
        <span aria-hidden style={{ fontSize: HERO_SIZE.restFinal, fontWeight: 800, lineHeight: 0.85, letterSpacing: '-0.06em', maxWidth: '100%', ...num }}>
          {seconds}
        </span>
        <span aria-hidden style={{ fontSize: T.xl, fontWeight: 800 }}>
          sec
        </span>
      </div>
      {next && name && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, paddingTop: 18 }}>
          <span style={{ fontSize: T.xl, fontWeight: 800 }}>
            {name} · set {next.setNo}
          </span>
          <span style={{ fontSize: T.lg, fontWeight: 800, color: C.ink80, ...num }}>
            {weightShort(next.weight, b.s.unit, b.isBodyweightLift(next.exerciseId))} × {next.reps}
          </span>
        </div>
      )}
    </div>
  );
}

/**
 * The set just finished and "How did that feel?". After a superset round, a
 * compact row for each set in it. On the plan-done screen, a compact row as
 * well for any other set from this session still unrated, since this is the
 * last natural moment to ask.
 */
function JustLogged({ complete }: { complete: boolean }) {
  const b = useBompa();
  const rows = b.justLoggedRows;
  const others = complete
    ? unratedSets(b.sessionSets).filter((row) => !rows.some((x) => x.exerciseId === row.exerciseId && x.setNo === row.setNo))
    : [];
  if (rows.length === 0 && others.length === 0) return null;

  const single = rows.length === 1 ? rows[0]! : null;
  return (
    <section
      aria-label="Just logged"
      style={{
        background: onInk.raised,
        border: `1px solid ${onInk.line}`,
        borderRadius: R.card,
        padding: '14px 14px 16px',
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        flex: 'none',
      }}
    >
      {single ? (
        <SingleSet row={single} />
      ) : (
        rows.length > 1 && (
          <>
            <span style={{ fontSize: T.sm, fontWeight: 700, color: onInk.muted }}>Just logged · the round</span>
            <span style={{ fontSize: T.lg, fontWeight: 800 }}>How did that feel?</span>
            {rows.map((row) => (
              <RateSetRow key={`${row.exerciseId}-${row.setNo}`} row={row} />
            ))}
          </>
        )
      )}
      {others.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, paddingTop: 12, borderTop: `1px solid ${onInk.line}` }}>
          <span style={{ fontSize: T.sm, fontWeight: 700, color: onInk.muted }}>Still unrated from this session</span>
          {others.map((row) => (
            <RateSetRow key={`${row.exerciseId}-${row.setNo}`} row={row} />
          ))}
        </div>
      )}
      <RpeHelpLine target={single ? targetFor(b, single) : null} />
    </section>
  );
}

/** One set: what it was, a way to edit it, and the full row of chips. */
function SingleSet({ row }: { row: LoggedSet }) {
  const b = useBompa();
  const { unit } = b.s;
  const exercise = b.exerciseById.get(row.exerciseId);
  const short = exercise?.short ?? exercise?.name ?? row.exerciseId;
  const weight = weightShort(toDisplay(row.weightKg, unit), unit, b.isBodyweightLift(row.exerciseId));

  // A set made of pieces is one set, named for what it was.
  const pieces = b.sessionSets
    .filter((x) => !isSet(x) && x.sessionId === row.sessionId && x.exerciseId === row.exerciseId && x.setNo === row.setNo)
    .sort((a, c) => a.at - c.at);
  const style = pieces[0]?.segmentStyle;
  const title = pieces.length
    ? `${short} ${setNoun(style)} · ${pieces.length + 1} × ${row.reps}`
    : row.type === 'warmup'
      ? `${short} warm-up`
      : `${short} set ${row.setNo}`;
  const value = pieces.length ? `${weight} × ${[row.reps, ...pieces.map((x) => x.reps)].join(' + ')}` : `${weight} × ${row.reps}`;
  const rateable = countsAsWork(row.type);

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
          <span style={{ fontSize: T.sm, fontWeight: 700, color: onInk.muted, ...num }}>Just logged · {title}</span>
          <span style={{ fontSize: T.lg, fontWeight: 800, ...num }}>{value}</span>
        </div>
        <Btn
          onClick={row.id === undefined ? undefined : () => b.patch({ editingSetId: row.id! })}
          disabled={row.id === undefined}
          style={{ height: TOUCH, padding: '0 6px', fontSize: T.sm, fontWeight: 800, color: C.amberLight, flex: 'none' }}
        >
          Edit set
        </Btn>
      </div>
      {rateable ? (
        <>
          <span style={{ fontSize: T.lg, fontWeight: 800 }}>How did that feel?</span>
          <RpeChipRow
            target={targetFor(b, row)}
            value={row.rpeEstimated ? null : row.rpe}
            onPick={(rpe) => row.id !== undefined && b.rateSet(row.id, rpe)}
            disabled={row.id === undefined}
            label={`RPE for ${short} set ${row.setNo}`}
          />
        </>
      ) : (
        <span style={{ fontSize: T.sm, lineHeight: 1.4, color: onInk.body }}>
          Warm-ups stay out of your fatigue numbers, so there is nothing to rate.
        </span>
      )}
    </>
  );
}

/** The noun for a set made of pieces other than a cluster. */
function setNoun(style: LoggedSet['segmentStyle']): string {
  if (style === 'rest-pause') return 'rest-pause set';
  if (style === 'mechanical-drop') return 'mechanical drop set';
  if (style === 'cluster') return 'cluster';
  return 'drop set';
}

/**
 * What the numbers mean, said against the aim, and a way to the fuller
 * explainer. Skipping is allowed, so the line says what happens then.
 */
function RpeHelpLine({ target }: { target: number | null }) {
  const b = useBompa();
  return (
    <span style={{ fontSize: T.sm, lineHeight: 1.4, color: onInk.muted }}>
      {target !== null && `Reps left in the tank: ${target} means ${repsLeft(target)}. `}
      Skip it and I&rsquo;ll log your aim as an estimate.{' '}
      <Btn
        onClick={() => b.patch({ rpeHelp: true })}
        style={{ display: 'inline-flex', alignItems: 'center', minHeight: TOUCH, verticalAlign: 'middle', fontSize: T.sm, fontWeight: 800, color: C.amberLight }}
      >
        What&rsquo;s RPE?
      </Btn>
    </span>
  );
}

/** "about 3 more", "2 or 3 more", or "nothing left" at 10. */
function repsLeft(rpe: number): string {
  const left = 10 - rpe;
  if (left <= 0) return 'nothing left';
  if (Number.isInteger(left)) return `about ${left} more`;
  return `${Math.floor(left)} or ${Math.ceil(left)} more`;
}

/**
 * What comes after this rest, read from the plan: the lift Train will show
 * and its next set as programmed, not whatever is left in the steppers.
 */
function NextRow() {
  const b = useBompa();
  const next = b.restNext;
  if (!next) return null;
  const name = b.exerciseById.get(next.exerciseId)?.name ?? next.exerciseId;
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '0 2px', flex: 'none' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
        <span style={{ fontSize: T.sm, fontWeight: 700, color: onInk.muted }}>Next</span>
        <span style={{ fontSize: T.lg, fontWeight: 800, ...num }}>
          {name} · set {next.setNo}
        </span>
      </div>
      <span style={{ fontSize: T.lg, fontWeight: 800, color: onInk.body, flex: 'none', ...num }}>
        {weightShort(next.weight, b.s.unit, b.isBodyweightLift(next.exerciseId))} × {next.reps}
      </span>
    </div>
  );
}

/** The default rest, picked from the lengths people actually use. */
function PresetSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const b = useBompa();
  return (
    <DarkSheet open={open} onClose={onClose} eyebrow="Rest timer" title="Default rest" titleSize={22} label="Default rest">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8 }}>
        {REST_PRESETS_SEC.map((sec) => {
          const on = b.s.restPresetSec === sec;
          return (
            <InkButton
              key={sec}
              variant={on ? 'amber' : 'outline'}
              pressed={on}
              height={56}
              fontSize={T.lg}
              label={`${fmtClock(sec)} rest`}
              onClick={() => {
                b.setRestPreset(sec);
                onClose();
                b.say(`Rests default to ${fmtClock(sec)} from the next set.`);
              }}
            >
              {fmtClock(sec)}
            </InkButton>
          );
        })}
      </div>
      <span style={{ fontSize: T.sm, lineHeight: 1.4, color: onInk.body }}>
        The rest running now keeps its length. A workout that sets its own rests keeps those.
      </span>
    </DarkSheet>
  );
}
