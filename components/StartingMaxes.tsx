'use client';

// Declared working maxes. Lives outside Tools because first-run setup shows the
// same control — one stored value, two entry points. Both places put it on the
// light sheet, so it draws as a flat section of hairline rows, not a card.

import { toDisplay, toKg } from '@/lib/calc';
import { startingMaxLifts } from '@/lib/maxes';
import { weightMax, weightPrecision } from '@/lib/numberEntry';
import { C, R, TOUCH } from '@/lib/tokens';
import { useBompa } from '@/state/BompaContext';
import { Btn, EditableNumber, Row, Section } from '@/components/ui';

/**
 * A new user has no history, so every routine priced as a percentage of 1RM
 * would prescribe zero kilograms. Declaring a starting max gives those routines
 * something to work from until real sets overtake it.
 */
export function StartingMaxes() {
  const b = useBompa();
  const { s } = b;
  const step = s.unit === 'kg' ? 2.5 : 5;
  // The lifts that can use a max, not every compound in the library. An id with
  // no matching movement (one since deleted) is skipped rather than shown blank.
  const lifts = startingMaxLifts(b.routines, b.startingMaxes).flatMap((id) => {
    const exercise = b.exerciseById.get(id);
    return exercise ? [exercise] : [];
  });

  return (
    <Section title="Starting maxes" right="optional">
      {lifts.map((exercise) => {
        const declared = b.startingMaxes[exercise.id] ?? 0;
        const estimated = b.e1rmByExercise[exercise.id] ?? 0;
        const fromHistory = estimated > declared;
        return (
          <Row
            key={exercise.id}
            title={exercise.name}
            titleSize={14}
            sub={
              // The row's own sub colour is tertiary; green says "your log has
              // taken over from the number you typed".
              <span style={{ color: fromHistory ? C.greenDark : C.tertiary }}>
                {estimated > 0 ? `using ${toDisplay(estimated, s.unit)} ${s.unit}${fromHistory ? ' from your log' : ''}` : 'not set'}
              </span>
            }
            right={
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 'none' }}>
                {/* The stored value is kilograms. Each tap reads it back in the
                    display unit, steps there, and converts once on the way in,
                    so a pound user's number lands on a clean 5 lb step. */}
                <MaxStepper
                  onClick={() => b.setStartingMax(exercise.id, Math.max(0, toKg(Math.max(0, toDisplay(declared, s.unit) - step), s.unit)))}
                  label={`Lower starting max for ${exercise.name}`}
                >
                  −
                </MaxStepper>
                {/* Typed in the display unit and converted once, here. */}
                <EditableNumber
                  label={`Starting max for ${exercise.name}`}
                  unit={s.unit}
                  value={toDisplay(declared, s.unit)}
                  min={0}
                  max={weightMax(s.unit)}
                  precision={weightPrecision(s.unit)}
                  onCommit={(next) => b.setStartingMax(exercise.id, toKg(next, s.unit))}
                  {...(declared > 0 ? {} : { display: '—', spoken: `Starting max for ${exercise.name} not set`, openEmpty: true })}
                  style={{ minWidth: 50, fontSize: 15, fontWeight: 800 }}
                />
                <MaxStepper
                  onClick={() => b.setStartingMax(exercise.id, toKg(toDisplay(declared, s.unit) + step, s.unit))}
                  label={`Raise starting max for ${exercise.name}`}
                >
                  +
                </MaxStepper>
              </div>
            }
          />
        );
      })}
      <span style={{ fontSize: 12, lineHeight: 1.5, color: C.tertiary, paddingTop: 10, borderTop: `1px solid ${C.line}` }}>
        Only needed for routines written as a percentage — 5/3/1 and the like. Your logged sets take over as soon as they beat the number.
      </span>
    </Section>
  );
}

/** The design drew these at 40px; they are raised to the 44px a thumb can reliably hit. */
function MaxStepper({ onClick, label, children }: { onClick: () => void; label: string; children: string }) {
  return (
    <Btn
      onClick={onClick}
      label={label}
      style={{
        width: TOUCH,
        height: TOUCH,
        borderRadius: R.chip,
        border: `1px solid ${C.lineStrong}`,
        background: C.card,
        color: C.ink,
        fontSize: 17,
      }}
    >
      {children}
    </Btn>
  );
}
