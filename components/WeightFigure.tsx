'use client';

// The big weight figure on ink, as Train and the set editor both draw it:
// typed or stepped, and bodyweight-aware. Zero reads "Bodyweight", and added
// weight on a bodyweight lift reads "BW + 10 kg", because "0 kg" for a set of
// pull-ups says the set was nothing.

import type { CSSProperties } from 'react';
import { isBodyweightLift as isLibraryBodyweight, weightSpoken } from '@/lib/bodyweight';
import { weightMax, weightPrecision } from '@/lib/numberEntry';
import { onInk } from '@/lib/tokens';
import type { Unit } from '@/lib/types';
import { useBompa } from '@/state/BompaContext';
import { EditableNumber, InkChip } from '@/components/ui';

/**
 * Renders the figure and its unit as siblings, so the caller's own row keeps
 * laying them out on a shared baseline exactly as before.
 *
 * `weight` is in the display unit; so is what `onCommit` hands back.
 */
export function WeightFigure({
  weight,
  unit,
  bodyweight,
  onCommit,
  figure,
  unitStyle,
}: {
  weight: number;
  unit: Unit;
  /** The lift is done with the body as the base load. */
  bodyweight: boolean;
  onCommit: (next: number) => void;
  /** The number's type: size, weight, line height, spacing. */
  figure: CSSProperties;
  /** The small unit label's type. */
  unitStyle: CSSProperties;
}) {
  const size = typeof figure.fontSize === 'number' ? figure.fontSize : 0;
  const common = {
    label: 'Weight',
    unit,
    value: weight,
    min: 0,
    max: weightMax(unit),
    precision: weightPrecision(unit),
    onCommit,
    // Only bodyweight needs its own words; a loaded lift keeps "Weight 80 kg".
    spoken: bodyweight ? weightSpoken(weight, unit, true) : undefined,
  };

  if (weight === 0) {
    // The word at full figure size would run off a phone; at under half it
    // still reads from arm's length.
    return <EditableNumber {...common} display="Bodyweight" style={{ ...figure, fontSize: Math.round(size * 0.42), letterSpacing: '-0.02em' }} />;
  }

  return (
    <>
      {bodyweight && <span style={{ ...unitStyle, color: onInk.muted }}>BW +</span>}
      <EditableNumber {...common} style={figure} />
      <span style={{ ...unitStyle, color: onInk.muted }}>{unit}</span>
    </>
  );
}

/**
 * One tap to plain bodyweight. Pressed while the lift is being done as
 * bodyweight; pressing it then, with weight added, turns that off again for a
 * lift the lifter only marked by hand.
 */
export function BodyweightChip({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <InkChip on={on} onClick={onClick} style={{ padding: '0 10px' }}>
      Bodyweight
    </InkChip>
  );
}

/**
 * Whether a lift is being done as bodyweight, and the chip's tap.
 *
 * On at zero, for a lift the library knows is bodyweight, or for one the
 * lifter marked with the chip. The mark is kept with the lifter's settings, so
 * weighted hyperextensions still read "BW + 10 kg" after leaving Train, and the
 * fatigue model counts the body under the plate. Unmarking takes both away.
 *
 * `exerciseId` names the lift the mark belongs to, so marking dips doesn't
 * mark the bench press after a swipe.
 */
export function useBodyweight(exerciseId: string | undefined, weight: number, setWeight: (next: number) => void) {
  const b = useBompa();
  const known = isLibraryBodyweight(exerciseId === undefined ? undefined : b.exerciseById.get(exerciseId));
  const on = weight === 0 || (exerciseId !== undefined && b.isBodyweightLift(exerciseId));

  const toggle = () => {
    if (exerciseId === undefined) return;
    // Marked by hand with plates on: the lifter is taking the mark back off,
    // and the weight stays as it is. A library bodyweight lift has no mark to
    // take off, so the tap goes to plain bodyweight instead.
    if (on && weight > 0 && !known) {
      b.markBodyweightLift(exerciseId, false);
      return;
    }
    if (!known) b.markBodyweightLift(exerciseId, true);
    if (weight !== 0) setWeight(0);
  };

  return { on, toggle };
}
