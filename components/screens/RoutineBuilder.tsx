'use client';

// Build and edit a workout. Without this, first-run setup cannot ask the user
// to set up their first one, and the app is stuck shipping routines it invented.

import { useEffect, useMemo, useState } from 'react';
import { toDisplay, toKg } from '@/lib/calc';
import { groupNoun } from '@/lib/methods';
import { describeMethod } from '@/lib/methodPresets';
import { normaliseRoutine } from '@/lib/supersets';
import { C, R, TOUCH, num } from '@/lib/tokens';
import type { Routine, RoutineSlot } from '@/lib/types';
import { useBompa } from '@/state/BompaContext';
import { Btn, Empty, Eyebrow } from '@/components/ui';
import { ExercisePicker } from '@/components/screens/ExercisePicker';
import { MethodPicker } from '@/components/MethodPicker';

const SUPERSET_LETTERS = ['A', 'B', 'C'];

/**
 * Gaps offered between the lifts of a superset. None is the default and the
 * usual answer; the rest are for programmes that prescribe a short breather so
 * the second lift isn't ruined by the first.
 */
const SUPERSET_GAPS = [0, 10, 15, 30];

export function RoutineBuilder({ routineId, onClose }: { routineId: string; onClose: () => void }) {
  const b = useBompa();
  const source = b.allRoutines.find((r) => r.id === routineId);
  const [draft, setDraft] = useState<Routine | null>(source ?? null);
  const [picking, setPicking] = useState(false);
  /** The lift whose method sheet is open, by position in the draft. */
  const [methodFor, setMethodFor] = useState<number | null>(null);
  const guideOpen = b.s.methodGuide !== null;

  // Escape closes, matching every other sheet in the app — but only the
  // topmost one: with a method sheet or an explainer open over the builder,
  // Escape belongs to that, not to the unsaved workout underneath.
  useEffect(() => {
    if (methodFor !== null || guideOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, methodFor, guideOpen]);

  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(source), [draft, source]);

  if (!draft) return null;

  const setSlot = (index: number, next: Partial<RoutineSlot>) => {
    const slots = draft.slots.map((slot, i) => (i === index ? { ...slot, ...next } : slot));
    const updated = { ...draft, slots };
    // Regroup as soon as a letter changes, so what you see is what will be
    // saved rather than a layout that rearranges itself afterwards. That also
    // drops the gap for a letter this edit just emptied out.
    setDraft(next.supersetGroup !== undefined ? normaliseRoutine(updated) : updated);
  };

  /** Replace one lift wholesale — the method sheet hands back a complete slot. */
  const replaceSlot = (index: number, next: RoutineSlot) => {
    setDraft({ ...draft, slots: draft.slots.map((slot, i) => (i === index ? next : slot)) });
  };

  /**
   * With a per-set scheme the set count is the scheme's length, so changing it
   * adds a copy of the last set or takes the last one off rather than leaving
   * the two to disagree until saving quietly overrules the stepper.
   */
  const setSets = (index: number, value: number) => {
    const slot = draft.slots[index]!;
    const sets = Math.max(1, value);
    if (!slot.scheme || slot.scheme.length === 0) {
      setSlot(index, { sets });
      return;
    }
    const last = slot.scheme[slot.scheme.length - 1]!;
    const scheme =
      sets <= slot.scheme.length
        ? slot.scheme.slice(0, sets)
        : [...slot.scheme, ...Array.from({ length: sets - slot.scheme.length }, () => ({ ...last, ...(last.load ? { load: { ...last.load } } : {}) }))];
    setSlot(index, { sets: scheme.length, scheme });
  };

  const groupRest = (letter: string) => draft.supersetRest?.[letter] ?? 0;
  const groupSize = (letter: string) => draft.slots.filter((slot) => slot.supersetGroup === letter).length;

  const setGroupRest = (letter: string, sec: number) => {
    const rest = { ...(draft.supersetRest ?? {}) };
    // Zero is the absence of a gap, not a gap of zero — storing it would leave
    // a key behind for a letter that behaves exactly like an untouched one.
    if (sec > 0) rest[letter] = sec;
    else delete rest[letter];
    setDraft({ ...draft, supersetRest: rest });
  };

  const move = (index: number, by: number) => {
    const to = index + by;
    if (to < 0 || to >= draft.slots.length) return;
    const slots = [...draft.slots];
    const [lifted] = slots.splice(index, 1);
    slots.splice(to, 0, lifted!);
    setDraft({ ...draft, slots: slots.map((slot, i) => ({ ...slot, order: i })) });
  };

  const save = async () => {
    await b.saveRoutine(draft);
    onClose();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Edit ${draft.name}`}
      onClick={onClose}
      style={{ position: 'absolute', inset: 0, zIndex: 30, background: 'rgba(20,20,16,.42)', display: 'flex', alignItems: 'flex-end' }}
    >
      <div
        className="sheet"
        onClick={(event) => event.stopPropagation()}
        style={{
          width: '100%',
          boxSizing: 'border-box',
          maxHeight: 'calc(100% - 30px)',
          display: 'flex',
          flexDirection: 'column',
          background: C.screen,
          borderRadius: '22px 22px 0 0',
          padding: '16px 18px 22px',
          gap: 12,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          <span style={{ fontSize: 20, fontWeight: 800 }}>Edit workout</span>
          <Btn
            onClick={onClose}
            label="Close"
            style={{
              width: 34,
              height: 34,
              flex: 'none',
              borderRadius: R.pill,
              border: `1px solid ${C.lineStrong}`,
              background: C.card,
              color: C.ink60,
              fontSize: 15,
              fontWeight: 800,
            }}
          >
            ✕
          </Btn>
        </div>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <Eyebrow style={{ letterSpacing: '.12em' }}>Name</Eyebrow>
          <input
            value={draft.name}
            onChange={(event) => setDraft({ ...draft, name: event.target.value })}
            style={{
              height: 44,
              borderRadius: R.chip,
              border: `1px solid ${C.lineStrong}`,
              background: C.card,
              padding: '0 12px',
              fontSize: 15,
              fontWeight: 800,
              color: C.ink,
              fontFamily: 'inherit',
              width: '100%',
            }}
          />
        </label>

        <div className="no-scrollbar" style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {draft.slots.length === 0 && <Empty>No lifts yet. Add one below.</Empty>}

          {draft.slots.map((slot, index) => {
            const exercise = b.exerciseById.get(slot.exerciseId);
            const usesPct = slot.targetPct1RM !== null;
            // Bound once so the click handlers below close over a narrowed
            // value rather than re-checking a property TypeScript can't follow
            // into a callback.
            const letter = slot.supersetGroup;
            const grouped = letter !== null;
            // Members are contiguous by the time a routine is saved, so adjacency
            // here is a reliable way to draw the group.
            const startsGroup = grouped && draft.slots[index - 1]?.supersetGroup !== letter;
            const endsGroup = grouped && draft.slots[index + 1]?.supersetGroup !== letter;
            return (
              <div
                key={`${slot.exerciseId}-${index}`}
                style={{
                  background: C.card,
                  border: `1px solid ${grouped ? C.amberBd : C.line}`,
                  borderLeft: grouped ? `3px solid ${C.amber}` : `1px solid ${C.line}`,
                  borderTopLeftRadius: grouped && !startsGroup ? 0 : R.block,
                  borderTopRightRadius: grouped && !startsGroup ? 0 : R.block,
                  borderBottomLeftRadius: grouped && !endsGroup ? 0 : R.block,
                  borderBottomRightRadius: grouped && !endsGroup ? 0 : R.block,
                  marginTop: grouped && !startsGroup ? -8 : 0,
                  padding: '12px 13px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 10,
                }}
              >
                {startsGroup && letter !== null && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                    <span style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: '.14em', color: C.amberDark }}>
                      {groupNoun(groupSize(letter)).toUpperCase()} {letter} ·{' '}
                      {groupRest(letter) === 0 ? 'NO REST BETWEEN THESE' : `${groupRest(letter)}S BETWEEN THESE`}
                    </span>
                    {/* The gap belongs to the group, not to a lift, so it is set
                        once on the header rather than repeated on every member. */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <Eyebrow style={{ letterSpacing: '.12em', flex: 'none' }}>Gap</Eyebrow>
                      {SUPERSET_GAPS.map((sec) => (
                        <Btn key={sec} onClick={() => setGroupRest(letter, sec)} style={groupStyle(groupRest(letter) === sec)}>
                          {sec === 0 ? 'None' : `${sec}s`}
                        </Btn>
                      ))}
                    </div>
                  </div>
                )}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <span style={{ fontSize: 13.5, fontWeight: 800, minWidth: 0 }}>{exercise?.name ?? slot.exerciseId}</span>
                  <div style={{ display: 'flex', gap: 4, flex: 'none' }}>
                    <MiniBtn onClick={() => move(index, -1)} label="Move up" disabled={index === 0}>
                      ↑
                    </MiniBtn>
                    <MiniBtn onClick={() => move(index, 1)} label="Move down" disabled={index === draft.slots.length - 1}>
                      ↓
                    </MiniBtn>
                    <MiniBtn
                      onClick={() => setDraft({ ...draft, slots: draft.slots.filter((_, i) => i !== index) })}
                      label="Remove lift"
                      danger
                    >
                      ✕
                    </MiniBtn>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 6 }}>
                  <Field label="Sets" value={slot.scheme?.length || slot.sets} onChange={(v) => setSets(index, v)} />
                  <Field label="Reps" value={slot.reps} onChange={(v) => setSlot(index, { reps: Math.max(1, v) })} />
                  <Field label="RPE" value={slot.targetRpe} step={0.5} onChange={(v) => setSlot(index, { targetRpe: Math.min(10, Math.max(6, v)) })} />
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Btn
                    onClick={() =>
                      setSlot(index, usesPct ? { targetPct1RM: null, targetWeightKg: 60 } : { targetPct1RM: 0.75, targetWeightKg: null })
                    }
                    style={{
                      height: 34,
                      padding: '0 10px',
                      borderRadius: 9,
                      border: `1px solid ${C.lineStrong}`,
                      background: C.screen,
                      color: C.ink60,
                      fontSize: 11,
                      fontWeight: 800,
                      flex: 'none',
                    }}
                  >
                    {usesPct ? '% of 1RM' : b.s.unit}
                  </Btn>
                  {usesPct ? (
                    <Field
                      label="Percent"
                      value={Math.round((slot.targetPct1RM ?? 0) * 100)}
                      step={5}
                      onChange={(v) => setSlot(index, { targetPct1RM: Math.min(100, Math.max(30, v)) / 100 })}
                    />
                  ) : (
                    <Field
                      label={`Weight (${b.s.unit})`}
                      value={toDisplay(slot.targetWeightKg ?? 0, b.s.unit)}
                      step={b.s.unit === 'kg' ? 2.5 : 5}
                      onChange={(v) => setSlot(index, { targetWeightKg: toKg(Math.max(0, v), b.s.unit) })}
                    />
                  )}
                </div>

                {/* One row for everything beyond sets and reps, so a lifter who
                    never uses methods pays for them with one line. */}
                <Btn
                  onClick={() => setMethodFor(index)}
                  style={{
                    minHeight: TOUCH,
                    borderRadius: R.small,
                    border: `1px solid ${C.line}`,
                    background: C.screen,
                    padding: '6px 10px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    textAlign: 'left',
                  }}
                >
                  <Eyebrow style={{ letterSpacing: '.12em', flex: 'none' }}>Method</Eyebrow>
                  <span data-testid="method-row-summary" style={{ flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: 700, color: C.ink80, ...num }}>
                    {describeMethod(slot)}
                  </span>
                  <span aria-hidden style={{ flex: 'none', fontSize: 14, fontWeight: 800, color: C.muted }}>
                    ›
                  </span>
                </Btn>

                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Eyebrow style={{ letterSpacing: '.12em', flex: 'none' }}>Superset</Eyebrow>
                  <Btn
                    onClick={() => setSlot(index, { supersetGroup: null })}
                    style={groupStyle(letter === null)}
                  >
                    None
                  </Btn>
                  {SUPERSET_LETTERS.map((option) => (
                    <Btn key={option} onClick={() => setSlot(index, { supersetGroup: option })} style={groupStyle(letter === option)}>
                      {option}
                    </Btn>
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        <Btn
          onClick={() => setPicking(true)}
          style={{
            height: 44,
            borderRadius: R.chip,
            border: `1px dashed ${C.lineStrong}`,
            background: 'transparent',
            color: C.ink60,
            fontSize: 13,
            fontWeight: 800,
          }}
        >
          + Add a lift
        </Btn>

        <div style={{ display: 'flex', gap: 7 }}>
          <Btn
            onClick={save}
            disabled={draft.slots.length === 0}
            style={{ flex: 1, height: 48, borderRadius: R.chip, background: C.ink, color: C.white, fontSize: 14, fontWeight: 800 }}
          >
            {dirty ? 'Save workout' : 'Done'}
          </Btn>
          {source?.source !== 'template' && (
            <Btn
              onClick={async () => {
                if (!window.confirm(`Delete ${draft.name}? Your logged history stays.`)) return;
                await b.deleteRoutine(draft.id);
                onClose();
              }}
              style={{
                width: 96,
                height: 48,
                flex: 'none',
                borderRadius: R.chip,
                border: `1px solid ${C.redBd}`,
                background: C.redBg,
                color: C.redDark,
                fontSize: 13,
                fontWeight: 800,
              }}
            >
              Delete
            </Btn>
          )}
        </div>

        {methodFor !== null && draft.slots[methodFor] && (
          <MethodPicker
            slot={draft.slots[methodFor]!}
            exerciseName={b.exerciseById.get(draft.slots[methodFor]!.exerciseId)?.name ?? draft.slots[methodFor]!.exerciseId}
            grouped={draft.slots[methodFor]!.supersetGroup !== null}
            groupGapSec={groupRest(draft.slots[methodFor]!.supersetGroup ?? '')}
            unit={b.s.unit}
            onChange={(next) => replaceSlot(methodFor, next)}
            onClose={() => setMethodFor(null)}
          />
        )}

        {picking && (
          <ExercisePicker
            title="Add a lift"
            footnote="Added to this workout, not to a session in progress."
            selectedIds={new Set(draft.slots.map((slot) => slot.exerciseId))}
            onPick={(exerciseId) => {
              if (draft.slots.some((slot) => slot.exerciseId === exerciseId)) return;
              setDraft({
                ...draft,
                slots: [
                  ...draft.slots,
                  {
                    exerciseId,
                    order: draft.slots.length,
                    sets: 3,
                    reps: 8,
                    targetWeightKg: 40,
                    targetPct1RM: null,
                    targetRpe: 8,
                    supersetGroup: null,
                  },
                ],
              });
            }}
            onClose={() => setPicking(false)}
          />
        )}
      </div>
    </div>
  );
}

function groupStyle(on: boolean) {
  return {
    flex: 1,
    height: 30,
    borderRadius: 8,
    border: `1px solid ${on ? C.ink : C.line}`,
    background: on ? C.ink : C.screen,
    color: on ? C.white : C.muted,
    fontSize: 11,
    fontWeight: 800,
  } as const;
}

function MiniBtn({
  children,
  onClick,
  label,
  disabled,
  danger,
}: {
  children: React.ReactNode;
  onClick: () => void;
  label: string;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <Btn
      onClick={onClick}
      label={label}
      disabled={disabled}
      style={{
        width: 30,
        height: 30,
        borderRadius: 8,
        border: `1px solid ${danger ? C.redBd : C.lineStrong}`,
        background: danger ? C.redBg : C.card,
        color: danger ? C.redDark : C.ink60,
        fontSize: 12,
        fontWeight: 800,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {children}
    </Btn>
  );
}

function Field({
  label,
  value,
  onChange,
  step = 1,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  step?: number;
}) {
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
      <Eyebrow style={{ letterSpacing: '.1em', fontSize: 8.5 }}>{label}</Eyebrow>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <MiniBtn onClick={() => onChange(value - step)} label={`Decrease ${label}`}>
          −
        </MiniBtn>
        <span style={{ flex: 1, textAlign: 'center', fontSize: 14, fontWeight: 800, ...num }}>{value}</span>
        <MiniBtn onClick={() => onChange(value + step)} label={`Increase ${label}`}>
          +
        </MiniBtn>
      </div>
    </div>
  );
}
