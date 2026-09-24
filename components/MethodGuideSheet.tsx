'use client';

// One short explainer per training method, opened from the Train target line
// and the routine builder through `openMethodGuide(key)`; which one is open is
// `s.methodGuide`, and `closeMethodGuide()` shuts it.
//
// Every sheet has the same five parts in the same order, so a lifter who has
// read one knows where to look on the next. The words live in
// lib/methodGuides.ts and are bundled, so a guide opens with no signal.

import { C, num, onInk } from '@/lib/tokens';
import { methodGuide } from '@/lib/methodGuides';
import { useBompa } from '@/state/BompaContext';
import { DarkSheet } from '@/components/ui';
import { SheetDot, SheetHeading, sheetHairline } from '@/components/SheetParts';

// Guides quote figures (2110, 13 of 50), and those read steadier in tabular numerals.
const body = { margin: 0, fontSize: 14, lineHeight: 1.5, color: onInk.body, ...num } as const;

export function MethodGuideSheet() {
  const b = useBompa();
  const key = b.s.methodGuide;
  // Nothing open is the common case; the sheet only exists while a guide is.
  if (key === null) return null;
  const guide = methodGuide(key);

  return (
    <DarkSheet open onClose={b.closeMethodGuide} eyebrow="How it works" title={guide.title} label={`${guide.title} explained`}>
      <section style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        <SheetHeading>What it is</SheetHeading>
        {/* The one line most people read and stop at, so it gets the brightest colour. */}
        <p style={{ ...body, color: onInk.text }}>{guide.what}</p>
      </section>

      <section style={{ display: 'flex', flexDirection: 'column', gap: 5, paddingTop: 12, ...sheetHairline }}>
        <SheetHeading>How to do it</SheetHeading>
        {/* A real ordered list: the steps are a sequence, and a screen reader says "1 of 3". */}
        <ol style={{ ...body, display: 'flex', flexDirection: 'column', gap: 4, paddingLeft: 20 }}>
          {guide.steps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      </section>

      <section style={{ display: 'flex', flexDirection: 'column', gap: 5, paddingTop: 12, ...sheetHairline }}>
        <SheetHeading>How Bompa logs it</SheetHeading>
        <p style={body}>{guide.logs}</p>
      </section>

      <section style={{ display: 'flex', flexDirection: 'column', gap: 5, paddingTop: 12, ...sheetHairline }}>
        <SheetHeading color={C.amberLight}>What Bompa counts</SheetHeading>
        <p style={body}>{guide.counts}</p>
      </section>

      <section style={{ display: 'flex', flexDirection: 'column', gap: 5, paddingTop: 12, ...sheetHairline }}>
        <SheetHeading>Watch out for</SheetHeading>
        <div style={{ display: 'flex', gap: 9, alignItems: 'flex-start' }}>
          <SheetDot />
          <p style={{ ...body, color: onInk.text }}>{guide.caution}</p>
        </div>
      </section>
    </DarkSheet>
  );
}
