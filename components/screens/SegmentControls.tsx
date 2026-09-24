'use client';

// The entry-card controls for a set made of pieces: "Drop 1 of 2", the pause
// between cluster singles, the running total, and ending the set early. The
// state and actions behind it live in the app context (`segment`,
// `logSegment`, `endSegments`, `startSegments`).
//
// The main button below still logs: mid-set it logs the next piece, so there is
// one place to press whatever the set is made of. This card only says what that
// press will log, and offers the way out.

import { useEffect } from 'react';
import { countsAsWork, fmtClock } from '@/lib/calc';
import { C, R, TOUCH, num, onInk } from '@/lib/tokens';
import type { LoggedSet, SegmentStyle } from '@/lib/types';
import { useBompa, type SegmentState } from '@/state/BompaContext';
import { InkButton } from '@/components/ui';

/**
 * What one piece of a set is called, for headings like "Drop 1 of 2" and
 * "Drop 1 of set 3". A cluster or rest-pause piece is neither a set nor a drop,
 * and calling it either would miscount what the lifter did.
 */
export function pieceNoun(style: SegmentStyle | undefined): 'Drop' | 'Piece' {
  return style === 'drop' || style === 'mechanical-drop' ? 'Drop' : 'Piece';
}

/**
 * Whether an unplanned drop can carry on the set just finished. Only after
 * work: a warm-up never has pieces. The newest row decides, piece or set, so a
 * planned drop set that has run its course can still take one more.
 */
export function offersDrop(sessionSets: readonly LoggedSet[]): boolean {
  let last: LoggedSet | null = null;
  for (const row of sessionSets) if (last === null || row.at >= last.at) last = row;
  return last !== null && countsAsWork(last.type);
}

export function SegmentControls() {
  const b = useBompa();
  const { segment, s } = b;

  // Changing lift mid-set ends the set where it stands. Otherwise the log button
  // would write the next piece against the lift that is no longer on screen.
  // Watched here rather than wired into each way of changing lift, because a
  // chip tap and a swipe both land in the same place: the active lift moving.
  const strayed = segment !== null && b.activeExerciseId !== null && b.activeExerciseId !== segment.exerciseId;
  const { endSegments, pickExercise } = b;
  useEffect(() => {
    if (!strayed) return;
    endSegments();
    // Ending a set loads what comes after it into the entry card. The lifter has
    // already said what comes next, so their pick goes back on top.
    pickExercise(s.exIdx);
  }, [strayed, endSegments, pickExercise, s.exIdx]);

  if (segment) return <InProgress segment={segment} />;
  return <DropOffer />;
}

/** The card while a set is between pieces. */
function InProgress({ segment }: { segment: SegmentState }) {
  const b = useBompa();
  const { s } = b;

  const heading = headingFor(segment);
  // From the stored end time on every render — the context ticks once a second
  // — so a phone locked through the pause still shows the right number.
  const pauseLeft = segment.pauseEndsAt === null ? 0 : Math.ceil(Math.max(0, segment.pauseEndsAt - Date.now()) / 1000);
  const reps = segment.nextReps === null ? 'as many as possible' : `${segment.nextReps} ${segment.nextReps === 1 ? 'rep' : 'reps'}`;

  return (
    <section
      aria-label="Set in progress"
      className="sheet"
      style={{
        margin: '16px 18px 0',
        padding: 16,
        borderRadius: R.card,
        background: onInk.line,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
          <span style={{ fontSize: 17, fontWeight: 800, color: onInk.text, ...num }}>{heading}</span>
          <span style={{ fontSize: 13, fontWeight: 700, color: C.amberLight, ...num }}>
            {s.entryWeight} {s.unit} · {reps}
          </span>
          {/* onInk.body rather than muted: this card is the lighter ink, where
              the muted grey is too faint for small text. */}
          {segment.label && (
            <span style={{ fontSize: 12.5, fontWeight: 700, color: onInk.body }}>now: {segment.label}</span>
          )}
          {segment.totalReps !== null && (
            <span style={{ fontSize: 12.5, fontWeight: 700, color: onInk.body, ...num }}>
              {segment.repsSoFar} of {segment.totalReps} reps
            </span>
          )}
        </div>
        {/* Finishing early is a real option — the lifter feels the set, the
            plan does not — so it sits right beside what the set is asking for. */}
        <InkButton onClick={b.endSegments} height={TOUCH} fontSize={13.5} style={{ flex: 'none', padding: '0 16px' }}>
          End set
        </InkButton>
      </div>

      {pauseLeft > 0 && (
        <div
          role="timer"
          aria-label={`${pauseNoun(segment)} in ${fmtClock(pauseLeft)}`}
          style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'center', gap: 8, paddingTop: 2 }}
        >
          <span aria-hidden style={{ fontSize: 13, fontWeight: 800, color: onInk.body }}>
            {pauseNoun(segment)} in
          </span>
          <span aria-hidden style={{ fontSize: 44, fontWeight: 800, lineHeight: 1, letterSpacing: '-0.04em', color: C.amberLight, ...num }}>
            {fmtClock(pauseLeft)}
          </span>
        </div>
      )}
    </section>
  );
}

/** "Drop 1 of 2", "Single 3 of 5", "Piece 2" — the piece about to be logged. */
function headingFor(segment: SegmentState): string {
  if (segment.style === 'drop' || segment.style === 'mechanical-drop') {
    return segment.planned === null ? `Drop ${segment.next}` : `Drop ${segment.next} of ${segment.planned}`;
  }
  // A cluster counts its first piece: five singles are "1 of 5" to "5 of 5",
  // which is how the lifter counts them at the bar.
  const noun = allSingles(segment) ? 'Single' : 'Piece';
  const at = segment.next + 1;
  return segment.planned === null ? `${noun} ${at}` : `${noun} ${at} of ${segment.planned + 1}`;
}

function pauseNoun(segment: SegmentState): string {
  return allSingles(segment) ? 'Next single' : 'Next piece';
}

function allSingles(segment: SegmentState): boolean {
  return segment.style === 'cluster' && segment.plan.segmentReps.length > 0 && segment.plan.segmentReps.every((reps) => reps === 1);
}

/**
 * An unplanned drop, offered while the rest after a working set runs. People
 * decide to drop on the day, and the app should not make them pre-programme it.
 * The full-screen rest carries the same button; this is the one under the
 * minimised card.
 */
function DropOffer() {
  const b = useBompa();
  if (!b.restActive || b.restKind !== 'full' || b.s.restFull || !offersDrop(b.sessionSets)) return null;

  return (
    <div style={{ margin: '10px 18px 0', display: 'flex' }}>
      <InkButton
        onClick={() => b.startSegments('drop')}
        label="Drop the weight and carry on this set"
        height={TOUCH}
        fontSize={14}
        color={C.amberLight}
        style={{ flex: 1 }}
      >
        + Drop
      </InkButton>
    </div>
  );
}
