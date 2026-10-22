'use client';

// The seven RPE chips asked after a set: on the rest screen, in the rating
// sheet, and in the line on Train while the rest is minimised. One component,
// because this is the input the whole fatigue model reads and three versions
// of it would drift.

import { rpeChoices, toDisplay } from '@/lib/calc';
import { weightShort } from '@/lib/bodyweight';
import { C, T, W, num, onInk } from '@/lib/tokens';
import type { LoggedSet } from '@/lib/types';
import { useBompa } from '@/state/BompaContext';
import { ChipTrack } from '@/components/ui';

/**
 * One row of chips, in a dark track inside the card it sits on. The aim is a
 * step lighter with a dot under it, because leaving the row alone logs the
 * aim; a chosen value turns white, the same as a chosen lift.
 *
 * Disabled until the set has its database id: rating goes by id, and the
 * optimistic row has none for the first moment.
 */
export function RpeChipRow({
  target,
  value,
  onPick,
  label,
  disabled = false,
}: {
  target: number;
  /** The rating given, or null while the aim still stands in for one. */
  value: number | null;
  onPick: (rpe: number) => void;
  /** Names the group for a screen reader, e.g. "RPE for Bench set 2". */
  label: string;
  disabled?: boolean;
}) {
  return (
    <ChipTrack
      label={label}
      fill
      track={C.ink}
      fontSize={T.title}
      disabled={disabled}
      value={value === null ? null : String(value)}
      onChange={(next) => onPick(Number(next))}
      items={rpeChoices(target).map((rpe) => ({
        value: String(rpe),
        label: rpe,
        name: `RPE ${rpe}${rpe === target ? ', your aim' : ''}`,
        suggested: rpe === target,
      }))}
    />
  );
}

/**
 * A set, labelled, with its chip row: "Fly 15 × 12" over seven chips. Used
 * for each set of a superset round, for the other unrated sets on the
 * plan-done screen, and in the rating sheet.
 */
export function RateSetRow({
  row,
  prefix,
  onRated,
}: {
  row: LoggedSet;
  /** e.g. "Set 2 · ", before the weight. */
  prefix?: string;
  /** Called after a value is written, for a sheet that closes on the answer. */
  onRated?: () => void;
}) {
  const b = useBompa();
  const { unit } = b.s;
  const exercise = b.exerciseById.get(row.exerciseId);
  const name = exercise?.short ?? exercise?.name ?? row.exerciseId;
  const weight = weightShort(toDisplay(row.weightKg, unit), unit, b.isBodyweightLift(row.exerciseId));
  const target = targetFor(b, row);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={{ fontSize: T.sm, fontWeight: W.button, color: onInk.body, ...num }}>
        {prefix ?? `${name} `}
        {weight} × {row.reps}
      </span>
      <RpeChipRow
        target={target}
        value={row.rpeEstimated ? null : row.rpe}
        onPick={(rpe) => {
          if (row.id === undefined) return;
          b.rateSet(row.id, rpe);
          onRated?.();
        }}
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
