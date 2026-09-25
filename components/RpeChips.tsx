'use client';

// The seven RPE chips asked after a set: on the rest screen, in the rating
// sheet, and in the line on Train while the rest is minimised. One component,
// because this is the input the whole fatigue model reads and three versions
// of it would drift.

import { rpeChoices, toDisplay } from '@/lib/calc';
import { weightShort } from '@/lib/bodyweight';
import { C, R, T, TOUCH, num, onInk } from '@/lib/tokens';
import type { LoggedSet } from '@/lib/types';
import { useBompa } from '@/state/BompaContext';
import { Btn } from '@/components/ui';
import { rpeColor } from '@/components/RpePicker';

/**
 * One row of chips. The aim has a white outline and says "aim" under it,
 * because leaving the row alone logs the aim. A chosen value fills with its
 * effort colour. `compact` is the row used several to a screen: 44px, the
 * touch minimum, where the design drew 40, and without the "aim" label. The
 * full one is 48px.
 *
 * Disabled until the set has its database id: rating goes by id, and the
 * optimistic row has none for the first moment.
 */
export function RpeChipRow({
  target,
  value,
  onPick,
  label,
  compact = false,
  disabled = false,
  gap = 5,
}: {
  target: number;
  /** The rating given, or null while the aim still stands in for one. */
  value: number | null;
  onPick: (rpe: number) => void;
  /** Names the group for a screen reader, e.g. "RPE for Bench set 2". */
  label: string;
  compact?: boolean;
  disabled?: boolean;
  /** Between chips. The one-line row on Train closes it up to fit a name beside them. */
  gap?: number;
}) {
  const height = compact ? TOUCH : 48;
  return (
    <div role="group" aria-label={label} style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap }}>
      {rpeChoices(target).map((rpe) => {
        const on = value === rpe;
        const aim = rpe === target;
        return (
          <Btn
            key={rpe}
            onClick={() => onPick(rpe)}
            disabled={disabled}
            pressed={on}
            label={`RPE ${rpe}${aim ? ', your aim' : ''}`}
            style={{
              height,
              borderRadius: R.chip,
              border: on ? `1px solid ${rpeColor(rpe)}` : aim ? `1.5px solid ${C.white}` : `1px solid ${onInk.control}`,
              background: on ? rpeColor(rpe) : 'transparent',
              color: on || aim ? C.white : onInk.body,
              fontSize: T.title,
              fontWeight: 800,
              lineHeight: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              opacity: 1,
              ...num,
            }}
          >
            {rpe}
            {aim && !compact && (
              <span aria-hidden style={{ fontSize: T.xs, fontWeight: 800, color: on ? C.white : onInk.muted, paddingTop: 3 }}>
                aim
              </span>
            )}
          </Btn>
        );
      })}
    </div>
  );
}

/**
 * A set, labelled, with its chip row: "Fly 15 × 12" over seven chips. Used
 * for each set of a superset round, for the other unrated sets on the
 * plan-done screen, and in the rating sheet.
 */
export function RateSetRow({ row, prefix }: { row: LoggedSet; /** e.g. "Set 2 · ", before the weight. */ prefix?: string }) {
  const b = useBompa();
  const { unit } = b.s;
  const exercise = b.exerciseById.get(row.exerciseId);
  const name = exercise?.short ?? exercise?.name ?? row.exerciseId;
  const weight = weightShort(toDisplay(row.weightKg, unit), unit, b.isBodyweightLift(row.exerciseId));
  const target = targetFor(b, row);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={{ fontSize: T.sm, fontWeight: 700, color: onInk.body, ...num }}>
        {prefix ?? `${name} `}
        {weight} × {row.reps}
      </span>
      <RpeChipRow
        compact
        target={target}
        value={row.rpeEstimated ? null : row.rpe}
        onPick={(rpe) => row.id !== undefined && b.rateSet(row.id, rpe)}
        disabled={row.id === undefined}
        label={`RPE for ${name} set ${row.setNo}`}
      />
    </div>
  );
}

/**
 * The aim a set was logged against. An unrated set carries it as its RPE,
 * since the aim is what was written in its place; a rated one has lost it, so
 * the lift's current target is the next best answer.
 */
export function targetFor(b: ReturnType<typeof useBompa>, row: LoggedSet): number {
  if (row.rpeEstimated) return row.rpe;
  // The session's own routine: after finishing, the active routine is already
  // the next workout's.
  const session = b.sessions.find((x) => x.id === row.sessionId);
  const routine = session ? b.routineById(session.routineId) : undefined;
  return routine?.slots.find((slot) => slot.exerciseId === row.exerciseId)?.targetRpe ?? 7;
}
