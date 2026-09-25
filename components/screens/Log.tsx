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
import { countsAsWork, fmtClock, fmtVolume, sessionTonnage, toDisplay } from '@/lib/calc';
import {
  HOLD_SEC_MAX,
  HOLD_SEC_MIN,
  describeTempo,
  formatTempo,
  isSet,
  roundToStep,
  type ActiveSetTarget,
  type MethodGuideKey,
  type SlotMethod,
} from '@/lib/methods';
import { weightShort } from '@/lib/bodyweight';
import { REPS_MAX } from '@/lib/numberEntry';
import { workingSetCount } from '@/lib/supersets';
import { C, HERO_SIZE, R, T, TOUCH, num, onAmber, onInk } from '@/lib/tokens';
import { unratedSets, untrainedLifts } from '@/lib/train';
import type { LoggedSet, SetPrescription, SetType } from '@/lib/types';
import { TRAIN_HINTS_SESSIONS, useBompa } from '@/state/BompaContext';
import { Btn, DarkSheet, EditableNumber, InkButton, InkSegmented, StepperTile, useLongPress } from '@/components/ui';
import { sheetHairline } from '@/components/SheetParts';
import { RpeChipRow, targetFor } from '@/components/RpeChips';
import { ExercisePicker } from '@/components/screens/ExercisePicker';
import { BodyweightChip, WeightFigure, useBodyweight } from '@/components/WeightFigure';
import { SegmentControls, offersDrop } from '@/components/screens/SegmentControls';
import { Icon } from '@/components/icons';
import { Toast } from '@/components/Toast';

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
 * - RUBBER: how far the column gives when dragged past the first or last
 *   lift, where there is nothing to move to.
 */
const SWIPE = { LOCK: 8, COMMIT: 70, SNAP: 60, SETTLE_MS: 120, FADE: 300, RUBBER: 40 } as const;

export function Log() {
  const b = useBompa();
  const { s, openSession } = b;
  const [picking, setPicking] = useState(false);
  const asked = useInlineAsk();
  const catchUp = useCatchUp();

  // Only the session gates the logger. If the routine behind it has since been
  // deleted, the session still has its own snapshot of exercise ids and is
  // perfectly loggable — dropping to NoSession here would strand the user
  // mid-workout with a running timer and no way to finish.
  if (!openSession) return <NoSession />;

  // A rating line or a catch-up line takes a row the screen was not drawn
  // with. To keep everything above the Log button without a scroll, the
  // screen tightens its spacing and drops the first-sessions hint while one
  // shows. Nothing is hidden that the lifter needs to log the next set.
  const busy = asked.length > 0 || catchUp !== null;

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
      <div style={{ padding: '12px 18px 0', display: 'flex', flexDirection: 'column', gap: busy ? 8 : 12 }}>
        <SessionHeader />

        {/* Above the lifts and outside the swipe column, so a tick is never
            read as the start of a swipe to the next lift. */}
        {b.activeWarmup.length > 0 && (
          <Suspense fallback={null}>
            <WarmupCard items={b.activeWarmup} done={b.warmupDone} onToggle={b.toggleWarmupItem} />
          </Suspense>
        )}

        <LiftChips />
        {/* One line at most. While the minimised rest is asking about a set,
            the catch-up line's sets are folded into its "more" button. */}
        {asked.length === 0 && catchUp && <CatchUpLine catchUp={catchUp} />}
        {asked.length > 0 && <InlineRating asked={asked} catchUp={catchUp} />}
      </div>

      {picking && <ExercisePicker onClose={() => setPicking(false)} />}
      <SessionMenu onAddLift={() => setPicking(true)} />
      <FinishGuard />

      {/* The pause between pieces has its own countdown in the set-in-progress card. */}
      <SegmentControls />

      <SwipeColumn tight={busy}>
        <LiftHeader tight={busy} />

        <WeightEntry />

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {/* Floored at 1 — zero reps is not a set. */}
          <StepperTile label="Decrease reps" width={72} onClick={() => b.patch({ entryReps: Math.max(1, s.entryReps - 1) })}>
            <Icon name="minus" size={24} />
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
                style={{ fontSize: T.figure, fontWeight: 800, lineHeight: 1 }}
              />
              <span style={{ fontSize: T.md, fontWeight: 800, color: onInk.muted }}>
                {REP_UNIT[repStyle]}
              </span>
            </div>
            {/* The stepper starts at the minimum; the lifter steps up to what
                they actually got. Saying so stops "5" reading as a cap. */}
            {amrap && b.activeSetTarget && (
              <span style={{ fontSize: T.caption, fontWeight: 700, color: onInk.body, ...num }}>
                {b.activeSetTarget.reps}+ · as many as you can
              </span>
            )}
          </div>
          <StepperTile label="Increase reps" width={72} onClick={() => b.patch({ entryReps: s.entryReps + 1 })}>
            <Icon name="plus" size={24} />
          </StepperTile>
        </div>

        {repStyle === 'isometric' && <HoldStepper />}

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
            height={50}
            width={TOUCH}
            color={onInk.body}
            style={{ padding: 0 }}
          >
            <Icon name="help" size={20} />
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
        {/* The toast hangs off this wrapper, just above the button, so a
            message about the set never covers the button for the next one. */}
        <div style={{ position: 'relative' }}>
          <Toast placement="footer" />
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
            <span style={{ fontWeight: 700, opacity: 0.65, ...num }}>
              {s.entryWeight === 0 ? 'BW' : s.entryWeight} × {s.entryReps}
            </span>
          </Btn>
        </div>
      </div>
    </div>
  );
}

/**
 * The routine name, the running totals, and the way to everything that is not
 * logging a set: the name and the ⋯ button both open the session menu. While
 * a rest runs minimised, a pill here shows it and brings it back full screen.
 */
function SessionHeader() {
  const b = useBompa();
  const { s, openSession, sessionSets } = b;
  if (!openSession) return null;

  // Every piece of a drop set moved weight, so tonnage counts them all — but a
  // drop set is still one set, so the count does not.
  const done = sessionSets.filter((row) => countsAsWork(row.type) && isSet(row)).length;
  const planned = b.sessionPlan.reduce((total, lift) => total + lift.planned, 0);
  const tonnageText = fmtVolume(sessionTonnage(sessionSets), s.unit);
  const openMenu = () => b.patch({ sessionMenuOpen: true });

  // The pause between pieces has its own countdown on the set card, so it
  // never shows here.
  const restPill = b.restActive && !s.restFull && b.restKind !== 'intra';
  const restLeft = fmtClock(Math.ceil(b.restRemainingMs / 1000));
  // An unplanned drop, offered while the full rest after a working set runs
  // minimised. The full-screen rest carries the same button. It sits by the
  // rest pill rather than on a row of its own, which Train has no height for.
  const dropOffer = restPill && b.restKind === 'full' && !b.segment && offersDrop(sessionSets);

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
      <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <Btn
          onClick={openMenu}
          label={`${openSession.routineName}. Opens the session menu.`}
          style={{ display: 'flex', alignItems: 'center', gap: 6, minHeight: TOUCH, minWidth: 0, textAlign: 'left', color: onInk.text }}
        >
          <span style={{ fontSize: T.lg, fontWeight: 800, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {openSession.routineName}
          </span>
          <span style={{ display: 'flex', color: onInk.muted }}>
            <Icon name="chevron-down" size={14} strokeWidth={2.5} />
          </span>
        </Btn>
        <span style={{ fontSize: T.sm, fontWeight: 700, color: onInk.muted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', ...num }}>
          {fmtClock(Math.floor(openSession.elapsedMs / 1000))} · {planned > 0 ? `${done} of ${planned} sets` : `${done} sets`} · {tonnageText}
        </span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 'none' }}>
        {restPill && (
          <Btn
            onClick={b.showRestFull}
            label={`Rest, ${restLeft} left. Show the rest timer full screen.`}
            style={{
              height: TOUCH,
              padding: '0 12px',
              borderRadius: R.pill,
              background: onInk.line,
              color: onInk.text,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              fontSize: T.md,
              fontWeight: 800,
              ...num,
            }}
          >
            <span aria-hidden style={{ width: 8, height: 8, borderRadius: '50%', background: C.amberLight }} />
            Rest {restLeft}
          </Btn>
        )}
        {dropOffer && (
          <InkButton
            onClick={() => b.startSegments('drop')}
            label="Drop the weight and carry on this set"
            shape="pill"
            height={TOUCH}
            fontSize={T.md}
            color={C.amberLight}
            style={{ padding: '0 12px' }}
          >
            + Drop
          </InkButton>
        )}
        <InkButton shape="circle" height={TOUCH} label="Session menu" onClick={openMenu}>
          <Icon name="more" size={20} />
        </InkButton>
      </div>
    </div>
  );
}

/**
 * The lifts in this session, as a sideways-scrolling row of chips. This is also
 * the keyboard and screen-reader way to change lift, since a swipe is neither.
 * Each chip carries its progress as a bar inside it, and a tick once its
 * planned sets are all done.
 */
function LiftChips() {
  const b = useBompa();
  const { s, sessionSets } = b;
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
        const planned = b.sessionPlan.find((lift) => lift.exerciseId === chip.exerciseId)?.planned ?? 0;
        const done = workingSetCount(sessionSets, chip.exerciseId);
        const finished = planned > 0 && done >= planned;
        const on = index === s.exIdx;
        const short = b.exerciseById.get(chip.exerciseId)?.short ?? chip.exerciseId;
        const name = chip.letter ? `${short} · ${chip.letter}` : short;
        return (
          // The wrapper is what the scroll-into-view measures.
          <span key={chip.exerciseId} data-chip style={{ display: 'flex', flex: 'none' }}>
          <Btn
            onClick={() => b.pickExercise(index)}
            pressed={on}
            // An unplanned lift has no target to count against.
            label={planned > 0 ? `${name}, ${done} of ${planned} sets` : `${name}, ${done} sets`}
            style={{
              position: 'relative',
              overflow: 'hidden',
              flex: 'none',
              height: TOUCH,
              padding: '0 14px',
              borderRadius: R.chip,
              background: on ? C.amber : 'transparent',
              border: `1px solid ${on ? C.amber : onInk.control}`,
              color: on ? C.ink : onInk.body,
              fontSize: T.sm,
              fontWeight: 800,
              whiteSpace: 'nowrap',
              display: 'flex',
              alignItems: 'center',
              gap: 5,
            }}
          >
            {finished && !on && (
              <span style={{ display: 'flex', color: C.greenLight }}>
                <Icon name="check" size={13} />
              </span>
            )}
            {name}
            {planned > 0 && (
              <span
                aria-hidden
                style={{
                  position: 'absolute',
                  left: 12,
                  right: 12,
                  bottom: 6,
                  height: 3,
                  borderRadius: R.bar,
                  background: on ? onAmber.track : onInk.line,
                  overflow: 'hidden',
                }}
              >
                <span
                  style={{
                    display: 'block',
                    height: '100%',
                    width: `${Math.min(1, done / planned) * 100}%`,
                    borderRadius: R.bar,
                    background: on ? C.ink : C.green,
                  }}
                />
              </span>
            )}
          </Btn>
          </span>
        );
      })}
    </div>
  );
}

type CatchUp = { liftId: string; unrated: LoggedSet[] };

/**
 * The lift left with sets unrated, and those sets. Null once they are all
 * rated, or when there is no such lift.
 */
function useCatchUp(): CatchUp | null {
  const b = useBompa();
  const liftId = b.s.catchUpLift;
  if (!liftId) return null;
  const unrated = unratedSets(b.sessionSets, liftId);
  return unrated.length > 0 ? { liftId, unrated } : null;
}

/**
 * With the rest minimised, the question the rest screen would have asked:
 * the sets just logged that are still unrated, newest first. Empty once it
 * is answered or the next set is logged, and only for a lifter who has chosen
 * the minimised rest: after a skipped rest, the catch-up line and the summary
 * are the way back to an unrated set.
 */
function useInlineAsk(): LoggedSet[] {
  const b = useBompa();
  const { s } = b;
  if (!s.restPrefersMinimised || s.restFull || s.sessionComplete) return [];
  return b.justLoggedRows.filter((row) => countsAsWork(row.type) && row.rpeEstimated).sort((x, y) => y.at - x.at);
}

/**
 * "Bench · 2 sets unrated", after leaving a lift without rating its sets. It
 * goes when the next set is logged or when they are all rated.
 */
function CatchUpLine({ catchUp }: { catchUp: CatchUp }) {
  const b = useBompa();
  const { liftId, unrated } = catchUp;
  const name = b.exerciseById.get(liftId)?.short ?? liftId;
  const ids = unrated.map((row) => row.id).filter((id): id is number => id !== undefined);

  return (
    <div
      role="status"
      style={{
        height: TOUCH,
        borderRadius: R.chip,
        background: onInk.line,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 6px 0 14px',
        gap: 10,
      }}
    >
      <span style={{ fontSize: T.md, fontWeight: 700, color: onInk.text, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', ...num }}>
        <span style={{ fontWeight: 800 }}>{name}</span> · {unrated.length} {unrated.length === 1 ? 'set' : 'sets'} unrated
      </span>
      {/* 44px to press, 36px drawn, so it sits inside the 44px bar. */}
      <Btn
        onClick={() => b.patch({ rateSheet: { exerciseId: liftId, setIds: ids } })}
        label={`Rate ${name}`}
        disabled={ids.length === 0}
        style={{ height: TOUCH, minWidth: TOUCH, display: 'flex', alignItems: 'center', flex: 'none' }}
      >
        <span
          style={{
            height: 36,
            padding: '0 14px',
            borderRadius: R.small,
            border: `1px solid ${onInk.muted}`,
            display: 'flex',
            alignItems: 'center',
            fontSize: T.sm,
            fontWeight: 800,
            color: onInk.text,
          }}
        >
          Rate
        </span>
      </Btn>
    </div>
  );
}

/** Seven 44px chips and the gaps between them: what the one-line rating gives its chips. */
const INLINE_CHIP_GAP = 3;
const INLINE_CHIPS_WIDTH = 7 * TOUCH + 6 * INLINE_CHIP_GAP;

/**
 * The minimised rest's question, on one line: the newest unrated set's short
 * name, then its seven chips. A round asks about several sets; only the
 * newest gets chips here, and the rest, with any the catch-up line was
 * holding, sit behind "+N more", which opens them all in the rating sheet.
 * One line, because Train has no height for a row per set.
 */
function InlineRating({ asked, catchUp }: { asked: LoggedSet[]; catchUp: CatchUp | null }) {
  const b = useBompa();
  const row = asked[0]!;
  const others = [...asked.slice(1), ...(catchUp?.unrated ?? []).filter((x) => !asked.some((y) => y.id === x.id))];
  const ids = [row, ...others].map((x) => x.id).filter((id): id is number => id !== undefined);
  const name = b.exerciseById.get(row.exerciseId)?.short ?? row.exerciseId;
  const labelText = { fontSize: T.sm, fontWeight: 800, color: onInk.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%' } as const;

  return (
    <section
      aria-label="How did that feel?"
      // Runs nearer the screen edges than the rows above it, so the name
      // beside seven full-size chips has room to be read.
      style={{ display: 'flex', alignItems: 'center', gap: 6, height: TOUCH, margin: '0 -8px' }}
    >
      {others.length === 0 && <span style={{ ...labelText, flex: 1, minWidth: 0 }}>{name}</span>}
      {others.length > 0 && (
        <Btn
          onClick={() => b.patch({ rateSheet: { exerciseId: row.exerciseId, setIds: ids, title: 'These sets' } })}
          label={`${name}, +${others.length} more to rate. Opens them all.`}
          style={{ flex: 1, minWidth: 0, height: TOUCH, display: 'flex', flexDirection: 'column', alignItems: 'flex-start', justifyContent: 'center', gap: 1 }}
        >
          <span style={labelText}>{name}</span>
          <span style={{ ...labelText, fontSize: T.xs, color: C.amberLight, ...num }}>+{others.length} more</span>
        </Btn>
      )}
      <div style={{ flex: 'none', width: INLINE_CHIPS_WIDTH }}>
        <RpeChipRow
          compact
          gap={INLINE_CHIP_GAP}
          target={targetFor(b, row)}
          value={null}
          onPick={(rpe) => row.id !== undefined && b.rateSet(row.id, rpe)}
          disabled={row.id === undefined}
          label={`RPE for ${name} set ${row.setNo}`}
        />
      </div>
    </section>
  );
}

/**
 * Everything about the session that is not logging a set: add a lift,
 * reorder, finish. In one menu so the header keeps one button, and Finish
 * sits a deliberate two taps away from a thumb reaching for Log.
 */
function SessionMenu({ onAddLift }: { onAddLift: () => void }) {
  const b = useBompa();
  const [reordering, setReordering] = useState(false);
  const open = b.s.sessionMenuOpen;
  const close = () => {
    setReordering(false);
    b.patch({ sessionMenuOpen: false });
  };
  if (!b.openSession) return null;

  const item = (label: string, icon: 'plus' | 'arrow-down', onClick: () => void) => (
    <Btn
      onClick={onClick}
      style={{ minHeight: 52, display: 'flex', alignItems: 'center', gap: 12, fontSize: T.lg, fontWeight: 800, color: onInk.text, textAlign: 'left' }}
    >
      <span style={{ display: 'flex', color: onInk.muted }}>
        <Icon name={icon} size={20} />
      </span>
      {label}
    </Btn>
  );

  return (
    <DarkSheet open={open} onClose={close} eyebrow="This session" title={b.openSession.routineName} titleSize={22} label="Session menu" gap={4}>
      {reordering ? (
        <ReorderLifts onDone={() => setReordering(false)} />
      ) : (
        <>
          {item('Add a lift', 'plus', () => {
            close();
            onAddLift();
          })}
          {item('Reorder lifts', 'arrow-down', () => setReordering(true))}
          <div style={{ ...sheetHairline, marginTop: 8, paddingTop: 12 }}>
            <InkButton onClick={b.requestFinish} width="100%" height={56} fontSize={T.lg}>
              Finish session
            </InkButton>
          </div>
        </>
      )}
    </DarkSheet>
  );
}

/** Up and down for each lift. A superset moves as one block. */
function ReorderLifts({ onDone }: { onDone: () => void }) {
  const b = useBompa();
  const ids = b.openSession?.exerciseIds ?? [];
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <ol style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {ids.map((id, index) => {
          const name = b.exerciseById.get(id)?.name ?? id;
          return (
            <li key={id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 0', ...sheetHairline }}>
              <span style={{ flex: 1, minWidth: 0, fontSize: T.title, fontWeight: 800 }}>{name}</span>
              <InkButton shape="circle" height={TOUCH} label={`Move ${name} up`} disabled={index === 0} onClick={() => b.moveSessionLift(index, -1)}>
                <Icon name="arrow-up" size={18} />
              </InkButton>
              <InkButton
                shape="circle"
                height={TOUCH}
                label={`Move ${name} down`}
                disabled={index === ids.length - 1}
                onClick={() => b.moveSessionLift(index, 1)}
              >
                <Icon name="arrow-down" size={18} />
              </InkButton>
            </li>
          );
        })}
      </ol>
      <InkButton variant="amber" onClick={onDone} height={56} fontSize={T.lg} style={{ marginTop: 12 }}>
        Done
      </InkButton>
    </div>
  );
}

/**
 * Asked before finishing with planned lifts not started, because finishing
 * counts the workout as done for the week. "Keep going" is first and takes
 * focus: it is the answer that loses nothing.
 */
function FinishGuard() {
  const b = useBompa();
  const open = b.s.finishGuardOpen;
  const close = () => b.patch({ finishGuardOpen: false });
  if (!b.openSession) return null;
  const left = untrainedLifts(b.sessionPlan, b.sessionSets);
  const routine = b.openSession.routineName;
  return (
    <DarkSheet
      open={open}
      onClose={close}
      eyebrow={`Finish ${routine}`}
      title={`${left.length} ${left.length === 1 ? 'lift' : 'lifts'} not trained yet`}
      gap={16}
    >
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, borderBottom: `1px solid ${onInk.line}` }}>
        {left.map((lift) => (
          <li
            key={lift.exerciseId}
            style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '12px 0', fontSize: T.title, fontWeight: 800, ...sheetHairline }}
          >
            <span>{b.exerciseById.get(lift.exerciseId)?.name ?? lift.exerciseId}</span>
            <span style={{ color: onInk.muted, ...num }}>0 / {lift.planned}</span>
          </li>
        ))}
      </ul>
      <p style={{ margin: 0, fontSize: T.md, lineHeight: 1.45, color: onInk.body }}>
        If you finish now, I&rsquo;ll count {routine} as done this week and plan around what you actually lifted. You can undo this for 30
        seconds.
      </p>
      <KeepGoing onClick={close} />
      <InkButton
        onClick={() => {
          close();
          b.finishSession();
        }}
        height={56}
        fontSize={T.title}
        style={{ marginTop: -8 }}
      >
        Finish anyway
      </InkButton>
    </DarkSheet>
  );
}

/**
 * The guard's safe answer, focused on open. The sheet focuses its panel as it
 * opens, after this button has mounted, so the focus is taken back a frame later.
 */
function KeepGoing({ onClick }: { onClick: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const frame = requestAnimationFrame(() => ref.current?.querySelector('button')?.focus());
    return () => cancelAnimationFrame(frame);
  }, []);
  return (
    <div ref={ref} style={{ display: 'flex' }}>
      <InkButton variant="amber" onClick={onClick} height={58} fontSize={T.lg} style={{ flex: 1 }}>
        Keep going
      </InkButton>
    </div>
  );
}

/**
 * The centre of the screen, which follows a sideways swipe to the next or
 * previous lift. The chips above do the same job for keyboards and screen
 * readers, so nothing here is only reachable by swiping.
 *
 * It stops at both ends rather than wrapping: dragged past the first or last
 * lift it stretches a little and springs back, so the end of the list reads
 * as the end.
 *
 * The drag offset is local state: nothing else in the app needs to know a
 * finger is halfway across the screen.
 */
function SwipeColumn({ children, tight }: { children: ReactNode; tight: boolean }) {
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
  const index = b.s.exIdx;
  // Whether a drag this way has a lift to go to.
  const canGo = (dx: number) => (dx < 0 ? index < count - 1 : index > 0);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    start.current = { x: event.clientX, y: event.clientY };
    locked.current = false;
    swallowClick.current = false;
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!start.current) return;
    const raw = event.clientX - start.current.x;
    const dy = event.clientY - start.current.y;
    if (!locked.current) {
      // Mostly vertical: this is a scroll, and it stays one.
      if (Math.abs(dy) > SWIPE.LOCK && Math.abs(dy) >= Math.abs(raw)) {
        start.current = null;
        return;
      }
      if (Math.abs(raw) <= SWIPE.LOCK || Math.abs(raw) <= Math.abs(dy)) return;
      locked.current = true;
      // Keep receiving the drag even when the finger leaves the column.
      event.currentTarget.setPointerCapture?.(event.pointerId);
    }
    // Past an end there is nothing to reveal, so the column only gives a little.
    const dx = canGo(raw) ? raw : Math.sign(raw) * Math.min(SWIPE.RUBBER, Math.abs(raw));
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
    if (!commit || !canGo(dx) || Math.abs(dx) <= SWIPE.COMMIT) {
      setDrag({ dx: 0, dragging: false });
      return;
    }
    const next = dx < 0 ? index + 1 : index - 1;
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
        padding: `${tight ? 12 : 20}px 18px 0`,
        display: 'flex',
        flexDirection: 'column',
        gap: tight ? 10 : 18,
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
function LiftHeader({ tight }: { tight: boolean }) {
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
  const nextId = s.exIdx < count - 1 ? b.exerciseIds[s.exIdx + 1] : undefined;
  const nextShort = nextId ? (b.exerciseById.get(nextId)?.short ?? nextId) : null;

  // A reminder for the first few sessions, then out of the way: after that the
  // dots and the swipe are known, and the line is only height.
  const showHint = !tight && s.trainHintsSeen < TRAIN_HINTS_SESSIONS;
  const hint =
    mine.length > 0 ? 'Tap a filled dot to edit that set' : planned > 0 ? `${planned} sets planned` : 'Not in today’s plan';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: tight ? 4 : 6, alignItems: 'center', textAlign: 'center' }}>
      <h2 style={{ margin: 0 }}>
        <Btn
          onClick={() => b.patch({ howToKey: activeExerciseId })}
          style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: TOUCH, color: onInk.text }}
        >
          <span style={{ fontSize: T.xl, fontWeight: 800 }}>{exercise?.name ?? 'Exercise'}</span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2, fontSize: T.sm, fontWeight: 800, color: onInk.muted }}>
            How to
            <Icon name="chevron-right" size={13} strokeWidth={2.5} />
          </span>
        </Btn>
      </h2>

      {activeTarget && activeSetTarget && b.activeMethod ? (
        <TargetLine target={activeSetTarget} method={b.activeMethod} />
      ) : (
        <span style={{ fontSize: T.md, fontWeight: 800, color: onInk.body, whiteSpace: 'nowrap', ...num }}>
          {activeTarget
            ? `${activeTarget.sets} × ${activeTarget.reps} @ ${weightShort(toDisplay(activeTarget.weightKg, s.unit), s.unit, b.isBodyweightLift(activeExerciseId))} · aim RPE ${activeTarget.rpe}`
            : 'Added today · no target'}
        </span>
      )}

      {/* A superset is a sequence, so say where in it you are and when the rest
          comes. Without this the screen looks like unrelated lifts. Saying
          "no rest" when the group has a gap would be a lie the lifter only
          catches when the timer starts anyway. */}
      {b.activeGroup && (
        <span style={{ fontSize: T.caption, fontWeight: 700, color: onInk.body, ...num }}>
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
          <SetDot key={row.id ?? `w-${row.at}-${i}`} row={row} />
        ))}
        {work.map((row, i) => (
          <SetDot key={row.id ?? `s-${row.at}-${i}`} row={row} />
        ))}
        {Array.from({ length: empty }, (_, i) => (
          <span key={`e-${i}`} aria-hidden style={DOT_BOX}>
            <span style={{ ...DOT, border: `1.5px solid ${onInk.control}` }} />
          </span>
        ))}
      </div>

      {showHint && (
        <span style={{ fontSize: T.xs, fontWeight: 600, color: onInk.muted }}>
          {hint}
          {nextShort && ` · swipe for ${nextShort}`}
        </span>
      )}
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
  const effort = target.amrap ? '' : ` · aim RPE ${target.rpe}`;
  const extra = target.setIndex >= target.setCount;
  // This set, not the lift: "Set 3 of 4" says where you are, which a bare
  // "4 × 8" never did.
  const weight = weightShort(shown, s.unit, b.isBodyweightLift(b.activeExerciseId));
  const head = `${extra ? 'Extra set' : `Set ${target.setIndex + 1} of ${target.setCount}`} · ${repsText(target)} reps @ ${weight}${effort}`;

  const badges: { text: string; key: MethodGuideKey }[] = [];
  const style = repStyleBadge(method);
  if (style && method.repStyle !== 'full') badges.push({ text: style, key: method.repStyle });
  const pieces = segmentBadge(method, target.reps);
  if (pieces && method.segments) badges.push({ text: pieces, key: method.segments.style });
  if (target.amrap) badges.push({ text: 'AMRAP', key: 'amrap' });
  if (scheme && target.type === 'backoff' && !extra) badges.push({ text: 'Back-off', key: 'backoff' });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
      <span style={{ fontSize: T.md, fontWeight: 800, color: onInk.body, whiteSpace: 'nowrap', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', ...num }}>
        {head}
      </span>

      {scheme && <SchemeStrip scheme={scheme} current={target.setIndex} />}

      {(method.tempo || badges.length > 0) && (
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', alignItems: 'center', gap: 6 }}>
          {method.tempo && (
            <Btn
              onClick={() => b.openMethodGuide('tempo')}
              // Starts with the words on screen, so saying what you see still
              // finds it by voice; then the tempo spelled out.
              label={`tempo ${formatTempo(method.tempo, { spaced: true })}: ${describeTempo(method.tempo)}. Opens the tempo guide.`}
              style={{ minHeight: TOUCH, padding: '0 6px', fontSize: T.copy, fontWeight: 800, color: onInk.text, ...num }}
            >
              {/* Spaced so each phase reads on its own at arm's length. */}
              tempo {formatTempo(method.tempo, { spaced: true })}
              <span style={{ display: 'inline-flex', color: onInk.muted, marginLeft: 6 }}>
                <Icon name="help" size={16} />
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
                fontSize: T.caption,
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
        <span style={{ fontSize: T.sm, fontWeight: 600, color: onInk.body }}>{method.note}</span>
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
            style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: T.note, fontWeight: 800, ...num }}
          >
            {i > 0 && i % period === 0 && (
              <span aria-hidden style={{ color: onInk.muted }}>
                ·
              </span>
            )}
            <span
              style={{
                color: now ? onInk.text : done ? onInk.control : onInk.body,
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
        <Icon name="minus" size={24} />
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
        <span style={{ fontSize: T.md, fontWeight: 800, color: onInk.muted }}>s each hold</span>
      </div>
      <StepperTile label="Longer hold" onClick={() => set(seconds + HOLD_STEP_SEC)}>
        <Icon name="plus" size={24} />
      </StepperTile>
    </div>
  );
}

/** Five seconds a tap: finer than anyone times a hold by feel. */
const HOLD_STEP_SEC = 5;
/** Only reached when a routine asks for holds without saying how long. */
const HOLD_DEFAULT_SEC = 10;

/** A 14px dot is what the eye needs; a 44px box is what the thumb needs. */
const DOT_BOX = {
  width: TOUCH,
  height: TOUCH,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  flex: 'none',
} as const;

const DOT = { width: 14, height: 14, borderRadius: '50%', boxSizing: 'border-box' } as const;

/**
 * A logged set. Tapping it opens the editor for that set.
 *
 * Three looks: solid green once rated, a thick green ring while its RPE is
 * still the aim standing in, and grey for a warm-up, which is never rated.
 *
 * Its name spells out what the set was, so a screen reader hears "80 kg × 8 at
 * RPE 8" rather than a row of identical buttons.
 */
function SetDot({ row }: { row: LoggedSet }) {
  const b = useBompa();
  const { unit } = b.s;
  const kind = row.type === 'warmup' ? ' (Warm-up)' : row.type === 'backoff' ? ' (Back-off)' : '';
  const unrated = countsAsWork(row.type) && row.rpeEstimated;
  const look =
    row.type === 'warmup'
      ? { background: onInk.muted, border: `1.5px solid ${onInk.muted}` }
      : unrated
        ? { background: 'transparent', border: `3.5px solid ${C.green}` }
        : { background: C.green, border: `1.5px solid ${C.green}` };
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
        {unrated ? ', not rated yet' : ''}
      </span>
      <span aria-hidden style={{ ...DOT, ...look }} />
    </Btn>
  );
}

/**
 * The weight: the big figure, typed or stepped, and a one-tap way to plain
 * bodyweight. Entry stays in the display unit throughout; logging the set is
 * where it becomes kilograms, once.
 *
 * The steppers say their step, and holding either one moves to the next step.
 * The Bodyweight chip only shows where it means something: on a bodyweight
 * lift, or with the weight already at zero.
 */
function WeightEntry() {
  const b = useBompa();
  const { s, activeExerciseId } = b;
  const setWeight = (next: number) => b.patch({ entryWeight: next });
  const bodyweight = useBodyweight(activeExerciseId ?? undefined, s.entryWeight, setWeight);
  const showBodyweight = b.isBodyweightLift(activeExerciseId) || s.entryWeight === 0;

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
            unitStyle={{ fontSize: T.lg, fontWeight: 800 }}
          />
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, width: '100%', paddingTop: 12 }}>
        <WeightStep sign="minus" onStep={() => setWeight(Math.max(0, Math.round((s.entryWeight - s.step) * 100) / 100))} />
        {showBodyweight && <BodyweightChip on={bodyweight.on} onClick={bodyweight.toggle} />}
        <WeightStep sign="plus" onStep={() => setWeight(Math.round((s.entryWeight + s.step) * 100) / 100)} />
      </div>
    </div>
  );
}

/**
 * One weight stepper: "− 2.5". A tap steps; holding it half a second moves to
 * the next step size instead, so the step lives where the thumb already is
 * rather than on a button of its own.
 */
function WeightStep({ sign, onStep }: { sign: 'minus' | 'plus'; onStep: () => void }) {
  const b = useBompa();
  const { s } = b;
  const press = useLongPress(b.setStepByLongPress);
  const verb = sign === 'minus' ? 'Decrease' : 'Increase';
  return (
    <button
      type="button"
      {...press.handlers}
      onClick={() => {
        if (press.wasLong()) return;
        onStep();
      }}
      aria-label={`${verb} weight by ${s.step} ${s.unit}. Hold to change the step.`}
      style={{
        fontFamily: 'inherit',
        flex: 1,
        height: 56,
        borderRadius: R.block,
        border: `1px solid ${onInk.control}`,
        background: 'transparent',
        color: onInk.text,
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 4,
        // A held finger must not select the text or raise the phone's own menu.
        userSelect: 'none',
        WebkitUserSelect: 'none',
        WebkitTouchCallout: 'none',
        padding: 0,
      }}
    >
      <Icon name={sign} size={24} />
      <span aria-hidden style={{ fontSize: T.md, fontWeight: 800, color: onInk.muted, ...num }}>
        {s.step}
      </span>
    </button>
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
      <h1 style={{ fontSize: T.xl, fontWeight: 800, margin: 0 }}>Train</h1>
      <div
        style={{
          border: `1px dashed ${onInk.control}`,
          borderRadius: R.chip,
          padding: 18,
          textAlign: 'center',
          fontSize: T.note,
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
        <InkButton onClick={() => b.go('workouts')} style={routine ? undefined : { flex: 1 }}>
          {routine ? 'Pick another' : 'Pick a workout'}
        </InkButton>
      </div>
    </div>
  );
}
