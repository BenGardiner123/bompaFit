'use client';

// What warm-up, working and back-off mean — and what each one costs you.
//
// Three unlabelled words on a segmented control do not say what "back-off"
// means, and set type is the field whose mistake is invisible. A working set
// mistyped as a warm-up is quietly discounted in the fatigue model, skipped
// for records and left out of the chip count, and nothing on screen ever
// says so.

import { C, T, onInk } from '@/lib/tokens';
import { useBompa } from '@/state/BompaContext';
import { DarkSheet } from '@/components/ui';
import { sheetHairline } from '@/components/SheetParts';

// Each label carries its own colour so the three read apart at a glance, in the
// light variants that stay readable on ink. Warm-up is the quiet one because it
// is the set that counts least.
const TYPES: { label: string; what: string; costs: string; color: string }[] = [
  {
    label: 'Warm-up',
    what: 'The light sets before the real work — getting the joints moving and grooving the pattern.',
    costs: 'Counts a little. Discounted by how close it got to your working weight, so a 60kg triple before a 75kg set is not treated as nothing. Never sets a record and never fills your set count.',
    color: onInk.body,
  },
  {
    label: 'Working',
    what: 'The sets the programme actually asked for. This is the work that makes you stronger.',
    costs: 'Counts in full, weighted by RPE. This is what the whole model is built on.',
    color: C.amberLight,
  },
  {
    label: 'Back-off',
    what: 'Lighter sets after the heavy ones, usually for more reps — extra volume without the cost of another maximal set.',
    costs: 'Counts in full, exactly like a working set. Lighter and easier, so the numbers come out smaller on their own.',
    color: C.greenLight,
  },
];

export function SetTypeSheet() {
  const b = useBompa();
  const close = () => b.patch({ setTypeHelp: false });

  return (
    <DarkSheet
      open={b.s.setTypeHelp}
      onClose={close}
      eyebrow="Kinds of set"
      title="What each one costs you"
      label="What the set types mean"
    >
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {TYPES.map((type) => (
          <section key={type.label} style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '14px 0', ...sheetHairline }}>
            <h3 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: type.color }}>{type.label}</h3>
            <span style={{ fontSize: T.md, lineHeight: 1.5, color: onInk.text }}>{type.what}</span>
            <span style={{ fontSize: 13, lineHeight: 1.5, color: onInk.muted }}>{type.costs}</span>
          </section>
        ))}
      </div>

      <span style={{ fontSize: 13, lineHeight: 1.5, color: onInk.muted, paddingTop: 12, ...sheetHairline }}>
        Got one wrong? Tap its dot above the weight to change it. Type is the one field whose mistake never shows on screen; it just quietly
        makes your numbers read low.
      </span>
    </DarkSheet>
  );
}
