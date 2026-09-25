'use client';

// Rating sets after the moment has passed: from the catch-up line on Train,
// or from the summary once the session is finished. One row per set that was
// unrated when the sheet opened. The list is fixed at opening, so a row stays
// put, showing its new value, once it is rated rather than vanishing under
// the finger.

import { C, T, TOUCH, onInk } from '@/lib/tokens';
import { useBompa } from '@/state/BompaContext';
import { Btn, DarkSheet, InkButton } from '@/components/ui';
import { RateSetRow } from '@/components/RpeChips';

export function RateSheet() {
  const b = useBompa();
  const sheet = b.s.rateSheet;
  const close = () => b.patch({ rateSheet: null });
  if (!sheet) return null;

  const rows = sheet.setIds.flatMap((id) => {
    const row = b.sets.find((x) => x.id === id);
    return row ? [row] : [];
  });
  const name = sheet.title ?? b.exerciseById.get(sheet.exerciseId)?.name ?? sheet.exerciseId;
  // Sets from more than one lift say whose they are, not just their number.
  const mixed = new Set(rows.map((row) => row.exerciseId)).size > 1;
  const prefix = (row: (typeof rows)[number]) =>
    mixed ? `${b.exerciseById.get(row.exerciseId)?.short ?? row.exerciseId} set ${row.setNo} · ` : `Set ${row.setNo} · `;

  return (
    <DarkSheet open onClose={close} eyebrow="How did they feel?" title={name} titleSize={22} label={`Rate ${name}`} gap={16}>
      {rows.map((row) => (
        <RateSetRow key={row.id} row={row} prefix={prefix(row)} />
      ))}
      <span style={{ fontSize: T.sm, lineHeight: 1.4, color: onInk.muted }}>
        Any you leave keep your aim, marked as an estimate.{' '}
        <Btn
          onClick={() => {
            close();
            b.patch({ rpeHelp: true });
          }}
          style={{ display: 'inline-flex', alignItems: 'center', minHeight: TOUCH, verticalAlign: 'middle', fontSize: T.sm, fontWeight: 800, color: C.amberLight }}
        >
          What&rsquo;s RPE?
        </Btn>
      </span>
      <InkButton variant="amber" onClick={close} height={56} fontSize={T.lg}>
        Done
      </InkButton>
    </DarkSheet>
  );
}
