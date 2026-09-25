'use client';

// Amending a set that is already logged.
//
// Until this existed the only correction available was deleting the row and
// logging it again, which loses the original timestamp and is a poor answer to
// a mistyped weight. Set type matters most: a working set mistyped as a warm-up
// is quietly excluded from session load, personal records and the RPE deviation
// the weekly review reads, and nothing on screen would ever say so.

import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { increments, isSet, segmentOf, toDisplay } from '@/lib/calc';
import { REPS_MAX } from '@/lib/numberEntry';
import { C, T, num, onInk } from '@/lib/tokens';
import type { SetType } from '@/lib/types';
import { useBompa } from '@/state/BompaContext';
import { DarkSheet, EditableNumber, InkButton, InkSegmented, StepperTile } from '@/components/ui';
import { Icon } from '@/components/icons';
import { RpePicker } from '@/components/RpePicker';
import { pieceNoun } from '@/components/screens/SegmentControls';
import { BodyweightChip, WeightFigure, useBodyweight } from '@/components/WeightFigure';

const SET_TYPES: { value: SetType; label: string }[] = [
  { value: 'warmup', label: 'Warm-up' },
  { value: 'working', label: 'Working' },
  { value: 'backoff', label: 'Back-off' },
];

/**
 * The form's working copy. `startWeight` and `startRpe` are the values as first
 * shown, kept so Save can tell whether either was actually touched.
 */
type Draft = { id: number; weight: number; startWeight: number; reps: number; rpe: number; startRpe: number; type: SetType };

export function EditSetSheet() {
  const b = useBompa();
  const { s } = b;
  const row = s.editingSetId === null ? undefined : b.sets.find((x) => x.id === s.editingSetId);

  // Draft state, so nothing is written until Save. Keyed on the set id: opening
  // a different row reloads the form rather than keeping the last one's numbers.
  const [draft, setDraft] = useState<Draft | null>(null);

  useEffect(() => {
    if (row?.id === undefined) {
      setDraft(null);
      return;
    }
    const id = row.id;
    setDraft((prev) => {
      if (prev?.id === id) return prev;
      const weight = toDisplay(row.weightKg, s.unit);
      return { id, weight, startWeight: weight, reps: row.reps, rpe: row.rpe, startRpe: row.rpe, type: row.type };
    });
  }, [row, s.unit]);

  const setWeight = (weight: number) => setDraft((prev) => (prev ? { ...prev, weight } : prev));
  const bodyweight = useBodyweight(row?.exerciseId, draft?.weight ?? 0, setWeight);

  // The row can vanish underneath the sheet — deleted from the list behind it,
  // or a session closed. Rendering nothing beats rendering an empty form.
  if (s.editingSetId === null || !row || !draft) return null;

  // A drop or cluster piece is its own row, edited on its own, but it belongs to
  // a set: its type is the set's, and deleting the set takes it too.
  const piece = !isSet(row);
  const pieces = piece
    ? []
    : b.sets.filter(
        (x) => !isSet(x) && x.sessionId === row.sessionId && x.exerciseId === row.exerciseId && x.setNo === row.setNo,
      );
  const noun = pieceNoun(piece ? row.segmentStyle : pieces[0]?.segmentStyle).toLowerCase();
  const piecesWord = `${pieces.length} ${noun}${pieces.length === 1 ? '' : 's'}`;
  const typeLabel = SET_TYPES.find((x) => x.value === row.type)?.label ?? row.type;

  const close = () => b.patch({ editingSetId: null });
  const step = increments(s.unit)[1] ?? 2.5;
  const round = (value: number) => Math.round(value * 100) / 100;

  const save = () => {
    b.updateSet(draft.id, {
      // Only sent when it moved. The stored kilograms went through a rounding
      // step on the way to the screen, so sending an untouched weight back would
      // convert it a second time and could nudge a pound user's history by a
      // fraction on every save that only fixed the reps.
      weight: draft.weight === draft.startWeight ? undefined : draft.weight,
      reps: draft.reps,
      // Sending an RPE marks the set as rated by the lifter. Fixing a mistyped
      // weight is not a rating, so an untouched RPE stays the stand-in it was.
      rpe: draft.rpe === draft.startRpe ? undefined : draft.rpe,
      type: draft.type,
    });
    close();
  };

  const remove = () => {
    b.deleteSet(row);
    close();
  };

  return (
    <DarkSheet
      open
      onClose={close}
      eyebrow={piece ? `${pieceNoun(row.segmentStyle)} ${segmentOf(row)} of set ${row.setNo}` : `Edit set ${row.setNo}`}
      title={b.exerciseById.get(row.exerciseId)?.name ?? row.exerciseId}
      titleSize={T.xl}
      label="Edit logged set"
      // Words rather than ✕: closing here throws the changes away, and a cross
      // doesn't say that.
      closeText="Cancel"
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <StepperTile label="Decrease weight" height={60} onClick={() => setWeight(Math.max(0, round(draft.weight - step)))}>
          <Icon name="minus" size={24} />
        </StepperTile>
        {/* Typed in the display unit like the steppers; Save converts it, and
            only if it moved. */}
        <Figure>
          <WeightFigure
            weight={draft.weight}
            unit={s.unit}
            bodyweight={bodyweight.on}
            onCommit={setWeight}
            figure={figureType(64)}
            unitStyle={{ fontSize: T.title, fontWeight: 800 }}
          />
        </Figure>
        <StepperTile label="Increase weight" height={60} onClick={() => setWeight(round(draft.weight + step))}>
          <Icon name="plus" size={24} />
        </StepperTile>
      </div>

      <div style={{ display: 'flex', justifyContent: 'center' }}>
        <BodyweightChip on={bodyweight.on} onClick={bodyweight.toggle} />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {/* Floored at 1 — zero reps is not a set. */}
        <StepperTile label="Decrease reps" onClick={() => setDraft({ ...draft, reps: Math.max(1, draft.reps - 1) })}>
          <Icon name="minus" size={24} />
        </StepperTile>
        <Figure>
          <EditableNumber
            label="Reps"
            value={draft.reps}
            min={1}
            max={REPS_MAX}
            precision={1}
            onCommit={(reps) => setDraft({ ...draft, reps })}
            style={figureType(T.stat)}
          />
          <span style={{ fontSize: T.md, fontWeight: 800, color: onInk.muted }}>reps</span>
        </Figure>
        <StepperTile label="Increase reps" onClick={() => setDraft({ ...draft, reps: draft.reps + 1 })}>
          <Icon name="plus" size={24} />
        </StepperTile>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {/* The same control the logger uses. Two selectors for one value
            would drift, and this is the field the whole model reads. */}
        <RpePicker dark value={draft.rpe} target={draft.rpe} onPick={(next) => setDraft({ ...draft, rpe: next ?? draft.rpe })} />
        {row.rpeEstimated && draft.rpe === row.rpe && (
          <span style={{ fontSize: T.sm, fontWeight: 600, lineHeight: 1.45, color: onInk.body }}>
            This one was never given an RPE — the programmed target was recorded instead.
          </span>
        )}
      </div>

      {piece ? (
        // No type control on a piece: a set cannot be half warm-up, so the type
        // is changed on the set and every piece follows.
        <span style={{ fontSize: T.sm, fontWeight: 600, lineHeight: 1.45, color: onInk.body, ...num }}>
          {typeLabel}, like set {row.setNo}. Change the type on the set and its pieces follow.
        </span>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex' }}>
            <InkSegmented label="Set type" value={draft.type} options={SET_TYPES} onChange={(type) => setDraft({ ...draft, type })} />
          </div>
          {draft.type === 'warmup' && row.type !== 'warmup' && (
            <span style={{ fontSize: T.sm, fontWeight: 600, lineHeight: 1.45, color: onInk.body }}>
              Warm-ups sit outside your fatigue numbers, records and set counts.
            </span>
          )}
          {draft.type !== row.type && pieces.length > 0 && (
            <span style={{ fontSize: T.sm, fontWeight: 600, lineHeight: 1.45, color: onInk.body, ...num }}>
              Its {piecesWord} change with it.
            </span>
          )}
        </div>
      )}

      {pieces.length > 0 && (
        // Said before the button rather than after it: a delete that takes more
        // rows than the one on screen should never be a surprise.
        <span style={{ fontSize: T.sm, fontWeight: 600, lineHeight: 1.45, color: onInk.body, ...num }}>
          Deleting this set deletes its {piecesWord} too.
        </span>
      )}

      <div style={{ display: 'flex', gap: 8 }}>
        {/* Red text rather than a red fill: deleting is a real option here, not
            the expected one, so it stays quieter than Save. */}
        <InkButton width={100} height={56} fontSize={T.md} color={C.redLight} onClick={remove}>
          Delete
        </InkButton>
        <InkButton variant="amber" height={56} fontSize={T.lg} onClick={save} style={{ flex: 1 }}>
          Save changes
        </InkButton>
      </div>
    </DarkSheet>
  );
}

/** A big figure with its unit beside it, centred between two steppers. */
function Figure({ children }: { children: ReactNode }) {
  return (
    // minWidth 0 lets the figure give way to the fixed-width steppers on a
    // narrow phone instead of pushing them off the edge.
    <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'baseline', justifyContent: 'center', gap: 5 }}>{children}</div>
  );
}

function figureType(size: number): CSSProperties {
  return { fontSize: size, fontWeight: 800, lineHeight: 1, letterSpacing: '-0.04em', color: onInk.text };
}
