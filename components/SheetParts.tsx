'use client';

// Small pieces shared by the content of the dark bottom sheets. The sheet shell
// itself (scrim, panel, header, close control) is `DarkSheet` in ui.tsx; these
// are the parts that repeat *inside* several sheets, kept in one place so the
// How-to, RPE and set-type explainers can't drift apart in how they label things.

import type { CSSProperties, ReactNode } from 'react';
import { C, T, W, num, onInk } from '@/lib/tokens';

/**
 * The small label over a block inside a sheet: Execution, Why I ask.
 *
 * A real heading, one level under the sheet's own title, so a screen reader can
 * jump between blocks.
 */
export function SheetHeading({ children, color = onInk.muted, style }: { children: ReactNode; color?: string; style?: CSSProperties }) {
  return (
    <h3
      style={{
        margin: 0,
        fontSize: T.sm,
        fontWeight: W.label,
        color,
        ...num,
        ...style,
      }}
    >
      {children}
    </h3>
  );
}

/** A hairline across the sheet, the dark-surface stand-in for a card border. */
export const sheetHairline: CSSProperties = { borderTop: `1px solid ${onInk.line}` };

/** The amber marker in front of a warning or a note that wants attention. */
export function SheetDot() {
  return <span aria-hidden style={{ width: 7, height: 7, borderRadius: '50%', background: C.amber, marginTop: 7, flex: 'none' }} />;
}
