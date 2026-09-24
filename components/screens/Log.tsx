'use client';

// The Train screen. It is used mid-set, one-handed, often with chalk or sweat
// on the thumb, so everything here is big, dark and reachable from the bottom
// half of the phone. It is dark all the way down because a bright screen under
// gym lights is the hardest thing in the room to read at a glance.

import {
  Suspense,
  lazy,
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { countsAsWork, fmtClock, increments, toDisplay } from '@/lib/calc';
import {
  HOLD_SEC_MAX,
  HOLD_SEC_MIN,
  describeTempo,
  formatTempo,
  isSet,
  resolveSlotMethod,
  roundToStep,
  type ActiveSetTarget,
  type MethodGuideKey,
  type SlotMethod,
} from '@/lib/methods';
import { weightShort } from '@/lib/bodyweight';
import { REPS_MAX } from '@/lib/numberEntry';
import { C, HERO_SIZE, R, TOUCH, num, onInk } from '@/lib/tokens';
import type { LoggedSet, SetPrescription, SetType } from '@/lib/types';
import { useBompa } from '@/state/BompaContext';
import { Btn, EditableNumber, InkButton, InkChip, InkSegmented, StepperTile } from '@/components/ui';
import { ExercisePicker } from '@/components/screens/ExercisePicker';
import { RpePicker } from '@/components/RpePicker';
import { BodyweightChip, WeightFigure, useBodyweight } from '@/components/WeightFigure';
import { SegmentControls } from '@/components/screens/SegmentControls';

// On demand, with the common moves' cues: a workout with no warm-up never
// downloads it, and logging a set never waits on it.
// A chunk that fails to load (a stale page after an update, say) draws nothing
// rather than throwing, which with no error boundary would take Train down mid-set.
const WarmupCard = lazy(() =>
  import('@/components/screens/WarmupCard').then((m) => ({ default: m.WarmupCard })).catch(() => ({ default: () => null })),
);

/**
 * What the reps stepper is counting. A 1½ rep is one full cycle, and an
 * isometric "rep" is a hold; the word under the number is what stops a lifter
 * logging half-reps as whole ones.
 */
const REP_UNIT: Record<SlotMethod['repStyle'], string> = {
  full: 'reps',
  'one-and-half': '1½ reps',
  'twenty-ones': 'reps · 7 + 7 + 7',
  partial: 'partial reps',
  'eccentric-only': 'lowering reps',
  isometric: 'holds',
};

/** The rep style as a badge on the target line. Full reps need no badge. */
function repStyleBadge(method: SlotMethod): string | null {
  switch (method.repStyle) {
    case 'one-and-half':
      return '1½ reps';
    case 'twenty-ones':
      return '21s';
    case 'partial':
      return 'Partials';
    case 'eccentric-only':
      return 'Eccentric only';
    case 'isometric':
      return method.holdSec === null ? 'Holds' : `Hold ${method.holdSec} s`;
    default:
      return null;
  }
}

/** A set made of pieces, as a badge: how many and of what. */
function segmentBadge(method: SlotMethod, reps: number): string | null {
  const plan = method.segments;
  if (!plan) return null;
  const more = plan.segmentReps.length;
  switch (plan.style) {
    case 'drop':
      return `Drop ×${more}`;
    case 'mechanical-drop':
      return `Mechanical drop ×${more}`;
    case 'cluster':
      return `Cluster ${more + 1} × ${reps}`;
    case 'rest-pause':
      return plan.totalReps === undefined ? 'Rest-pause' : `Rest-pause · ${plan.totalReps} total`;
  }
}

/** One set's reps as a lifter says them: `8`, `6–8`, or `5+` for as many as possible. */
function repsText(entry: { reps: number; repsMax?: number | null; amrap?: boolean }): string {
  if (entry.amrap) return `${entry.reps}+`;
  if (entry.repsMax) return `${entry.reps}–${entry.repsMax}`;
  return String(entry.reps);
}

/**
 * How many entries make one wave of a scheme, so `7 5 3 7 5 3` can be drawn as
 * `7 5 3 · 7 5 3`. The whole scheme when nothing repeats.
 */
function wavePeriod(scheme: SetPrescription[]): number {
  const n = scheme.length;
  const same = (a: SetPrescription, b: SetPrescription) => a.reps === b.reps && Boolean(a.amrap) === Boolean(b.amrap);
  for (let p = 2; p < n; p++) {
    if (n % p !== 0) continue;
    if (scheme.every((entry, i) => same(entry, scheme[i % p]!))) return p;
  }
  return n;
}

const SET_TYPES: { value: SetType; label: string }[] = [
  { value: 'warmup', label: 'Warm-up' },
  { value: 'working', label: 'Working' },
  { value: 'backoff', label: 'Back-off' },
];

/**
 * Swiping between lifts. The numbers are feel, tuned by hand on a phone:
 * - LOCK: how far a finger travels before we decide it is a sideways swipe
 *   rather than the start of a scroll. Below this, the page scrolls as normal.
 * - COMMIT: how far a swipe has to go before letting go changes the lift.
 *   Anything shorter springs back, so a wobble never switches by accident.
 * - SNAP / SETTLE: on commit, the column slides a little further the way it
 *   was going, holds for a beat so the eye sees it leave, then the new lift
 *   slides in.
 * - FADE: the column dims as it is dragged, reaching half at this distance,
 *   so it reads as "on its way out" rather than as a layout glitch.
 */
const SWIPE = { LOCK: 8, COMMIT: 70, SNAP: 60, SETTLE_MS: 120, FADE: 300 } as const;

export function Log() {
  const b = useBompa();
  const { s, openSession, activeTarget, sessionSets } = b;
  const [picking, setPicking] = useState(false);

  // Only the session gates the logger. If the routine behind it has since been
  // deleted, the session still has its own snapshot of exercise ids and is
  // perfectly loggable — dropping to NoSession here would strand the user
  // mid-workout with a running timer and no way to finish.
  if (!openSession) return <NoSession />;

  const workingSets = sessionSets.filter((row) => countsAsWork(row.type));
  // Every piece of a drop set moved weight, so tonnage counts them all — but a
  // drop set is still one set, so the count does not.
  const setCount = workingSets.filter(isSet).length;
  const tonnage = workingSets.reduce((a, row) => a + row.weightKg * row.reps, 0);
  const shownTonnage = toDisplay(tonnage, s.unit);
  const amrap = Boolean(b.activeSetTarget?.amrap) && s.entryType !== 'warmup';
  // Warm-ups are ordinary reps on the way up, whatever the working sets ask for.
  const repStyle = s.entryType === 'warmup' ? 'full' : (b.activeMethod?.repStyle ?? 'full');

  return (
    <div
      className="rise"
      style={{
        // The screen paints its own ink, all the way down, so a short page never
        // shows a light strip between the last control and the tab bar.
        flex: '1 0 auto',
        minHeight: '100%',
        background: C.ink,
        color: onInk.text,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div style={{ padding: '12px 18px 0', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
            <Btn
              onClick={() => b.patch({ library: true })}
              style={{ display: 'flex', alignItems: 'baseline', gap: 7, minHeight: TOUCH, textAlign: 'left', color: onInk.text }}
            >
              <span style={{ fontSize: 15, fontWeight: 800 }}>{openSession.routineName}</span>
              <span style={{ fontSize: 12, fontWeight: 800, color: C.amberLight }}>Change</span>
            </Btn>
            <span style={{ fontSize: 12, fontWeight: 700, color: onInk.muted, ...num }}>
              {fmtClock(Math.floor(openSession.elapsedMs / 1000))} · {setCount} sets ·{' '}
              {shownTonnage >= 1000 ? `${(tonnage / 1000).toFixed(1)}t` : `${Math.round(shownTonnage)} ${s.unit}`}
            </span>
          </div>
          <InkButton onClick={b.finishSession} shape="pill" height={40} fontSize={13}>
            Finish
          </InkButton>
        </div>

        {/* Above the lifts and outside the swipe column, so a tick is never
            read as the start of a swipe to the next lift. */}
        {b.activeWarmup.length > 0 && (
          <Suspense fallback={null}>
            <WarmupCard items={b.activeWarmup} done={b.warmupDone} onToggle={b.toggleWarmupItem} />
          </Suspense>
        )}

        <LiftChips onAdd={() => setPicking(true)} />
      </div>

      {picking && <ExercisePicker onClose={() => setPicking(false)} />}

      {/* The countdown shrunk to a card, after "Minimise". The full-screen one
          lives in the shell so it can cover the tab bar too. */}
      {/* The pause between pieces has its own countdown in the set-in-progress card. */}
      {b.restActive && !s.restFull && b.restKind !== 'intra' && <RestCard />}
      <SegmentControls />

      <SwipeColumn>
        <LiftHeader />

        <WeightEntry />

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {/* Floored at 1 — zero reps is not a set. */}
          <StepperTile label="Decrease reps" onClick={() => b.patch({ entryReps: Math.max(1, s.entryReps - 1) })}>
            −
          </StepperTile>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'center', gap: 6 }}>
              <EditableNumber
                label="Reps"
                value={s.entryReps}
                min={1}
                max={REPS_MAX}
                precision={1}
                onCommit={(next) => b.patch({ entryReps: next })}
                style={{ fontSize: 48, fontWeight: 800, lineHeight: 1 }}
              />
              <span style={{ fontSize: 14, fontWeight: 800, color: onInk.muted }}>
                {REP_UNIT[repStyle]}
              </span>
            </div>
            {/* The stepper starts at the minimum; the lifter steps up to what
                they actually got. Saying so stops "5" reading as a cap. */}
            {amrap && b.activeSetTarget && (
              <span style={{ fontSize: 12, fontWeight: 700, color: C.amberLight, ...num }}>
                {b.activeSetTarget.reps}+ · as many as you can
              </span>
            )}
          </div>
          <StepperTile label="Increase reps" onClick={() => b.patch({ entryReps: s.entryReps + 1 })}>
            +
          </StepperTile>
        </div>

        {repStyle === 'isometric' && <HoldStepper />}

        <RpePicker
          dark
          value={s.entryRpe}
          target={activeTarget?.rpe ?? b.activeSlot?.targetRpe ?? 7}
          onPick={(next) => b.patch({ entryRpe: next })}
          after={
            <Btn
              onClick={() => b.patch({ rpeHelp: true })}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                minHeight: TOUCH,
                padding: '0 4px',
                verticalAlign: 'middle',
                fontSize: 12.5,
                fontWeight: 800,
                color: C.amberLight,
              }}
            >
              What&rsquo;s RPE?
            </Btn>
          }
        />

        {/* Set type goes last on purpose: it is the field changed least, and the
            one most often left alone between sets. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <InkSegmented
            label="Set type"
            value={s.entryType}
            options={SET_TYPES}
            onChange={(entryType) => b.patch({ entryType })}
          />
          <InkButton
            onClick={() => b.patch({ setTypeHelp: true })}
            label="What do the set types mean?"
            height={TOUCH}
            width={TOUCH}
            color={C.amberLight}
            fontSize={14}
            style={{ padding: 0 }}
          >
            ?
          </InkButton>
        </div>
      </SwipeColumn>

      <div
        style={{
          position: 'sticky',
          bottom: 0,
          zIndex: 6,
          padding: '14px 18px 16px',
          // Fades the controls out under the button as they scroll past, rather
          // than cutting them off at a hard edge.
          background: `linear-gradient(180deg, transparent, ${C.ink} 36%)`,
        }}
      >
        <Btn
          onClick={b.logSet}
          style={{
            width: '100%',
            height: 64,
            borderRadius: R.panel,
            background: C.amber,
            color: C.ink,
            fontSize: 18,
            fontWeight: 800,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 10,
          }}
        >
          {/* Mid-set the same button logs the next piece, and says so: "Log set"
              there would read as starting a new set. */}
          {b.segment
            ? b.segment.style === 'drop' || b.segment.style === 'mechanical-drop'
              ? 'Log drop'
              : 'Log piece'
            : amrap
              ? 'Log AMRAP set'
              : 'Log set'}
          <span style={{ fontWeight: 700, opacity: 0.6, ...num }}>
            {s.entryWeight === 0 ? 'BW' : s.entryWeight} × {s.entryReps}
          </span>
        </Btn>
      </div>
    </div>
  );
}

/**
 * The lifts in this session, as a sideways-scrolling row of chips. This is also
 * the keyboard and screen-reader way to change lift, since a swipe is neither.
 */
function LiftChips({ onAdd }: { onAdd: () => void }) {
  const b = useBompa();
  const { s, activeRoutine, sessionSets } = b;
  const row = useRef<HTMLDivElement>(null);

  // Keep the active lift in view whenever it changes — by a tap, a swipe, a
  // superset moving you on, or a lift being added at the far end of the row.
  useEffect(() => {
    const el = row.current;
    const chip = el?.querySelectorAll<HTMLElement>('[data-chip]')[s.exIdx];
    if (!el || !chip || typeof el.scrollTo !== 'function') return;
    const still = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollTo({
      left: Math.max(0, chip.offsetLeft - el.clientWidth / 2 + chip.offsetWidth / 2),
      behavior: still ? 'auto' : 'smooth',
    });
  }, [s.exIdx, b.chips.length]);

  // The row runs to both screen edges and fades at each end, so a chip cut off
  // at the edge reads as "there is more this way" rather than as clipping.
  const mask = 'linear-gradient(90deg, transparent 0, black 18px, black calc(100% - 44px), transparent)';

  return (
    <div
      ref={row}
      className="no-scrollbar"
      style={{
        // Positioned, so each chip's offsetLeft is measured from the row itself.
        position: 'relative',
        display: 'flex',
        gap: 6,
        overflowX: 'auto',
        margin: '0 -18px',
        padding: '0 44px 0 18px',
        scrollPadding: '0 18px',
        WebkitMaskImage: mask,
        maskImage: mask,
      }}
    >
      {b.chips.map((chip, index) => {
        // The routine may be gone; the session snapshot is not.
        const slot = activeRoutine?.slots.find((x) => x.exerciseId === chip.exerciseId);
        const done = sessionSets.filter(
          (row) => row.exerciseId === chip.exerciseId && countsAsWork(row.type) && isSet(row),
        ).length;
        const short = b.exerciseById.get(chip.exerciseId)?.short ?? chip.exerciseId;
        return (
          <span key={chip.exerciseId} data-chip style={{ display: 'flex', flex: 'none' }}>
            <InkChip
              on={index === s.exIdx}
              onClick={() => b.pickExercise(index)}
              height={40}
              // An unplanned lift has no target to count against.
              meta={slot ? `${done}/${resolveSlotMethod(slot).setCount}` : done}
            >
              {chip.letter ? `${short} · ${chip.letter}` : short}
            </InkChip>
          </span>
        );
      })}
      <InkChip on={false} dashed onClick={onAdd} label="Add a lift to this session" height={40} style={{ fontSize: 18, padding: 0 }}>
        +
      </InkChip>
    </div>
  );
}

/**
 * The centre of the screen, which follows a sideways swipe to the next or
 * previous lift. The chips above do the same job for keyboards and screen
 * readers, so nothing here is only reachable by swiping.
 *
 * The drag offset is local state: nothing else in the app needs to know a
 * finger is halfway across the screen.
 */
function SwipeColumn({ children }: { children: ReactNode }) {
  const b = useBompa();
  const [drag, setDrag] = useState({ dx: 0, dragging: false });
  const start = useRef<{ x: number; y: number } | null>(null);
  const locked = useRef(false);
  const latestDx = useRef(0);
  // A drag that ends over a button must not also press it.
  const swallowClick = useRef(false);
  const settle = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (settle.current) clearTimeout(settle.current);
  }, []);

  const count = b.exerciseIds.length;

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    start.current = { x: event.clientX, y: event.clientY };
    locked.current = false;
    swallowClick.current = false;
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!start.current) return;
    const dx = event.clientX - start.current.x;
    const dy = event.clientY - start.current.y;
    if (!locked.current) {
      // Mostly vertical: this is a scroll, and it stays one.
      if (Math.abs(dy) > SWIPE.LOCK && Math.abs(dy) >= Math.abs(dx)) {
        start.current = null;
        return;
      }
      if (Math.abs(dx) <= SWIPE.LOCK || Math.abs(dx) <= Math.abs(dy)) return;
      locked.current = true;
      // Keep receiving the drag even when the finger leaves the column.
      event.currentTarget.setPointerCapture?.(event.pointerId);
    }
    latestDx.current = dx;
    setDrag({ dx, dragging: true });
  };

  const release = (commit: boolean) => {
    const wasLocked = locked.current;
    start.current = null;
    locked.current = false;
    if (!wasLocked) return;
    swallowClick.current = true;

    const dx = latestDx.current;
    latestDx.current = 0;
    if (!commit || count < 2 || Math.abs(dx) <= SWIPE.COMMIT) {
      setDrag({ dx: 0, dragging: false });
      return;
    }
    // Wraps at both ends: past the last lift is the first one again.
    const next = dx < 0 ? (b.s.exIdx + 1) % count : (b.s.exIdx - 1 + count) % count;
    const pick = b.pickExercise;
    setDrag({ dx: dx < 0 ? -SWIPE.SNAP : SWIPE.SNAP, dragging: false });
    settle.current = setTimeout(() => {
      pick(next);
      setDrag({ dx: 0, dragging: false });
    }, SWIPE.SETTLE_MS);
  };

  const onClickCapture = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (!swallowClick.current) return;
    swallowClick.current = false;
    event.stopPropagation();
    event.preventDefault();
  };

  return (
    <div
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={() => release(true)}
      onPointerCancel={() => release(false)}
      onClickCapture={onClickCapture}
      style={{
        padding: '20px 18px 0',
        display: 'flex',
        flexDirection: 'column',
        gap: 18,
        flex: 1,
        // Vertical scrolling stays with the browser; sideways movement comes to us.
        touchAction: 'pan-y',
        userSelect: drag.dragging ? 'none' : undefined,
        transform: `translateX(${drag.dx}px)`,
        opacity: 1 - Math.min(0.5, Math.abs(drag.dx) / SWIPE.FADE),
        transition: drag.dragging ? 'none' : 'transform .2s ease, opacity .2s ease',
      }}
    >
      {children}
    </div>
  );
}

/** The lift's name, its target, a dot per set, and what to do next. */
function LiftHeader() {
  const b = useBompa();
  const { s, activeTarget, activeSetTarget, activeExerciseId, sessionSets } = b;
  const exercise = activeExerciseId ? b.exerciseById.get(activeExerciseId) : undefined;

  // One dot per set. The pieces of a drop or cluster set belong to its dot;
  // giving them their own would make one set look like three.
  const mine = sessionSets.filter((row) => row.exerciseId === activeExerciseId && isSet(row));
  const warmups = mine.filter((row) => row.type === 'warmup');
  const work = mine.filter((row) => countsAsWork(row.type));
  const planned = activeSetTarget?.setCount ?? activeTarget?.sets ?? 0;
  const empty = Math.max(0, planned - work.length);

  const count = b.exerciseIds.length;
  const nextId = count > 1 ? b.exerciseIds[(s.exIdx + 1) % count] : undefined;
  const nextShort = nextId ? (b.exerciseById.get(nextId)?.short ?? nextId) : null;

  const hint =
    mine.length > 0 ? 'Tap a filled dot to edit that set' : planned > 0 ? `${planned} sets planned` : 'Not in today’s plan';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center', textAlign: 'center' }}>
      <h2 style={{ margin: 0 }}>
        <Btn
          onClick={() => b.patch({ howToKey: activeExerciseId })}
          style={{ display: 'flex', alignItems: 'baseline', gap: 8, minHeight: TOUCH, color: onInk.text }}
        >
          <span style={{ fontSize: 22, fontWeight: 800 }}>{exercise?.name ?? 'Exercise'}</span>
          <span style={{ fontSize: 12, fontWeight: 800, color: onInk.muted }}>How to ›</span>
        </Btn>
      </h2>

      {activeTarget && activeSetTarget && b.activeMethod ? (
        <TargetLine target={activeSetTarget} method={b.activeMethod} />
      ) : (
        <span style={{ fontSize: 13.5, fontWeight: 800, color: C.amberLight, ...num }}>
          {activeTarget
            ? `${activeTarget.sets} × ${activeTarget.reps} @ ${weightShort(toDisplay(activeTarget.weightKg, s.unit), s.unit, b.isBodyweightLift(activeExerciseId))} · RPE ${activeTarget.rpe}`
            : 'Added today · no target'}
        </span>
      )}

      {/* A superset is a sequence, so say where in it you are and when the rest
          comes. Without this the screen looks like unrelated lifts. Saying
          "no rest" when the group has a gap would be a lie the lifter only
          catches when the timer starts anyway. */}
      {b.activeGroup && (
        <span style={{ fontSize: 12, fontWeight: 700, color: onInk.body, ...num }}>
          {b.supersetLabel} ·{' '}
          {b.activeGroup.restSec === 0
            ? 'no rest until the round is done'
            : `${b.activeGroup.restSec}s between lifts, full rest after the round`}
        </span>
      )}

      <div
        role="group"
        aria-label={`${work.length} of ${planned || work.length} sets logged`}
        style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center' }}
      >
        {/* Warm-ups get their own dots, ahead of the work, so a set logged as
            the wrong type can still be reached and corrected. */}
        {warmups.map((row, i) => (
          <SetDot key={row.id ?? `w-${row.at}-${i}`} row={row} fill={onInk.muted} />
        ))}
        {work.map((row, i) => (
          <SetDot key={row.id ?? `s-${row.at}-${i}`} row={row} fill={C.green} />
        ))}
        {Array.from({ length: empty }, (_, i) => (
          <span key={`e-${i}`} aria-hidden style={DOT_BOX}>
            <span style={{ ...DOT, border: `1.5px solid ${onInk.control}` }} />
          </span>
        ))}
      </div>

      <span style={{ fontSize: 11, fontWeight: 600, color: onInk.muted }}>
        {hint}
        {nextShort && ` · swipe for ${nextShort}`}
      </span>
    </div>
  );
}

/**
 * This set's target, not a summary of the lift: a wave or a pyramid asks for
 * something different every set, and "6 × 5" would be wrong for all of them.
 * Beneath it, how the reps are done — tempo, rep style, pieces — each a tap
 * away from its explainer, and the slot's note.
 */
function TargetLine({ target, method }: { target: ActiveSetTarget; method: SlotMethod }) {
  const b = useBompa();
  const { s } = b;
  const scheme = method.scheme;
  // A scheme's weights are fractions of the working weight, so they land
  // between plates. Show what the stepper loads, not what the maths says.
  const shown = scheme ? roundToStep(toDisplay(target.weightKg, s.unit), s.step) : toDisplay(target.weightKg, s.unit);
  // Near failure by definition, so there is no effort to aim for.
  const effort = target.amrap ? '' : ` · RPE ${target.rpe}`;
  const extra = target.setIndex >= target.setCount;
  const head = scheme
    ? `${extra ? 'Extra set' : `Set ${target.setIndex + 1} of ${target.setCount}`} · ${repsText(target)} @ ${shown} ${s.unit}${effort}`
    : `${target.setCount} × ${repsText(target)} @ ${shown} ${s.unit}${effort}`;

  const badges: { text: string; key: MethodGuideKey }[] = [];
  const style = repStyleBadge(method);
  if (style && method.repStyle !== 'full') badges.push({ text: style, key: method.repStyle });
  const pieces = segmentBadge(method, target.reps);
  if (pieces && method.segments) badges.push({ text: pieces, key: method.segments.style });
  if (target.amrap) badges.push({ text: 'AMRAP', key: 'amrap' });
  if (scheme && target.type === 'backoff' && !extra) badges.push({ text: 'Back-off', key: 'backoff' });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
      <span style={{ fontSize: 13.5, fontWeight: 800, color: C.amberLight, ...num }}>{head}</span>

      {scheme && <SchemeStrip scheme={scheme} current={target.setIndex} />}

      {(method.tempo || badges.length > 0) && (
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', alignItems: 'center', gap: 6 }}>
          {method.tempo && (
            <Btn
              onClick={() => b.openMethodGuide('tempo')}
              // Starts with the words on screen, so saying what you see still
              // finds it by voice; then the tempo spelled out.
              label={`tempo ${formatTempo(method.tempo, { spaced: true })}: ${describeTempo(method.tempo)}. Opens the tempo guide.`}
              style={{ minHeight: TOUCH, padding: '0 6px', fontSize: 13.5, fontWeight: 800, color: onInk.text, ...num }}
            >
              {/* Spaced so each phase reads on its own at arm's length. */}
              tempo {formatTempo(method.tempo, { spaced: true })}
              <span aria-hidden style={{ color: C.amberLight, marginLeft: 6 }}>
                ?
              </span>
            </Btn>
          )}
          {badges.map((badge) => (
            <Btn
              key={badge.text}
              onClick={() => b.openMethodGuide(badge.key)}
              label={`${badge.text}. Opens its guide.`}
              style={{
                minHeight: TOUCH,
                padding: '0 12px',
                borderRadius: R.chip,
                border: `1px solid ${onInk.control}`,
                fontSize: 12,
                fontWeight: 800,
                color: onInk.text,
                ...num,
              }}
            >
              {badge.text}
            </Btn>
          ))}
        </div>
      )}

      {method.note && (
        <span style={{ fontSize: 12.5, fontWeight: 600, color: onInk.body }}>{method.note}</span>
      )}
    </div>
  );
}

/**
 * The whole scheme in one line — `7 5 3 · 7 5 3` — with finished sets dimmed
 * and this one lit, so the lifter can see where they are in the wave without
 * counting.
 */
function SchemeStrip({ scheme, current }: { scheme: SetPrescription[]; current: number }) {
  const period = wavePeriod(scheme);
  return (
    <ol
      aria-label="Every set of this lift"
      style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 6 }}
    >
      {scheme.map((entry, i) => {
        const now = i === current;
        const done = i < current;
        return (
          <li
            key={i}
            aria-current={now ? 'step' : undefined}
            style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 800, ...num }}
          >
            {i > 0 && i % period === 0 && (
              <span aria-hidden style={{ color: onInk.muted }}>
                ·
              </span>
            )}
            <span
              style={{
                color: now ? C.amberLight : done ? onInk.control : onInk.body,
                textDecoration: now ? 'underline' : undefined,
                textUnderlineOffset: 4,
              }}
            >
              <span className="sr-only">
                Set {i + 1}
                {done ? ', done' : ''}:{' '}
              </span>
              {repsText(entry)}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * Seconds per hold, for an isometric lift. The reps stepper counts holds; this
 * says how long each one was, starting from what the routine asks for.
 */
function HoldStepper() {
  const b = useBompa();
  const seconds = b.s.entryHoldSec ?? b.activeMethod?.holdSec ?? HOLD_DEFAULT_SEC;
  const set = (next: number) => b.patch({ entryHoldSec: Math.min(HOLD_SEC_MAX, Math.max(HOLD_SEC_MIN, next)) });
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <StepperTile label="Shorter hold" onClick={() => set(seconds - HOLD_STEP_SEC)}>
        −
      </StepperTile>
      <div style={{ flex: 1, display: 'flex', alignItems: 'baseline', justifyContent: 'center', gap: 6 }}>
        <EditableNumber
          label="Hold"
          unit="seconds"
          value={seconds}
          min={HOLD_SEC_MIN}
          max={HOLD_SEC_MAX}
          precision={1}
          onCommit={set}
          style={{ fontSize: 32, fontWeight: 800, lineHeight: 1 }}
        />
        <span style={{ fontSize: 14, fontWeight: 800, color: onInk.muted }}>s each hold</span>
      </div>
      <StepperTile label="Longer hold" onClick={() => set(seconds + HOLD_STEP_SEC)}>
        +
      </StepperTile>
    </div>
  );
}

/** Five seconds a tap: finer than anyone times a hold by feel. */
const HOLD_STEP_SEC = 5;
/** Only reached when a routine asks for holds without saying how long. */
const HOLD_DEFAULT_SEC = 10;

/** A 12px dot is what the eye needs; a 44px box is what the thumb needs. */
const DOT_BOX = {
  width: TOUCH,
  height: TOUCH,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  flex: 'none',
} as const;

const DOT = { width: 12, height: 12, borderRadius: '50%', boxSizing: 'border-box' } as const;

/**
 * A logged set. Tapping it opens the editor for that set.
 *
 * Its name spells out what the set was, so a screen reader hears "80 kg × 8 at
 * RPE 8" rather than a row of identical buttons.
 */
function SetDot({ row, fill }: { row: LoggedSet; fill: string }) {
  const b = useBompa();
  const { unit } = b.s;
  const kind = row.type === 'warmup' ? ' (Warm-up)' : row.type === 'backoff' ? ' (Back-off)' : '';
  return (
    <Btn
      // The database id arrives a moment after the set lands on screen. Until
      // then there is nothing to edit by, so the dot waits.
      onClick={row.id === undefined ? undefined : () => b.patch({ editingSetId: row.id! })}
      disabled={row.id === undefined}
      style={{ ...DOT_BOX, opacity: 1 }}
    >
      <span className="sr-only">
        Edit set {row.setNo}
        {kind}: {weightShort(toDisplay(row.weightKg, unit), unit, b.isBodyweightLift(row.exerciseId))} × {row.reps} @{row.rpe}
      </span>
      <span aria-hidden style={{ ...DOT, background: fill, border: `1.5px solid ${fill}` }} />
    </Btn>
  );
}

/**
 * The weight: the big figure, typed or stepped, and a one-tap way to plain
 * bodyweight. Entry stays in the display unit throughout; logging the set is
 * where it becomes kilograms, once.
 */
function WeightEntry() {
  const b = useBompa();
  const { s, activeExerciseId } = b;
  const setWeight = (next: number) => b.patch({ entryWeight: next });
  const bodyweight = useBodyweight(activeExerciseId ?? undefined, s.entryWeight, setWeight);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
      {/* Holds the full figure's height even when "Bodyweight" is drawn
          smaller, so the steppers don't jump under a thumb that is about to
          press one. The outer box sits its row at the bottom (flex-end); the
          inner row lines the figure and unit up on their text baseline. */}
      <div style={{ minHeight: Math.round(HERO_SIZE.step * 0.9), display: 'flex', alignItems: 'flex-end' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
          <WeightFigure
            weight={s.entryWeight}
            unit={s.unit}
            bodyweight={bodyweight.on}
            onCommit={setWeight}
            figure={{ fontSize: HERO_SIZE.step, fontWeight: 800, lineHeight: 0.9, letterSpacing: '-0.05em' }}
            unitStyle={{ fontSize: 17, fontWeight: 800 }}
          />
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, width: '100%', paddingTop: 12 }}>
        <StepperTile width="flex" label="Decrease weight" onClick={() => setWeight(Math.max(0, Math.round((s.entryWeight - s.step) * 100) / 100))}>
          −
        </StepperTile>
        <StepCycle />
        <BodyweightChip on={bodyweight.on} onClick={bodyweight.toggle} />
        <StepperTile width="flex" label="Increase weight" onClick={() => setWeight(Math.round((s.entryWeight + s.step) * 100) / 100)}>
          +
        </StepperTile>
      </div>
    </div>
  );
}

/**
 * One button for the weight step. Three toggles would take a row of their own;
 * one that cycles fits between − and + where the thumb already is.
 */
function StepCycle() {
  const b = useBompa();
  const { s } = b;
  const options = increments(s.unit);
  const at = options.indexOf(s.step);
  const next = options[(at + 1) % options.length] ?? options[0]!;
  return (
    <InkButton
      onClick={() => b.setStep(next)}
      label={`Weight step ${s.step} ${s.unit}. Change to ${next}`}
      width={76}
      color={onInk.muted}
      fontSize={13}
      style={{ padding: 0 }}
    >
      ±{s.step}
    </InkButton>
  );
}

/**
 * The rest countdown after "Minimise": the same timer, shrunk so the logger is
 * usable again while it runs. Derived from the stored end time every render,
 * so a phone that slept through the rest still shows the right number.
 */
function RestCard() {
  const b = useBompa();
  const remaining = Math.ceil(b.restRemainingMs / 1000);
  const urgent = remaining <= 10;
  const color = urgent ? C.redLight : C.amberLight;
  const progress = b.restTotalMs > 0 ? Math.max(0, Math.min(1, b.restRemainingMs / b.restTotalMs)) : 0;

  return (
    <div
      role="timer"
      aria-label="Rest timer"
      className="sheet"
      style={{
        margin: '16px 18px 0',
        padding: 18,
        borderRadius: R.card,
        background: onInk.line,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 12,
      }}
    >
      <div style={{ alignSelf: 'stretch', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        {/* White in the last seconds rather than red: this card is the lighter
            ink, where red is too faint for text this small. */}
        <span style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '.16em', color: urgent ? onInk.text : C.amberLight }}>
          {urgent ? 'GET UNDER THE BAR' : 'RESTING'}
        </span>
        <InkButton onClick={b.showRestFull} shape="pill" height={TOUCH} fontSize={12.5} label="Show the rest timer full screen">
          Full screen
        </InkButton>
      </div>
      <span style={{ fontSize: 76, fontWeight: 800, lineHeight: 0.9, letterSpacing: '-0.04em', color, ...num }}>
        {fmtClock(remaining)}
      </span>
      <div aria-hidden style={{ width: '100%', height: 5, borderRadius: 3, background: onInk.control, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${(progress * 100).toFixed(1)}%`, background: color }} />
      </div>
      <div style={{ display: 'flex', gap: 6, width: '100%' }}>
        <InkButton onClick={b.subRest} height={TOUCH} style={{ flex: 1 }}>
          −30
        </InkButton>
        <InkButton onClick={b.addRest} height={TOUCH} style={{ flex: 1 }}>
          +30
        </InkButton>
        <InkButton onClick={b.skipRest} variant="white" height={TOUCH} style={{ flex: 1 }}>
          Skip
        </InkButton>
      </div>
    </div>
  );
}

function NoSession() {
  const b = useBompa();
  const routine = b.nextSlot ? b.routineById(b.nextSlot.routineId) : undefined;
  const { done, total } = b.progress;

  return (
    <div
      className="rise"
      style={{
        flex: '1 0 auto',
        minHeight: '100%',
        background: C.ink,
        color: onInk.text,
        padding: '14px 18px 20px',
        display: 'flex',
        flexDirection: 'column',
        gap: 14,
      }}
    >
      <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>Train</h1>
      <div
        style={{
          border: `1px dashed ${onInk.control}`,
          borderRadius: R.chip,
          padding: 18,
          textAlign: 'center',
          fontSize: 13,
          fontWeight: 700,
          lineHeight: 1.5,
          color: onInk.body,
        }}
      >
        No session running.
        <br />
        {routine
          ? `${routine.name} is next — ${done} of ${total} done this week.`
          : total > 0
            ? "That's the whole week's work logged."
            : b.routines.length === 0
              ? 'No workouts yet. Build one to get started.'
              : 'Nothing scheduled. Start any workout you like.'}
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        {routine && (
          <InkButton variant="amber" onClick={() => b.startSession(routine.id)} style={{ flex: 1 }}>
            Start {routine.name}
          </InkButton>
        )}
        <InkButton onClick={() => b.patch({ library: true })} style={routine ? undefined : { flex: 1 }}>
          {routine ? 'Pick another' : 'Pick a workout'}
        </InkButton>
      </div>
    </div>
  );
}
