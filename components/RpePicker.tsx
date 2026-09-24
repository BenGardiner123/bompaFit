'use client';

// The RPE selector: nine chips, and what the chosen one means underneath.
//
// It is a grid rather than the single scrolling row the design drew, and that
// is the only change from it. At 412px the row could not fit nine chips, so it
// scrolled — putting 9, 9.5 and 10 off screen. Those are the readings the
// adaptation engine is most sensitive to, and mid-set with one hand that is
// exactly how a brutal set gets logged as 8.5 because 8.5 was what was visible.
//
// Five columns at 412px leaves 64px a chip, comfortably over the 44px touch
// target minimum, with nothing off screen and nothing to scroll.

import type { ReactNode } from 'react';
import { RPE_MEANING, RPE_SCALE } from '@/lib/data';
import { C, R, num, onInk } from '@/lib/tokens';
import { Btn } from '@/components/ui';

/** Green below 8, amber through the 8s, red at 9 and above. */
export function rpeColor(value: number): string {
  return value >= 9 ? C.redDark : value >= 8 ? C.amberDark : C.greenDark;
}

export function RpePicker({
  value,
  target,
  onPick,
  dark = false,
  after,
}: {
  /** Null means the lifter has not said, which is allowed. */
  value: number | null;
  /** Recorded on their behalf when they leave it unset. */
  target: number;
  onPick: (next: number | null) => void;
  /**
   * The ink version, for the Train screen: unselected chips go transparent with
   * a dark outline. Off by default so the light sheets that share this picker
   * keep their look until they are restyled themselves.
   */
  dark?: boolean;
  /** Sits on the same line as the meaning, e.g. a "What's RPE?" link. */
  after?: ReactNode;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 6 }}>
        {RPE_SCALE.map((entry) => {
          const on = value === entry.rpe;
          return (
            <Btn
              key={entry.rpe}
              // Tapping the chosen one again clears it. Leaving RPE unset is a
              // legitimate answer, and it needs a way back out.
              onClick={() => onPick(on ? null : entry.rpe)}
              label={`RPE ${entry.rpe}`}
              style={{
                height: 48,
                borderRadius: R.chip,
                fontSize: 15,
                fontWeight: 800,
                background: on ? rpeColor(entry.rpe) : dark ? 'transparent' : C.screen,
                border: `1px solid ${on ? rpeColor(entry.rpe) : dark ? onInk.control : C.line}`,
                color: on ? C.white : dark ? onInk.body : C.ink60,
                ...num,
              }}
            >
              {entry.rpe}
            </Btn>
          );
        })}
      </div>

      {/* What the chosen value means, at the moment it is chosen. The explainer
          sheet is still there for the fuller story, but nobody opens a sheet
          between sets — and RPE is the one input the whole model reads. */}
      <div
        style={{
          fontSize: dark ? 12.5 : 11.5,
          fontWeight: 600,
          lineHeight: 1.4,
          minHeight: dark ? 18 : 16,
          color: dark ? onInk.body : C.tertiary,
          textAlign: dark ? 'center' : undefined,
        }}
      >
        {/* Only the meaning is the live region. The link beside it would
            otherwise be re-announced every time a chip is tapped. */}
        <span role="status">
          {value === null
            ? `Not sure? Leave it and I'll record your target of ${target}.`
            : (RPE_MEANING.get(value) ?? '')}
        </span>
        {after !== undefined && <> {after}</>}
      </div>
    </div>
  );
}
