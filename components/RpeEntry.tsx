'use client';

// RPE on the Train screen: one button that says what will be recorded, and a
// sheet with the full picker behind it.
//
// The picker used to sit open on the screen, two rows of chips and a meaning
// line. It was the tallest thing between the reps and the Log button, and most
// sets it goes untouched — the target is logged as an estimate. Folding it into
// a button hands that height back to the numbers that change every set, while
// the answer still reads at a glance and a real reading is one tap away.

import { RPE_MEANING } from '@/lib/data';
import { C, R, TOUCH, num, onInk } from '@/lib/tokens';
import { Btn, DarkSheet, InkButton } from '@/components/ui';
import { RpePicker, rpeColor } from '@/components/RpePicker';

/**
 * The compact control. Unset, it shows the target in a quiet colour, because
 * that is what will be written if the lifter says nothing. Set, the value takes
 * the same fill its chip has in the picker, so the two read as one thing.
 */
export function RpeButton({ value, target, onClick }: { value: number | null; target: number; onClick: () => void }) {
  const label = value === null ? `RPE: not set, target ${target} — choose` : `RPE ${value} — change`;
  return (
    <Btn
      onClick={onClick}
      label={label}
      style={{
        width: '100%',
        minHeight: TOUCH,
        height: 48,
        borderRadius: R.chip,
        border: `1px solid ${onInk.control}`,
        padding: '0 12px',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        textAlign: 'left',
      }}
    >
      {value === null ? (
        <span style={{ flex: 1, fontSize: 15, fontWeight: 800, color: onInk.muted, ...num }}>RPE {target} · target</span>
      ) : (
        <>
          <span
            style={{
              flex: 'none',
              padding: '4px 10px',
              borderRadius: R.chip,
              background: rpeColor(value),
              color: C.white,
              fontSize: 15,
              fontWeight: 800,
              ...num,
            }}
          >
            RPE {value}
          </span>
          {/* One line or nothing: a wrapping sentence would make the button
              grow and push the Log button about between sets. */}
          <span
            style={{
              flex: 1,
              minWidth: 0,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              fontSize: 12.5,
              fontWeight: 600,
              color: onInk.body,
            }}
          >
            {RPE_MEANING.get(value) ?? ''}
          </span>
        </>
      )}
      <span aria-hidden style={{ flex: 'none', fontSize: 18, fontWeight: 800, color: C.amberLight }}>
        ›
      </span>
    </Btn>
  );
}

/**
 * The picker, as a sheet. Choosing a value closes it in the same tap: between
 * sets nobody wants a second tap to confirm a number they just pressed.
 *
 * It is separate from the button so the screen can draw it outside the swipe
 * column. That column moves with a transform, and a transformed parent would
 * pin the sheet inside it — under the Log button instead of over the screen.
 */
export function RpePickerSheet({
  open,
  onClose,
  value,
  target,
  onPick,
  onExplain,
}: {
  open: boolean;
  onClose: () => void;
  value: number | null;
  target: number;
  onPick: (next: number | null) => void;
  /** Opens the fuller explainer, which is its own sheet. */
  onExplain: () => void;
}) {
  const pick = (next: number | null) => {
    onPick(next);
    onClose();
  };

  return (
    <DarkSheet open={open} onClose={onClose} title="How hard was that set?" titleSize={22} gap={14}>
      <RpePicker
        dark
        value={value}
        target={target}
        onPick={pick}
        after={
          <Btn
            // Two sheets stacked would need two Escapes and leave focus
            // guessing where to land; closing this one first keeps it simple.
            onClick={() => {
              onClose();
              onExplain();
            }}
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
      {value !== null && (
        <InkButton onClick={() => pick(null)} height={TOUCH} width="100%">
          Clear — log my target
        </InkButton>
      )}
    </DarkSheet>
  );
}
