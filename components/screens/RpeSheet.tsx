'use client';

// What RPE means, and why Bompa cares.
//
// RPE is the single input the whole adaptation engine reads. Offering a row of
// numbers from 6 to 10 with no statement of what they mean is asking the user to
// guess at the thing the model is most sensitive to.

import { RPE_SCALE } from '@/lib/data';
import { C, T, num, onInk } from '@/lib/tokens';
import { useBompa } from '@/state/BompaContext';
import { DarkSheet } from '@/components/ui';
import { SheetHeading, sheetHairline } from '@/components/SheetParts';

// Whole numbers only, hardest first. The RPE picker shows every step
// including the halves; a list of nine rows here would be a wall rather than an
// explanation. Same source either way, so the two cannot disagree.
const SCALE = [...RPE_SCALE].filter((entry) => Number.isInteger(entry.rpe)).reverse();

/**
 * The numeral colour for an effort level, in the light variants that read on
 * ink: red for the sets that nearly or fully ran out, amber for two in the
 * tank, green for the comfortable ones.
 */
function effortColor(rpe: number): string {
  if (rpe >= 9) return C.redLight;
  if (rpe >= 8) return C.amberLight;
  return C.greenLight;
}

export function RpeSheet() {
  const b = useBompa();
  const close = () => b.patch({ rpeHelp: false });

  return (
    <DarkSheet
      open={b.s.rpeHelp}
      onClose={close}
      eyebrow="Rate of perceived exertion"
      title="Count what you left behind"
      label="What RPE means"
    >
      <ul style={{ display: 'flex', flexDirection: 'column', margin: 0, padding: 0, listStyle: 'none' }}>
        {SCALE.map((row) => (
          <li
            key={row.rpe}
            style={{ display: 'grid', gridTemplateColumns: '56px 1fr', gap: 10, alignItems: 'center', padding: '10px 0', ...sheetHairline }}
          >
            {/* Read as "RPE 9" rather than a bare "9" that could be anything. */}
            <span style={{ fontSize: 40, fontWeight: 800, lineHeight: 1, letterSpacing: '-0.03em', color: effortColor(row.rpe), ...num }}>
              <span className="sr-only">RPE </span>
              {row.rpe}
            </span>
            <span style={{ fontSize: T.md, lineHeight: 1.45, color: onInk.body }}>{row.left}</span>
          </li>
        ))}
      </ul>

      <section style={{ display: 'flex', flexDirection: 'column', gap: 5, paddingTop: 12, ...sheetHairline }}>
        <SheetHeading color={C.amberLight}>Why I ask</SheetHeading>
        <p style={{ margin: 0, fontSize: T.md, lineHeight: 1.5, color: onInk.text }}>
          RPE is how I weigh what a session cost you. The same tonnage at 9 costs noticeably more than at 6, and a week that runs consistently
          over target changes what I plan for the next one. It is the one number that makes this more than a ledger.
        </p>
      </section>

      <section style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        <SheetHeading>When you are not sure</SheetHeading>
        <p style={{ margin: 0, fontSize: T.md, lineHeight: 1.5, color: onInk.body }}>
          Leave it unset. I record the weight that was programmed for that set and mark it as an estimate rather than something you told me.
          A blank is honest; a guess is noise I would then act on.
        </p>
      </section>
    </DarkSheet>
  );
}
